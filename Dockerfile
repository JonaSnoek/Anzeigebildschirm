# Digital Signage – Docker-Container (optional)
#
# Bauen:
#   docker build -t anzeige .
#
# Starten:
#   docker run -d --name anzeige -p 5000:5000 \
#     -e SECRET_KEY=$(openssl rand -hex 32) \
#     -v anzeige_uploads:/app/uploads \
#     -v anzeige_db:/app/database \
#     --restart unless-stopped anzeige
#
# Achtung: Das Volume bindet uploads/database, damit die Daten bei einem
# Container-Neustart erhalten bleiben.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=5000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads/images uploads/videos uploads/audio database

EXPOSE 5000

CMD ["python", "run.py"]
