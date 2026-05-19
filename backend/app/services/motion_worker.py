import time
import cv2
import numpy as np
from ultralytics import YOLO
from app.models.schemas import WorkerResult, ChallengeType


class MotionWorker:
    def __init__(self, settings):
        self.settings = settings
        self.model = YOLO(settings.seg_model)

        # --- CONFIGURACIÓN DE UMBRALES ---
        self.IOU_THRESHOLD = 0.85          # Más estricto que antes (0.88 → 0.92)
        self.INTERNAL_THRESHOLD = 80000   # Píxeles de movimiento interno máximo

        # --- HISTORIAL DE MÁSCARAS (ventana de 5 frames, como en el laboratorio) ---
        self.WINDOW_COMPARE = 5
        self.mask_history = []

        # Frame gris anterior para cálculo de movimiento interno
        self.prev_frame_gray = None

        # Kernel morfológico para filtrar ruido en la máscara
        self.kernel = np.ones((5, 5), np.uint8)

        # --- PROGRESO DE LA BARRA ---
        self.current_progress = 0.0
        self.last_target = None
        self.last_time = None

        # Tasa de cambio: 20% por segundo → 100% en 5 segundos
        self.PROGRESS_STEP = 20.0

    def analyze(self, frame: np.ndarray, target: str) -> WorkerResult:
        # Resetear estado si cambió el target
        if self.last_target != target:
            self.current_progress = 100.0 if target == "stay_still" else 0.0
            self.last_target = target
            self.prev_frame_gray = None
            self.mask_history = []
            self.last_time = time.time()

        now = time.time()
        dt = now - self.last_time
        self.last_time = now

        # Convertir a gris para movimiento interno
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Inferencia
        results = self.model.predict(source=frame, conf=self.settings.pose_conf, verbose=False)
        result = results[0]

        current_status, combined_mask = self._check_motion_status(frame, gray, result)

        step = self.PROGRESS_STEP * dt

        # --- Lógica para "NO TE MUEVAS" (stay_still) ---
        if target == "stay_still":
            if current_status == "STABLE":
                # Recupera barra lentamente si se quedó quieto
                self.current_progress = min(100.0, self.current_progress + (step * 0.5))
            elif current_status == "MOVING":
                # Penalización agresiva por moverse
                self.current_progress = max(0.0, self.current_progress - (step * 2.0))
            # "NO_PERSON" no modifica la barra

        # --- Lógica para "MANTENTE EN MOVIMIENTO" (any_movement) ---
        elif target == "any_movement":
            if current_status == "MOVING":
                self.current_progress = min(100.0, self.current_progress + step)
            elif current_status == "STABLE":
                # Baja si se queda quieto
                self.current_progress = max(0.0, self.current_progress - (step * 1.5))
            # "NO_PERSON" no modifica la barra

        # El puntaje se calcula al FINAL de la ronda en game_service.py
        # matched=False siempre durante la ronda; el campo progress es lo que importa
        matched = False

        # --- Visualización: overlay de la máscara sobre el frame ---
        return WorkerResult(
            challenge_type=ChallengeType.motion,
            target=target,
            matched=matched,
            confidence=1.0 if current_status == "MOVING" else 0.0,
            details={
                "status": current_status,
                "progress": round(self.current_progress, 2),
                "required_time": 5.0,
            }
        )

    def _check_motion_status(self, frame: np.ndarray, gray: np.ndarray, result) -> tuple[str, np.ndarray | None]:
        """
        Retorna (status, combined_mask).
        status: "MOVING" | "STABLE" | "NO_PERSON"
        """
        combined_mask = None

        # 1. Filtrar solo máscaras de personas (igual que el laboratorio)
        if result.masks is not None and result.boxes is not None:
            classes = result.boxes.cls.cpu().numpy()

            for i, cls in enumerate(classes):
                if self.model.names[int(cls)] == "person":
                    mask = result.masks.data[i].cpu().numpy()
                    mask = (mask > 0.5).astype(np.uint8)

                    # Filtrar ruido morfológico
                    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self.kernel)

                    if combined_mask is None:
                        combined_mask = mask
                    else:
                        combined_mask = np.logical_or(combined_mask, mask).astype(np.uint8)

        if combined_mask is None:
            self.prev_frame_gray = gray.copy()
            # Sin persona: el progreso cae a 0 rápidamente
            self.current_progress = max(0.0, self.current_progress - (self.PROGRESS_STEP * 2.0))
            return "NO_PERSON", None

        # 2. Movimiento interno: absdiff del frame gris dentro de la máscara
        internal_motion = 0
        if self.prev_frame_gray is not None:
            # Redimensionar máscara al tamaño del frame gris si difieren
            mask_resized = cv2.resize(
                combined_mask,
                (gray.shape[1], gray.shape[0]),
                interpolation=cv2.INTER_NEAREST
            )
            frame_diff = cv2.absdiff(gray, self.prev_frame_gray)
            motion_region = frame_diff * mask_resized
            internal_motion = int(np.sum(motion_region))

        # 3. Actualizar frame gris anterior
        self.prev_frame_gray = gray.copy()

        # 4. Historial de máscaras (ventana de 5 frames)
        self.mask_history.append(combined_mask.copy())
        if len(self.mask_history) < self.WINDOW_COMPARE:
            return "STABLE", combined_mask

        old_mask = self.mask_history[0]
        self.mask_history = self.mask_history[1:]

        # Ajustar tamaños si difieren
        if combined_mask.shape != old_mask.shape:
            old_mask = cv2.resize(
                old_mask,
                (combined_mask.shape[1], combined_mask.shape[0]),
                interpolation=cv2.INTER_NEAREST
            )

        # 5. IoU entre máscara actual y la de hace 5 frames
        intersection = np.logical_and(combined_mask, old_mask).sum()
        union = np.logical_or(combined_mask, old_mask).sum()
        iou = intersection / union if union > 0 else 1.0

        # 6. Decisión final (igual que el laboratorio)
        if iou < self.IOU_THRESHOLD or internal_motion > self.INTERNAL_THRESHOLD:
            return "MOVING", combined_mask
        else:
            return "STABLE", combined_mask

    def _build_mask_overlay(self, frame: np.ndarray, mask: np.ndarray, status: str) -> str | None:
        """
        Genera un overlay visual de la máscara sobre el frame.
        Verde = STABLE, Rojo = MOVING.
        Retorna la imagen como base64 JPEG para enviar al frontend.
        """
        try:
            import base64

            # Color según estado
            color = (0, 255, 0) if status == "STABLE" else (0, 0, 255)  # BGR

            # Redimensionar máscara al tamaño del frame
            h, w = frame.shape[:2]
            mask_resized = cv2.resize(
                mask.astype(np.uint8),
                (w, h),
                interpolation=cv2.INTER_NEAREST
            )

            overlay = frame.copy()
            overlay[mask_resized == 1] = (
                overlay[mask_resized == 1] * 0.5 +
                np.array(color, dtype=np.float32) * 0.5
            ).astype(np.uint8)

            # Contorno de la máscara
            contours, _ = cv2.findContours(mask_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, color, 2)

            # Texto de estado
            label = "QUIETO" if status == "STABLE" else "MOVIMIENTO"
            cv2.putText(overlay, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, color, 3)

            # Codificar a JPEG base64
            _, buf = cv2.imencode(".jpg", overlay, [cv2.IMWRITE_JPEG_QUALITY, 60])
            return "data:image/jpeg;base64," + base64.b64encode(buf).decode("utf-8")

        except Exception:
            return None