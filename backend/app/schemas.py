from pydantic import BaseModel
from typing import List, Optional


class Keypoint(BaseModel):
    x: float
    y: float
    confidence: float


class PoseResult(BaseModel):
    detected: bool
    keypoints: List[Keypoint]
    inference_ms: float
    width: int
    height: int