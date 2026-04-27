# Backend refactor - YOLO Motion Game 1v1

## Qué incluye
- FastAPI + WebSocket por `matchId`
- `GameCoordinator` para lobby, ready, inicio de partida y score
- `TaskRouter` para separar retos de pose y objeto
- `PoseWorker` con `yolo26n-pose.pt`
- `ObjectWorker` con `yolo26s.pt`
- protocolo JSON simple para frontend React

## Por qué así
En tu resumen quedó definido que el backend debía mantenerse modular, con coordinador central, router y workers separados, aunque todo corra localmente en una sola PC. Esa estructura está implementada aquí.

## Recomendación de modelos para tu laptop
- **Objeto**: `yolo26s.pt`
- **Pose**: `yolo26n-pose.pt`

La razón es práctica: en un i7 de 3ra generación con 8 GB de RAM, un modelo pequeño para pose suele ser mucho más estable que `yolo26s-pose`, mientras que `yolo26s` todavía puede servir para detección general si limitas FPS e imagen a 640.

## Instalación
```bash
cd backend_refactor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Ejecución
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoint de salud
```bash
curl http://localhost:8000/health
```

## Flujo WebSocket
Conéctate a:
```text
ws://localhost:8000/ws/test-match
```

### 1) join
```json
{
  "type": "join",
  "matchId": "test-match",
  "playerId": "p1",
  "displayName": "Jugador 1"
}
```

### 2) ready
```json
{
  "type": "ready",
  "matchId": "test-match",
  "playerId": "p1",
  "ready": true
}
```

### 3) start_match
```json
{
  "type": "start_match",
  "matchId": "test-match"
}
```

### 4) frame
```json
{
  "type": "frame",
  "matchId": "test-match",
  "playerId": "p1",
  "frame": "data:image/jpeg;base64,..."
}
```

## Targets soportados ahora
### Pose
- `hands_up`
- `left_hand_up`
- `right_hand_up`
- `t_pose`
- `hands_on_hips`

### Objetos (COCO)
- `bottle`
- `cell phone`
- `book`
- `cup`
- `backpack`

## Qué debes ajustar luego
1. Conectar el frontend React a `/ws/{matchId}`.
2. Hacer que el frontend muestre el `match_state` y `frame_result`.
3. Si el rendimiento cae, baja `YMG_IMAGE_SIZE` a `512` o cambia `YMG_DETECT_MODEL=yolo26n.pt`.
4. Cuando todo funcione, recién agregar Redis o PostgreSQL.
