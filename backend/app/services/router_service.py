from __future__ import annotations

import numpy as np

from app.models.schemas import ChallengeType, WorkerResult
from app.services.object_worker import ObjectWorker
from app.services.pose_worker import PoseWorker


class TaskRouter:
    def __init__(self, pose_worker: PoseWorker, object_worker: ObjectWorker) -> None:
        self.pose_worker = pose_worker
        self.object_worker = object_worker

    def process(self, challenge_type: ChallengeType, frame: np.ndarray, target: str) -> WorkerResult:
        if challenge_type == ChallengeType.pose:
            return self.pose_worker.analyze(frame, target)

        if challenge_type == ChallengeType.object:
            return self.object_worker.analyze(frame, target)

        raise ValueError(f"Tipo de challenge no soportado: {challenge_type}")