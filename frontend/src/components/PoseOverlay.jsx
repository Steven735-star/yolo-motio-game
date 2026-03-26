import { useEffect, useRef } from "react";

export default function PoseOverlay({ keypoints, videoSize }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!keypoints) return;

    keypoints.forEach(p => {
      if (p.confidence < 0.5) return;

      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [keypoints]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={480}
      style={{ position: "absolute", top: 0, left: 0 }}
    />
  );
}