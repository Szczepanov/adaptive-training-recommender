# Local full stack with Docker Compose

The Compose stack mirrors the production request topology closely enough to exercise the
browser-facing integration locally without deploying Firebase Hosting or Cloud Run.

## Topology

| Local endpoint | Compose service | Purpose |
| --- | --- | --- |
| `http://127.0.0.1:8080` | `frontend` | Production Vite bundle served by Nginx |
| `http://127.0.0.1:8081` | `backend` | `garmin_sync.account_link_api` |
| `http://127.0.0.1:8082` | `google-health-backend` | `garmin_sync.google_health_account_link_api` |

Nginx keeps browser requests same-origin and mirrors the Firebase Hosting rewrites:

- `/api/garmin/**` -> `backend:8080`
- `/api/google-health/**` -> `google-health-backend:8080`
- all other routes -> the SPA (`index.html`)

The Google Health service is intentionally separate from the Garmin linker, matching the
production Cloud Run topology and the service's own isolation requirement.

## First-time setup

1. Copy `.env.example` to `.env` and fill in the Firebase web configuration used to build
   the frontend.
2. Put a Firebase service-account JSON at `./firebase-service-account.json`, or set
   `FIREBASE_CREDENTIALS_HOST_PATH` in `.env` to its host path. The file is mounted read-only
   into both Python HTTP services. Compose deliberately refuses to create a missing source
   path as a directory, so a bad credentials path fails at startup instead of becoming a
   confusing Firebase error.
3. For a real Google Health OAuth link flow, also configure `GOOGLE_HEALTH_CLIENT_ID`,
   `GOOGLE_HEALTH_CLIENT_SECRET`, `GOOGLE_HEALTH_REDIRECT_URI`, and
   `GOOGLE_HEALTH_TOKEN_BUCKET`. The health and routing smoke checks do not require live
   Google OAuth credentials.

Then run:

```bash
make docker-build
make docker-up
make docker-smoke
```

`make docker-up` waits until all three services are healthy. `make docker-down` stops the
stack without deleting the named Garmin-token volume.

## Local Vite development

Running `npm run dev` inside `app/` does not use Nginx. Vite proxies the two API families
straight to the local Python services instead:

- Garmin defaults to `http://localhost:8081`
- Google Health defaults to `http://localhost:8082`

Override those targets in `app/.env.local` with `VITE_GARMIN_BACKEND_URL` and
`VITE_GOOGLE_HEALTH_BACKEND_URL`. `vite.config.ts` uses `loadEnv`, so values from Vite env
files affect the proxy configuration as documented.

## Exposure and security parity

Published Compose ports bind to `127.0.0.1` by default so local account-link APIs are not
silently exposed to the LAN. Set `COMPOSE_BIND_ADDRESS` only when remote access is
intentional.

The Nginx container carries the same CSP, frame, content-type, referrer, and permissions
headers as `app/firebase.json`. Hashed `/assets/` files are immutable; `index.html`, the
service worker, registration script, and web manifest remain revalidatable so a new deploy
cannot be hidden behind a long-lived cache entry.

## Smoke contract

`scripts/docker_compose_smoke.py` verifies:

- both Python services are healthy directly;
- the frontend SPA is served with security and no-cache headers;
- a built hashed asset retains both immutable caching and security headers;
- the PWA service worker is not long-cacheable;
- Garmin requests reach the Garmin linker through Nginx;
- Google Health requests reach the separate Google Health linker through Nginx.

CI invokes this same script after `docker compose up --wait`, so local and CI smoke behavior
share one implementation.
