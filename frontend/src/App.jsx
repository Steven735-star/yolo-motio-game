import React, { useEffect, useMemo, useRef, useState } from "react";
import logo from "./assets/logo.png";
import CalibrationProgress from "./CalibrationProgress"; // Ajusta la ruta si es necesario

const WS_BASE = "wss://broaden-unlighted-shrubs.ngrok-free.dev";
const DEFAULT_ROOM = "SALA-001";
const GAME_NAME = "No le hagas caso a tu ex";

const MOBILE_BREAKPOINT = 768;

function isMobileViewport() {
  if (typeof window === "undefined") return false;

  const hasTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0;

  return window.innerWidth <= MOBILE_BREAKPOINT || hasTouch;
}

function getCameraConstraints(isMobile) {
  return {
    video: {
      facingMode: "user",
      width: { ideal: isMobile ? 480 : 640 },
      height: { ideal: isMobile ? 640 : 480 },
      aspectRatio: isMobile ? { ideal: 3 / 4 } : { ideal: 4 / 3 },
    },
    audio: false,
  };
}

function getFrameProfile(isMobile) {
  return {
    width: isMobile ? 288 : 320,
    height: isMobile ? 384 : 240,
    quality: isMobile ? 0.55 : 0.65,
    calibrationIntervalMs: isMobile ? 450 : 350,
    gameIntervalMs: isMobile ? 350 : 250,
  };
}


function getDeviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("device_id", id);
  }
  return id;
}


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
  return cleanInstruction(challenge.instruction || "");
}

