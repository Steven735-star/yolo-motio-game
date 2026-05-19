FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Dependencias esenciales
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# USAMOS /app para que coincida con tu estructura de paquetes
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el resto del código
COPY . .

EXPOSE 8000

# Usamos un pequeño delay de 2 segundos para asegurar que el socket de red esté listo
CMD ["sh", "-c", "sleep 2 && uvicorn app.main:app --host 0.0.0.0 --port 8000"]