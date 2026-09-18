# Firestore evidence reconnaissance — 2026-09-17

This is an aggregate, privacy-preserving status check against the production Firestore
project `adaptive-training-recommender`. The query read document metadata and bounded field
presence only; it did not print document IDs, user IDs, health values, free text, or raw
payloads.

## Aggregate inventory

| Collection group | Documents | Interpretation |
|---|---:|---|
| `health_observation_days` | 552 | Real health-observation history exists, but volume alone does not activate multisource, anomaly, or identity policy. |
| `activities` | 2,215 | Real activity history exists for replay/shadow work. |
| `daily_recommendations` | 50 | Persisted recommendation history exists for comparison/report inputs. |
| `decision_journal` | 23 | All 23 records were structurally complete; 22 distinct local dates across 2 users. |
| `session_executions` | 14 | Real structured-session execution evidence exists. |
| `session_definitions` | 3 | Authored session definitions exist. |
| `anthropometry_entries` | 3 | Anthropometry entries exist in production; server-authority is established separately by the deployment/rewrite verification. |
| `external_plans` | 3 | External-plan usage exists, but this does not by itself satisfy later usage-triggered gates. |
| `intent_blocks` | 1 | Block-intent persistence is in use; progression evidence still requires review/confirmation gates. |
| `health_anomaly_outcomes` | 2 | Outcome-label records exist, but no persisted assessment documents were found in the queried group. |
| `competition_outcomes` | 0 | No real event outcome is available for OV7.1 closure. |
| `outcome_evaluations` | 0 | No persisted outcome evaluation is available for a real-event block report. |
| identity passport/assessment/review groups | 0 | No Firestore prospective identity-label evidence is available for PI activation. |
| intraday/schedule-window groups | 0 | No production intraday evidence was found in these groups. |

## Decision-journal gate

Of the 23 journal records, 16 were recorded before the engine verdict, 7 after the engine
verdict, and only 2 contain an `actualVerdict`. The maximum per-user consecutive run is 16
local dates; the largest calendar span is 31 days with 22 distinct recorded dates. This is
useful shadow evidence, but it is not a completed 4–6 week Phase 9.0 block with the required
evening outcomes. Phase 9.0.7 therefore remains open, and Phase 9.8 remains blocked on that
prospective evidence.

## Status decisions

- WU and SAW remain correctly closed as `Implemented` after the visual/deployment checks
  recorded in the plan reconciliation.
- BC0's stale “Blocked by ADR-0039 acceptance” wording was corrected; the ADR is accepted
  and BC0–BC4 are implemented.
- No evidence-only collection count was treated as permission to activate recommendation
  authority. OV7.1+, HA7+, HRF8+, PI9+, MS17, ES10, TO4/TO5, and the remaining Phase 9,
  subjective-baseline, and usage-triggered gates remain open where their plans require
  prospective labels, independent references, compliance/consent, or an explicit activation
  review.
