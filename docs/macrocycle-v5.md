# Sustained Multidirectional Field Macrocycle — v5.0 contract

**Source version:** 5.0  
**Source updated:** 3 August 2026  
**Status:** in-repository behavioral authority for the recommendation-policy alignment work in PR #17.  
**Scope:** this file records the macrocycle rules that are decision-bearing in the engine. It is intentionally narrower than the full athlete-context document.

The external v5.0 context supersedes v4.0 and the July football-return bridge. Its current phase is a cycling-priority race build with football and running maintenance. The primary cycling event is an approximately 50-minute road race, most likely **5–6 September 2026** or **12–13 September 2026**.

## Planning rule

Prepare for the earlier race date. If the later date is confirmed, use the extra calendar week as **one additional specific week**, then taper in race week.

This is a week-aligned contract, not a fixed `N days before race` rule.

For the 2026 event branches:

| Branch | Specific week immediately before taper | Taper starts | Race window |
|---|---|---|---|
| Earlier / planning-date branch | Mon 24 Aug – Sun 30 Aug | **Mon 31 Aug 2026** | Sat 5 – Sun 6 Sep |
| Later confirmed branch | Mon 31 Aug – Sun 6 Sep | **Mon 7 Sep 2026** | Sat 12 – Sun 13 Sep |

For an unconfirmed date range, `planningDate = earliestDate` remains the conservative planning anchor, but it must not erase the decisive 24–30 August peak-specific week.

## Weekly architecture until race

Preferred normal build week:

- sustained cycling quality: **1× weekly**;
- event-specific outdoor ride: **1× weekly**;
- Easy Zone 2 cycling: **1–2× weekly**;
- primary full-body strength: **1× weekly**;
- compact power/strength maintenance: **1× weekly initially**;
- football/field maintenance: approximately once every 7–10 days;
- walk–run: optional once every 7–10 days.

Minimum effective week:

- three cycling sessions;
- one full-body strength session;
- one brief upper-body/trunk or power-maintenance exposure;
- optional football or run–walk, but not both if lower tissues are loaded.

The two cycling quality sessions should normally be separated by at least 48 hours. Strength supports cycling quality rather than reducing it.

## Easy Zone 2 is a distinct programming role

A true Easy Zone 2 exposure is:

- **30–90 minutes** depending on phase;
- RPE **2–3**;
- conversational breathing;
- smooth cadence, usually 85–95 rpm;
- no low-cadence grinding;
- stable power and HR;
- finish unchanged or fresher.

The weekly floor is **1–2 actual Zone 2 exposures**. A short recovery spin is useful recovery work but does not replace that aerobic-volume floor.

## 17–23 August travel week

Travel is **19 August afternoon through 22 August 2026**.

Before travel:

- Mon 17 Aug: main cycling quality;
- Tue 18 Aug: compact strength plus optional easy spin;
- Wed 19 Aug: easy movement or rest before departure.

During travel:

- **one 30–45-minute aerobic session** using hotel bike, elliptical, rower, SkiErg or similar;
- **one 25–40-minute hotel-gym maintenance session**;
- walking and trip activity count as load;
- **no maximal intervals**;
- do not compare hotel-machine watts with Assioma or home indoor-bike watts;
- optional easy walk–run only if calves/Achilles and knee remain completely normal.

After return:

- Sun 23 Aug: easy outdoor Zone 2 or recovery depending on travel and walking load.

The engine does not yet model walking/sightseeing as load; this remains explicitly out of scope for the PR #17 macrocycle-alignment increment.

## 24–30 August — decisive peak race-specific week

This week must remain **peak/specific** for the earlier 5–6 September branch.

Required shape:

1. one race-specific over-under/repeated-surge session;
2. one 50–60-minute outdoor simulation, preferably with other riders;
3. one true Easy Zone 2 ride;
4. optional short recovery ride;
5. one reduced-volume strength session;
6. no hard running;
7. football only if extremely light and early in the week.

The outdoor simulation includes repeated 10–30-second accelerations, at least one harder 1–3-minute section, recovery at meaningful pedalling power, a late positioning surge, and a final approximately 1 km hard.

## Branch A — race 5–6 September

From **31 August to race**:

- reduce volume approximately 35–50%;
- retain brief intensity;
- one final short strength-maintenance exposure early in the week;
- one short race-specific sharpening ride;
- one or two easy rides;
- short openers or rest before race;
- no football, hard running, heavy eccentrics or maximal gym work.

## Branch B — race 12–13 September

### 31 August–6 September — one additional specific week

- one controlled threshold/over-under session;
- one final group or race-simulation ride;
- one true Easy Zone 2 ride;
- one compact strength-maintenance session;
- do not add excessive volume just because another week is available.

### 7 September to race — taper

- recovery Monday;
- last meaningful but short cycling stimulus Tuesday;
- easy Zone 2 Wednesday;
- short openers or rest Thursday;
- rest Friday;
- race weekend.

## Strength during cycling build

Primary strength remains **1× weekly**, usually 45–70 minutes, mostly RPE 5–7 with no grinding and low enough volume to preserve cycling quality. The compact second session is optional and should reduce or disappear during peak/taper. Strength volume is reduced approximately 30–50% in race week.

The recommendation engine therefore needs at least one strength-maintenance prescription that remains admissible in a moderate/modify state; otherwise the authored weekly role can become structurally unfillable even though the macrocycle still requires maintenance.

## Recovery authority

Recovery tools are subordinate to actual recovery. The source prioritizes sleep, adequate calories/carbohydrate/protein, hydration/sodium, then easy movement. Active recovery is optional; complete rest remains a legitimate choice when accumulated fatigue is high.

A recommendation policy must not trap itself above a recovery threshold by repeatedly selecting a non-zero-cost recovery session when rest is available and preferred.

## Acceptance contracts derived from v5.0

PR #17 may bless a new semantic baseline only when deterministic tests demonstrate all of the following:

1. earlier branch: 24–30 Aug remains peak-specific and taper begins 31 Aug;
2. later confirmed branch: 31 Aug–6 Sep remains one additional specific week and taper begins 7 Sep;
3. recovery spins alone cannot satisfy the Easy Zone 2 / aerobic-volume floor;
4. high-fatigue trajectories can clear the recover and modify thresholds instead of being held above them by recovery-session cost;
5. primary strength remains reachable when the athlete is in the modify band but is not admitted through the recover gate;
6. the 19–22 Aug authored travel block yields one aerobic and one maintenance-strength opportunity and no maximal-intensity work;
7. the semantic diff exposes both programming-role coverage and fatigue-clearing behavior before the baseline is updated.
