# 🎮 No le hagas caso a tu ex

Juego multijugador en tiempo real basado en visión computacional. Los jugadores usan la cámara para responder instrucciones mediante poses corporales u objetos detectados con modelos YOLO.

---

## 📖 Descripción

El juego funciona con una dinámica tipo **"Simón dice"**, pero adaptada a la mecánica del proyecto:

- Si aparece una instrucción normal, el jugador debe realizarla para ganar puntos.
- Si aparece `Tu ex dice: ...`, el jugador debe **ignorarla**.
- Si obedece una instrucción de "Tu ex dice", **pierde puntos**.
- Gana quien acumule mayor puntaje al finalizar las rondas.

El sistema detecta acciones usando visión computacional en tiempo real, combinando detección de poses y detección de objetos.

---

## 🛠️ Tecnologías usadas

### Frontend
- React
- Vite
- WebSocket
- HTML5 Camera API
- CSS personalizado

### Backend
- Python
- FastAPI
- WebSocket
- Ultralytics YOLO
- OpenCV
- PostgreSQL
- Redis
- Docker

### Modelos
- YOLO Pose — detección corporal
- YOLO Object Detection — detección de objetos

---

## ✅ Funcionalidades principales

- Creación y unión a salas mediante código
- Soporte multijugador
- Detección de poses corporales
- Detección de objetos comunes
- Sistema de puntaje
- Sistema de racha
- Calibración inicial de cámara
- Reconexión de jugadores
- Feedback visual en tiempo real
- Persistencia de métricas en PostgreSQL

---

## 🏗️ Arquitectura general

```text
Frontend React
    |
    | WebSocket
    v
Backend FastAPI
    |
    +--> Game Logic
    |
    +--> Router Service
          |
          +--> Pose Worker   --> YOLO Pose
          |
          +--> Object Worker --> YOLO Object
    |
    +--> PostgreSQL
    |
    +--> Redis
```

---

## 📁 Estructura del proyecto

```text
yolo-motion-game/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── core/
│   │   ├── models/
│   │   ├── services/
│   │   └── utils/
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── styles.css
│   │   └── assets/
│   │       └── logo.png
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

---

## ⚙️ Requisitos

Antes de ejecutar el proyecto, instalar:

- Python 3.10+
- Node.js 18+
- Docker
- Docker Compose
- Conda (opcional, recomendado para el backend)

---

## 🚀 Instalación

### Backend

```bash
# Entrar a la carpeta del backend
cd backend

# Crear o activar entorno con Conda
conda create -n vision python=3.10
conda activate vision

# Instalar dependencias
pip install -r requirements.txt

# Levantar PostgreSQL y Redis con Docker
docker compose up -d

# Ejecutar backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verificar funcionamiento en: `http://localhost:8000/health`

### Frontend

```bash
# Entrar a la carpeta del frontend
cd frontend

# Instalar dependencias
npm install

# Ejecutar frontend
npm run dev -- --host 0.0.0.0
```

Abrir en navegador: `http://localhost:5173`

---

## 🔌 Configuración del WebSocket

En el archivo principal del frontend, configurar la variable `WS_BASE` según el entorno:

**Misma computadora:**
```js
const WS_BASE = "ws://localhost:8000";
```

**Otra computadora en la misma red:**
```js
const WS_BASE = "ws://IP_DEL_BACKEND:8000";
// Ejemplo: const WS_BASE = "ws://192.168.1.50:8000";
```

**Usando túnel externo (ngrok u otro):**
```js
const WS_BASE = "wss://TU_URL_NGROK";
```

### Ejecución en red local

En la computadora que ejecuta el proyecto:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
npm run dev -- --host 0.0.0.0
```

Desde otro dispositivo en la misma red: `http://IP_DEL_SERVIDOR:5173`

---

## 🎯 Uso del juego

1. Abrir la aplicación.
2. Crear una sala o ingresar un código existente.
3. Escribir un nombre de jugador.
4. Entrar a la sala.
5. Marcarse como listo.
6. Abrir la cámara.
7. Calibrar posición.
8. Iniciar partida.
9. Seguir solo las instrucciones normales.
10. **Ignorar** las instrucciones que empiezan con `Tu ex dice`.

---

## 🧠 Lógica de juego

Cada ronda genera un reto de tipo **pose** u **objeto**.

**Ejemplos:**
```
Levante la mano derecha
Muestre un libro
Tu ex dice: levante ambas manos
Tu ex dice: muestre un celular
```

**Reglas:**
| Acción | Resultado |
|---|---|
| Instrucción normal cumplida correctamente | ✅ Suma puntos |
| Instrucción de "Tu ex dice" ignorada | ✅ Evita penalización |
| Instrucción de "Tu ex dice" realizada | ❌ Resta puntos |

El mejor tiempo de reacción puede otorgar ventaja. Gana el jugador con mayor puntaje al final.

---

## 👁️ Visión computacional

### Pose Worker

Procesa poses corporales usando **YOLO Pose**. El modelo obtiene keypoints del cuerpo humano:

- Hombros, codos, muñecas
- Cadera, nariz

**Ejemplo de regla:** una mano está levantada si la muñeca está por encima del hombro.

### Object Worker

Procesa objetos usando **YOLO Object Detection**. Detecta objetos comunes como:

- Libro, celular, botella, mochila, laptop, vaso

---

## 🗄️ Base de datos

El sistema usa **PostgreSQL** para guardar métricas de juego, intentos y puntajes.

```bash
# Entrar al contenedor de PostgreSQL
docker exec -it yolo_postgres psql -U yolo_user -d yolo_game

# Consultar intentos
SELECT * FROM session_metrics ORDER BY id DESC LIMIT 20;
```

### Redis

Redis se usa para manejo rápido de estado y soporte de arquitectura distribuida.

```bash
docker ps
# Debe aparecer un contenedor similar a: yolo_redis
```

---

## 🔧 Ajustes importantes

### Cambiar duración de cada instrucción

En `app/config.py`, buscar:

```python
round_timeout_seconds: float = 6.0
```

### Cambiar modelos

En `app/config.py`:

```python
pose_model = "yolo26n-pose.pt"
detect_model = "yolo26s.pt"
```

### Cambiar umbral de detección

Buscar variables como `pose_conf`, `object_conf`, `pose_keypoint_conf`.

> Reducir el umbral hace la detección más sensible, pero puede generar falsos positivos.

---

## 📊 Estado actual del proyecto

El sistema actualmente permite:

- Correr backend y frontend localmente
- Crear salas y conectar varios jugadores
- Procesar cámara en tiempo real
- Detectar poses y objetos
- Actualizar puntajes y mostrar ganador
- Guardar métricas en base de datos

---

## 🚧 Posibles mejoras futuras

- Desplegar backend en AWS, Render o Railway
- Desplegar frontend en Vercel o Netlify
- Separar workers de visión en servicios independientes
- Agregar ranking histórico desde PostgreSQL
- Mejorar detección con modelos entrenados específicamente
- Agregar sonidos y efectos visuales
- Implementar modo torneo
- Optimizar inferencia para hardware limitado

---

## 👥 Autores

- **Steven Rodríguez**
- **Kevin Erazo**

Proyecto desarrollado como propuesta de integración entre visión computacional, sistemas distribuidos y desarrollo web interactivo.

---

## 📄 Licencia

Proyecto académico. Uso libre para fines educativos.
