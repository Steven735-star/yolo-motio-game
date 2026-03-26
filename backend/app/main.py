from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import time

from app.services.db_service import (
    create_session,
    update_session_calibration,
    close_session,
    get_session_shard,
)
from app.services.game_service import next_state, get_state_duration
from app.services.pose_service import PoseService
from app.services.movement_service import (
    compute_movement,
    smooth_movement,
    classify_state,
)
from app.utils.image_decode import decode_base64_image

app = FastAPI()
pose_service = PoseService()

session_state = {}

CALIBRATION_SECONDS = 5
ALPHA = 1.5
MIN_VALID_CALIBRATION_FRAMES = 20

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/pose")
async def websocket_pose(websocket: WebSocket):
    await websocket.accept()
    session_id = None

    try:
        while True:
            message = await websocket.receive_json()

            frame_data = message.get("frame")
            session_id = message.get("sessionId", "unknown")

            if session_id not in session_state:
                session_state[session_id] = {
                    "previous_keypoints": None,
                    "smoothed_movement": None,
                    "phase": "CALIBRATING",
                    "calibration_start": time.time(),
                    "calibration_values": [],
                    "baseline": None,
                    "threshold": None,
                    "calibration_status": "IN_PROGRESS",
                    "game_state": "WAIT",
                    "state_start_time": time.time(),
                    "state_duration": 3.0,
                }
                create_session(session_id)

            state_data = session_state[session_id]

            if not frame_data:
                await websocket.send_json({
                    "detected": False,
                    "error": "No frame provided",
                    "sessionId": session_id,
                    "db_shard": get_session_shard(session_id),
                })
                continue

            frame = decode_base64_image(frame_data)

            if frame is None:
                await websocket.send_json({
                    "detected": False,
                    "error": "Invalid image",
                    "sessionId": session_id,
                    "db_shard": get_session_shard(session_id),
                })
                continue

            result = pose_service.infer(frame)

            previous_keypoints = state_data["previous_keypoints"]
            raw_movement = compute_movement(previous_keypoints, result["keypoints"])

            smoothed_movement = smooth_movement(
                raw_movement,
                state_data["smoothed_movement"],
                alpha=0.35,
            )

            state_data["previous_keypoints"] = result["keypoints"]
            state_data["smoothed_movement"] = smoothed_movement

            now = time.time()
            elapsed_calibration = now - state_data["calibration_start"]

            # =========================
            # FASE DE CALIBRACIÓN
            # =========================
            if state_data["phase"] == "CALIBRATING":
                if smoothed_movement is not None:
                    state_data["calibration_values"].append(smoothed_movement)

                if elapsed_calibration >= CALIBRATION_SECONDS:
                    values = state_data["calibration_values"]
                    total_frames = len(values)

                    if total_frames >= MIN_VALID_CALIBRATION_FRAMES:
                        baseline = sum(values) / len(values)
                        threshold = baseline * ALPHA

                        state_data["baseline"] = baseline
                        state_data["threshold"] = threshold
                        state_data["phase"] = "PLAYING"
                        state_data["calibration_status"] = "OK"

                        update_session_calibration(
                            session_id=session_id,
                            calibration_status="OK",
                            baseline=baseline,
                            threshold=threshold,
                        )

                        state_data["game_state"] = "WAIT"
                        state_data["state_start_time"] = now
                        state_data["state_duration"] = get_state_duration("WAIT")
                    else:
                        state_data["calibration_start"] = time.time()
                        state_data["calibration_values"] = []
                        state_data["baseline"] = None
                        state_data["threshold"] = None
                        state_data["calibration_status"] = "RETRYING"

                        update_session_calibration(
                            session_id=session_id,
                            calibration_status="RETRYING",
                            baseline=None,
                            threshold=None,
                        )

                result["movement"] = smoothed_movement
                result["baseline"] = state_data["baseline"]
                result["threshold"] = state_data["threshold"]
                result["state"] = "CALIBRANDO"
                result["game_phase"] = state_data["phase"]
                result["game_state"] = state_data["game_state"]
                result["state_time"] = 0.0
                result["state_duration"] = state_data["state_duration"]
                result["calibration_progress"] = min(
                    elapsed_calibration / CALIBRATION_SECONDS, 1.0
                )
                result["calibration_status"] = state_data["calibration_status"]
                result["valid_calibration_frames"] = len(state_data["calibration_values"])
                result["required_calibration_frames"] = MIN_VALID_CALIBRATION_FRAMES
                result["sessionId"] = session_id
                result["db_shard"] = get_session_shard(session_id)

                await websocket.send_json(result)
                continue

            # =========================
            # FASE DE JUEGO
            # =========================
            threshold = state_data["threshold"]
            player_state = classify_state(smoothed_movement, threshold)

            current_game_state = state_data["game_state"]
            elapsed_state = now - state_data["state_start_time"]

            if elapsed_state >= state_data["state_duration"]:
                new_state = next_state(current_game_state)
                state_data["game_state"] = new_state
                state_data["state_start_time"] = now
                state_data["state_duration"] = get_state_duration(new_state)

                current_game_state = new_state
                elapsed_state = 0.0

            result["movement"] = smoothed_movement
            result["baseline"] = state_data["baseline"]
            result["threshold"] = threshold
            result["state"] = player_state
            result["game_phase"] = state_data["phase"]
            result["game_state"] = state_data["game_state"]
            result["state_time"] = elapsed_state
            result["state_duration"] = state_data["state_duration"]
            result["calibration_progress"] = 1.0
            result["calibration_status"] = state_data["calibration_status"]
            result["valid_calibration_frames"] = len(state_data["calibration_values"])
            result["required_calibration_frames"] = MIN_VALID_CALIBRATION_FRAMES
            result["sessionId"] = session_id
            result["db_shard"] = get_session_shard(session_id)

            await websocket.send_json(result)

    except WebSocketDisconnect:
        try:
            if session_id:
                close_session(session_id)
                if session_id in session_state:
                    del session_state[session_id]
        except Exception as e:
            print("Error cerrando sesión en DB:", e)

        print("Cliente desconectado")