from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

from app.config import Settings
from app.models.schemas import (
    ChallengeDefinition,
    ChallengeType,
    MatchSnapshot,
    MatchStatus,
    PlayerState,
    RoundState,
    WorkerResult,
)

POSE_CATALOG: list[dict[str, str]] = [
    {"target": "right_hand_up", "instruction": "levante la mano derecha"},
    {"target": "left_hand_up", "instruction": "levante la mano izquierda"},
    {"target": "both_hands_up", "instruction": "levante ambas manos"},
    {"target": "t_pose", "instruction": "abra los brazos en cruz"},
    {"target": "hands_on_hips", "instruction": "ponga las manos en la cintura"},
]

OBJECT_CATALOG: list[dict[str, str]] = [
    {"target": "backpack", "instruction": "muestre una mochila"},
    {"target": "book", "instruction": "muestre un libro"},
    {"target": "cell phone", "instruction": "muestre un celular"},
    {"target": "cup", "instruction": "muestre un vaso"},
    {"target": "bottle", "instruction": "muestre una botella"},
    {"target": "laptop", "instruction": "muestre una laptop"},
    {"target": "keyboard", "instruction": "muestre un teclado"},
    {"target": "mouse", "instruction": "muestre un mouse"},
    {"target": "tie", "instruction": "muestre una corbata"},
]

SIMON_SUCCESS_POINTS = 10
SIMON_FAST_BONUS_POINTS = 2
TRAP_AVOID_POINTS = 5
TRAP_FAIL_PENALTY = 5
RECONNECT_GRACE_SECONDS = 20.0


@dataclass
class MatchRuntime:
    match_id: str
    players: dict[str, PlayerState] = field(default_factory=dict)
    round_state: RoundState = field(default_factory=RoundState)
    status: MatchStatus = MatchStatus.waiting_players
    winner_player_id: str | None = None
    accepted_hits: set[str] = field(default_factory=set)
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    disconnected_at: dict[str, float] = field(default_factory=dict)


