import { useEffect, useRef, useState } from "react";
import CameraView from "./components/CameraView";
import PoseOverlay from "./components/PoseOverlay";
import StatusPanel from "./components/StatusPanel";
import { createPoseSocket } from "./services/websocket";

function generateSessionId() {
  return crypto.randomUUID();
}

export default function App() {
  const videoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const socketRef = useRef(null);

  const [sessionId] = useState(generateSessionId());
  const [result, setResult] = useState({
    detected: false,
    keypoints: [],
    inference_ms: 0
  });

  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });

  useEffect(() => {
    socketRef.current = createPoseSocket((data) => {
      setResult(data);
      if (data.width && data.height) {
        setVideoSize({ width: data.width, height: data.height });
      }
    });

    return () => socketRef.current?.close();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      const canvas = hiddenCanvasRef.current;
      const socket = socketRef.current;

      if (!video || !canvas || !socket) return;
      if (video.readyState < 2) return;
      if (socket.readyState !== WebSocket.OPEN) return;

      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      ctx.drawImage(video, 0, 0);

      const frame = canvas.toDataURL("image/jpeg", 0.6);

      socket.send(JSON.stringify({
        sessionId,
        frame
      }));
    }, 150);

    return () => clearInterval(interval);
  }, [sessionId]);

  return (
    <div style={{ padding: "20px" }}>
      <h1>YOLO Motion Game</h1>

      <div style={{ position: "relative", width: 640, height: 480 }}>
        <CameraView videoRef={videoRef} />
        <PoseOverlay keypoints={result.keypoints} videoSize={videoSize} />
      </div>

      <StatusPanel result={result} />

      <canvas ref={hiddenCanvasRef} style={{ display: "none" }} />
    </div>
  );
}