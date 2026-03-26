import random
import time


def next_state(current_state):
    if current_state == "WAIT":
        return "MOVE"
    if current_state == "MOVE":
        return random.choice(["FREEZE", "FAKE"])
    if current_state in ["FREEZE", "FAKE"]:
        return "MOVE"

    return "WAIT"


def get_state_duration(state):
    if state == "WAIT":
        return random.uniform(2, 5)
    if state == "MOVE":
        return random.uniform(3, 6)
    if state == "FREEZE":
        return 2
    if state == "FAKE":
        return 2

    return 3


def check_freeze_success(player_state, duration_ok):
    return player_state == "QUIETO" and duration_ok