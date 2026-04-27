from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import DefaultDict

from fastapi import WebSocket

from app.models.schemas import ServerEvent


class ConnectionManager:
    def __init__(self) -> None:
        self.match_connections: DefaultDict[str, set[WebSocket]] = defaultdict(set)
        self.lock = asyncio.Lock()

    async def connect(self, match_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self.lock:
            self.match_connections[match_id].add(websocket)

    async def disconnect(self, match_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            if match_id in self.match_connections:
                self.match_connections[match_id].discard(websocket)
                if not self.match_connections[match_id]:
                    del self.match_connections[match_id]

    async def send(self, websocket: WebSocket, payload: ServerEvent | dict) -> None:
        data = payload.model_dump() if isinstance(payload, ServerEvent) else payload
        await websocket.send_text(json.dumps(data, ensure_ascii=False))

    async def broadcast(self, match_id: str, payload: ServerEvent | dict) -> None:
        data = payload.model_dump() if isinstance(payload, ServerEvent) else payload
        text = json.dumps(data, ensure_ascii=False)

        async with self.lock:
            connections = list(self.match_connections.get(match_id, set()))

        stale: list[WebSocket] = []
        for ws in connections:
            try:
                await ws.send_text(text)
            except Exception:
                stale.append(ws)

        for ws in stale:
            await self.disconnect(match_id, ws)