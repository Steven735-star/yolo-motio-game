import time
from ultralytics import YOLO
from app.config import MODEL_PATH, CONF_THRESHOLD, IMG_SIZE
from app.utils.pose_format import format_keypoints


class PoseService:
    def __init__(self):
        self.model = YOLO(MODEL_PATH)

    def infer(self, frame):
        start = time.perf_counter()

        results = self.model.predict(
            source=frame,
            conf=CONF_THRESHOLD,
            imgsz=IMG_SIZE,
            verbose=False
        )

        inference_ms = (time.perf_counter() - start) * 1000.0
        keypoints = format_keypoints(results)

        return {
            "detected": len(keypoints) > 0,
            "keypoints": keypoints,
            "inference_ms": round(inference_ms, 2),
            "width": frame.shape[1],
            "height": frame.shape[0]
        }