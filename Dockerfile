FROM python:3.11-slim

WORKDIR /smart-ai-face-attendance

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    libasound2 \
    libsdl2-2.0-0 \
    libportmidi0 \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r requirements.txt

CMD [ "python","source/attendance.py" ]