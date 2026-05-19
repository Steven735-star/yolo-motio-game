from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import cv2
from ultralytics import YOLO

from app.config import Settings
from app.models.schemas import ChallengeType, WorkerResult

NOSE = 0
LEFT_EYE = 1
RIGHT_EYE = 2
LEFT_EAR = 3
RIGHT_EAR = 4
LEFT_SHOULDER = 5
RIGHT_SHOULDER = 6
LEFT_ELBOW = 7
RIGHT_ELBOW = 8
LEFT_WRIST = 9
RIGHT_WRIST = 10
LEFT_HIP = 11
RIGHT_HIP = 12



@dataclass
class PoseKeypoints:
    xy: np.ndarray
    conf: np.ndarray


class PoseWorker:
    
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = YOLO(settings.pose_model)

    def analyze(self, frame: np.ndarray, target: str) -> WorkerResult:
        results = self.model.predict(
            source=frame,
            conf=self.settings.pose_conf,
            imgsz=self.settings.image_size,
            verbose=False
        )

        if not results or results[0].keypoints is None:
            return WorkerResult(
                challenge_type=ChallengeType.pose,
                target=target,
                matched=False,
                confidence=0.0,
                details={"reason": "No se detectó una persona."},
            )

        result = results[0]
        xy = result.keypoints.xy[0].cpu().numpy()
        conf = result.keypoints.conf[0].cpu().numpy() if result.keypoints.conf is not None else np.ones(len(xy))
        pose = PoseKeypoints(xy=xy, conf=conf)

        # Match de pose pura (sin pasar 'result' de segmentación)
        matched, score, details = self._match_pose(pose, target)

        # Formateo de keypoints para el frontend
        keypoints = [{"x": float(pt[0]), "y": float(pt[1]), "conf": float(conf[i])} for i, pt in enumerate(xy)]
        details["keypoints"] = keypoints

        return WorkerResult(
            challenge_type=ChallengeType.pose,
            target=target,
            matched=bool(matched),
            confidence=float(score),
            details=details,
        )

    def analyze_calibration(self, frame: np.ndarray) -> dict[str, Any]:
        results = self.model.predict(
            source=frame,
            conf=self.settings.pose_conf,
            imgsz=self.settings.image_size,
            verbose=False,
        )

        if not results:
            return {
                "detected": False,
                "confidence": 0.0,
                "keypointsVisible": 0,
                "ready": False,
                "keypoints": [],
            }

        result = results[0]
        if result.keypoints is None or result.keypoints.xy is None or len(result.keypoints.xy) == 0:
            return {
                "detected": False,
                "confidence": 0.0,
                "keypointsVisible": 0,
                "ready": False,
                "keypoints": [],
            }

        xy = result.keypoints.xy[0].cpu().numpy()
        conf = result.keypoints.conf[0].cpu().numpy() if result.keypoints.conf is not None else np.ones(len(xy))
        visible = int(sum(float(c) >= self.settings.pose_keypoint_conf for c in conf))

        keypoints = [
            {
                "x": float(pt[0]),
                "y": float(pt[1]),
                "conf": float(conf[i]) if i < len(conf) else 0.0,
            }
            for i, pt in enumerate(xy)
        ]

        confidence = min(1.0, visible / 10.0)
        ready = visible >= 8

        return {
            "detected": True,
            "confidence": float(confidence),
            "keypointsVisible": visible,
            "ready": bool(ready),
            "keypoints": keypoints,
        }

    def _match_pose(self, pose: PoseKeypoints, target: str) -> tuple[bool, float, dict[str, Any]]:
            target = target.lower().strip()

            # --- Poses Originales ---
            if target in {"both_hands_up", "hands_up"}:
                left = self._wrist_above_shoulder(pose, LEFT_WRIST, LEFT_SHOULDER)
                right = self._wrist_above_shoulder(pose, RIGHT_WRIST, RIGHT_SHOULDER)
                return bool(left and right), float((float(left) + float(right)) / 2), {"left": left, "right": right}

            if target == "left_hand_up":
                left = self._wrist_above_shoulder(pose, LEFT_WRIST, LEFT_SHOULDER)
                return bool(left), float(left), {"matched": left}

            if target == "right_hand_up":
                right = self._wrist_above_shoulder(pose, RIGHT_WRIST, RIGHT_SHOULDER)
                return bool(right), float(right), {"matched": right}

            if target == "t_pose":
                ok_left, _ = self._wrist_aligned_horizontally(pose, LEFT_WRIST, LEFT_SHOULDER)
                ok_right, _ = self._wrist_aligned_horizontally(pose, RIGHT_WRIST, RIGHT_SHOULDER)
                wide = self._arms_wide(pose)
                return bool(ok_left and ok_right and wide), 1.0 if (ok_left and ok_right) else 0.0, {}

            if target == "hands_on_hips":
                # Muñeca cerca de la cadera
                left_hip = self._near_point(pose, LEFT_WRIST, LEFT_HIP, dist=65.0)
                right_hip = self._near_point(pose, RIGHT_WRIST, RIGHT_HIP, dist=65.0)
                # El codo debe estar flexionado: codo separado lateralmente del hombro
                left_bent = self._elbow_bent_outward(pose, LEFT_ELBOW, LEFT_SHOULDER, LEFT_WRIST)
                right_bent = self._elbow_bent_outward(pose, RIGHT_ELBOW, RIGHT_SHOULDER, RIGHT_WRIST)
                ok = left_hip and right_hip and left_bent and right_bent
                return bool(ok), 1.0 if ok else 0.0, {}

            # 1. Bíceps (Derecho, Izquierdo o Ambos)
            if target in {"biceps_right", "biceps_left", "both_biceps"}:
                # Se detecta si la muñeca está cerca del hombro del mismo lado y el codo está elevado
                # Simplificación: Muñeca arriba del codo y codo a la altura del hombro
                is_right = self._wrist_above_shoulder(pose, RIGHT_WRIST, RIGHT_ELBOW) # 8 es RIGHT_ELBOW (aproximado)
                is_left = self._wrist_above_shoulder(pose, LEFT_WRIST, LEFT_ELBOW)   # 7 es LEFT_ELBOW (aproximado)

                if target == "biceps_right": return is_right, 1.0 if is_right else 0.0, {}
                if target == "biceps_left": return is_left, 1.0 if is_left else 0.0, {}
                return bool(is_right and is_left), 1.0 if (is_right and is_left) else 0.0, {}

            # 2. Tápese los ojos o los oídos
            if target == "cover_eyes":
                # Muñecas cerca de los ojos (puntos 1 y 2 de COCO)
                left_cover = self._near_point(pose, LEFT_WRIST, 1, dist=45.0) 
                right_cover = self._near_point(pose, RIGHT_WRIST, 2, dist=45.0)
                return bool(left_cover and right_cover), 1.0 if (left_cover and right_cover) else 0.0, {}

            if target == "cover_ears":
                # Muñecas cerca de los oídos (puntos 3 y 4 de COCO)
                left_cover = self._near_point(pose, LEFT_WRIST, 3, dist=50.0) 
                right_cover = self._near_point(pose, RIGHT_WRIST, 4, dist=50.0)
                return bool(left_cover and right_cover), 1.0 if (left_cover and right_cover) else 0.0, {}

            # 3. Manos cruzadas a hombros
            if target == "right_hand_to_left_shoulder":
                matched = self._near_point(pose, RIGHT_WRIST, LEFT_SHOULDER, dist=70.0)
                return matched, 1.0 if matched else 0.0, {}

            if target == "left_hand_to_right_shoulder":
                matched = self._near_point(pose, LEFT_WRIST, RIGHT_SHOULDER, dist=70.0)
                return matched, 1.0 if matched else 0.0, {}

            return False, 0.0, {"reason": f"Pose target no soportado: {target}"}

    def _wrist_above_shoulder(self, pose: PoseKeypoints, wrist_idx: int, shoulder_idx: int) -> bool:
        if not self._is_reliable(pose, wrist_idx) or not self._is_reliable(pose, shoulder_idx):
            return False
        wrist_y = pose.xy[wrist_idx][1]
        shoulder_y = pose.xy[shoulder_idx][1]
        return bool(wrist_y < shoulder_y - 15)

    def _wrist_aligned_horizontally(self, pose: PoseKeypoints, wrist_idx: int, shoulder_idx: int) -> tuple[bool, float | None]:
        if not self._is_reliable(pose, wrist_idx) or not self._is_reliable(pose, shoulder_idx):
            return False, None
        wrist_y = pose.xy[wrist_idx][1]
        shoulder_y = pose.xy[shoulder_idx][1]
        delta = abs(float(wrist_y - shoulder_y))
        return bool(delta <= 35.0), float(delta)

    def _arms_wide(self, pose: PoseKeypoints) -> bool:
        required = [LEFT_WRIST, RIGHT_WRIST, LEFT_SHOULDER, RIGHT_SHOULDER]
        if not all(self._is_reliable(pose, idx) for idx in required):
            return False
        wrist_span = abs(float(pose.xy[RIGHT_WRIST][0] - pose.xy[LEFT_WRIST][0]))
        shoulder_span = abs(float(pose.xy[RIGHT_SHOULDER][0] - pose.xy[LEFT_SHOULDER][0]))
        return bool(wrist_span > shoulder_span * 1.6)

    def _near_point(self, pose: PoseKeypoints, point_a_idx: int, point_b_idx: int, dist: float = 65.0) -> bool:
        if not self._is_reliable(pose, point_a_idx) or not self._is_reliable(pose, point_b_idx):
            return False
        a = pose.xy[point_a_idx]
        b = pose.xy[point_b_idx]
        actual_dist = float(np.linalg.norm(a - b))
        return bool(actual_dist < dist)


    def _is_reliable(self, pose: PoseKeypoints, idx: int) -> bool:
        return bool(idx < len(pose.conf) and float(pose.conf[idx]) >= self.settings.pose_keypoint_conf)
    
    def _elbow_bent_outward(
        self,
        pose: PoseKeypoints,
        elbow_idx: int,
        shoulder_idx: int,
        wrist_idx: int,
    ) -> bool:
        """
        Devuelve True si el codo está flexionado hacia afuera.
        Condición: el codo está desplazado lateralmente más allá del hombro
        Y la distancia muñeca-codo es pequeña (brazo doblado, no estirado).
        """
        if not all(self._is_reliable(pose, i) for i in [elbow_idx, shoulder_idx, wrist_idx]):
            return False
        # El codo debe sobresalir lateralmente respecto al hombro
        elbow_x = pose.xy[elbow_idx][0]
        shoulder_x = pose.xy[shoulder_idx][0]
        lateral_offset = abs(float(elbow_x - shoulder_x))
        # Muñeca cerca del codo (brazo doblado)
        wrist_to_elbow = float(np.linalg.norm(pose.xy[wrist_idx] - pose.xy[elbow_idx]))
        return bool(lateral_offset > 30.0 and wrist_to_elbow < 80.0)
