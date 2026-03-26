def format_keypoints(results):
    formatted = []

    if not results or len(results) == 0:
        return formatted

    result = results[0]

    if result.keypoints is None:
        return formatted

    xy = result.keypoints.xy
    conf = result.keypoints.conf

    if xy is None or len(xy) == 0:
        return formatted

    points = xy[0].cpu().numpy()
    confs = conf[0].cpu().numpy() if conf is not None else [1.0] * len(points)

    for i, point in enumerate(points):
        formatted.append({
            "x": float(point[0]),
            "y": float(point[1]),
            "confidence": float(confs[i])
        })

    return formatted