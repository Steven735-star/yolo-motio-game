from app.db.database import SessionLocal
from app.db.models import Match, Player, Round, Attempt


class MetricsService:

    def create_match(self, match_id: str):
        db = SessionLocal()
        db_match = Match(match_id=match_id, status="created")
        db.add(db_match)
        db.commit()
        db.close()

    def save_player(self, match_id: str, player_id: str, display_name: str):
        db = SessionLocal()
        db_player = Player(
            match_id=match_id,
            player_id=player_id,
            display_name=display_name,
            score=0
        )
        db.add(db_player)
        db.commit()
        db.close()

    def update_score(self, match_id: str, player_id: str, score: int):
        db = SessionLocal()
        player = db.query(Player).filter_by(
            match_id=match_id,
            player_id=player_id
        ).first()

        if player:
            player.score = score
            db.commit()

        db.close()

    def save_round(self, match_id: str, round_number: int, challenge_type: str, target: str):
        db = SessionLocal()
        round_db = Round(
            match_id=match_id,
            round_number=round_number,
            challenge_type=challenge_type,
            target=target
        )
        db.add(round_db)
        db.commit()
        db.close()

    def save_attempt(self, match_id: str, player_id: str, matched: bool, confidence: float):
        db = SessionLocal()
        attempt = Attempt(
            match_id=match_id,
            player_id=player_id,
            matched=matched,
            confidence=confidence
        )
        db.add(attempt)
        db.commit()
        db.close()

    def finish_match(self, match_id: str, winner_player_id: str):
        db = SessionLocal()
        match = db.query(Match).filter_by(match_id=match_id).first()
        if match:
            match.status = "finished"
            match.winner_player_id = winner_player_id
            db.commit()
        db.close()