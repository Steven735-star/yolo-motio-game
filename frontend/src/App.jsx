import React, { useEffect, useMemo, useRef, useState } from "react";
import logo from "./assets/logo.png";

const WS_BASE = "ws://192.168.68.128:8000";
const DEFAULT_ROOM = "SALA-001";
const GAME_NAME = "No le hagas caso a tu ex";

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SALA-";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function cleanInstruction(text = "") {
  return text
    .replace(/^Simón dice:\s*/i, "")
    .replace(/^Simon dice:\s*/i, "")
    .trim();
}

function buildDisplayInstruction(challenge) {
  if (!challenge) return "Esperando instrucción...";
  const instruction = cleanInstruction(challenge.instruction || "");
  if (challenge.isSimonSays) return instruction;
  return `Tu ex dice: ${instruction}`;
}

export default function App() {
  const [screen, setScreen] = useState(() => history.state?.screen || "landing");
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState(DEFAULT_ROOM);
  const [roomMode, setRoomMode] = useState("join");

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [matchState, setMatchState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [joined, setJoined] = useState(false);
  const [readySent, setReadySent] = useState(false);

  const [calibrationInfo, setCalibrationInfo] = useState({
    detected: false,
    confidence: 0,
    keypointsVisible: 0,
    stableFrames: 0,
    ready: false,
    keypoints: [],
  });

  const [flashActive, setFlashActive] = useState(false);
  const [roundBanner, setRoundBanner] = useState("");
  const [showFinalOverlay, setShowFinalOverlay] = useState(false);
  const [streak, setStreak] = useState(0);

  const [reconnectBanner, setReconnectBanner] = useState("");
  const [wasDisconnected, setWasDisconnected] = useState(false);
  const [lobbyNotice, setLobbyNotice] = useState("");
  const [copiedRoom, setCopiedRoom] = useState(false);

  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const wsRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const calibrationIntervalRef = useRef(null);

  const lastRoundProcessedRef = useRef(null);
  const blockedFrameRoundRef = useRef(null);

  const currentMatchId = roomId.trim() || DEFAULT_ROOM;

  const navigateTo = (newScreen) => {
    history.pushState({ screen: newScreen }, "", `#${newScreen}`);
    setScreen(newScreen);
  };

  const showReconnectMessage = (msg, duration = 2500) => {
    setReconnectBanner(msg);
    window.clearTimeout(showReconnectMessage._t);
    showReconnectMessage._t = window.setTimeout(() => setReconnectBanner(""), duration);
  };

  const showLobbyNotice = (msg, duration = 2600) => {
    setLobbyNotice(msg);
    window.clearTimeout(showLobbyNotice._t);
    showLobbyNotice._t = window.setTimeout(() => setLobbyNotice(""), duration);
  };

  useEffect(() => {
    const handlePop = (e) => setScreen(e.state?.screen || "landing");
    window.addEventListener("popstate", handlePop);
    history.replaceState({ screen: "landing" }, "", "#landing");
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        if (wsRef.current?.readyState === WebSocket.OPEN && nickname.trim()) {
          wsRef.current.send(
            JSON.stringify({
              type: "leave",
              matchId: currentMatchId,
              playerId: nickname,
            })
          );
        }
      } catch (err) {
        console.error(err);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [nickname, currentMatchId]);

  useEffect(() => {
    let streamRef = null;

    if (["camera", "calibration", "game"].includes(screen)) {
      async function startCamera() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false,
          });
          streamRef = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
          setCameraStatus("ready");
        } catch (err) {
          console.error(err);
          setCameraStatus("error");
          showLobbyNotice("No se pudo activar la cámara. Revisa permisos o HTTPS.");
        }
      }
      startCamera();
    }

    return () => {
      if (streamRef) streamRef.getTracks().forEach((track) => track.stop());
    };
  }, [screen]);

  useEffect(() => {
    const shouldHaveSocket =
      nickname.trim() &&
      currentMatchId &&
      ["lobby", "camera", "calibration", "game"].includes(screen);

    if (!shouldHaveSocket) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/${currentMatchId}`);
    wsRef.current = ws;
    setWsStatus("connecting");

    ws.onopen = () => {
      setWsStatus("connected");
      if (wasDisconnected && screen === "game") {
        showReconnectMessage("Reconectado a la partida.");
        setWasDisconnected(false);
      }
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      if (screen === "game") {
        setWasDisconnected(true);
        showReconnectMessage("Se perdió la conexión. Intentando recuperar...");
      }
    };

    ws.onerror = () => showLobbyNotice("Error de conexión.");

    ws.onmessage = (event) => {
      try {
        handleServerEvent(JSON.parse(event.data));
      } catch (err) {
        console.error(err);
      }
    };
  }, [screen, nickname, currentMatchId, wasDisconnected]);

  useEffect(() => {
    if (screen === "landing" && wsRef.current) {
      try {
        if (nickname.trim()) {
          wsRef.current.send(
            JSON.stringify({
              type: "leave",
              matchId: currentMatchId,
              playerId: nickname,
            })
          );
        }
      } catch (err) {
        console.error(err);
      }

      wsRef.current.close();
      wsRef.current = null;
      setWsStatus("disconnected");
      setJoined(false);
      setReadySent(false);
      setMatchState(null);
      setPlayers([]);
      setLastResult(null);
      setCalibrationInfo({
        detected: false,
        confidence: 0,
        keypointsVisible: 0,
        stableFrames: 0,
        ready: false,
        keypoints: [],
      });
      setShowFinalOverlay(false);
      setStreak(0);
      setReconnectBanner("");
      setWasDisconnected(false);
      setLobbyNotice("");
      lastRoundProcessedRef.current = null;
      blockedFrameRoundRef.current = null;
    }
  }, [screen, nickname, currentMatchId]);

  useEffect(() => {
    if (screen === "lobby" && wsStatus === "connected" && nickname.trim() && !joined) {
      sendWs({
        type: "join",
        matchId: currentMatchId,
        playerId: nickname,
        displayName: nickname,
      });
      setJoined(true);
    }
  }, [screen, wsStatus, nickname, joined, currentMatchId]);

  useEffect(() => {
    if (!wsRef.current || wsStatus !== "connected" || !nickname.trim()) return;

    const interval = setInterval(() => {
      sendWs({
        type: "ping",
        matchId: currentMatchId,
        playerId: nickname,
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [wsStatus, nickname, screen, currentMatchId]);

  useEffect(() => {
    if (matchState?.status === "in_progress") {
      setShowFinalOverlay(false);
      if (screen !== "game") setTimeout(() => navigateTo("game"), 250);
    }
  }, [matchState?.status, screen]);

  useEffect(() => {
    if (matchState?.status === "finished") setShowFinalOverlay(true);
  }, [matchState?.status]);

  useEffect(() => {
    if (screen !== "calibration") {
      stopCalibrationFrames();
      return;
    }

    if (!videoRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    calibrationIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !ctx || wsRef.current?.readyState !== WebSocket.OPEN) return;

      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      sendWs({
        type: "calibration_frame",
        matchId: currentMatchId,
        playerId: nickname,
        frame: canvas.toDataURL("image/jpeg", 0.65),
        timestamp: Date.now() / 1000,
      });
    }, 350);

    return () => stopCalibrationFrames();
  }, [screen, nickname, wsStatus, currentMatchId]);

  useEffect(() => {
    if (screen !== "game") {
      stopGameFrames();
      return;
    }

    if (!videoRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    frameIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !ctx) return;
      if (!matchState?.round?.active || !matchState?.round?.challenge) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const roundNumber = matchState.round.roundNumber;

      if (blockedFrameRoundRef.current === roundNumber) return;

      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      sendWs({
        type: "frame",
        matchId: currentMatchId,
        playerId: nickname,
        frame: canvas.toDataURL("image/jpeg", 0.65),
        challengeType: matchState.round.challenge.challengeType,
        target: matchState.round.challenge.target,
        timestamp: Date.now() / 1000,
      });
    }, 250);

    return () => stopGameFrames();
  }, [
    screen,
    matchState?.round?.roundNumber,
    matchState?.round?.active,
    matchState?.round?.challenge,
    nickname,
    currentMatchId,
  ]);

  useEffect(() => drawOverlay(), [calibrationInfo, lastResult, screen]);

  useEffect(() => {
    if (screen !== "game") return;

    const disconnectedPlayers = players.filter((p) => !p.connected);
    if (disconnectedPlayers.length === 0) return;

    const names = disconnectedPlayers
      .filter((p) => p.playerId !== nickname)
      .map((p) => p.displayName || p.playerId)
      .join(", ");

    if (names) showReconnectMessage(`Esperando reconexión de: ${names}`, 3000);
  }, [players, nickname, screen]);

  const stopCalibrationFrames = () => {
    if (calibrationIntervalRef.current) {
      clearInterval(calibrationIntervalRef.current);
      calibrationIntervalRef.current = null;
    }
  };

  const stopGameFrames = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
  };

  const sendWs = (payload) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showLobbyNotice("No hay conexión con la sala.");
      return false;
    }

    wsRef.current.send(JSON.stringify(payload));
    return true;
  };

  const triggerFlash = () => {
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 450);
  };

  const handleServerEvent = (data) => {
    if (data.event === "connected" || data.event === "pong") return;

    if (data.event === "error") {
      showLobbyNotice(data.message || "Ocurrió un error.");
      return;
    }

    if (data.event === "match_state") {
      setMatchState(data.data);
      setPlayers(data.data?.players || []);

      const currentRound = data.data?.round?.roundNumber;
      if (blockedFrameRoundRef.current && currentRound !== blockedFrameRoundRef.current) {
        blockedFrameRoundRef.current = null;
      }

      if (data.data?.round?.reason === "timeout") {
        setRoundBanner("Tiempo terminado");
      } else if (data.data?.round?.winnerPlayerId) {
        setRoundBanner(`Ganó la ronda: ${data.data.round.winnerPlayerId}`);
      }

      return;
    }

    if (data.event === "match_started") {
      setMatchState(data.data);
      setPlayers(data.data?.players || []);
      setStreak(0);
      lastRoundProcessedRef.current = null;
      blockedFrameRoundRef.current = null;
      return;
    }

    if (data.event === "calibration_result") {
      setCalibrationInfo(data.data);
      return;
    }

    if (data.event === "frame_result") {
      const result = data.data?.workerResult || null;
      const match = data.data?.match || null;

      setLastResult(result);

      if (match) {
        setMatchState(match);
        setPlayers(match.players || []);
      }

      const roundNumber = match?.round?.roundNumber;
      const challenge = match?.round?.challenge;
      const isValidInstruction = challenge?.isSimonSays === true;

      if (result?.matched && roundNumber) {
        blockedFrameRoundRef.current = roundNumber;
      }

      if (!roundNumber || lastRoundProcessedRef.current === roundNumber) {
        return;
      }

      if (result?.matched) {
        lastRoundProcessedRef.current = roundNumber;
        triggerFlash();

        if (isValidInstruction) {
          setStreak((prev) => Math.min(prev + 1, 10));
        } else {
          setStreak((prev) => Math.max(prev - 2, 0));
        }

        return;
      }

      if (isValidInstruction && match?.round?.active === false) {
        lastRoundProcessedRef.current = roundNumber;
        setStreak((prev) => Math.max(prev - 1, 0));
      }

      return;
    }
  };

  const drawOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 640;
    canvas.height = 480;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const keypoints =
      screen === "calibration"
        ? calibrationInfo?.keypoints || []
        : lastResult?.details?.keypoints || [];

    keypoints.forEach((kp) => {
      if ((kp.conf || 0) < 0.3) return;
      ctx.beginPath();
      ctx.arc(kp.x * 2, kp.y * 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#4cc9f0";
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#4cc9f0";
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  };

  const handleReady = () => {
    const ok = sendWs({
      type: "ready",
      matchId: currentMatchId,
      playerId: nickname,
      ready: true,
    });

    if (ok) {
      setReadySent(true);
      showLobbyNotice("Estás listo.");
    }
  };

  const handleStartMatch = () => {
    const readyPlayers = players.filter((p) => p.ready && p.connected);
    const notReadyPlayers = players.filter((p) => !p.ready && p.connected);

    if (readyPlayers.length < 2) {
      if (notReadyPlayers.length > 0) {
        const names = notReadyPlayers.map((p) => p.displayName || p.playerId).join(", ");
        showLobbyNotice(`${names}, deben ponerse listos para iniciar.`);
      } else {
        showLobbyNotice("Se necesitan al menos 2 jugadores listos.");
      }
      return;
    }

    const ok = sendWs({
      type: "start_match",
      matchId: currentMatchId,
      playerId: nickname,
    });

    if (ok) showLobbyNotice("Iniciando partida...");
  };

  const handleCreateRoom = () => {
    const code = generateRoomCode();
    setRoomMode("create");
    setRoomId(code);
    showLobbyNotice(`Sala ${code} creada.`);
  };

  const handleContinueToLobby = () => {
    if (!nickname.trim()) return;
    if (!roomId.trim()) {
      showLobbyNotice("Ingresa un código de sala.");
      return;
    }

    setJoined(false);
    setReadySent(false);
    navigateTo("lobby");
  };

  const handleNickKeyDown = (e) => {
    if (e.key === "Enter") handleContinueToLobby();
  };

  const handleCopyRoom = async () => {
    try {
      await navigator.clipboard.writeText(currentMatchId);
      setCopiedRoom(true);
      showLobbyNotice("Código copiado.");
      setTimeout(() => setCopiedRoom(false), 1500);
    } catch {
      showLobbyNotice("No se pudo copiar el código.");
    }
  };

  const getPlayerGameStatus = (player) => {
    if (!player.connected) return "Ausente";
    if (player.lastMatched) return "En racha";
    if ((player.score || 0) > 0) return "En partida";
    return "Jugando";
  };

  const getMatchStatusLabel = (status) => {
    switch (status) {
      case "in_progress":
        return "Partida en curso";
      case "finished":
        return "Partida finalizada";
      case "round_finished":
        return "Ronda completada";
      case "round_timeout":
        return "Ronda terminada";
      case "ready":
        return "Equipo listo";
      case "lobby":
        return "Esperando en sala";
      case "waiting_players":
        return "Esperando jugadores";
      case "aborted":
        return "Partida interrumpida";
      default:
        return "En sesión";
    }
  };

  const currentChallenge = matchState?.round?.challenge;
  const currentInstruction = buildDisplayInstruction(currentChallenge);
  const currentInstructionKey = `${matchState?.round?.roundNumber || 0}-${currentInstruction}`;
  const currentPlayer = players.find((p) => p.playerId === nickname);
  const myScore = currentPlayer?.score || 0;
  const maxScore = Math.max(10, ...players.map((p) => p.score || 0));
  const myScorePct = Math.max(6, (myScore / maxScore) * 100);

  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);

  const allReady = players.length >= 2 && players.filter((p) => p.connected).every((p) => p.ready);
  const connectedCount = players.filter((p) => p.connected).length;
  const readyCount = players.filter((p) => p.connected && p.ready).length;

  if (screen === "landing") {
    return (
      <div className="landing">
        <img src={logo} alt={GAME_NAME} className="landing-logo" />

        <div className="buttons landing-buttons">
          <button className="primary" onClick={() => navigateTo("nick-input")}>
            ▶ Iniciar juego
          </button>
          <button className="secondary" onClick={() => navigateTo("how-it-works")}>
            ℹ ¿Cómo jugar?
          </button>
        </div>
      </div>
    );
  }

  if (screen === "nick-input") {
    return (
      <div className="landing">
        <button className="back" onClick={() => navigateTo("landing")}>Volver</button>

        {lobbyNotice && <div className="reconnect-banner">{lobbyNotice}</div>}

        <h2 className="camera-title">Crear o unirse a una sala</h2>
        <p className="camera-subtitle">Elige tu nombre y escribe el código de sala.</p>

        <div className="setup-panel room-setup-panel" style={{ width: "520px", textAlign: "center" }}>
          <div className="room-mode-switch">
            <button
              className={`room-mode-btn ${roomMode === "join" ? "room-mode-btn-active" : ""}`}
              onClick={() => setRoomMode("join")}
            >
              Unirse a sala
            </button>
            <button
              className={`room-mode-btn ${roomMode === "create" ? "room-mode-btn-active" : ""}`}
              onClick={handleCreateRoom}
            >
              Crear sala
            </button>
          </div>

          <input
            type="text"
            className="nick-input"
            placeholder="Tu nombre"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={handleNickKeyDown}
            maxLength={15}
          />

          <input
            type="text"
            className="nick-input"
            style={{ marginTop: "14px" }}
            placeholder="Código de sala"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            onKeyDown={handleNickKeyDown}
            maxLength={16}
          />

          <div className="room-help-text">
            {roomMode === "create"
              ? "Comparte este código con los demás jugadores."
              : "Ingresa el código que te compartieron."}
          </div>

          <button
            className="primary"
            style={{ width: "100%", marginTop: "20px" }}
            disabled={!nickname.trim() || !roomId.trim()}
            onClick={handleContinueToLobby}
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  if (screen === "lobby") {
    return (
      <div className="camera-screen">
        <h1 className="camera-title">Sala de jugadores</h1>
        <p className="camera-subtitle">Todos deben estar listos para iniciar la partida.</p>

        {lobbyNotice && <div className="reconnect-banner">{lobbyNotice}</div>}

        <div className="setup-panel lobby-panel-real" style={{ width: "760px" }}>
          <div className="lobby-top-row">
            <div>
              <div className="lobby-room-label">CÓDIGO DE SALA</div>
              <div className="lobby-room-code">{currentMatchId}</div>
            </div>

            <button className="copy-room-btn" onClick={handleCopyRoom}>
              {copiedRoom ? "Copiado" : "Copiar código"}
            </button>
          </div>

          <div className="lobby-stats-row">
            <div className="lobby-stat-card">
              <span className="lobby-stat-number">{connectedCount}</span>
              <span className="lobby-stat-label">Jugadores conectados</span>
            </div>
            <div className="lobby-stat-card">
              <span className="lobby-stat-number">{readyCount}</span>
              <span className="lobby-stat-label">Jugadores listos</span>
            </div>
            <div className="lobby-stat-card">
              <span className="lobby-stat-number">{allReady ? "SÍ" : "NO"}</span>
              <span className="lobby-stat-label">Puede iniciar</span>
            </div>
          </div>

          <div className="player-list">
            {players.length === 0 ? (
              <div className="player-card-real player-card-you">
                <div className="player-card-name">{nickname} (Tú)</div>
                <div className="player-card-status">Entrando a la sala...</div>
              </div>
            ) : (
              players.map((player) => {
                const isYou = player.playerId === nickname;
                const statusText = !player.connected ? "Ausente" : player.ready ? "Listo" : "No está listo";

                return (
                  <div
                    key={player.playerId}
                    className={`player-card-real ${isYou ? "player-card-you" : ""} ${player.ready ? "player-card-ready" : ""} ${!player.connected ? "player-card-offline" : ""}`}
                  >
                    <div className="player-card-name">
                      {player.displayName || player.playerId}
                      {isYou ? " (Tú)" : ""}
                    </div>
                    <div className="player-card-status">{statusText}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="action-buttons">
          <button className="btn-continue" onClick={handleReady}>
            {readySent ? "Listo ✓" : "Estoy listo"}
          </button>

          <button className="btn-continue" onClick={() => navigateTo("camera")}>
            Abrir cámara
          </button>

          <button
            className={`btn-continue start-match-btn ${allReady ? "start-match-btn-live" : "start-match-btn-wait"}`}
            onClick={handleStartMatch}
          >
            {allReady ? "Iniciar partida" : "Esperando jugadores"}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "how-it-works") {
    return (
      <div className="camera-screen">
        <div className="top-bar" style={{ alignSelf: "flex-start" }}>
          <button className="back" onClick={() => navigateTo("landing")}>Volver</button>
        </div>

        <h1 className="camera-title">¿Cómo jugar?</h1>
        <p className="camera-subtitle">Reacciona rápido, pero no caigas en las trampas.</p>

        <div className="setup-panel" style={{ width: "1000px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
          <div className="step-card">
            <div className="step-number">01</div>
            <h4>Entra a una sala</h4>
            <p>Crea una sala o únete con un código. Todos los jugadores deben marcarse como listos antes de iniciar.</p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h4>Lee la instrucción</h4>
            <p>Si la instrucción aparece sola, debes hacerla para ganar puntos. Ejemplo: “levante la mano derecha”.</p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h4>No le hagas caso a tu ex</h4>
            <p>Si aparece “Tu ex dice: ...”, no debes hacer la acción. Si obedeces a tu ex, pierdes puntos.</p>
          </div>
        </div>

        <div className="setup-panel" style={{ width: "1000px", marginTop: "28px" }}>
          <h3>Reglas principales</h3>
          <ul className="setup-list">
            <li>✅ Las instrucciones normales dan puntos si las haces correctamente.</li>
            <li>⚠️ Las instrucciones que empiezan con “Tu ex dice” son trampas.</li>
            <li>📷 El sistema detecta poses y objetos con visión computacional.</li>
            <li>🔥 Si aciertas varias veces, tu racha aumenta.</li>
            <li>🏆 Gana quien acumule más puntos al terminar las rondas.</li>
          </ul>
        </div>

        <button className="primary" style={{ marginTop: "40px" }} onClick={() => navigateTo("nick-input")}>
          Entendido, jugar
        </button>
      </div>
    );
  }

  if (screen === "camera") {
    return (
      <div className="camera-screen">
        <div className="top-bar" style={{ alignSelf: "flex-start" }}>
          <button className="back" onClick={() => navigateTo("lobby")}>Volver</button>
        </div>

        <h1 className="camera-title">Ubícate frente a la cámara</h1>
        <p className="camera-subtitle">Asegúrate de que tu cuerpo sea visible.</p>

        <div className="camera-box">
          <video ref={videoRef} autoPlay playsInline className="video-feed" />
        </div>

        {cameraStatus === "ready" && (
          <>
            <div className="setup-panel">
              <h3>Consejos</h3>
              <ul className="setup-list">
                <li>✅ Mantente a una distancia adecuada de la cámara.</li>
                <li>✅ Usa buena iluminación.</li>
                <li>✅ Intenta que tus brazos y manos sean visibles.</li>
              </ul>
            </div>
            <div className="action-buttons">
              <button className="btn-continue" onClick={() => navigateTo("calibration")}>Continuar ✓</button>
              <button className="btn-back-outline" onClick={() => navigateTo("lobby")}>Volver</button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (screen === "calibration") {
    const pct = Math.min(100, calibrationInfo.stableFrames * 25);

    return (
      <div className="camera-screen">
        <div className="top-bar" style={{ alignSelf: "flex-start" }}>
          <button className="back" onClick={() => navigateTo("camera")}>Volver</button>
        </div>

        <div className={`camera-box ${flashActive ? "detect-flash" : ""}`}>
          <video ref={videoRef} autoPlay playsInline className="video-feed" />
          <canvas ref={overlayCanvasRef} className="overlay-canvas" />

          <div className="calibration-overlay">
            <div className="loader-ring"></div>
            <h1 className="camera-title" style={{ fontSize: "48px" }}>Calibrando...</h1>
            <p style={{ fontSize: "18px", opacity: 0.8 }}>
              Mantente visible mientras ajustamos la detección.
            </p>

            <div className="progress-container">
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${pct}%` }}></div>
              </div>
              <div className="percentage">{pct}%</div>
            </div>

            <div style={{ marginTop: "18px", fontSize: "18px" }}>
              Detección: {calibrationInfo.detected ? "correcta" : "buscando"} | Puntos visibles: {calibrationInfo.keypointsVisible}
            </div>

            <div className="action-buttons" style={{ marginTop: "20px" }}>
              <button className="btn-continue" onClick={handleStartMatch} disabled={!calibrationInfo.ready}>
                Iniciar partida
              </button>
              <button className="btn-back-outline" onClick={() => navigateTo("camera")}>
                Volver
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "game") {
    return (
      <div className="camera-screen compact-game-screen">
        {reconnectBanner && <div className="reconnect-banner">{reconnectBanner}</div>}

        <div className="game-main-layout">
          <div className={`camera-box ${flashActive ? "detect-flash detect-wave" : ""}`}>
            <video ref={videoRef} autoPlay playsInline className="video-feed" />
            <canvas ref={overlayCanvasRef} className="overlay-canvas" />

            <div key={currentInstructionKey} className="video-instruction animated-instruction">
              <div className="video-instruction-title">{currentInstruction}</div>
              <div className="video-instruction-sub">
                {currentChallenge
                  ? currentChallenge.challengeType === "pose"
                    ? "Reto de postura"
                    : "Reto de objeto"
                  : "Esperando reto..."}
              </div>
            </div>

            <div className="video-score-bottom">
              <div className="video-score-label">
                {currentPlayer?.displayName || nickname} · {myScore} puntos
              </div>
              <div className="video-score-bar-bg">
                <div className="video-score-bar-fill" style={{ width: `${myScorePct}%` }}></div>
              </div>
            </div>

            {lastResult?.matched && <div className="detected-badge">DETECTADO</div>}
          </div>

          <div className="side-streak-panel">
            <div className="streak-title">Tu racha</div>
            <div className="streak-bar-bg">
              <div className="streak-bar-fill" style={{ height: `${(streak / 10) * 100}%` }}></div>
            </div>
            <div className="streak-level">Nivel {streak}</div>
          </div>
        </div>

        <div className="setup-panel compact-panel game-status-panel" style={{ width: "900px" }}>
          <h3>Estado de la partida</h3>

          <div className="game-status-grid">
            <div className="game-status-card">
              <span className="game-status-label">Ronda</span>
              <span className="game-status-value">{matchState?.round?.roundNumber || 0}</span>
            </div>

            <div className="game-status-card">
              <span className="game-status-label">Partida</span>
              <span className="game-status-value">{getMatchStatusLabel(matchState?.status)}</span>
            </div>

            <div className="game-status-card">
              <span className="game-status-label">Tu acción</span>
              <span className="game-status-value">
                {lastResult ? (lastResult.matched ? "¡Movimiento detectado!" : "Sigue intentando") : "Esperando movimiento"}
              </span>
            </div>
          </div>

          <div className="game-player-status-list">
            {players.map((player) => (
              <div
                key={player.playerId}
                className={`game-player-status-item ${player.playerId === nickname ? "game-player-status-you" : ""} ${!player.connected ? "game-player-status-away" : ""}`}
              >
                <div className="game-player-status-main">
                  <span className="game-player-name">
                    {player.displayName || player.playerId}
                    {player.playerId === nickname ? " (Tú)" : ""}
                  </span>
                  <span className="game-player-presence">{getPlayerGameStatus(player)}</span>
                </div>

                <div className="game-player-score-text">{player.score} pts</div>
              </div>
            ))}
          </div>

          {roundBanner && <div className="round-banner">{roundBanner}</div>}
        </div>

        {showFinalOverlay && (
          <div className="final-overlay">
            <div className="final-card">
              <img src={logo} alt={GAME_NAME} className="final-logo" />
              <h2>Partida terminada</h2>
              <h1>{matchState?.winnerPlayerId || "Sin ganador"}</h1>

              <p>Resultados de esta partida</p>
              <div className="final-ranking">
                {sortedPlayers.map((player, index) => (
                  <div key={player.playerId} className="final-row">
                    <span>#{index + 1}</span>
                    <span>{player.displayName || player.playerId}</span>
                    <strong>{player.score}</strong>
                  </div>
                ))}
              </div>

              <button className="btn-continue" onClick={() => navigateTo("landing")}>
                Salir
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}