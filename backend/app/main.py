from __future__ import annotations

import json
import time
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app.config import get_settings
from app.core.manager import ConnectionManager
from app.models.schemas import (
    CalibrationFrameMessage,
    ChallengeType,
    ClientEventType,
    JoinMessage,
    LeaveMessage,
    MatchSnapshot,
    PingMessage,
    PlayerFrameMessage,
    ReadyMessage,
    ServerEvent,
    StartMatchMessage,
)
from app.services.game_service import GameCoordinator
from app.services.metrics_service import MetricsService
from app.services.object_worker import ObjectWorker
from app.services.pose_worker import PoseWorker
from app.services.router_service import TaskRouter
from app.utils.image_decode import ImageDecodeError, decode_base64_image, resize_for_inference

settings = get_settings()
app = FastAPI(title=settings.app_name, debug=settings.debug)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()
game = GameCoordinator(settings)
pose_worker = PoseWorker(settings)
object_worker = ObjectWorker(settings)
router = TaskRouter(pose_worker=pose_worker, object_worker=object_worker)
metrics = MetricsService()

last_frame_seen: dict[tuple[str, str], float] = {}
calibration_stability: dict[tuple[str, str], int] = {}
last_player_seen: dict[tuple[str, str], float] = {}

persisted_matches: set[str] = set()
persisted_players: set[tuple[str, str]] = set()
persisted_rounds: set[tuple[str, int]] = set()
finished_matches: set[str] = set()

PLAYER_TTL_SECONDS = 8.0


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "detect_model": settings.detect_model,
        "pose_model": settings.pose_model,
        "ts": time.time(),
    }


@app.get("/matches/{match_id}")
def get_match(match_id: str) -> dict[str, Any]:
    _prune_stale_players(match_id)
    snapshot = game.tick(match_id)
    _sync_snapshot_to_metrics(snapshot)
    return snapshot.model_dump()


