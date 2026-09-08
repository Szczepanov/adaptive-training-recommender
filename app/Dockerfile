# syntax=docker/dockerfile:1

# ---- Builder stage: install deps and produce the static production bundle ----
FROM node:22-alpine AS builder
WORKDIR /app

# Vite inlines these into the client bundle at build time (see app/.env.example), so they
# must be supplied as build args, not runtime env vars.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ARG VITE_HEALTH_ANOMALY_POLICY=off
ARG VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY=off
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET} \
    VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID} \
    VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID} \
    VITE_HEALTH_ANOMALY_POLICY=${VITE_HEALTH_ANOMALY_POLICY} \
    VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY=${VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY}

# Install dependencies first (uses legacy-peer-deps per .npmrc) so this layer stays cached
# when only application source changes. Skip Playwright's browser download during install --
# @playwright/test is only used by the visual-review test suite, never by the production
# build, and downloading Chromium here just wastes time/network in the image build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps

# Copy sources and build the production bundle. Uses build:bundle (plain `vite build`)
# rather than `build` (which also runs the full lint/typecheck/test/validate suite) --
# that suite belongs in CI, not in the image build.
COPY . .
RUN npm run build:bundle

# ---- Runtime stage: serve the static bundle with nginx ----
# Track the current stable nginx line rather than the obsolete 1.27 development line.
FROM nginx:1.30.4-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/dist /usr/share/nginx/html
# nginx's official entrypoint envsubst's every *.template in this directory into
# /etc/nginx/conf.d/ at container start. This resolves backend service names at runtime,
# so the same frontend image can be wired differently without rebuilding the SPA.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY security-headers.conf /etc/nginx/security-headers.conf
ENV BACKEND_HOST=backend \
    BACKEND_PORT=8080 \
    GOOGLE_HEALTH_BACKEND_HOST=google-health-backend

# nginx needs write access to these paths (including the templated conf dir + generated
# conf) even when running as a non-root user; nginx's entrypoint envsubst step needs to
# write into /etc/nginx/conf.d as this user too.
RUN chown -R appuser:appgroup /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /etc/nginx/templates \
    && touch /var/run/nginx.pid \
    && chown appuser:appgroup /var/run/nginx.pid

USER appuser
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
