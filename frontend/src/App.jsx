import React, { useEffect, useMemo, useRef, useState } from "react";

const WS_BASE = "ws://localhost:8000";
const DEFAULT_ROOM = "SALA-001";

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "ROOM-";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function App() {
  const [screen, setScreen] = useState(() => history.state?.screen || "landing");
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState(DEFAULT_ROOM);
  const [roomMode, setRoomMode] = useState("join"); // join | create

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [matchState, setMatchState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [joined, setJoined] = useState(false);
  const [readySent, setReadySent] = useState(false);
  const [logMessages, setLogMessages] = useState([]);

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

  const currentMatchId = roomId.trim() || DEFAULT_ROOM;

  const navigateTo = (newScreen) => {
    history.pushState({ screen: newScreen }, "", `#${newScreen}`);
    setScreen(newScreen);
  };

  const addLog = (msg) => {
    const now = new Date().toLocaleTimeString();
    setLogMessages((prev) => [`[${now}] ${msg}`, ...prev].slice(0, 120));
  };

  const showReconnectMessage = (msg, duration = 2500) => {
    setReconnectBanner(msg);
    window.clearTimeout(showReconnectMessage._t);
    showReconnectMessage._t = window.setTimeout(() => {
      setReconnectBanner("");
    }, duration);
  };

  const showLobbyNotice = (msg, duration = 2600) => {
    setLobbyNotice(msg);
    window.clearTimeout(showLobbyNotice._t);
    showLobbyNotice._t = window.setTimeout(() => {
      setLobbyNotice("");
    }, duration);
  };

  useEffect(() => {
    const handlePop = (e) => {
      const target = e.state?.screen || "landing";
      setScreen(target);
    };
    window.addEventListener("popstate", handlePop);
    history.replaceState({ screen: "landing" }, "", "#landing");
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && nickname.trim()) {
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

    if (screen === "camera" || screen === "calibration" || screen === "game") {
      async function startCamera() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false,
          });
          streamRef = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
          setCameraStatus("ready");
          addLog("Cámara activada.");
        } catch (err) {
          console.error(err);
          setCameraStatus("error");
          addLog("No se pudo activar la cámara.");
          setScreen("landing");
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
      (screen === "lobby" || screen === "camera" || screen === "calibration" || screen === "game");

    if (!shouldHaveSocket) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_BASE}/ws/${currentMatchId}`);
    wsRef.current = ws;
    setWsStatus("connecting");

    ws.onopen = () => {
      setWsStatus("connected");
      addLog(`Servidor conectado para sala ${currentMatchId}.`);

      if (wasDisconnected && screen === "game") {
        showReconnectMessage("Reconnected to ongoing match");
        setWasDisconnected(false);
      }
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      addLog("WebSocket cerrado.");

      if (screen === "game") {
        setWasDisconnected(true);
        showReconnectMessage("Connection lost. Trying to recover...");
      }
    };

    ws.onerror = () => {
      addLog("Error en WebSocket.");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
      } catch (err) {
        console.error(err);
        addLog("Mensaje inválido del servidor.");
      }
    };

    return () => {};
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
      addLog(`Solicitud join enviada para ${nickname}.`);
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
    if (matchState?.status === "finished") {
      setShowFinalOverlay(true);
    }
  }, [matchState?.status]);

  useEffect(() => {
    if (screen !== "calibration") {
      stopCalibrationFrames();
      return;
    }

    if (!videoRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    calibrationIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !ctx) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      const frame = canvas.toDataURL("image/jpeg", 0.65);

      sendWs({
        type: "calibration_frame",
        matchId: currentMatchId,
        playerId: nickname,
        frame,
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

    if (!videoRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    frameIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !ctx) return;
      if (!matchState?.round?.active || !matchState?.round?.challenge) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      const frame = canvas.toDataURL("image/jpeg", 0.65);

      sendWs({
        type: "frame",
        matchId: currentMatchId,
        playerId: nickname,
        frame,
        challengeType: matchState.round.challenge.challengeType,
        target: matchState.round.challenge.target,
        timestamp: Date.now() / 1000,
      });
    }, 250);

    addLog("Envío de frames iniciado a ~4 FPS.");

    return () => stopGameFrames();
  }, [screen, matchState?.round?.active, matchState?.round?.challenge, nickname, currentMatchId]);

  useEffect(() => {
    drawOverlay();
  }, [calibrationInfo, lastResult, screen]);

  useEffect(() => {
    if (screen !== "game") return;
    const disconnectedPlayers = players.filter((p) => !p.connected);
    if (disconnectedPlayers.length === 0) return;

    const someoneElseDisconnected = disconnectedPlayers.some((p) => p.playerId !== nickname);
    const iAmDisconnected = disconnectedPlayers.some((p) => p.playerId === nickname);

    if (iAmDisconnected) {
      showReconnectMessage("You are currently disconnected. Rejoin with the same nickname.");
      return;
    }

    if (someoneElseDisconnected) {
      const names = disconnectedPlayers
        .filter((p) => p.playerId !== nickname)
        .map((p) => p.displayName || p.playerId)
        .join(", ");

      showReconnectMessage(`Waiting for reconnection: ${names}`, 3000);
    }
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
      addLog("WS no conectado.");
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
    if (data.event === "connected") {
      addLog("WS conectado.");
      return;
    }

    if (data.event === "error") {
      addLog(`ERROR: ${data.message}`);
      return;
    }

    if (data.event === "pong") {
      return;
    }

    if (data.event === "match_state") {
      setMatchState(data.data);
      setPlayers(data.data?.players || []);

      const me = data.data?.players?.find((p) => p.playerId === nickname);
      if (me?.connected && wasDisconnected && screen === "game") {
        showReconnectMessage("Reconnected — score restored");
        setWasDisconnected(false);
      }

      if (data.data?.round?.reason === "timeout") {
        setRoundBanner("Round timeout");
      } else if (data.data?.round?.winnerPlayerId) {
        setRoundBanner(`Round winner: ${data.data.round.winnerPlayerId}`);
      }
      return;
    }

    if (data.event === "match_started") {
      setMatchState(data.data);
      setPlayers(data.data?.players || []);
      setStreak(0);
      addLog("Partida iniciada.");
      return;
    }

    if (data.event === "calibration_result") {
      setCalibrationInfo(data.data);
      return;
    }

    if (data.event === "frame_result") {
      const result = data.data?.workerResult || null;
      setLastResult(result);

      if (result?.matched) {
        triggerFlash();
        setStreak((prev) => Math.min(prev + 1, 10));
      } else {
        setStreak((prev) => Math.max(prev - 1, 0));
      }

      if (data.data?.match) {
        setMatchState(data.data.match);
        setPlayers(data.data.match?.players || []);
      }
      return;
    }

    if (data.event === "ignored_frame") {
      addLog(`Frame ignorado: ${data.message}`);
      return;
    }

    if (data.event === "left") {
      addLog(`Evento: ${JSON.stringify(data)}`);
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
      showLobbyNotice("You are ready.");
      addLog("Ready enviado.");
    }
  };

  const handleStartMatch = () => {
    const readyPlayers = players.filter((p) => p.ready && p.connected);
    const notReadyPlayers = players.filter((p) => !p.ready && p.connected);

    if (readyPlayers.length < 2) {
      if (notReadyPlayers.length > 0) {
        const names = notReadyPlayers.map((p) => p.displayName || p.playerId).join(", ");
        showLobbyNotice(`Tell ${names} to tap Ready. You want to start the match.`);
      } else {
        showLobbyNotice("At least 2 ready players are needed.");
      }
      return;
    }

    const ok = sendWs({
      type: "start_match",
      matchId: currentMatchId,
      playerId: nickname,
    });

    if (ok) {
      showLobbyNotice("Starting match...");
      addLog("Solicitud de inicio enviada.");
    }
  };

  const handleCreateRoom = () => {
    const code = generateRoomCode();
    setRoomMode("create");
    setRoomId(code);
    showLobbyNotice(`Room ${code} created.`);
  };

  const handleContinueToLobby = () => {
    if (!nickname.trim()) return;
    if (!roomId.trim()) {
      showLobbyNotice("Enter a room code first.");
      return;
    }
    navigateTo("lobby");
  };

  const handleNickKeyDown = (e) => {
    if (e.key === "Enter") {
      handleContinueToLobby();
    }
  };

  const handleLobbyKeyDown = (e) => {
    if (e.key === "Enter") {
      handleContinueToLobby();
    }
  };

  const handleCopyRoom = async () => {
    try {
      await navigator.clipboard.writeText(currentMatchId);
      setCopiedRoom(true);
      showLobbyNotice("Room code copied.");
      setTimeout(() => setCopiedRoom(false), 1500);
    } catch (err) {
      console.error(err);
    }
  };

  const currentChallenge = matchState?.round?.challenge;
  const currentInstruction = currentChallenge?.instruction || "Waiting for challenge...";
  const currentInstructionKey = `${matchState?.round?.roundNumber || 0}-${currentInstruction}`;
  const currentPlayer = players.find((p) => p.playerId === nickname);
  const myScore = currentPlayer?.score || 0;
  const maxScore = Math.max(10, ...players.map((p) => p.score || 0));
  const myScorePct = Math.max(6, (myScore / maxScore) * 100);

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => b.score - a.score);
  }, [players]);

  const allReady = players.length >= 2 && players.filter((p) => p.connected).every((p) => p.ready);
  const connectedCount = players.filter((p) => p.connected).length;
  const readyCount = players.filter((p) => p.connected && p.ready).length;


  const getPlayerGameStatus = (player) => {
  if (!player.connected) return "Away";
  if (player.lastMatched) return "On fire";
  if ((player.score || 0) > 0) return "In match";
  return "Playing";
};

const getMatchStatusLabel = (status) => {
  switch (status) {
    case "in_progress":
      return "Match in progress";
    case "finished":
      return "Match finished";
    case "round_finished":
      return "Round cleared";
    case "round_timeout":
      return "Round ended";
    case "ready":
      return "Squad ready";
    case "lobby":
      return "Waiting in lobby";
    case "waiting_players":
      return "Waiting for players";
    case "aborted":
      return "Match interrupted";
    default:
      return "In session";
  }
};


  if (screen === "landing") {
    return (
      <div className="landing">
        <h1 className="title" style={{ fontSize: "90px" }}>YOLO Motion Game</h1>
        <div className="gradient-line"></div>
        <p className="subtitle">
          Test your reflexes and body control in this interactive motion-based challenge.
        </p>
        <div className="buttons">
          <button className="primary" onClick={() => navigateTo("nick-input")}>
            ▶ Start Game
          </button>
          <button className="secondary" onClick={() => navigateTo("how-it-works")}>
            ℹ How it works
          </button>
        </div>
      </div>
    );
  }

  if (screen === "nick-input") {
    return (
      <div className="landing">
        <button className="back" onClick={() => navigateTo("landing")}>Back</button>

        {lobbyNotice && <div className="reconnect-banner">{lobbyNotice}</div>}

        <h1 className="camera-title">Create or Join a Room</h1>
        <p className="camera-subtitle">Choose a nickname and enter a room code to play.</p>

        <div className="setup-panel room-setup-panel" style={{ width: "520px", textAlign: "center" }}>
          <div className="room-mode-switch">
            <button
              className={`room-mode-btn ${roomMode === "join" ? "room-mode-btn-active" : ""}`}
              onClick={() => setRoomMode("join")}
            >
              Join Room
            </button>
            <button
              className={`room-mode-btn ${roomMode === "create" ? "room-mode-btn-active" : ""}`}
              onClick={handleCreateRoom}
            >
              Create Room
            </button>
          </div>

          <input
            type="text"
            className="nick-input"
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={handleNickKeyDown}
            maxLength={15}
          />

          <input
            type="text"
            className="nick-input"
            style={{ marginTop: "14px" }}
            placeholder="Room code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            onKeyDown={handleLobbyKeyDown}
            maxLength={16}
          />

          <div className="room-help-text">
            {roomMode === "create"
              ? "Share this room code with your friends."
              : "Enter the room code you received."}
          </div>

          <button
            className="primary"
            style={{ width: "100%", marginTop: "20px" }}
            disabled={!nickname.trim() || !roomId.trim()}
            onClick={handleContinueToLobby}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (screen === "lobby") {
    return (
      <div className="camera-screen">
        <h1 className="camera-title">Squad Lobby</h1>
        <p className="camera-subtitle">Get everyone ready, then jump into the match.</p>

        {lobbyNotice && <div className="reconnect-banner">{lobbyNotice}</div>}

        <div className="setup-panel lobby-panel-real" style={{ width: "760px" }}>
          <div className="lobby-top-row">
            <div>
              <div className="lobby-room-label">ROOM CODE</div>
              <div className="lobby-room-code">{currentMatchId}</div>
            </div>

            <button className="copy-room-btn" onClick={handleCopyRoom}>
              {copiedRoom ? "Copied!" : "Copy Code"}
            </button>
          </div>

          <div className="lobby-stats-row">
            <div className="lobby-stat-card">
              <span className="lobby-stat-number">{connectedCount}</span>
              <span className="lobby-stat-label">Players online</span>
            </div>
            <div className="lobby-stat-card">
              <span className="lobby-stat-number">{readyCount}</span>
              <span className="lobby-stat-label">Players ready</span>
            </div>
            <div className="lobby-stat-card">
              <span className="lobby-stat-number">{allReady ? "YES" : "NO"}</span>
              <span className="lobby-stat-label">Ready to start</span>
            </div>
          </div>

          <div className="player-list">
            {players.length === 0 ? (
              <div className="player-card-real player-card-you">
                <div className="player-card-name">{nickname} (You)</div>
                <div className="player-card-status">Joining room...</div>
              </div>
            ) : (
              players.map((player) => {
                const isYou = player.playerId === nickname;
                const statusText = !player.connected
                  ? "Offline"
                  : player.ready
                    ? "Ready"
                    : "Not ready";

                return (
                  <div
                    key={player.playerId}
                    className={`player-card-real ${isYou ? "player-card-you" : ""} ${player.ready ? "player-card-ready" : ""} ${!player.connected ? "player-card-offline" : ""}`}
                  >
                    <div className="player-card-name">
                      {player.displayName || player.playerId}
                      {isYou ? " (You)" : ""}
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
            {readySent ? "Ready ✓" : "Tap Ready"}
          </button>

          <button className="btn-continue" onClick={() => navigateTo("camera")}>
            Open Camera
          </button>

          <button
            className={`btn-continue start-match-btn ${allReady ? "start-match-btn-live" : "start-match-btn-wait"}`}
            onClick={handleStartMatch}
          >
            {allReady ? "Start Match" : "Waiting for Squad"}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "how-it-works") {
    return (
      <div className="camera-screen">
        <div className="top-bar" style={{ alignSelf: "flex-start" }}>
          <button className="back" onClick={() => navigateTo("landing")}>Back</button>
        </div>

        <h1 className="camera-title">How it Works</h1>
        <p className="camera-subtitle">Follow these steps to ensure the best motion detection experience.</p>

        <div className="setup-panel" style={{ width: "1000px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
          <div className="step-card">
            <div className="step-number">01</div>
            <h4>Calibration</h4>
            <p>The system verifies that your body is visible before the game starts.</p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h4>Pose Detection</h4>
            <p>Our AI identifies body keypoints in real-time using YOLO technology.</p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h4>Match & Score</h4>
            <p>Mimic the poses or show the requested object to earn points.</p>
          </div>
        </div>

        <button
          className="primary"
          style={{ marginTop: "40px" }}
          onClick={() => navigateTo("nick-input")}
        >
          Got it, let's start!
        </button>
      </div>
    );
  }

  if (screen === "camera") {
    return (
      <div className="camera-screen">
        <div className="top-bar" style={{ alignSelf: "flex-start" }}>
          <button className="back" onClick={() => navigateTo("lobby")}>Back</button>
        </div>

        <h1 className="camera-title">Position Yourself</h1>
        <p className="camera-subtitle">Make sure your full body is visible in the frame.</p>

        <div className="camera-box">
          <video ref={videoRef} autoPlay playsInline className="video-feed" />
        </div>

        {cameraStatus === "ready" && (
          <>
            <div className="setup-panel">
              <h3>Setup Tips:</h3>
              <ul className="setup-list">
                <li>✅ Stand 6-8 feet away from the camera</li>
                <li>✅ Ensure good lighting in the room</li>
                <li>✅ Your entire body should be visible</li>
              </ul>
            </div>
            <div className="action-buttons">
              <button className="btn-continue" onClick={() => navigateTo("calibration")}>Continue ✓</button>
              <button className="btn-back-outline" onClick={() => navigateTo("lobby")}>Back</button>
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
          <button className="back" onClick={() => navigateTo("camera")}>Back</button>
        </div>

        <div className={`camera-box ${flashActive ? "detect-flash" : ""}`}>
          <video ref={videoRef} autoPlay playsInline className="video-feed" />
          <canvas ref={overlayCanvasRef} className="overlay-canvas" />

          <div className="calibration-overlay">
            <div className="loader-ring"></div>
            <h1 className="camera-title" style={{ fontSize: "48px" }}>Calibrating...</h1>
            <p style={{ fontSize: "18px", opacity: 0.8 }}>
              Keep your body visible while we validate your position
            </p>

            <div className="progress-container">
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${pct}%` }}></div>
              </div>
              <div className="percentage">{pct}%</div>
            </div>

            <div style={{ marginTop: "18px", fontSize: "18px" }}>
              Detected: {String(calibrationInfo.detected)} | Keypoints: {calibrationInfo.keypointsVisible} | Stable: {calibrationInfo.stableFrames}
            </div>

            <div className="action-buttons" style={{ marginTop: "20px" }}>
              <button className="btn-continue" onClick={handleStartMatch} disabled={!calibrationInfo.ready}>
                Start Match
              </button>
              <button className="btn-back-outline" onClick={() => navigateTo("camera")}>
                Back
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
        <h1 className="camera-title game-screen-title">YOLO Motion Game</h1>

        {reconnectBanner && <div className="reconnect-banner">{reconnectBanner}</div>}

        <div className="game-main-layout">
          <div className={`camera-box ${flashActive ? "detect-flash detect-wave" : ""}`}>
            <video ref={videoRef} autoPlay playsInline className="video-feed" />
            <canvas ref={overlayCanvasRef} className="overlay-canvas" />

            <div key={currentInstructionKey} className="video-instruction animated-instruction">
              <div className="video-instruction-title">{currentInstruction}</div>
              <div className="video-instruction-sub">
                {currentChallenge
                  ? `${currentChallenge.challengeType} | target=${currentChallenge.target}`
                  : "Waiting for challenge..."}
              </div>
            </div>

            <div className="video-score-bottom">
              <div className="video-score-label">
                {currentPlayer?.displayName || nickname} · {myScore} pts
              </div>
              <div className="video-score-bar-bg">
                <div
                  className="video-score-bar-fill"
                  style={{ width: `${myScorePct}%` }}
                ></div>
              </div>
            </div>

            {lastResult?.matched && <div className="detected-badge">DETECTED</div>}
          </div>

          <div className="side-streak-panel">
            <div className="streak-title">Your Streak</div>
            <div className="streak-bar-bg">
              <div
                className="streak-bar-fill"
                style={{ height: `${(streak / 10) * 100}%` }}
              ></div>
            </div>
            <div className="streak-level">Lv {streak}</div>
          </div>
        </div>

        <div className="setup-panel compact-panel game-status-panel" style={{ width: "900px" }}>
          <h3>Match Update</h3>

          <div className="game-status-grid">
            <div className="game-status-card">
              <span className="game-status-label">Round</span>
              <span className="game-status-value">{matchState?.round?.roundNumber || 0}</span>
            </div>

            <div className="game-status-card">
              <span className="game-status-label">Match</span>
              <span className="game-status-value">
                {getMatchStatusLabel(matchState?.status)}
              </span>
            </div>

            <div className="game-status-card">
              <span className="game-status-label">Your action</span>
              <span className="game-status-value">
                {lastResult
                  ? lastResult.matched
                    ? "Great move!"
                    : "Keep trying"
                  : "Waiting for move"}
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
                    {player.playerId === nickname ? " (You)" : ""}
                  </span>
                  <span className="game-player-presence">
                    {getPlayerGameStatus(player)}
                  </span>
                </div>

                <div className="game-player-score-text">
                  {player.score} pts
                </div>
              </div>
            ))}
          </div>

          {roundBanner && <div className="round-banner">{roundBanner}</div>}
        </div>

        {showFinalOverlay && (
          <div className="final-overlay">
            <div className="final-card">
              <h2>Game Over</h2>
              <h1>{matchState?.winnerPlayerId || "No winner"}</h1>
              <p>Final ranking</p>
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
                Exit
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}