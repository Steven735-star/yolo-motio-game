from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from ultralytics import YOLO

from app.config import Settings
from app.models.schemas import ChallengeType, WorkerResult

NOSE = 0
LEFT_SHOULDER = 5
RIGHT_SHOULDER = 6
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
            verbose=False,
        )

        if not results:
            return WorkerResult(
                challenge_type=ChallengeType.pose,
                target=target,
                matched=False,
                confidence=0.0,
                details={"reason": "No hubo resultado del modelo."},
            )

        result = results[0]
        if result.keypoints is None or result.keypoints.xy is None or len(result.keypoints.xy) == 0:
            return WorkerResult(
                challenge_type=ChallengeType.pose,
                target=target,
                matched=False,
                confidence=0.0,
                details={"reason": "No se detectó una persona con keypoints válidos."},
            )

        xy = result.keypoints.xy[0].cpu().numpy()
        conf = result.keypoints.conf[0].cpu().numpy() if result.keypoints.conf is not None else np.ones(len(xy))
        pose = PoseKeypoints(xy=xy, conf=conf)

        matched, score, details = self._match_pose(pose, target)

        keypoints = [
            {
                "x": float(pt[0]),
                "y": float(pt[1]),
                "conf": float(conf[i]) if i < len(conf) else 1.0,
            }
            for i, pt in enumerate(xy)
        ]

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
                "conf": float(conf[i]) if i < len(conf) else 1.0,
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

        if target in {"both_hands_up", "hands_up"}:
            left = self._wrist_above_shoulder(pose, LEFT_WRIST, LEFT_SHOULDER)
            right = self._wrist_above_shoulder(pose, RIGHT_WRIST, RIGHT_SHOULDER)
            score = float((float(left) + float(right)) / 2)
            return bool(left and right), score, {
                "leftHandUp": bool(left),
                "rightHandUp": bool(right),
            }

        if target == "left_hand_up":
            left = self._wrist_above_shoulder(pose, LEFT_WRIST, LEFT_SHOULDER)
            return bool(left), float(left), {"leftHandUp": bool(left)}

        if target == "right_hand_up":
            right = self._wrist_above_shoulder(pose, RIGHT_WRIST, RIGHT_SHOULDER)
            return bool(right), float(right), {"rightHandUp": bool(right)}

        if target == "t_pose":
            ok_left, left_delta = self._wrist_aligned_horizontally(pose, LEFT_WRIST, LEFT_SHOULDER)
            ok_right, right_delta = self._wrist_aligned_horizontally(pose, RIGHT_WRIST, RIGHT_SHOULDER)
            wide_enough = self._arms_wide(pose)
            score = float((float(ok_left) + float(ok_right) + float(wide_enough)) / 3)
            return bool(ok_left and ok_right and wide_enough), score, {
                "leftAligned": bool(ok_left),
                "rightAligned": bool(ok_right),
                "armsWide": bool(wide_enough),
                "leftDelta": float(left_delta) if left_delta is not None else None,
                "rightDelta": float(right_delta) if right_delta is not None else None,
            }

        if target == "hands_on_hips":
            left = self._near_point(pose, LEFT_WRIST, LEFT_HIP)
            right = self._near_point(pose, RIGHT_WRIST, RIGHT_HIP)
            score = float((float(left) + float(right)) / 2)
            return bool(left and right), score, {
                "leftHandOnHip": bool(left),
                "rightHandOnHip": bool(right),
            }

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

    def _near_point(self, pose: PoseKeypoints, point_a_idx: int, point_b_idx: int) -> bool:
        if not self._is_reliable(pose, point_a_idx) or not self._is_reliable(pose, point_b_idx):
            return False
        a = pose.xy[point_a_idx]
        b = pose.xy[point_b_idx]
        dist = float(np.linalg.norm(a - b))
        return bool(dist < 65.0)

    def _is_reliable(self, pose: PoseKeypoints, idx: int) -> bool:
        return bool(idx < len(pose.conf) and float(pose.conf[idx]) >= self.settings.pose_keypoint_conf)