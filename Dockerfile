# Debian 12 (bookworm) distribui nmcli/libnm 1.42.4. A base móvel
# python:3.12-slim passou para Debian 13 (nmcli 1.52.1), que envia
# mac-address-denylist ao daemon 1.46 do Zorin e falha ao criar hotspot.
FROM python:3.12-slim-bookworm
LABEL org.opencontainers.image.title="ZimaOS Network Manager" \
      org.opencontainers.image.version="0.3.9"
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends network-manager iw iproute2 \
    && rm -rf /var/lib/apt/lists/* \
    && nmcli --version
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
CMD ["python", "-m", "app.server"]
