# Production Dockerfile for Garmin Ingestion Service
FROM python:3.14-slim AS builder

WORKDIR /app

# Never let uv silently download a different Python interpreter than the base image.
# If pyproject.toml stops supporting the Docker runtime, fail the image build instead.
ENV UV_PYTHON_DOWNLOADS=never

# Pin the same modern uv release used by CI so Python 3.14 resolution and lock
# semantics are consistent across CI and the production image.
RUN pip install --no-cache-dir uv==0.12.2

# Copy project definition and lock file. README.md is required here even though it is
# not source: pyproject.toml declares `readme = "README.md"`, and hatchling validates
# that metadata while building the project, so `uv sync` fails with
# "OSError: Readme file does not exist: README.md" without it.
COPY pyproject.toml uv.lock README.md /app/

# Fail closed if the committed lock no longer represents pyproject.toml for this
# interpreter. `--frozen` alone intentionally skips lock freshness checks.
RUN uv lock --check

# Resolve third-party dependencies first, without building the project itself, so this
# layer stays cached when only src/ changes.
RUN uv sync --frozen --no-dev --no-install-project

# Then add the sources and install the project on top.
COPY src /app/src
RUN uv sync --frozen --no-dev

# Final runtime image
FROM python:3.14-slim AS runtime

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

# Catch interpreter/ABI mismatches during docker build, before a broken image can be
# pushed to Artifact Registry or deployed to Cloud Run.
RUN /app/.venv/bin/python --version && \
    /app/.venv/bin/python -c "import firebase_admin, garminconnect; import google.cloud.firestore; import google.cloud.storage"

USER appuser

# Default entrypoint runs daily sync
ENTRYPOINT ["python", "-m", "garmin_sync"]
CMD ["sync"]
