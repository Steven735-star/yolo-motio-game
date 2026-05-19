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
    {"target": "right_hand_up", "instruction": "Levante la mano derecha"},
    {"target": "left_hand_up", "instruction": "Levante la mano izquierda"},
    {"target": "both_hands_up", "instruction": "Levante ambas manos"},
    {"target": "t_pose", "instruction": "Abra los brazos en cruz"},
    {"target": "hands_on_hips", "instruction": "Ponga las manos en la cintura"},
    {"target": "biceps_right", "instruction": "Muestre su bíceps derecho"},
    {"target": "biceps_left", "instruction": "Muestre su bíceps izquierdo"},
    {"target": "both_biceps", "instruction": "Muestre ambos bíceps"},
    {"target": "cover_eyes", "instruction": "Tápese los ojos"},
    {"target": "cover_ears", "instruction": "Tápese los oídos"},
    {"target": "right_hand_to_left_shoulder", "instruction": "Ponga su mano derecha en el hombro izquierdo"},
    {"target": "left_hand_to_right_shoulder", "instruction": "Ponga su mano izquierda en el hombro derecho"}
]

OBJECT_CATALOG: list[dict[str, str]] = [
    {"target": "backpack", "instruction": "Muestre una mochila"},
    {"target": "book", "instruction": "Muestre un libro"},
    {"target": "cell phone", "instruction": "Muestre un celular"},
    {"target": "bottle", "instruction": "Muestre una botella"},
    {"target": "apple", "instruction": "Muestre una manzana"},
]

MOTION_CATALOG: list[dict[str, str]] = [
    {"target": "any_movement", "instruction": "¡Mantente en movimiento!"},
    {"target": "stay_still", "instruction": "¡NO TE MUEVAS!"},
]

# Parámetros de puntuación estándar
SIMON_SUCCESS_POINTS = 10
SIMON_FAST_BONUS_POINTS = 2
TRAP_AVOID_POINTS = 5
TRAP_FAIL_PENALTY = 5
RECONNECT_GRACE_SECONDS = 20.0

# Umbrales para puntuación de movimiento por tramos
MOTION_HIGH_THRESHOLD = 80.0   # >= 80% → puntuación máxima
MOTION_LOW_THRESHOLD = 20.0    # < 20% → penalización


