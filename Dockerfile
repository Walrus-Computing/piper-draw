# Stage 1: build the Vite/React frontend
FROM node:22-slim AS frontend
WORKDIR /app/gui
COPY gui/package.json gui/package-lock.json ./
RUN npm ci
COPY gui/ ./
RUN npm run build

# Stage 2: Python runtime serving FastAPI + the built frontend
FROM python:3.14-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY server.py ./
COPY --from=frontend /app/gui/dist ./gui/dist

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
