export default function StatusPanel({ result }) {
  return (
    <div>
      <p>Detectado: {result.detected ? "Sí" : "No"}</p>
      <p>Inferencia: {result.inference_ms} ms</p>
      <p>Keypoints: {result.keypoints?.length || 0}</p>
      <p>Movimiento: {result.movement?.toFixed(2) ?? "N/A"}</p>
      <p>Estado jugador: {result.state ?? "N/A"}</p>
      <p>Fase: {result.game_phase ?? "N/A"}</p>
      <p>Estado juego: {result.game_state ?? "N/A"}</p>
      <p>
        Tiempo estado: {result.state_time?.toFixed(2) ?? "0.00"} /{" "}
        {result.state_duration?.toFixed(2) ?? "0.00"} s
      </p>
      <p>Baseline: {result.baseline?.toFixed(2) ?? "N/A"}</p>
      <p>Threshold: {result.threshold?.toFixed(2) ?? "N/A"}</p>
      <p>Calibración: {Math.round((result.calibration_progress ?? 0) * 100)}%</p>
      <p>Estado calibración: {result.calibration_status ?? "N/A"}</p>
      <p>
        Frames válidos calibración: {result.valid_calibration_frames ?? 0}/
        {result.required_calibration_frames ?? 0}
      </p>
    </div>
  );
}