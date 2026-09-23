# UI/UX foundation and documentation review — 2026-09-23

## Question

Do the repository's foundational documents give contributors a durable, industry-aligned UI/UX
quality standard, or is the guidance currently scattered across implementation plans, dated
audits, component CSS, and flow-specific architecture documents?

## Scope reviewed

Repository sources:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/architecture/user-flows.md`
- `docs/architecture/morning-decision-ux.md`
- `docs/plans/mobile_ux_implementation_plan.md`
- `docs/analysis/2026-09-16-ux-heuristics-review.md`
- `docs/analysis/2026-09-17-ux-heuristics-review-followup.md`
- current frontend design tokens, responsive styles, visual Playwright matrix, and browser
  E2E configuration

External references checked for the baseline:

- W3C WCAG 2.2 and WAI mobile accessibility guidance
- WCAG 2.2 Target Size (Minimum), Focus Not Obscured, Redundant Entry, and Accessible
  Authentication guidance
- Nielsen Norman Group's ten usability heuristics
- Apple Human Interface Guidelines for mobile hit targets and touch-control spacing

This is a dated analysis. The new `docs/standards/ui-ux.md` is the living standard produced
from it.

## Executive finding

**The repository already contains good UI/UX thinking, but it does not yet have a
foundational UI/UX source of truth.**

Coverage is fragmented:

- the mobile implementation plan contains strong product principles, a 44 px touch-target
  requirement, mobile widths, accessibility notes, and a definition of done, but it is
  explicitly marked `Implemented` and historical;
- the September UX reviews use Nielsen's heuristics well, but they are dated evidence and
  intentionally must not be treated as current standards;
- `morning-decision-ux.md` gives strong progressive-disclosure and trust contracts, but
  only for one surface;
- `user-flows.md` accurately describes navigation and current behavior, but is descriptive,
  not a quality bar;
- `app/src/index.css` defines useful mobile tokens, including
  `--touch-target-min: 44px`, but a CSS token is not a product/UX policy and some components
  still bypass it;
- the visual harness has a good 360/390/412 px matrix and horizontal-overflow assertion, but
  the E2E suite is desktop-only and screenshots cannot prove mobile interaction quality.

The result is a discoverability problem: a contributor can change UI behavior without being
forced through a single document that explains accessibility, mobile ergonomics, navigation,
error prevention, content clarity, testing, and exception handling together.

## What is already strong

### Mobile-first product hierarchy

The implemented mobile plan established the right core model:

- daily decision first;
- mobile is not compressed desktop;
- one dominant action per state;
- progressive disclosure;
- preserve safety visibility.

Those principles remain valid and should be elevated from historical plan rationale into the
living standard.

### Trust and decision transparency

`morning-decision-ux.md` correctly treats the UI as an explanation/execution layer over the
engine rather than an independent authority. It preserves uncertainty, rationale, safety
boundaries, and alternatives without inventing stronger semantics.

This is unusually important for this product and belongs in the cross-cutting standard.

### Usability review discipline

The September review explicitly used Nielsen's ten heuristics and distinguished findings that
were real from findings that did not survive source tracing. That is a good review method and
should remain the default heuristic-evaluation framework.

### Responsive visual coverage

The visual Playwright config already tests 360, 390 and 412 px mobile widths plus desktop,
and `capture.pw.ts` asserts against body-level horizontal overflow. This is a good foundation
to preserve.

## Gaps against industry practice

### 1. No explicit accessibility conformance baseline

No foundational document says that the app targets WCAG 2.2 Level AA.

Individual accessibility requirements exist, but without a named baseline contributors must
infer what "accessible enough" means.

**Resolution:** make WCAG 2.2 AA the baseline and state clearly that automated tests alone do
not establish conformance.

### 2. The 44 px target exists technically but not normatively

WCAG 2.2 SC 2.5.8 sets a 24 x 24 CSS-pixel minimum or spacing alternative. Apple recommends
44 x 44 points for mobile controls. The app already has a 44 px CSS token, so the product can
reasonably adopt 44 x 44 CSS px as its stronger internal default.

**Resolution:** document 44 x 44 as the project standard, while accurately distinguishing it
from the WCAG AA minimum.

### 3. Mobile viewport behavior is under-specified

The historical plan covers safe areas and mobile widths, but the foundation does not address
dynamic viewport height, browser chrome, software keyboard reduction, or focused controls
being obscured by sticky/fixed content.

WCAG 2.2 SC 2.4.11 specifically addresses focus being obscured by author-created content.

**Resolution:** make dynamic viewport, safe-area, keyboard visibility, and fixed/sticky
behavior part of the living standard.

### 4. User control and platform Back behavior are not a foundation rule

`user-flows.md` accurately records that there is currently no URL router and
`handleNavigate` is state-only. The UX standard did not say what platform Back/Forward
should do.

**Resolution:** define browser/platform navigation cooperation as the desired interaction
contract without pretending the current implementation already satisfies it.

### 5. Error prevention and reversibility are scattered

The product already makes several good decisions — unanswered check-in inputs do not silently
default, safety gates are explicit, and some flows have confirmation — but there is no
cross-cutting rule requiring undo/edit/confirmation based on the cost of an error.

**Resolution:** codify user control, undo/edit where practical, and deliberate confirmation
for irreversible/high-cost actions.

### 6. Content and uncertainty rules are flow-specific

The UX reviews found engine jargon leaking into athlete-facing copy and fixed it. The morning
decision architecture protects uncertainty well, but other screens do not have a shared
language rule.

**Resolution:** define plain athlete-facing language, honest uncertainty, actionable error
copy, and no hidden second decision authority as global requirements.

### 7. Testing responsibilities are fragmented

Visual tests prove layout; unit tests prove local state; E2E proves workflow semantics. The
repository uses all three, but no foundational UI doc says which class of problem belongs in
which layer.

**Resolution:** define a layered UI verification strategy and a UI-specific definition of
done.

## Documentation decision

Create `docs/standards/ui-ux.md` as a **normative, living standard**.

A new ADR was deliberately not used:

- the standard must evolve when WCAG/platform guidance evolves;
- ADRs are immutable decision records in this repository;
- duplicating the same rules into an ADR and a living implementation standard would create a
  new drift surface.

Update the documentation router so contributors know:

- standards answer "what quality bar must changes meet?";
- architecture answers "how does it work today?";
- analyses are dated evidence;
- implemented plans are history, not present-tense requirements.

## External baseline summary

### WCAG 2.2

WCAG 2.2 is a W3C Recommendation and the appropriate current web accessibility baseline.
Relevant additions for this app include Focus Not Obscured, Target Size (Minimum), Redundant
Entry, and Accessible Authentication.

### WAI mobile guidance

W3C does not define a separate mobile accessibility standard; WCAG applies to mobile web
content and applications. Mobile-specific implementation review still matters because small
screens, touch input, browser chrome, and device context create additional usability risk.

### Nielsen heuristics

The heuristics are not a conformance standard. They are a practical evaluation framework for
system status, real-world language, user control, consistency, error prevention, recognition,
efficiency, minimalism, error recovery, and help.

### Apple mobile ergonomics

Apple's 44 x 44 point hit-target guidance is useful as an ergonomic reference. The project
uses 44 x 44 **CSS px** as its own web-app standard; the units and authority should not be
conflated.

## Resulting documentation changes

1. Add `docs/standards/ui-ux.md`.
2. Add `docs/standards/` to the documentation routing model.
3. Add a UI/UX task-oriented entry point in `docs/README.md`.
4. Update `AGENTS.md` and `CLAUDE.md` so UI changes read the standard before historical
   plans/audits.
5. Point the implemented mobile plan at the living standard.
6. Point the current user-flow architecture at the standard without changing its descriptive
   role.

## Follow-up boundary

This documentation change does not claim that current code fully conforms to the new standard.

Known implementation gaps should remain tracked as GitHub issues and fixed independently. A
standard is useful only if it remains stable enough to judge new work and explicit enough to
make deviations visible.