@app.websocket("/ws/{match_id}")
async def websocket_match(websocket: WebSocket, match_id: str) -> None:
    current_player_id: str | None = None

    try:
        await manager.connect(match_id, websocket)

        await manager.send(
            websocket,
            ServerEvent(
                event="connected",
                data={"matchId": match_id, "serverTime": time.time()},
            ),
        )

        while True:
            raw = await websocket.receive_text()

            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send(
                    websocket,
                    ServerEvent(event="error", ok=False, message="JSON inválido."),
                )
                continue

            event_type = payload.get("type")
            if not event_type:
                await manager.send(
                    websocket,
                    ServerEvent(event="error", ok=False, message="Falta el campo 'type'."),
                )
                continue

            try:
                if event_type == ClientEventType.join:
                    msg = JoinMessage(**payload)
                    _ensure_same_match(msg.matchId, match_id)
                    current_player_id = msg.playerId
                    _mark_seen(msg.matchId, msg.playerId)

                    snapshot = game.join_player(msg.matchId, msg.playerId, msg.displayName)

                    _safe_save_player(
                        match_id=msg.matchId,
                        player_id=msg.playerId,
                        display_name=msg.displayName or msg.playerId,
                    )

                    _sync_snapshot_to_metrics(snapshot)

                    await manager.broadcast(
                        msg.matchId,
                        ServerEvent(event="match_state", data=snapshot.model_dump()),
                    )
                    continue

                if event_type == ClientEventType.ready:
                    msg = ReadyMessage(**payload)
                    _ensure_same_match(msg.matchId, match_id)
                    current_player_id = msg.playerId
                    _mark_seen(msg.matchId, msg.playerId)

                    snapshot = game.set_ready(msg.matchId, msg.playerId, msg.ready)
                    _sync_snapshot_to_metrics(snapshot)

                    await manager.broadcast(
                        msg.matchId,
                        ServerEvent(event="match_state", data=snapshot.model_dump()),
                    )
                    continue

                if event_type == ClientEventType.start_match:
                    msg = StartMatchMessage(**payload)
                    _ensure_same_match(msg.matchId, match_id)
                    if msg.playerId:
                        current_player_id = msg.playerId
                        _mark_seen(msg.matchId, msg.playerId)

                    snapshot = game.start_match(msg.matchId)

                    _safe_create_match(msg.matchId)
                    _safe_save_round_from_snapshot(snapshot)
                    _sync_snapshot_to_metrics(snapshot)

                    await manager.broadcast(
                        msg.matchId,
                        ServerEvent(event="match_started", data=snapshot.model_dump()),
                    )
                    continue

                if event_type == ClientEventType.leave:
                    msg = LeaveMessage(**payload)
                    _ensure_same_match(msg.matchId, match_id)

                    snapshot = game.remove_player(msg.matchId, msg.playerId)
                    _remove_seen(msg.matchId, msg.playerId)

                    if snapshot is not None:
                        _sync_snapshot_to_metrics(snapshot)
                        await manager.broadcast(
                            msg.matchId,
                            ServerEvent(event="match_state", data=snapshot.model_dump()),
                        )
                    else:
                        await manager.send(
                            websocket,
                            ServerEvent(
                                event="left",
                                data={"matchId": msg.matchId, "playerId": msg.playerId},
                            ),
                        )
                    continue

                if event_type == ClientEventType.ping:
                    msg = PingMessage(**payload)
                    if msg.matchId and msg.playerId:
                        current_player_id = msg.playerId
                        _mark_seen(msg.matchId, msg.playerId)

                    if msg.matchId:
                        _prune_stale_players(msg.matchId)
                        snapshot = game.tick(msg.matchId)
                        _safe_save_round_from_snapshot(snapshot)
                        _sync_snapshot_to_metrics(snapshot)

                        await manager.broadcast(
                            msg.matchId,
                            ServerEvent(event="match_state", data=snapshot.model_dump()),
                        )

                    await manager.send(
                        websocket,
                        ServerEvent(event="pong", data={"matchId": msg.matchId, "ts": time.time()}),
                    )
                    continue

                if event_type == ClientEventType.calibration_frame:
                    msg = CalibrationFrameMessage(**payload)
                    _ensure_same_match(msg.matchId, match_id)
                    current_player_id = msg.playerId
                    _mark_seen(msg.matchId, msg.playerId)

                    try:
                        image = decode_base64_image(
                            msg.frame,
                            max_chars=settings.max_frame_base64_chars,
                        )
                        image, _ = resize_for_inference(
                            image,
                            max_side=settings.max_inference_side,
                        )
                    except ImageDecodeError as exc:
                        await manager.send(
                            websocket,
                            ServerEvent(event="error", ok=False, message=str(exc)),
                        )
                        continue

                    result = pose_worker.analyze_calibration(image)

                    key = (msg.matchId, msg.playerId)
                    if result["ready"]:
                        calibration_stability[key] = calibration_stability.get(key, 0) + 1
                    else:
                        calibration_stability[key] = 0

                    stable_frames = calibration_stability[key]
                    final_ready = stable_frames >= 4

                    await manager.send(
                        websocket,
                        ServerEvent(
                            event="calibration_result",
                            data={
                                "playerId": msg.playerId,
                                "detected": result["detected"],
                                "confidence": result["confidence"],
                                "keypointsVisible": result["keypointsVisible"],
                                "stableFrames": stable_frames,
                                "ready": final_ready,
                                "keypoints": result["keypoints"],
                            },
                        ),
                    )
                    continue

                if event_type == ClientEventType.frame:
                    msg = PlayerFrameMessage(**payload)
                    _ensure_same_match(msg.matchId, match_id)
                    current_player_id = msg.playerId
                    _mark_seen(msg.matchId, msg.playerId)

                    _prune_stale_players(msg.matchId)
                    snapshot = game.tick(msg.matchId)
                    _safe_save_round_from_snapshot(snapshot)
                    _sync_snapshot_to_metrics(snapshot)

                    if snapshot.status.value != "in_progress" or not snapshot.round.active:
                        await manager.send(
                            websocket,
                            ServerEvent(
                                event="ignored_frame",
                                ok=False,
                                message="No hay una ronda activa para procesar frames.",
                                data=snapshot.model_dump(),
                            ),
                        )
                        continue

                    if _should_throttle(msg.matchId, msg.playerId):
                        continue

                    try:
                        image = decode_base64_image(
                            msg.frame,
                            max_chars=settings.max_frame_base64_chars,
                        )
                        image, _ = resize_for_inference(
                            image,
                            max_side=settings.max_inference_side,
                        )
                    except ImageDecodeError as exc:
                        await manager.send(
                            websocket,
                            ServerEvent(event="error", ok=False, message=str(exc)),
                        )
                        continue

                    challenge = game.current_or_new_challenge(msg.matchId)
                    challenge_type = msg.challengeType or challenge.challengeType
                    target = msg.target or challenge.target

                    result = router.process(
                        challenge_type=ChallengeType(challenge_type),
                        frame=image,
                        target=target,
                    )

                    _safe_save_attempt(
                        match_id=msg.matchId,
                        player_id=msg.playerId,
                        matched=result.matched,
                        confidence=result.confidence,
                    )

                    snapshot = game.register_attempt(msg.matchId, msg.playerId, result)
                    _sync_snapshot_to_metrics(snapshot)

                    await manager.broadcast(
                        msg.matchId,
                        ServerEvent(
                            event="frame_result",
                            data={
                                "playerId": msg.playerId,
                                "workerResult": result.model_dump(),
                                "match": snapshot.model_dump(),
                            },
                        ),
                    )

                    snapshot = game.tick(msg.matchId)
                    _safe_save_round_from_snapshot(snapshot)
                    _sync_snapshot_to_metrics(snapshot)

                    await manager.broadcast(
                        msg.matchId,
                        ServerEvent(event="match_state", data=snapshot.model_dump()),
                    )
                    continue

                await manager.send(
                    websocket,
                    ServerEvent(
                        event="error",
                        ok=False,
                        message=f"Tipo de evento no soportado: {event_type}",
                    ),
                )

            except ValidationError as exc:
                await manager.send(
                    websocket,
                    ServerEvent(event="error", ok=False, message=f"Payload inválido: {exc}"),
                )
            except ValueError as exc:
                await manager.send(
                    websocket,
                    ServerEvent(event="error", ok=False, message=str(exc)),
                )
            except Exception as exc:
                await manager.send(
                    websocket,
                    ServerEvent(event="error", ok=False, message=f"Error interno: {exc}"),
                )

    except (WebSocketDisconnect, RuntimeError):
        if current_player_id:
            snapshot = game.disconnect_player(match_id, current_player_id)
            if snapshot is not None:
                _sync_snapshot_to_metrics(snapshot)
                await manager.broadcast(
                    match_id,
                    ServerEvent(event="match_state", data=snapshot.model_dump()),
                )
    finally:
        await manager.disconnect(match_id, websocket)