class GameCoordinator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.matches: dict[str, MatchRuntime] = {}

    def ensure_match(self, match_id: str) -> MatchRuntime:
        if match_id not in self.matches:
            self.matches[match_id] = MatchRuntime(match_id=match_id)
        return self.matches[match_id]

    def join_player(self, match_id: str, player_id: str, display_name: str | None = None) -> MatchSnapshot:
        match = self.ensure_match(match_id)

        # Permitir reconexión del mismo jugador aunque la partida siga en progreso
        if player_id in match.players:
            state = match.players[player_id]
            state.displayName = display_name or state.displayName
            state.connected = True
            match.disconnected_at.pop(player_id, None)
            return self.snapshot(match_id)

        if match.status in {
            MatchStatus.in_progress,
            MatchStatus.round_finished,
            MatchStatus.round_timeout,
        }:
            raise ValueError("La partida ya inició. Solo se permite reconexión de jugadores existentes.")

        if len(match.players) >= self.settings.max_players_per_match:
            raise ValueError(f"La sala ya alcanzó el máximo de {self.settings.max_players_per_match} jugadores.")

        state = PlayerState(playerId=player_id, displayName=display_name)
        state.connected = True
        match.players[player_id] = state

        if match.status in {MatchStatus.finished, MatchStatus.aborted}:
            self._prepare_lobby_replay(match)

        self._refresh_lobby_status(match)
        return self.snapshot(match_id)

    def set_ready(self, match_id: str, player_id: str, ready: bool) -> MatchSnapshot:
        match = self.ensure_match(match_id)
        if player_id not in match.players:
            raise ValueError("El jugador no pertenece a la sala.")

        if match.status in {MatchStatus.in_progress, MatchStatus.round_finished, MatchStatus.round_timeout}:
            raise ValueError("La partida ya inició. No se puede cambiar ready.")

        if match.status in {MatchStatus.finished, MatchStatus.aborted}:
            self._prepare_lobby_replay(match)

        match.players[player_id].ready = ready
        self._refresh_lobby_status(match)
        return self.snapshot(match_id)

    def start_match(self, match_id: str) -> MatchSnapshot:
        match = self.ensure_match(match_id)

        if match.status in {MatchStatus.finished, MatchStatus.aborted}:
            self._prepare_replay(match)

        ready_players = self._ready_connected_players(match)
        if len(ready_players) < self.settings.min_players_to_start:
            raise ValueError(
                f"Se requieren al menos {self.settings.min_players_to_start} jugadores listos para iniciar."
            )

        match.started_at = time.time()
        match.winner_player_id = None
        match.finished_at = None
        match.disconnected_at.clear()

        for player in match.players.values():
            player.score = 0
            player.lastMatched = False
            player.lastReactionSeconds = None

        match.status = MatchStatus.in_progress
        self._start_next_round(match)
        return self.snapshot(match_id)

    def current_or_new_challenge(self, match_id: str) -> ChallengeDefinition:
        match = self.ensure_match(match_id)
        self.tick(match_id)

        if match.round_state.challenge is None and match.status == MatchStatus.in_progress:
            self._start_next_round(match)

        if match.round_state.challenge is None:
            raise ValueError("No hay ronda activa en este momento.")

        return match.round_state.challenge

    def register_attempt(self, match_id: str, player_id: str, result: WorkerResult) -> MatchSnapshot:
        match = self.ensure_match(match_id)
        self.tick(match_id)

        if match.status != MatchStatus.in_progress or not match.round_state.active:
            return self.snapshot(match_id)

        if player_id not in match.players:
            raise ValueError("El jugador no pertenece a la sala.")

        player = match.players[player_id]
        if not player.connected or not player.ready:
            return self.snapshot(match_id)

        if player_id in match.accepted_hits:
            return self.snapshot(match_id)

        challenge = match.round_state.challenge
        if challenge is None:
            return self.snapshot(match_id)

        now = time.time()
        reaction = None
        if match.round_state.startedAt is not None:
            reaction = max(0.0, now - match.round_state.startedAt)

        player.lastReactionSeconds = reaction
        player.lastMatched = bool(result.matched)

        if challenge.isSimonSays:
            if result.matched:
                match.accepted_hits.add(player_id)
                if match.round_state.winnerPlayerId is None:
                    match.round_state.winnerPlayerId = player_id
                    player.score += SIMON_SUCCESS_POINTS
                    if reaction is not None and reaction <= self.settings.reaction_bonus_window_seconds:
                        player.score += SIMON_FAST_BONUS_POINTS
                    self._finish_round(match, reason="simon_success")
            return self.snapshot(match_id)

        if result.matched:
            match.accepted_hits.add(player_id)
            player.score -= TRAP_FAIL_PENALTY
            if match.round_state.winnerPlayerId is None:
                match.round_state.winnerPlayerId = player_id
            return self.snapshot(match_id)

        return self.snapshot(match_id)

    def disconnect_player(self, match_id: str, player_id: str) -> MatchSnapshot | None:
        match = self.matches.get(match_id)
        if match is None or player_id not in match.players:
            return None

        match.players[player_id].connected = False
        match.disconnected_at[player_id] = time.time()

        # No terminar inmediatamente; se espera el tiempo de gracia.
        if match.status not in {MatchStatus.in_progress, MatchStatus.round_finished, MatchStatus.round_timeout}:
            self._refresh_lobby_status(match)

        return self.snapshot(match_id)

    def remove_player(self, match_id: str, player_id: str) -> MatchSnapshot | None:
        match = self.matches.get(match_id)
        if match is None:
            return None

        match.players.pop(player_id, None)
        match.disconnected_at.pop(player_id, None)

        if not match.players:
            self._hard_reset_match(match)
            return self.snapshot(match_id)

        if match.status in {MatchStatus.in_progress, MatchStatus.round_finished, MatchStatus.round_timeout}:
            self._maybe_abort_or_finish_due_to_absence(match)
        else:
            self._refresh_lobby_status(match)

        return self.snapshot(match_id)

    def tick(self, match_id: str) -> MatchSnapshot:
        match = self.ensure_match(match_id)

        self._prune_disconnected(match)

        if match.status == MatchStatus.in_progress and match.round_state.active:
            deadline = match.round_state.deadlineAt
            if deadline is not None and time.time() > deadline:
                self._finish_round(match, reason="timeout")

        if match.status in {MatchStatus.round_finished, MatchStatus.round_timeout}:
            if match.round_state.finishedAt is not None:
                if (time.time() - match.round_state.finishedAt) >= self.settings.inter_round_delay_seconds:
                    self._advance_after_round(match)

        return self.snapshot(match_id)

    def snapshot(self, match_id: str) -> MatchSnapshot:
        match = self.ensure_match(match_id)
        can_join = match.status in {
            MatchStatus.waiting_players,
            MatchStatus.lobby,
            MatchStatus.ready,
            MatchStatus.finished,
            MatchStatus.aborted,
        }
        rounds_remaining = max(0, self.settings.max_rounds - match.round_state.roundNumber)

        return MatchSnapshot(
            matchId=match_id,
            status=match.status,
            players=list(match.players.values()),
            round=match.round_state,
            winnerPlayerId=match.winner_player_id,
            maxPlayers=self.settings.max_players_per_match,
            minPlayersToStart=self.settings.min_players_to_start,
            canJoin=can_join and len(match.players) < self.settings.max_players_per_match,
            roundsRemaining=rounds_remaining,
        )

    def _refresh_lobby_status(self, match: MatchRuntime) -> None:
        total_players = len(match.players)
        ready_connected = self._ready_connected_players(match)

        if total_players < self.settings.min_players_to_start:
            match.status = MatchStatus.waiting_players
            return

        if len(ready_connected) >= self.settings.min_players_to_start:
            match.status = MatchStatus.ready
        else:
            match.status = MatchStatus.lobby

    def _ready_connected_players(self, match: MatchRuntime) -> list[PlayerState]:
        return [p for p in match.players.values() if p.connected and p.ready]

    def _connected_players(self, match: MatchRuntime) -> list[PlayerState]:
        return [p for p in match.players.values() if p.connected]

    def _start_next_round(self, match: MatchRuntime) -> None:
        if match.round_state.roundNumber >= self.settings.max_rounds:
            self._finish_match(match)
            return

        challenge = self._build_random_challenge()
        now = time.time()

        for player in match.players.values():
            player.lastMatched = False
            player.lastReactionSeconds = None

        match.round_state = RoundState(
            roundNumber=match.round_state.roundNumber + 1,
            active=True,
            challenge=challenge,
            startedAt=now,
            deadlineAt=now + self.settings.round_timeout_seconds,
            winnerPlayerId=None,
            finishedAt=None,
            reason=None,
        )
        match.accepted_hits.clear()
        match.status = MatchStatus.in_progress

    def _build_random_challenge(self) -> ChallengeDefinition:
        is_pose = random.random() < 0.5
        is_simon_says = random.random() < 0.65

        if is_pose:
            item = random.choice(POSE_CATALOG)
            instruction = f"Simón dice: {item['instruction']}" if is_simon_says else item["instruction"].capitalize()
            return ChallengeDefinition(
                challengeType=ChallengeType.pose,
                target=item["target"],
                instruction=instruction,
                isSimonSays=is_simon_says,
            )

        item = random.choice(OBJECT_CATALOG)
        instruction = f"Simón dice: {item['instruction']}" if is_simon_says else item["instruction"].capitalize()
        return ChallengeDefinition(
            challengeType=ChallengeType.object,
            target=item["target"],
            instruction=instruction,
            isSimonSays=is_simon_says,
        )

    def _finish_round(self, match: MatchRuntime, reason: str) -> None:
        challenge = match.round_state.challenge

        if reason == "timeout" and challenge is not None and not challenge.isSimonSays:
            for player in match.players.values():
                if player.connected and player.ready and player.playerId not in match.accepted_hits:
                    player.score += TRAP_AVOID_POINTS

        match.round_state.active = False
        match.round_state.finishedAt = time.time()
        match.round_state.reason = reason

        if reason == "timeout":
            match.status = MatchStatus.round_timeout
        else:
            match.status = MatchStatus.round_finished

    def _advance_after_round(self, match: MatchRuntime) -> None:
        if match.round_state.roundNumber >= self.settings.max_rounds:
            self._finish_match(match)
            return

        connected_ready = self._ready_connected_players(match)
        if len(connected_ready) < self.settings.min_players_to_start:
            # aún no abortar aquí; si faltan jugadores quizá están dentro del tiempo de gracia
            if self._has_pending_reconnect(match):
                return
            match.status = MatchStatus.aborted
            return

        self._start_next_round(match)

    def _finish_match(self, match: MatchRuntime) -> None:
        match.status = MatchStatus.finished
        match.finished_at = time.time()
        match.round_state.active = False

        if not match.players:
            match.winner_player_id = None
            return

        sorted_players = sorted(
            match.players.values(),
            key=lambda p: (p.score, -(p.lastReactionSeconds or 999999)),
            reverse=True,
        )
        match.winner_player_id = sorted_players[0].playerId if sorted_players else None

    def _prepare_lobby_replay(self, match: MatchRuntime) -> None:
        match.status = MatchStatus.lobby
        match.winner_player_id = None
        match.started_at = None
        match.finished_at = None
        match.accepted_hits.clear()
        match.round_state = RoundState()
        match.disconnected_at.clear()

        for player in match.players.values():
            player.ready = False
            player.lastMatched = False
            player.lastReactionSeconds = None

    def _prepare_replay(self, match: MatchRuntime) -> None:
        match.winner_player_id = None
        match.started_at = None
        match.finished_at = None
        match.accepted_hits.clear()
        match.round_state = RoundState()
        match.status = MatchStatus.lobby
        match.disconnected_at.clear()

        for player in match.players.values():
            player.score = 0
            player.lastMatched = False
            player.lastReactionSeconds = None

    def _hard_reset_match(self, match: MatchRuntime) -> None:
        match.players = {}
        match.round_state = RoundState()
        match.status = MatchStatus.waiting_players
        match.winner_player_id = None
        match.accepted_hits.clear()
        match.started_at = None
        match.finished_at = None
        match.disconnected_at.clear()

    def _prune_disconnected(self, match: MatchRuntime) -> None:
        now = time.time()
        expired = [
            player_id
            for player_id, disconnected_at in list(match.disconnected_at.items())
            if (now - disconnected_at) > RECONNECT_GRACE_SECONDS
        ]

        for player_id in expired:
            match.disconnected_at.pop(player_id, None)

        if expired and match.status in {MatchStatus.in_progress, MatchStatus.round_finished, MatchStatus.round_timeout}:
            self._maybe_abort_or_finish_due_to_absence(match)

    def _has_pending_reconnect(self, match: MatchRuntime) -> bool:
        if not match.disconnected_at:
            return False
        now = time.time()
        return any((now - ts) <= RECONNECT_GRACE_SECONDS for ts in match.disconnected_at.values())

    def _maybe_abort_or_finish_due_to_absence(self, match: MatchRuntime) -> None:
        connected = self._connected_players(match)

        if len(connected) >= self.settings.min_players_to_start:
            return

        if self._has_pending_reconnect(match):
            return

        if len(connected) == 1:
            match.winner_player_id = connected[0].playerId
            match.status = MatchStatus.finished
            match.finished_at = time.time()
            match.round_state.active = False
            match.round_state.finishedAt = time.time()
            match.round_state.reason = "only_one_remaining_after_grace"
            return

        match.status = MatchStatus.aborted
        match.round_state.active = False
        match.round_state.finishedAt = time.time()
        match.round_state.reason = "not_enough_players_after_grace"