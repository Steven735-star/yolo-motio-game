from app.db.database import SessionLocal
from app.db.models import Match, Player, Round, Attempt


class MetricsService:

    def create_match(self, match_id: str):
        db = SessionLocal()
        try:
            existing = db.query(Match).filter_by(match_id=match_id).first()
            if not existing:
                db_match = Match(match_id=match_id, status="created")
                db.add(db_match)
                db.commit()
        except Exception as e:
            db.rollback()
            print(f"[MetricsService] Error al crear match {match_id}: {e}")
        finally:
            db.close()

    def save_player(self, match_id: str, player_id: str, display_name: str):
        db = SessionLocal()
        try:
            existing = db.query(Player).filter_by(
                match_id=match_id, player_id=player_id
            ).first()
            if not existing:
                db.add(Player(match_id=match_id, player_id=player_id,
                            display_name=display_name, score=0))
                db.commit()
        except Exception as e:
            db.rollback()
            print(f"[MetricsService] Error al guardar jugador {player_id}: {e}")
        finally:
            db.close()

    def update_score(self, match_id: str, player_id: str, score: int):
        db = SessionLocal()
        try:
            player = db.query(Player).filter_by(
                match_id=match_id,
                player_id=player_id
            ).first()

            if player:
                player.score = score
                db.commit()
        except Exception as e:
            db.rollback() # Revierte si hay error
            print(f"Error al actualizar score: {e}")
        finally:
            db.close() # Siempre cierra la conexión

    def save_round(self, match_id: str, round_number: int, challenge_type: str, target: str):
        db = SessionLocal()
        try:
            db.add(Round(match_id=match_id, round_number=round_number,
                        challenge_type=challenge_type, target=target))
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[MetricsService] Error al guardar ronda {round_number}: {e}")
        finally:
            db.close()

    def save_attempt(self, match_id: str, player_id: str, matched: bool, confidence: float):
        db = SessionLocal()
        try:
            db.add(Attempt(match_id=match_id, player_id=player_id,
                        matched=matched, confidence=confidence))
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[MetricsService] Error al guardar intento: {e}")
        finally:
            db.close()

    def finish_match(self, match_id: str, winner_player_id: str):
        db = SessionLocal()
        try:
            match = db.query(Match).filter_by(match_id=match_id).first()
            if match:
                match.status = "finished"
                match.winner_player_id = winner_player_id
                db.commit()
        except Exception as e:
            db.rollback()
            print(f"[MetricsService] Error al finalizar match {match_id}: {e}")
        finally:
            db.close()