def _mark_seen(match_id: str, player_id: str) -> None:
    last_player_seen[(match_id, player_id)] = time.time()


def _remove_seen(match_id: str, player_id: str) -> None:
    last_player_seen.pop((match_id, player_id), None)


def _prune_stale_players(match_id: str) -> None:
    now = time.time()
    stale_players = [
        player_id
        for (m_id, player_id), last_seen in list(last_player_seen.items())
        if m_id == match_id and (now - last_seen) > PLAYER_TTL_SECONDS
    ]

    for player_id in stale_players:
        snapshot = game.disconnect_player(match_id, player_id)
        _remove_seen(match_id, player_id)
        if snapshot is not None:
            _sync_snapshot_to_metrics(snapshot)


def _should_throttle(match_id: str, player_id: str) -> bool:
    interval = 1.0 / max(settings.max_fps_per_player, 0.1)
    now = time.time()
    key = (match_id, player_id)
    last = last_frame_seen.get(key)

    if last is not None and (now - last) < interval:
        return True

    last_frame_seen[key] = now
    return False


def _ensure_same_match(payload_match_id: str, url_match_id: str) -> None:
    if payload_match_id != url_match_id:
        raise ValueError("El matchId del payload no coincide con la URL del WebSocket.")


def _safe_create_match(match_id: str) -> None:
    if match_id in persisted_matches:
        return
    try:
        metrics.create_match(match_id)
        persisted_matches.add(match_id)
    except Exception:
        pass


def _safe_save_player(match_id: str, player_id: str, display_name: str) -> None:
    key = (match_id, player_id)
    if key in persisted_players:
        return
    try:
        metrics.save_player(match_id, player_id, display_name)
        persisted_players.add(key)
    except Exception:
        pass


def _safe_save_round_from_snapshot(snapshot: MatchSnapshot) -> None:
    round_state = snapshot.round
    if round_state.roundNumber <= 0 or round_state.challenge is None:
        return

    key = (snapshot.matchId, round_state.roundNumber)
    if key in persisted_rounds:
        return

    try:
        metrics.save_round(
            snapshot.matchId,
            round_state.roundNumber,
            round_state.challenge.challengeType.value,
            round_state.challenge.target,
        )
        persisted_rounds.add(key)
    except Exception:
        pass


def _safe_save_attempt(match_id: str, player_id: str, matched: bool, confidence: float) -> None:
    try:
        metrics.save_attempt(match_id, player_id, matched, confidence)
    except Exception:
        pass


def _sync_snapshot_to_metrics(snapshot: MatchSnapshot) -> None:
    _safe_create_match(snapshot.matchId)
    _safe_save_round_from_snapshot(snapshot)

    for player in snapshot.players:
        _safe_save_player(
            match_id=snapshot.matchId,
            player_id=player.playerId,
            display_name=player.displayName or player.playerId,
        )
        try:
            metrics.update_score(snapshot.matchId, player.playerId, player.score)
        except Exception:
            pass

    if snapshot.status.value == "finished" and snapshot.winnerPlayerId and snapshot.matchId not in finished_matches:
        try:
            metrics.finish_match(snapshot.matchId, snapshot.winnerPlayerId)
            finished_matches.add(snapshot.matchId)
        except Exception:
            pass