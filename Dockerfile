# Production Dockerfile for Garmin Ingestion Service
FROM python:3.12-slim AS builder

WORKDIR /app

# Install uv for fast dependency restoration
RUN pip install --no-cache-dir uv

# Copy project definition and lock file
COPY pyproject.toml uv.lock /app/

# Install dependencies into virtual environment
RUN uv sync --frozen --no-dev

# Final runtime image
FROM python:3.12-slim AS runtime

# Set security and Python defaults
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

# Copy virtualenv and source code from builder
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --chown=appuser:appuser src /app/src
COPY --chown=appuser:appuser pyproject.toml /app/

USER appuser

# Default entrypoint runs daily sync
ENTRYPOINT ["python", "-m", "garmin_sync"]
CMD ["sync"]
