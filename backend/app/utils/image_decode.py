import base64
import cv2
import numpy as np


def decode_base64_image(data: str):
    if "," in data:
        data = data.split(",", 1)[1]

    img_bytes = base64.b64decode(data)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return frame