def _calc_motion_score(progress: float) -> int:
    """
    Calcula puntos de movimiento según el progreso acumulado al final de la ronda.

    Tramos (instrucción normal isSimonSays=True):
      >= 80%  → +SIMON_SUCCESS_POINTS (+10)
      20–79%  → proporcional entre 0 y +10
      < 20%   → -TRAP_FAIL_PENALTY (-5)

    Para trampa (isSimonSays=False) la lógica se invierte en register_attempt.
    """
    if progress >= MOTION_HIGH_THRESHOLD:
        return SIMON_SUCCESS_POINTS
    elif progress >= MOTION_LOW_THRESHOLD:
        # Proporcional: mapea [20, 80) → [0, 10)
        ratio = (progress - MOTION_LOW_THRESHOLD) / (MOTION_HIGH_THRESHOLD - MOTION_LOW_THRESHOLD)
        return max(1, round(ratio * SIMON_SUCCESS_POINTS))
    else:
        return -TRAP_FAIL_PENALTY


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
    last_target: str | None = None
    # Almacena el último progreso de movimiento por jugador para scoring final
    motion_progress: dict[str, float] = field(default_factory=dict)


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

        # Validar nombre duplicado
        if display_name:
            for existing in match.players.values():
                if (existing.displayName or "").lower() == display_name.lower():
                    raise ValueError(f"Ya hay un jugador con el nombre '{display_name}' en esta sala.")

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

        # 1. Validaciones de estado
        if match.status != MatchStatus.in_progress or not match.round_state.active:
            return self.snapshot(match_id)

        if player_id not in match.players:
            raise ValueError("El jugador no pertenece a la sala.")

        player = match.players[player_id]
        if not player.connected or not player.ready:
            return self.snapshot(match_id)

        challenge = match.round_state.challenge
        if challenge is None:
            return self.snapshot(match_id)

        # 2. Retos de movimiento: solo actualizamos el progreso en tiempo real.
        #    La puntuación se aplica en _finish_round al hacer timeout.
        if challenge.challengeType == ChallengeType.motion:
            new_progress = result.details.get("progress", 0.0)
            player.currentProgress = new_progress
            # Guardamos el último progreso para el scoring final
            match.motion_progress[player_id] = new_progress
            # No procesamos puntos aquí; retornamos snapshot actualizado
            return self.snapshot(match_id)

        # 3. Control de hits ya procesados (pose / objeto)
        if player_id in match.accepted_hits:
            return self.snapshot(match_id)

        now = time.time()
        reaction = None
        if match.round_state.startedAt is not None:
            reaction = max(0.0, now - match.round_state.startedAt)

        player.lastReactionSeconds = reaction
        player.lastMatched = bool(result.matched)

        # 4. Instrucción normal (isSimonSays=True): pose / objeto
        if challenge.isSimonSays:
            if result.matched:
                match.accepted_hits.add(player_id)

                if match.round_state.winnerPlayerId is None:
                    match.round_state.winnerPlayerId = player_id
                    player.score += SIMON_SUCCESS_POINTS

                    if reaction is not None and reaction <= self.settings.reaction_bonus_window_seconds:
                        player.score += SIMON_FAST_BONUS_POINTS

            return self.snapshot(match_id)

        # 5. Trampa (isSimonSays=False): pose / objeto
        #    Si el jugador hace la acción cuando no debe → pierde puntos
        if result.matched:
            match.accepted_hits.add(player_id)
            player.score -= TRAP_FAIL_PENALTY
            player.lastMatched = True
            if match.round_state.winnerPlayerId is None:
                match.round_state.winnerPlayerId = player_id

        return self.snapshot(match_id)

    def disconnect_player(self, match_id: str, player_id: str) -> MatchSnapshot | None:
        match = self.matches.get(match_id)
        if match is None or player_id not in match.players:
            return None

        match.players[player_id].connected = False
        match.disconnected_at[player_id] = time.time()

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

    # -------------------------------------------------------------------------
    # Lógica interna
    # -------------------------------------------------------------------------

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

        prev_challenge = match.round_state.challenge
        prev_target = prev_challenge.target if prev_challenge is not None else None

        challenge = self._build_random_challenge(exclude_target=prev_target)
        now = time.time()
        start_delay = 1.0

        for player in match.players.values():
            player.lastMatched = False
            player.lastReactionSeconds = None
            player.currentProgress = 100.0 if challenge.target == "stay_still" else 0.0

        match.motion_progress.clear()

        match.round_state = RoundState(
            roundNumber=match.round_state.roundNumber + 1,
            active=True,
            challenge=challenge,
            startedAt=now + start_delay,
            deadlineAt=now + self.settings.round_timeout_seconds + start_delay,
            winnerPlayerId=None,
            finishedAt=None,
            reason=None,
        )
        match.accepted_hits.clear()
        match.status = MatchStatus.in_progress
        match.last_target = challenge.target

    def _build_random_challenge(self, exclude_target: str | None = None) -> ChallengeDefinition:
        rand_category = random.random()

        if rand_category < 0.33:
            catalog = POSE_CATALOG
            challenge_type = ChallengeType.pose
        elif rand_category < 0.66:
            catalog = OBJECT_CATALOG
            challenge_type = ChallengeType.object
        else:
            catalog = MOTION_CATALOG
            challenge_type = ChallengeType.motion

        filtered = [c for c in catalog if c["target"] != exclude_target]
        if not filtered:
            filtered = catalog

        item = random.choice(filtered)

        rand_type = random.random()
        if rand_type < 0.45:
            prefix = "Simón dice: "
            is_simon_says = True
        elif rand_type < 0.70:
            prefix = ""
            is_simon_says = True
        else:
            prefix = "Tu ex dice: "
            is_simon_says = False

        instruction = f"{prefix}{item['instruction']}" if prefix else item['instruction'].capitalize()

        return ChallengeDefinition(
            challengeType=challenge_type,
            target=item["target"],
            instruction=instruction,
            isSimonSays=is_simon_says,
        )

    def _finish_round(self, match: MatchRuntime, reason: str) -> None:
        challenge = match.round_state.challenge

        # --- Puntuación final para rondas de MOVIMIENTO ---
        if challenge is not None and challenge.challengeType == ChallengeType.motion:
            self._apply_motion_end_scoring(match, challenge)

        # --- Puntuación por evitar trampa (pose/objeto sin prefijo Simon) ---
        elif reason == "timeout" and challenge is not None and not challenge.isSimonSays:
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

    def _apply_motion_end_scoring(self, match: MatchRuntime, challenge: ChallengeDefinition) -> None:
        """
        Aplica puntuación de movimiento al final de la ronda según el progreso acumulado.

        Instrucción normal (isSimonSays=True):
          - progress >= 80% → +10 pts
          - progress 20–79% → proporcional (+1 a +9 pts)
          - progress < 20%  → -5 pts

        Trampa (isSimonSays=False): lógica invertida.
          El jugador DEBE ignorar la instrucción:
          - Si stay_still: cumplir la orden (quedarse quieto) = pierde puntos
          - Si any_movement: cumplir la orden (moverse) = pierde puntos
          - No cumplirla = gana TRAP_AVOID_POINTS
        """
        for player in match.players.values():
            if not player.connected or not player.ready:
                continue

            progress = match.motion_progress.get(player.playerId, player.currentProgress)
            player.lastMatched = False

            if challenge.isSimonSays:
                # Instrucción normal → progress alto = bueno
                pts = _calc_motion_score(progress)
                player.score += pts
                if pts >= SIMON_SUCCESS_POINTS:
                    player.lastMatched = True
            else:
                # Trampa → el jugador DEBE IGNORAR la instrucción.
                # stay_still: alto progress = se quedó quieto = obedeció a su ex → penalización
                # any_movement: alto progress = se movió = obedeció a su ex → penalización
                # En ambos casos: progress alto = mal resultado
                inverted_progress = 100.0 - progress
                pts = _calc_motion_score(inverted_progress)
                player.score += pts
                if pts < 0:
                    # Obedeció a su ex
                    player.lastMatched = True  # visual de "cayó en la trampa"

    def _advance_after_round(self, match: MatchRuntime) -> None:
        if match.round_state.roundNumber >= self.settings.max_rounds:
            self._finish_match(match)
            return

        connected_ready = self._ready_connected_players(match)
        if len(connected_ready) < self.settings.min_players_to_start:
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
        match.motion_progress.clear()

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
        match.motion_progress.clear()

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
        match.motion_progress.clear()

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