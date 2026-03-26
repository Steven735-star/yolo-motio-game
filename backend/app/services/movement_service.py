import math


def euclidean(p1, p2):
    return math.sqrt((p1["x"] - p2["x"])**2 + (p1["y"] - p2["y"])**2)


def compute_movement(prev_keypoints, curr_keypoints, conf_threshold=0.5):
    if not prev_keypoints or not curr_keypoints:
        return None

    distances = []

    for p1, p2 in zip(prev_keypoints, curr_keypoints):
        if p1["confidence"] >= conf_threshold and p2["confidence"] >= conf_threshold:
            distances.append(euclidean(p1, p2))

    if len(distances) == 0:
        return None

    return sum(distances) / len(distances)


def smooth_movement(current_value, previous_smoothed, alpha=0.35):
    if current_value is None:
        return previous_smoothed

    if previous_smoothed is None:
        return current_value

    return alpha * current_value + (1 - alpha) * previous_smoothed


def classify_state(movement, threshold):
    if movement is None or threshold is None:
        return "UNKNOWN"

    return "QUIETO" if movement < threshold else "MOVIMIENTO"