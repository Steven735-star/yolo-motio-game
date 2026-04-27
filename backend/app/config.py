from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "YOLO Motion Game Backend"
    debug: bool = True
    host: str = "0.0.0.0"
    port: int = 8000

    # Modelos
    detect_model: str = Field(default="yolo26s.pt")
    pose_model: str = Field(default="yolo26n-pose.pt")
    object_conf: float = 0.30
    pose_conf: float = 0.30
    image_size: int = 640

    # Rendimiento
    max_fps_per_player: float = 5.0
    max_frame_base64_chars: int = 2_500_000
    max_inference_side: int = 960

    # Sala / partida
    max_players_per_match: int = 5
    min_players_to_start: int = 2
    max_rounds: int = 5
    round_timeout_seconds: int = 10
    inter_round_delay_seconds: float = 1.5

    # Puntaje
    win_points: int = 10
    reaction_bonus_window_seconds: float = 2.0
    reaction_bonus_points: int = 2

    # Detección
    min_object_bbox_area_ratio: float = 0.01
    pose_keypoint_conf: float = 0.30

    cors_origins: list[str] = ["*"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="YMG_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()