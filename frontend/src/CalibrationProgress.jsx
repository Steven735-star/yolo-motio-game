import React, { useRef } from "react";

const CalibrationProgress = ({ stableFrames, isDetected, keypointsVisible }) => {
  const maxPercentageRef = useRef(0);
  const current = Math.min(100, stableFrames * 25);
  if (current > maxPercentageRef.current) {
    maxPercentageRef.current = current;
  }
  const percentage = maxPercentageRef.current;

  return (
    <div className="calibration-overlay">
      <div className="loader-ring"></div>
      <h1 className="camera-title" style={{ fontSize: "48px" }}>
        Calibrando...
      </h1>
      <p style={{ fontSize: "18px", opacity: 0.8 }}>
        Mantente visible mientras ajustamos la detección.
      </p>

      <div className="progress-container">
        <div className="progress-bar-bg">
          <div 
            className="progress-bar-fill" 
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
        <div className="percentage">{percentage}%</div>
      </div>

      <div style={{ marginTop: "18px", fontSize: "18px" }}>
        Detección: {isDetected ? "✅ Correcta" : "🔍 Buscando cuerpo..."} | 
        Puntos: {keypointsVisible}
      </div>
    </div>
  );
};

export default CalibrationProgress;