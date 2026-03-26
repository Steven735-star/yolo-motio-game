from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL_SHARD_1 = "postgresql://yolo_user:yolo_pass@localhost:5433/yolo_motion_game"
DATABASE_URL_SHARD_2 = "postgresql://yolo_user:yolo_pass@localhost:5434/yolo_motion_game"

engine_shard_1 = create_engine(DATABASE_URL_SHARD_1, echo=False)
engine_shard_2 = create_engine(DATABASE_URL_SHARD_2, echo=False)

SessionLocalShard1 = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine_shard_1
)

SessionLocalShard2 = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine_shard_2
)
