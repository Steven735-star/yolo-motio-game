from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class ChallengeType(str, Enum):
    pose = "pose"
    object = "object"


class MatchStatus(str, Enum):
    waiting_players = "waiting_players"
    lobby = "lobby"
    ready = "ready"
    in_progress = "in_progress"
    round_finished = "round_finished"
    round_timeout = "round_timeout"
    finished = "finished"
    aborted = "aborted"


class ClientEventType(str, Enum):
    join = "join"
    ready = "ready"
    frame = "frame"
    start_match = "start_match"
    ping = "ping"
    leave = "leave"
    calibration_frame = "calibration_frame"


class PlayerFrameMessage(BaseModel):
    type: Literal[ClientEventType.frame] = ClientEventType.frame
    matchId: str = Field(..., min_length=1, max_length=100)
    playerId: str = Field(..., min_length=1, max_length=100)
    frame: str = Field(..., description="base64 image or data URL")
    challengeType: ChallengeType | None = None
    target: str | None = None
    timestamp: float | None = None

    @field_validator("frame")
    @classmethod
    def validate_frame(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("El frame no puede estar vacío.")
        return value


class CalibrationFrameMessage(BaseModel):
    type: Literal[ClientEventType.calibration_frame] = ClientEventType.calibration_frame
    matchId: str = Field(..., min_length=1, max_length=100)
    playerId: str = Field(..., min_length=1, max_length=100)
    frame: str = Field(..., description="base64 image or data URL")
    timestamp: float | None = None


class JoinMessage(BaseModel):
    type: Literal[ClientEventType.join] = ClientEventType.join
    matchId: str = Field(..., min_length=1, max_length=100)
    playerId: str = Field(..., min_length=1, max_length=100)
    displayName: str | None = Field(default=None, max_length=100)


class ReadyMessage(BaseModel):
    type: Literal[ClientEventType.ready] = ClientEventType.ready
    matchId: str = Field(..., min_length=1, max_length=100)
    playerId: str = Field(..., min_length=1, max_length=100)
    ready: bool = True


class StartMatchMessage(BaseModel):
    type: Literal[ClientEventType.start_match] = ClientEventType.start_match
    matchId: str = Field(..., min_length=1, max_length=100)
    playerId: str | None = Field(default=None, max_length=100)


class LeaveMessage(BaseModel):
    type: Literal[ClientEventType.leave] = ClientEventType.leave
    matchId: str = Field(..., min_length=1, max_length=100)
    playerId: str = Field(..., min_length=1, max_length=100)


class PingMessage(BaseModel):
    type: Literal[ClientEventType.ping] = ClientEventType.ping
    matchId: str | None = None
    playerId: str | None = None


class WorkerResult(BaseModel):
    challenge_type: ChallengeType
    target: str
    matched: bool
    confidence: float
    details: dict[str, Any] = Field(default_factory=dict)


class ChallengeDefinition(BaseModel):
    challengeType: ChallengeType
    target: str
    instruction: str
    isSimonSays: bool


class PlayerState(BaseModel):
    playerId: str
    displayName: str | None = None
    ready: bool = False
    connected: bool = True
    score: int = 0
    lastReactionSeconds: float | None = None
    lastMatched: bool = False


class RoundState(BaseModel):
    roundNumber: int = 0
    active: bool = False
    challenge: ChallengeDefinition | None = None
    startedAt: float | None = None
    deadlineAt: float | None = None
    winnerPlayerId: str | None = None
    finishedAt: float | None = None
    reason: str | None = None


class MatchSnapshot(BaseModel):
    matchId: str
    status: MatchStatus
    players: list[PlayerState]
    round: RoundState
    winnerPlayerId: str | None = None
    maxPlayers: int = 5
    minPlayersToStart: int = 2
    canJoin: bool = True
    roundsRemaining: int = 0


class ServerEvent(BaseModel):
    event: str
    ok: bool = True
    message: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)