from sqlalchemy import text
from app.db.shard_router import get_engine_for_session, get_shard_id


def create_session(session_id: str):
    engine = get_engine_for_session(session_id)
    with engine.connect() as conn:
        conn.execute(
            text("""
                INSERT INTO sessions (session_id, calibration_status)
                VALUES (:session_id, 'IN_PROGRESS')
                ON CONFLICT (session_id) DO NOTHING
            """),
            {"session_id": session_id}
        )
        conn.commit()


def update_session_calibration(
    session_id: str,
    calibration_status: str,
    baseline: float | None,
    threshold: float | None
):
    engine = get_engine_for_session(session_id)
    with engine.connect() as conn:
        conn.execute(
            text("""
                UPDATE sessions
                SET calibration_status = :calibration_status,
                    baseline = :baseline,
                    threshold = :threshold
                WHERE session_id = :session_id
            """),
            {
                "session_id": session_id,
                "calibration_status": calibration_status,
                "baseline": baseline,
                "threshold": threshold,
            }
        )
        conn.commit()


def close_session(session_id: str, final_score: int = 0):
    engine = get_engine_for_session(session_id)
    with engine.connect() as conn:
        conn.execute(
            text("""
                UPDATE sessions
                SET ended_at = NOW(),
                    final_score = :final_score
                WHERE session_id = :session_id
            """),
            {
                "session_id": session_id,
                "final_score": final_score,
            }
        )
        conn.commit()


def get_session_shard(session_id: str) -> int:
    return get_shard_id(session_id)
