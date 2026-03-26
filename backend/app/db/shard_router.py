import hashlib
from app.db.database import engine_shard_1, engine_shard_2


def get_shard_id(session_id: str) -> int:
    digest = hashlib.md5(session_id.encode()).hexdigest()
    value = int(digest, 16)
    return (value % 2) + 1


def get_engine_for_session(session_id: str):
    shard_id = get_shard_id(session_id)
    if shard_id == 1:
        return engine_shard_1
    return engine_shard_2
