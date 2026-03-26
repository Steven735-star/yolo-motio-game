import { useEffect } from "react";

export default function CameraView({ videoRef }) {
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        videoRef.current.srcObject = stream;
      })
      .catch(console.error);
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      width={640}
      height={480}
    />
  );
}