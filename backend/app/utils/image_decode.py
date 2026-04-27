from __future__ import annotations

import base64
from typing import Tuple

import cv2
import numpy as np


class ImageDecodeError(ValueError):
    pass


def decode_base64_image(data: str, max_chars: int | None = None) -> np.ndarray:
    """Decode a base64 image or data URL into a BGR OpenCV image."""
    try:
        payload = data.split(",", 1)[1] if data.startswith("data:image") else data

        if max_chars is not None and len(payload) > max_chars:
            raise ImageDecodeError("El frame es demasiado grande.")

        raw = base64.b64decode(payload)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        if img is None:
            raise ImageDecodeError("No se pudo decodificar la imagen.")
        return img

    except ImageDecodeError:
        raise
    except Exception as exc:
        raise ImageDecodeError(f"Imagen inválida: {exc}") from exc


def resize_for_inference(image: np.ndarray, max_side: int = 960) -> Tuple[np.ndarray, float]:
    h, w = image.shape[:2]
    largest = max(h, w)

    if largest <= max_side:
        return image, 1.0

    scale = max_side / float(largest)
    resized = cv2.resize(
        image,
        (int(w * scale), int(h * scale)),
        interpolation=cv2.INTER_AREA,
    )
    return resized, scale