# Single deployable: build the React SPA, then serve it + the API from FastAPI.
# Target: Railway (binds $PORT). Iframe-embedded at skiplum.no/apps/tfm-sjekk.

# --- stage 1: build frontend ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- stage 2: python runtime ---
FROM python:3.12-slim AS runtime
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV TFM_STORE_TTL=900 \
    TFM_STORE_MAX=3 \
    PYTHONUNBUFFERED=1
EXPOSE 8000
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
