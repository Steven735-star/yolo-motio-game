from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.db.database import Base


class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(String, unique=True, index=True)
    status = Column(String)
    winner_player_id = Column(String, nullable=True)


class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(String, index=True)
    player_id = Column(String)
    display_name = Column(String)
    score = Column(Integer, default=0)


class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(String)
    round_number = Column(Integer)
    challenge_type = Column(String)
    target = Column(String)
    winner_player_id = Column(String, nullable=True)


class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(String)
    player_id = Column(String)
    matched = Column(Boolean)
    confidence = Column(Float)