FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY backend ./backend
RUN python -m pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 tapbot \
    && mkdir -p /data/captures \
    && chown -R tapbot:tapbot /data
USER tapbot

EXPOSE 8000

CMD ["tapbot-api", "--host", "0.0.0.0", "--port", "8000"]
