FROM node:22

WORKDIR /smart-face-attendance

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-dev \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    libasound2 \
    libsdl2-2.0-0 \
    libportmidi0 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/env

ENV PATH="/opt/env/bin:$PATH"

COPY backend/requirements.txt  ./backend/

RUN cd backend && pip install --no-cache-dir -r requirements.txt

COPY frontend/package*.json ./frontend/

RUN cd frontend && npm install

COPY backend/ ./backend/
COPY frontend/ ./frontend/

COPY docker/dev-entrypoint.sh /smart-face-attendance/dev-entrypoint.sh
RUN chmod +x /smart-face-attendance/dev-entrypoint.sh

EXPOSE 8000 5173

CMD ["/smart-face-attendance/dev-entrypoint.sh"]