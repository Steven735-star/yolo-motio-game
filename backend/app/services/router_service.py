from __future__ import annotations
import numpy as np

from app.models.schemas import ChallengeType, WorkerResult
from app.services.object_worker import ObjectWorker
from app.services.pose_worker import PoseWorker
from app.services.motion_worker import MotionWorker


class TaskRouter:
    def __init__(
        self,
        pose_worker: PoseWorker,
        object_worker: ObjectWorker,
        motion_worker: MotionWorker,
        settings=None,
    ) -> None:
        self.pose_worker = pose_worker
        self.object_worker = object_worker
        self._base_motion_worker = motion_worker
        self._settings = settings or motion_worker.settings
        # Un MotionWorker independiente por jugador
        self._motion_workers: dict[str, MotionWorker] = {}

    def _get_motion_worker(self, player_id: str) -> MotionWorker:
        if player_id not in self._motion_workers:
            self._motion_workers[player_id] = MotionWorker(self._settings)
        return self._motion_workers[player_id]

    def remove_player(self, player_id: str) -> None:
        """Llamar cuando un jugador se desconecta para liberar memoria."""
        self._motion_workers.pop(player_id, None)

    def process(
        self,
        challenge_type: ChallengeType,
        frame: np.ndarray,
        target: str,
        player_id: str = "default",
    ) -> WorkerResult:
        if challenge_type == ChallengeType.pose:
            return self.pose_worker.analyze(frame, target)

        if challenge_type == ChallengeType.object:
            return self.object_worker.analyze(frame, target)

        if challenge_type == ChallengeType.motion:
            worker = self._get_motion_worker(player_id)
            return worker.analyze(frame, target)

        raise ValueError(f"Tipo de challenge no soportado: {challenge_type}")