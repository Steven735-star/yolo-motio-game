from __future__ import annotations

from ultralytics import YOLO

from app.config import Settings
from app.models.schemas import ChallengeType, WorkerResult


class ObjectWorker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = YOLO(settings.detect_model)

    def analyze(self, frame, target: str) -> WorkerResult:
        target = target.lower().strip()
        frame_h, frame_w = frame.shape[:2]
        frame_area = max(1, frame_h * frame_w)

        results = self.model.predict(
            source=frame,
            conf=self.settings.object_conf,
            imgsz=self.settings.image_size,
            verbose=False,
        )
        if not results:
            return WorkerResult(
                challenge_type=ChallengeType.object,
                target=target,
                matched=False,
                confidence=0.0,
                details={"reason": "No hubo resultado del modelo."},
            )

        result = results[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return WorkerResult(
                challenge_type=ChallengeType.object,
                target=target,
                matched=False,
                confidence=0.0,
                details={"reason": "No se detectaron objetos."},
            )

        best_conf = 0.0
        best_label = None
        best_box = None
        seen: list[dict] = []

        for box, cls_tensor, conf_tensor in zip(boxes.xyxy, boxes.cls, boxes.conf):
            cls_id = int(cls_tensor.item())
            conf = float(conf_tensor.item())
            label = str(self.model.names[cls_id]).lower()

            x1, y1, x2, y2 = [float(v) for v in box.tolist()]
            area_ratio = max(0.0, ((x2 - x1) * (y2 - y1)) / frame_area)

            seen.append(
                {
                    "label": label,
                    "confidence": round(conf, 4),
                    "bboxAreaRatio": round(area_ratio, 4),
                }
            )

            if area_ratio < self.settings.min_object_bbox_area_ratio:
                continue

            if label == target and conf > best_conf:
                best_conf = conf
                best_label = label
                best_box = [x1, y1, x2, y2]

        return WorkerResult(
            challenge_type=ChallengeType.object,
            target=target,
            matched=best_label == target,
            confidence=float(best_conf),
            details={
                "detectedTarget": best_label,
                "bbox": best_box,
                "topDetections": seen[:10],
            },
        )