export default function App() {
  const [screen, setScreen] = useState("landing");
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [nickname, setNickname] = useState("");
  const [deviceId] = useState(() => getDeviceId());
  const [roomId, setRoomId] = useState(DEFAULT_ROOM);
  const [roomMode, setRoomMode] = useState("join");
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());

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


  const [calibrationAchieved, setCalibrationAchieved] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [roundBanner, setRoundBanner] = useState("");
  const [showFinalOverlay, setShowFinalOverlay] = useState(false);
  const [streak, setStreak] = useState(0);
  const [motionStatus, setMotionStatus] = useState(null);
  const [blockedFromMatch, setBlockedFromMatch] = useState(false);

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
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const updateDeviceMode = () => {
      setIsMobile(isMobileViewport());
    };

    updateDeviceMode();

    window.addEventListener("resize", updateDeviceMode);
    window.addEventListener("orientationchange", updateDeviceMode);

    return () => {
      window.removeEventListener("resize", updateDeviceMode);
      window.removeEventListener("orientationchange", updateDeviceMode);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        if (wsRef.current?.readyState === WebSocket.OPEN && nickname.trim()) {
          wsRef.current.send(
            JSON.stringify({
              type: "leave",
              matchId: currentMatchId,
              playerId: deviceId,
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
          const stream = await navigator.mediaDevices.getUserMedia(
            getCameraConstraints(isMobile)
          );
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
  }, [screen, isMobile]);

  useEffect(() => {
    const effectiveNickname = screen === "calibration" && !nickname.trim() ? "calibracion-temp" : nickname;
    const effectiveMatchId = screen === "calibration" && !currentMatchId.trim() ? "SALA-CALIBRACION" : currentMatchId;

    const shouldHaveSocket =
      effectiveNickname.trim() &&
      effectiveMatchId &&
      ["lobby", "camera", "calibration", "game"].includes(screen);

    if (!shouldHaveSocket) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/${effectiveMatchId}`);
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
              playerId: deviceId,
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
      setCalibrationAchieved(false);
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
    const joinNickname = screen === "calibration" && !nickname.trim() ? "calibracion-temp" : nickname;
    const joinMatchId = screen === "calibration" && !currentMatchId.trim() ? "SALA-CALIBRACION" : currentMatchId;

    if (["lobby", "calibration", "game"].includes(screen) && wsStatus === "connected" && joinNickname.trim() && !joined) {
      sendWs({
        type: "join",
        matchId: joinMatchId,
        playerId: deviceId,
        displayName: joinNickname,
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
        playerId: deviceId,
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [wsStatus, nickname, screen, currentMatchId]);

  useEffect(() => {
    if (matchState?.status === "in_progress" && !blockedFromMatch) {
      setShowFinalOverlay(false);
      if (screen !== "game") setTimeout(() => navigateTo("game"), 250);
    }
  }, [matchState?.status, screen, blockedFromMatch]);

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

    const frameProfile = getFrameProfile(isMobile);

    calibrationIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !ctx || wsRef.current?.readyState !== WebSocket.OPEN) return;

      canvas.width = frameProfile.width;
      canvas.height = frameProfile.height;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      const calMatchId = !currentMatchId.trim() ? "SALA-CALIBRACION" : currentMatchId;
      sendWs({
        type: "calibration_frame",
        matchId: calMatchId,
        playerId: deviceId,
        frame: canvas.toDataURL("image/jpeg", frameProfile.quality),
        timestamp: Date.now() / 1000,
      });
    }, frameProfile.calibrationIntervalMs);

    return () => stopCalibrationFrames();
  }, [screen, nickname, wsStatus, currentMatchId, isMobile]);

  useEffect(() => {
    if (screen !== "game") {
      stopGameFrames();
      return;
    }

    if (!videoRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const frameProfile = getFrameProfile(isMobile);

    frameIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !ctx) return;
      if (!matchState?.round?.active || !matchState?.round?.challenge) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const roundNumber = matchState.round.roundNumber;

      if (blockedFrameRoundRef.current === roundNumber) return;

      canvas.width = frameProfile.width;
      canvas.height = frameProfile.height;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      sendWs({
        type: "frame",
        matchId: currentMatchId,
        playerId: deviceId,
        frame: canvas.toDataURL("image/jpeg", frameProfile.quality),
        challengeType: matchState.round.challenge.challengeType,
        target: matchState.round.challenge.target,
        timestamp: Date.now() / 1000,
      });
    }, frameProfile.gameIntervalMs);

    return () => stopGameFrames();
  }, [
    screen,
    matchState?.round?.roundNumber,
    matchState?.round?.active,
    matchState?.round?.challenge,
    nickname,
    currentMatchId,
    isMobile,
  ]);

  useEffect(() => drawOverlay(), [calibrationInfo, lastResult, screen, isMobile]);
  useEffect(() => {
    if (calibrationInfo.ready && !calibrationAchieved) {
      setCalibrationAchieved(true);
    }
  }, [calibrationInfo.ready]);

  useEffect(() => {
    if (screen !== "game") return;

    const disconnectedPlayers = players.filter((p) => !p.connected);
    if (disconnectedPlayers.length === 0) return;

    const names = disconnectedPlayers
      .filter((p) => p.playerId !== deviceId)
      .map((p) => p.displayName || p.playerId)
      .join(", ");

    if (names) showReconnectMessage(`Esperando reconexión de: ${names}`, 3000);
  }, [players, deviceId, screen]);

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
      const msg = data.message || "Ocurrió un error.";
      if (msg.includes("ya inició")) {
        setBlockedFromMatch(true);
      } else {
        showLobbyNotice(msg);
      }
      return;
    }

    if (data.event === "match_state") {
      setMatchState(data.data);
      setPlayers(data.data?.players || []);


      // Detectar nombre duplicado
      const me = (data.data?.players || []).find(p => p.playerId === deviceId);
      const duplicate = (data.data?.players || []).find(
        p => p.displayName?.toLowerCase() === nickname.toLowerCase() && p.playerId !== deviceId
      );
      if (duplicate && !me && screen === "lobby") {
        showLobbyNotice("Ya hay un jugador con ese nombre en la sala.");
        setTimeout(() => navigateTo("landing"), 2000);
        return;
      }

      // Sincronizar readySent con el estado real del servidor
      if (me) setReadySent(me.ready);



      // Limpiar badge si la ronda terminó o no es motion
      if (!data.data?.round?.active || data.data?.round?.challenge?.challengeType !== "motion") {
        setMotionStatus(null);
      }

      const currentRound = data.data?.round?.roundNumber;
      if (blockedFrameRoundRef.current && currentRound !== blockedFrameRoundRef.current) {
        blockedFrameRoundRef.current = null;
      }

      if (data.data?.round?.reason === "timeout") {
        setRoundBanner("Tiempo terminado");
        setTimeout(() => setRoundBanner(""), 3000);
      } else if (data.data?.round?.winnerPlayerId) {
        const roundWinner = (data.data?.players || []).find(p => p.playerId === data.data.round.winnerPlayerId);
        setRoundBanner(`Ganó la ronda: ${roundWinner?.displayName || "?"}`);
        setTimeout(() => setRoundBanner(""), 3000);
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
        const framePlayerId = data.data?.playerId;

        // Estado de partida y jugadores: se actualiza para todos
        if (match) {
            setMatchState(match);
            setPlayers(match.players || []);
        }

        // Todo lo demás: solo si es el jugador local
        if (framePlayerId !== deviceId) return;

        setLastResult(result);

        if (match?.round?.challenge?.challengeType === "motion") {
          setMotionStatus(result?.details?.status || null);
        } else {
          setMotionStatus(null);
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

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const displayWidth = Math.max(1, rect.width);
    const displayHeight = Math.max(1, rect.height);

    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const keypoints =
      screen === "calibration"
        ? calibrationInfo?.keypoints || []
        : lastResult?.details?.keypoints || [];

    const frameProfile = getFrameProfile(isMobile);
    const scaleX = displayWidth / frameProfile.width;
    const scaleY = displayHeight / frameProfile.height;

    keypoints.forEach((kp) => {
      if ((kp.conf || 0) < 0.3) return;

      const x = kp.x * scaleX;
      const y = kp.y * scaleY;

      ctx.beginPath();
      ctx.arc(x, y, isMobile ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = "#4cc9f0";
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#4cc9f0";
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  };

  const handleReady = () => {
  const currentPlayer = players.find((p) => p.playerId === deviceId);
  const isReady = currentPlayer?.ready ?? readySent;
  const newReady = !isReady;

  const ok = sendWs({
    type: "ready",
    matchId: currentMatchId,
    playerId: deviceId,
    ready: newReady,
  });

  if (ok) {
    setReadySent(newReady);
    showLobbyNotice(newReady ? "Estás listo." : "Ya no estás listo.");
   }
  };

  const handleStartMatch = () => {
    if (matchState?.status === "in_progress") {
      showLobbyNotice("La partida ya está en curso.");
      return;
    }

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
      playerId: deviceId,
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

    const duplicate = players.find(
      p => p.displayName?.toLowerCase() === nickname.trim().toLowerCase() && p.playerId !== deviceId
    );
    if (duplicate) {
      showLobbyNotice("Ya hay un jugador con ese nombre en esta sala.");
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

  const handleReadyToggle = () => {
  const currentPlayer = players.find((p) => p.playerId === deviceId);
  const isReady = currentPlayer?.ready ?? false;
  sendWs({
    type: "ready",
    matchId: currentMatchId,
    playerId: deviceId,
    ready: !isReady,
    });
  };

  const getPlayerGameStatus = (player) => {
    if (!player.connected) return "Reconectando...";
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
  const currentPlayer = players.find((p) => p.playerId === deviceId);
  const myScore = currentPlayer?.score || 0;
  const maxScore = Math.max(10, ...players.map((p) => p.score || 0));
  const myScorePct = Math.max(6, (myScore / maxScore) * 100);

  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);

  const connectedPlayers = players.filter((p) => p.connected);
  const allReady = connectedPlayers.length >= 2 && connectedPlayers.every((p) => p.ready);
  const connectedCount = connectedPlayers.length;
  const readyCount = connectedPlayers.filter((p) => p.ready).length;

  if (screen === "landing") {
    return (
      <div className="landing">
        <img src={logo} alt={GAME_NAME} className="landing-logo" />

        <div className="buttons landing-buttons">
          <button className="primary" onClick={() => navigateTo("nick-input")}>
            ▶ Iniciar juego
          </button>
          <button className="secondary" onClick={() => navigateTo("how-it-works")}>
            ¿Cómo jugar?
          </button>
        </div>
        <button className="btn-subtle" onClick={() => navigateTo("camera")}>
          📷 Probar cámara
        </button>
      </div>
    );
  }

  if (screen === "nick-input") {
    return (
      <div className="landing">
        <button className="back" onClick={() => navigateTo("landing")}>Volver</button>

        {lobbyNotice && <div className="reconnect-banner">{lobbyNotice}</div>}

        <h2 className="camera-title">Unirse a una sala</h2>
        <p className="camera-subtitle">Elige tu nombre e ingresa o genera un código de sala.</p>

        <div className="setup-panel room-setup-panel" style={{ width: "520px", textAlign: "center" }}>




          <input
            type="text"
            className="nick-input"
            placeholder="Tu nombre"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={handleNickKeyDown}
            maxLength={15}
          />

          <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
            <input
              type="text"
              className="nick-input"
              style={{ flex: 1, margin: 0 }}
              placeholder="Código de sala"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              onKeyDown={handleNickKeyDown}
              maxLength={16}
            />
            <button
              className="room-mode-btn"
              style={{ whiteSpace: "nowrap" }}
              onClick={handleCreateRoom}
            >
              ↺ Generar nuevo
            </button>
          </div>

          <div className="room-help-text">
            {roomMode === "create"
              ? "✓ Código generado. Compártelo con los demás jugadores."
              : "Ingresa el código que te compartieron, o genera uno nuevo."}
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
    const handleLeaveLobby = () => {
      if (window.confirm("¿Seguro que quieres salir de la sala?")) {
        navigateTo("nick-input");
      }
    };

    return (
      <div className="camera-screen">
        <button className="back" onClick={handleLeaveLobby}>Volver</button>
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
              players.filter((p) => p.connected).map((player) => {
                const isYou = player.playerId === deviceId;
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
          {/* Botón de Ready con estados Rojo (not-ready) y Verde (is-ready) */}
          <button 
            className={`btn-continue btn-ready-toggle ${
              (players.find((p) => p.playerId === deviceId)?.ready ?? readySent) ? "is-ready" : "not-ready"
            }`} 
            onClick={handleReady}
          >
            {(players.find((p) => p.playerId === deviceId)?.ready ?? readySent) ? "No estoy listo" : "Estoy listo"}
          </button>


          {/* Botón de Iniciar Partida: Azul Neón solo cuando todos están listos */}
          <button
            className={`btn-continue start-match-btn ${allReady ? "btn-start-active" : "btn-start-disabled"}`}
            onClick={handleStartMatch}
            disabled={!allReady}
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
          <button className="back" onClick={() => navigateTo("landing")}>Volver</button>
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
              <button className="btn-back-outline" onClick={() => navigateTo("landing")}>Volver</button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (screen === "calibration") {
    return (
      <div className="camera-screen">
        <div className="top-bar" style={{ alignSelf: "flex-start" }}>
          <button className="back" onClick={() => navigateTo("camera")}>Volver</button>
        </div>

        <div className={`camera-box ${flashActive ? "detect-flash" : ""}`}>
          <video ref={videoRef} autoPlay playsInline className="video-feed" />
          <canvas ref={overlayCanvasRef} className="overlay-canvas" />

          {/* Usamos el nuevo componente aquí */}
          <CalibrationProgress 
            stableFrames={calibrationInfo.stableFrames}
            isDetected={calibrationInfo.detected}
            keypointsVisible={calibrationInfo.keypointsVisible}
          />
        </div>

        <div className="action-buttons" style={{ marginTop: "20px" }}>
            <button 
              className="btn-continue" 
              onClick={() => navigateTo("nick-input")} 
              disabled={!calibrationAchieved}
            >
              Jugar
            </button>
            <button className="btn-back-outline" onClick={() => navigateTo("camera")}>
              Volver
            </button>
        </div>
      </div>
    );
}

  if (screen === "game") {
    return (
      <div className="camera-screen compact-game-screen">
        {reconnectBanner && (
          <div style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(30, 20, 60, 0.95)",
            color: "#fff",
            padding: "10px 28px",
            borderRadius: "24px",
            fontSize: "0.95rem",
            fontWeight: "bold",
            zIndex: 9999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}>
            {reconnectBanner}
          </div>
        )}

        <div key={currentInstructionKey} className="video-instruction animated-instruction">
          <div className="video-instruction-title">{currentInstruction}</div>
          <div className="video-instruction-sub">
            {currentChallenge
              ? currentChallenge.challengeType === "pose"
              ? "Reto de postura"
              : currentChallenge.challengeType === "motion"
              ? "Reto de movimiento"
              : "Reto de objeto"
              : "Esperando reto..."}
          </div>
        </div>

        <div className="game-main-layout">
          <div className={`camera-box ${flashActive ? "detect-flash detect-wave" : ""}`}>
            <video ref={videoRef} autoPlay playsInline className="video-feed" />
            <canvas ref={overlayCanvasRef} className="overlay-canvas" />

            <div className="video-score-bottom">
              <span className="video-score-name">{currentPlayer?.displayName || nickname}</span>
              <span key={myScore} className="video-score-number animated-score">
                {myScore > 0 ? `+${myScore}` : myScore} pts
              </span>
            </div>

            {lastResult?.matched && <div className="detected-badge">DETECTADO</div>}
          </div>

        </div>

        <div className="streak-horizontal-panel">
          <span className="streak-title">Tu racha</span>
          <div className="streak-bar-bg">
            <div className="streak-bar-fill" style={{ width: `${(streak / 10) * 100}%` }}></div>
          </div>
          <span className="streak-level">Nivel {streak}</span>
        </div>

        <div className="setup-panel compact-panel game-status-panel" style={{ width: "640px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ color: "#1cccf3", marginBottom: "12px", marginTop: "-20px" }}>
              Estado de la partida
            </h2>
            {motionStatus && (
              <div style={{
                background: motionStatus === "STABLE"
                  ? "rgba(0,200,80,0.92)"
                  : motionStatus === "NO_PERSON"
                  ? "rgba(220,150,0,0.92)"
                  : "rgba(220,30,30,0.92)",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "0.95rem",
                padding: "5px 16px",
                borderRadius: "20px",
                letterSpacing: "1px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}>
                {motionStatus === "STABLE"
                  ? "🟢 QUIETO"
                  : motionStatus === "NO_PERSON"
                  ? "🟡 SIN PERSONA"
                  : "🔴 MOVIMIENTO"}
              </div>
            )}
          </div>

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
            {players.filter((p) => p.connected).map((player) => (
              <div
                key={player.playerId}
                className={`game-player-status-item ${player.playerId === deviceId ? "game-player-status-you" : ""} ${!player.connected ? "game-player-status-away" : ""}`}
              >
                <div className="game-player-status-main">
                  <span className="game-player-name">
                    {player.displayName || player.playerId}
                    {player.playerId === deviceId  ? " (Tú)" : ""}
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
              <h1>
                {players.find(p => p.playerId === matchState?.winnerPlayerId)?.displayName
                  || "Sin ganador"}
              </h1>

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

  if (blockedFromMatch) {
    return (
      <div className="landing">
        <img src={logo} alt={GAME_NAME} className="landing-logo" />
        <h2 style={{ color: "#fff", marginBottom: "12px" }}>Partida en curso</h2>
        <p style={{ color: "#ccc", marginBottom: "28px", textAlign: "center", maxWidth: "340px" }}>
          La partida ya inició. No puedes unirte en este momento.
        </p>
        <button className="primary" onClick={() => {
          setBlockedFromMatch(false);
          navigateTo("landing");
        }}>
          Volver al inicio
        </button>
      </div>
    );
  }

  return null;
}