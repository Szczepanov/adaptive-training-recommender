# Concurrent test-harness port isolation

**Status:** `In progress` — P0–P3, P5, P6 and P8 implemented in PR #960; P4 measured and
dropped; P7 skipped (see
[Delivery record](#delivery-record))
**Blocked by:** — (PR #958 merged; this branch is rebased on it)
**Unlocks:** running `make verify`, `test:e2e`, `test:rules`, visual capture and the local preview from several agent worktrees at once without port collisions, cross-worktree server reuse, or orphaned emulators
**Scope:** test/dev harness only (`app/scripts/`, Playwright configs, E2E support, `scripts/verify_repo.py`, the `local-app-preview` skill). No engine, policy, rules or production code path changes; no `POLICY_VERSION` impact.

## Problem

Agents run in many git worktrees at once (59 on the 2026-10-01 machine snapshot). Every
emulator-backed or browser suite binds **fixed, machine-global ports**, and the only isolation
that exists — `app/scripts/run-rules-shard.mjs` — isolates shards *within one* `make verify`,
not *across* worktrees.

### Fixed ports in use

| Harness | Entry point | Ports | Isolated across worktrees? |
|---|---|---|---|
| Browser E2E | `npm run test:e2e` → `firebase emulators:exec` with `app/firebase.json` | auth 9099, firestore 8080, firestore websocket 9150, hub 4400 (IPv4 **and** `::1`), logging 4500 | No |
| E2E app server | `playwright.e2e.config.ts` `webServer` → `npm run e2e:serve` | 4173 | No |
| Visual capture | `playwright.config.ts` `webServer` → `npm run visual:serve` | 4174 | No |
| Rules shards | `run-rules-shard.mjs` `BASE_PORTS` + shard index | 8181+, 9161+, 4411+, 4511+ | No — shard *N* uses the same ports in every worktree |
| Rules (unsharded) | `npm run test:rules` | `firebase.json` defaults (8080, 9150, 4400, 4500) | No — collides with E2E |
| Local preview skill | `.claude/skills/local-app-preview` → `emulators:start` + `e2e:serve` | 9099, 8080, 4173 — long-running | No |
| Docker compose | `docker compose up` | frontend 8080, backends 8081–8083 | No — frontend shares 8080 with the Firestore emulator |

The ports are also baked into `app/.env.e2e` (`VITE_FIREBASE_AUTH_EMULATOR_PORT`,
`VITE_FIREBASE_FIRESTORE_EMULATOR_PORT`) and the defaults in `tests/e2e/support/athlete.ts`
(`E2E_AUTH_PORT`, `E2E_FIRESTORE_PORT` env overrides exist but nothing sets them).
`E2E_PROJECT_ID` is a constant, so every run in every worktree uses
`demo-adaptive-training-e2e`.

### Failure modes this produces

1. **Port-taken failures.** Two worktrees running E2E (or E2E and unsharded rules, or E2E and a
   preview someone left running) race for 9099/8080/4400; the loser fails with firebase-tools'
   `Could not start …, port taken.` The usual agent "fix" — kill whatever owns the port — kills
   *another agent's* emulator mid-run.
2. **Silent cross-worktree server reuse (correctness bug, worse than a failure).** Both Playwright
   configs set `reuseExistingServer: !process.env.CI`. Locally, if another worktree's Vite already
   answers on 4173/4174, Playwright reuses it — the suite then tests *the other worktree's code*
   and can pass or fail for reasons unrelated to the change under test.
3. **Shared emulator-hub locator.** firebase-tools writes `hub-<projectId>.json` into `os.tmpdir()`
   (`EmulatorHub.getLocatorFilePath`) and only warns ("multiple instances of the emulator suite")
   when a live hub for the same project exists. Same project id everywhere ⇒ every concurrent run
   shares one locator file.
4. **Orphans from hard kills.** The locator is deleted only by firebase-tools' own `exit`/`SIGINT`
   handlers. The 2026-10-01 snapshot found `hub-demo-adaptive-training-rules-1.json` and `-2.json`
   in `%TEMP%` whose owning pids were dead — those runs were terminated without running exit
   handlers (tool timeout / `taskkill`). On Windows killing the `npm`/`node` parent does not kill
   the child tree, so the Java emulator and Vite can survive and keep ports bound. Nothing in the
   repo detects or reaps them.
5. **Socket churn and resource pile-up.** Per run: one JVM per emulator suite (`make verify` runs
   three concurrently: two rules shards + E2E), each opening hub + logging + emulator +
   websocket listeners on two address families. E2E support creates a **fresh
   `initializeTestEnvironment` per seed call** (`seedRecoverySnapshot`, the `externalPlan.ts`
   seeders, `roundTrip.ts`) and a fresh client app per inspection (`initializeApp`/`deleteApp` in
   `athlete.ts`, `roundTrip.ts`); each opens new connections that end in `TIME_WAIT` (Windows holds
   them for minutes). Multiplied by concurrent agents this is the "lots of sockets" symptom. It is
   not yet measured — Phase 0 quantifies it before Phase 4 optimizes it.

What is *not* the problem: intra-`verify` parallelism (already handled by
`run-rules-shard.mjs`), and CI (each job is its own runner).

### Interaction with PR #958 (issue #953, open at time of writing)

[PR #958](https://github.com/Szczepanov/adaptive-training-recommender/pull/958) changes the
harness surface this plan rewrites. Rebase this work on it once it merges; until then treat these
as constraints:

- **Multi-project rules emulator.** `shardEmulatorConfig` gains `emulators.singleProjectMode:
  false`, because `recommendationAuditBudget.emulator.test.ts` now opens environments under
  several project ids on one emulator (`demo-audit-budget`, `demo-audit-budget-padded`, and a
  `demo-probe-<n>` per padding probe). The launcher's generated config must keep that flag for
  rules suites. Unsharded `npm run test:rules` still uses `firebase.json`, which does not set it —
  moving `test:rules` onto the launcher (P2) removes that inconsistency.
- **More per-call clients.** The headroom probe creates and tears down one test environment per
  probe step, and E2E support gains `readPersistedRecommendation`, another
  `initializeApp`/`deleteApp`-per-read inspector. Both add to the churn P4 targets.
- **E2E fixture base changes.** Specs now import `test` from `tests/e2e/support/consoleTrap.ts`
  (an auto fixture over Playwright's base `test`). P4's worker-scoped emulator fixture must extend
  that `test`, not the base one, or specs lose the console trap.
- **Default-port command in the #953 plan.** Its budget-harness instruction runs
  `npm run emulators:exec:rules -- "npx vitest run …"`, which binds the `firebase.json` defaults.
  P8 updates it to the launcher form.

## Design

One small harness layer in `app/scripts/harness/` that every emulator/browser entry point goes
through:

- **Lease, don't hard-code.** A run acquires a *port block* (8 consecutive ports for emulator
  suites, 2 for the visual Vite server) from a machine-wide lease directory,
  `os.tmpdir()/atr-harness/leases/`, by publishing `<blockBase>.json` atomically: the lease is
  written to a private temp file and hard-linked into place, which fails if the block is taken. The
  lease records `{ pid, worktree, suite, ports, startedAt }`. Before use, every port in the block is
  probed by binding on both `127.0.0.1` and `::1` (the hub binds both). Probe failure → release,
  try the next block. A lease whose `pid` is dead is stale. It may be reclaimed only if its ports
  are free; a stale lease whose ports are still held marks an orphan and is left for
  `harness:reap`. Every operation that deletes a lease it did not just create (reclaim, release,
  reap) takes the block's `.reclaim` lock and re-reads the lease first, and release only deletes a
  lease that still records the caller as owner.
- **Range:** 20000–39999, step 10. Below the Windows ephemeral range (49152+), clear of
  docker-compose (8080–8083) and the `firebase.json` defaults. Windows/Hyper-V excluded port
  ranges land inside it (this machine excludes 28385 and 28390), which is why every port is
  probed rather than trusted.
- **Unique project id per run:** `demo-atr-<suite>-<blockBase>`. Keeps hub locators, emulator
  data and Auth users disjoint. Must stay `demo-*` so firebase-tools runs offline.
- **Ports flow by environment, never by file edits.** The launcher injects
  `E2E_AUTH_PORT`, `E2E_FIRESTORE_PORT`, `E2E_APP_PORT`, `E2E_PROJECT_ID` and the matching
  `VITE_FIREBASE_*` variables. Vite gives pre-existing environment variables precedence over
  `.env.*` files, so `.env.e2e` stays as the documented default for manual runs (verified
  empirically in Phase 0 — see Risks).
- **No reuse, strict ports.** Servers start with `--strictPort`; `reuseExistingServer` becomes
  opt-in (`E2E_REUSE_SERVER=1`, `VISUAL_REUSE_SERVER=1` for the visual suite) instead of `!CI`.
- **Kill the tree.** The launcher owns the child tree: on exit/signal it terminates it and
  releases the lease. On Windows that is `taskkill /T /F /PID`. Elsewhere the child runs in its
  own process group, which first gets SIGINT so firebase-tools can stop the emulator JVM it starts
  in a separate session, then SIGKILL after 10 s.
- **`firebase.json` defaults stay** for humans running `firebase emulators:start` by hand. No
  automated path uses them any more.

No ADR is needed: this is test tooling with no product or policy decision. It is recorded in
`docs/standards/agent-tooling.md`.

## Phases

### P0 — Reproduce and measure (no code changes) — Implemented

- Failure modes 1 and 2 reproduced: concurrent default-port runs collide on 9099/8080/4400 and
  share `%TEMP%/hub-demo-adaptive-training-e2e.json`; `reuseExistingServer: !CI` reuses whatever
  already answers on 4173.
- Socket load is sampled with `app/scripts/harness/socket-sample.ps1` (diagnostic only, not in
  CI). Peak `TimeWait` turned out to depend on how fast a run goes, so the sampler also reports
  **distinct connections per harness port** over the whole run, which is the number to compare.
- Vite gives `process.env` precedence over `.env.e2e`: confirmed by the E2E suite passing against
  leased emulator ports while `.env.e2e` still names 9099/8080.
- The baseline is recorded with the P4 outcome below.

### P1 — Port-lease module — Implemented

- `app/scripts/harness/portLease.mjs`: `acquirePortBlock({ suite, size })`,
  `releasePortBlock(lease)`, `listLeases()`, `isStale(lease)`. Pure helpers (range iteration, lease
  serialization, stale detection) separated from the fs/net side effects so they are unit-testable.
- Tests (same runner as `scripts/runRulesShard.test.mjs`): six acquirers in separate processes
  started together never share a block, including when all of them race to reclaim the same
  dead-pid lease; a lease with a dead pid is reclaimed; an unparseable lease is left alone until it
  is older than a grace period; a block with one unbindable port is skipped; release is idempotent.
- A lease is published atomically (written to a private temp file, then hard-linked into place),
  so no reader ever sees an empty or partial lease, and stale-lease reclaim runs under a per-block
  lock with the staleness check repeated inside it. The first implementation did neither and the
  concurrent test showed two processes owning the same block.

### P2 — Emulator launcher; move rules onto it — Implemented

- `app/scripts/harness/runWithEmulators.mjs --suite <name> --only <emulators> -- <command>`:
  acquire lease → write `app/.harness-<blockBase>.firebase.json` (must live in `app/`:
  firebase-tools resolves `firestore.rules` relative to the config and rejects paths outside it —
  the constraint `run-rules-shard.mjs` already documents) → spawn `firebase emulators:exec` with a
  unique `--project` → inject env → tree-kill on signal → delete config and release lease in
  `finally`.
- Rewrite `run-rules-shard.mjs` as a thin wrapper over the launcher: drop `BASE_PORTS` and the
  `MAX_SHARDS = 9` ceiling that existed only because ports were derived from the index. Keep
  `singleProjectMode: false` in generated rules configs (PR #958). Point `test:rules` and
  `emulators:exec:rules` at the launcher too, so unsharded rules no longer uses the defaults.
- Replace the `.rules-shard-*.firebase.json` ignore rule with `app/.harness-*.firebase.json`.
- Update `scripts/runRulesShard.test.mjs` to assert the generated config uses the leased ports.

### P3 — E2E and visual servers on leased ports — Implemented

- `test:e2e` / `test:e2e:mobile` → launcher with `--only auth,firestore` and an extra leased
  `appPort`.
- `playwright.e2e.config.ts`: `baseURL`/`webServer.url` from `E2E_APP_PORT` (default 4173 only for
  manual runs); `webServer.command` built in the config as `vite --mode e2e --host 127.0.0.1
  --port <port> --strictPort` (npm-script `$VAR` interpolation does not work under Windows
  `cmd`); `webServer.env` passes the `VITE_FIREBASE_*` overrides; `reuseExistingServer` only when
  `E2E_REUSE_SERVER=1`.
- `tests/e2e/support/athlete.ts`: `E2E_PROJECT_ID` from env (default unchanged) so support helpers
  and the app agree on the per-run project.
- `playwright.config.ts` (visual): lease a single port for Vite (no emulators), same
  `--strictPort` / opt-in reuse treatment; `visual:refresh` goes through the lease.

### P4 — Reduce socket churn in E2E support — Dropped after measurement

The proposal was to replace per-call `initializeTestEnvironment` and per-read
`initializeApp`/`deleteApp` in E2E support with worker-scoped clients. It was implemented,
measured, and reverted:

- During a run the worker-scoped version held **one** Node connection to Firestore, so it did
  consolidate the helpers, but the suite total did not drop. With `main` (default ports) and this
  branch (leased ports) running the full E2E suite at the same time under one sampler, `main`
  opened 4,059 distinct Firestore connections and the worker-scoped branch 4,708. The bulk
  comes from the browser app's own REST traffic to the emulator, which P4 never touched.
- The acceptance target (≥ 50% fewer) was therefore not reachable from the support helpers. The
  change also relied on `RulesTestEnvironment.createContext`, which is not in the public typings.
- Every `src/emulator/*.emulator.test.ts` already pairs `initializeTestEnvironment` with
  `cleanup()`; nothing to fix there.

If socket load becomes a real constraint, the next lever is the app's Firestore transport in
E2E mode, not the support helpers; that would need its own plan.

### P5 — Orphan visibility and reaping — Implemented

- `npm run harness:status`: list leases with worktree, suite, ports, owner pid, alive/stale, and
  stale `hub-demo-*.json` locators in `os.tmpdir()`.
- `npm run harness:reap`: for **stale leases only** (owner pid dead), kill processes still
  listening on that lease's ports and remove the lease, its generated
  `app/.harness-<blockBase>.firebase.json` and its locator. Never touches a lease whose owner is
  alive. Dry-run by default; `--yes` to act.
- Agent rule in `AGENTS.md` and `docs/standards/agent-tooling.md`: never kill a process by port
  number; use `harness:status` / `harness:reap`.

### P6 — Local preview skill on the harness — Implemented

- `npm run preview:start` (detached launcher run: lease, `emulators:start`, Vite) writes
  `app/.preview.json` with the URLs, ports and project id; `npm run preview:stop` tears down the
  tree and releases the lease. Preview leases are long-lived but still owner-pid tracked, so a
  crashed preview becomes reapable.
- Rewrite `.claude/skills/local-app-preview/SKILL.md` to read ports from `app/.preview.json`
  instead of the hard-coded 9099/8080/4173 table and curl examples.

### P7 — Optional machine-wide emulator cap — Skipped (revisit)

Skipped because concurrent E2E pairs from separate worktrees passed without it, but two
concurrent full `make verify` runs hit load timeouts (see the delivery record), so this is the
first candidate if that needs fixing.

- A counting semaphore in the same lease directory limits concurrent emulator JVM runs
  (`ATR_MAX_EMULATOR_RUNS`, default derived from core count). Waiters log who holds the slots
  (worktree, suite) and time out with a clear message instead of failing on a port.
- Skip this phase if isolation alone makes concurrent verifies reliable; it trades failures for
  waiting, which is only worth it when the machine is genuinely saturated.

### P8 — Documentation — Implemented

- `AGENTS.md` command reference (`test:e2e`, `test:rules`, `harness:*`, `preview:*`),
  `docs/standards/agent-tooling.md` (verification contract paragraph that currently says E2E keeps
  `firebase.json`'s defaults), the `scripts/verify_repo.py` `build_plan` docstring (same claim),
  `app/README.md` E2E section, the `local-app-preview` skill, and the budget-harness command in
  `docs/plans/2026-10-01-issue-953-recommendation-write-rejections.md` (PR #958).

## Acceptance criteria

- Two worktrees running `make verify` concurrently both pass; each run's log shows distinct
  leased ports.
- Two `npm run test:e2e` runs in the **same** worktree concurrently both pass.
- With a Vite server already listening on 4173, `test:e2e` starts its own server on its leased
  port and never reuses the foreign one.
- No automated suite binds any `firebase.json` default port.
- After `taskkill /F` of a running `test:e2e` parent, `harness:status` reports the stale lease and
  `harness:reap --yes` leaves no listener on its ports and no stale hub locator.
- P4's socket target is met against the P0 baseline.
- `make verify` passes; `cd app && npm run test:rules` and `npm run test:e2e` pass in CI.

## Risks

| Risk | Mitigation |
|---|---|
| Vite env precedence differs from the assumption in Vite 8.3 | P0 verifies it; fallback is a generated `--mode` env file per lease, cleaned up with the config |
| Probe-then-bind race with a non-harness process | Exclusive leases remove races between harness runs; a non-harness process binding a leased port between probe and emulator start still fails that run with `port taken` (no automatic retry) |
| Excluded/reserved port ranges change after boot (Hyper-V, WSL, Docker) | Every port is probed at lease time; ranges are never cached |
| Reaper kills a legitimate process | Reap acts only on leases whose recorded owner pid is dead, re-checked under the block lock immediately before acting, only on that lease's ports, and is dry-run by default. `preview:stop` kills only when the lease still names its live supervisor |
| Per-run project ids leave Auth/Firestore state behind | Emulators are in-memory with `emulators:exec`; nothing persists past the run |
| CI regressions from dynamic ports | CI runs the same launcher; dynamic ports on a fresh runner are always free. `test:rules` and E2E CI jobs gate the change |

## Sequencing

P0 → P1 → P2 → P3 is the critical path that fixes failure modes 1–3 and should land as one PR
(P1–P3) after P0's numbers are recorded. P4 and P5 are independent follow-ups and can land in
parallel. P6 depends on P1. P7 is conditional. P8 lands with whichever PR changes the documented
behavior.

## Delivery record

Measured on the Windows development machine on 2026-10-01 (20 logical CPUs, other agent worktrees
active). Leased blocks started at 20000.

| Acceptance criterion | Result |
|---|---|
| Two worktrees running `make verify` concurrently both pass, on distinct leased ports | **Not met on this machine.** Ports stayed disjoint (no `port taken`), but each run failed one load timeout: rules shard 1/2 in one worktree (`recommendationAuditBudget` `beforeAll` > 30 s hook timeout; the same shard passed in the other), one E2E visibility timeout (`testing-physical-capital`) in the other. Two full verifies run 6 emulator JVMs and 2 browsers at once. |
| Two concurrent `test:e2e` runs in the **same** worktree both pass | **Not met.** Each run leases its own block and project and cleans up, but 4 of 4 runs had 1–4 failures, all 5 s UI/persistence timeouts in different tests (pages still `Loading…`). The same pair from two worktrees passed 41/41 on both sides, so the cause is something shared within one worktree and is not yet identified. Agents use separate worktrees, which is the supported case. |
| A foreign server on 4173 is never reused | Met: branch E2E passed on its leased app port while `main`'s E2E served 4173 (and 8080/9099) at the same time |
| No automated suite binds a `firebase.json` default port | Met: rules, E2E, shards, visual and preview all go through the launcher; `runRulesShard.test.mjs` asserts the lease range excludes every default |
| After `taskkill /F` of the launcher, `harness:status` shows the stale lease and `harness:reap --yes` leaves no listener and no stale locator | Met: 3 orphan listeners, the lease and the locator were removed; the orphan generated config is now removed too |
| P4 socket target | Dropped with P4 (above) |
| `test:rules` and `test:e2e` pass | Met locally: rules suite exit 0; E2E 41 passed, 3 skipped (CI pending on the PR) |

Cross-worktree concurrency: two concurrent full-E2E pairs passed 41/41 on both sides (`main` +
branch, branch + branch). Two concurrent full `make verify` runs did not (load timeouts, above).

Known follow-ups, not blocking:

- Same-worktree concurrent E2E flakes, and load timeouts with two concurrent `make verify` runs
  (above). P7's emulator cap, or longer timeouts on the budget-probe hook, are the candidate
  remedies; P7 was skipped on the earlier, narrower evidence.
- E2E through the launcher ran 10–15% slower than `main` on the same specs (two-spec sample:
  ~1.0–1.1 min vs 56–57 s). Not from P4 (the gap persisted with P4 reverted) and not from
  `singleProjectMode`; cause not investigated.
