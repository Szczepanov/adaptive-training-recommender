# Triathlon scenario and persona corpus (2026-08-30)

## Purpose

This synthetic corpus verifies the native three-discipline foundation delivered by the
running-and-triathlon support work. It is not evidence that the application is a complete
specialist triathlon coach. Every case is anonymized and uses only synthetic recovery,
availability, event, and completed-training data.

## Corpus design

The deterministic scenario registry and the blinded persona-plan-judge corpus share the
same athlete ladder:

| Level | Event | Current evidence | Perturbations |
| --- | --- | --- | --- |
| Novice | 1/8 distance | No invented current base | Normal recovery, adverse recovery, pool access unavailable |
| Intermediate | Olympic | 12 recent mixed-discipline exposures over 28 days | Normal recovery, adverse recovery, 45-minute weekday cap |
| Advanced | 70.3 | 18 recent mixed-discipline exposures over 28 days | Normal recovery, adverse recovery, final 14-day taper |

All normal-access cases declare both `outdoor_bike` and `swim_access`. This is important:
the triathlon planner may require a discipline, but feasibility still wins. The no-pool
case therefore proves that the system must leave swimming unprescribed rather than invent
an accessible substitute or silently count another discipline as swim training.

## Acceptance contract

- Event-directed persona cases carry one A-priority `triathlon` event and no evergreen
  training-intent profile, so the event path is exercised for real.
- Normal-access cases must select Swimming, Cycling, and Running over the two-week
  persona horizon; every case must have zero hard feasibility or injury violations.
- The advanced taper horizon ends before race day. It evaluates taper restraint without
  fabricating post-event training.
- The judge packet exposes only the athlete-facing event summary (title, date, priority,
  category), not planner diagnostics or raw demand scoring. Its triathlon guidance rejects
  a silent single-discipline substitution and invented brick, swim-pace, or open-water
  capability claims.

## Boundary retained

The corpus deliberately does not assert brick programming, open-water handling,
critical-swim-speed targets, race-distance-specific volume progression, or optimized
swim/bike/run load allocation. Those features remain outside the current model. A reviewed
persona baseline may be refreshed only after reviewing a stability run with the expanded
10-family, 30-case corpus.
