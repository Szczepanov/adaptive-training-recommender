# Visual review workflow

The visual-review harness captures the real React page components with deterministic,
synthetic athlete data. It does not authenticate, read Firestore, or use Garmin data.

## Refresh screenshots

```powershell
cd app
npm ci
npm run visual:install
npm run visual:refresh
```

The browser installation is only needed once per machine or when Playwright changes.
The refresh command starts a visual-only Vite entry point, captures desktop and mobile
screenshots, then writes the review bundle to `app/artifacts/visual-review/latest/`.

## Review bundle

| File | Purpose |
| --- | --- |
| `contact-sheet.html` | Quick human overview of all captures. |
| `manifest.json` | Image paths, scenario identifiers, viewports, and expected focus. |
| `review-context.md` | Commit, synthetic-data note, review rubric, and scenario intent. |
| `desktop/` and `mobile/` | Full-page PNG screenshots. |

The bundle is intentionally ignored by Git. It is regenerated on every refresh.

## Supplying the bundle to a reviewing agent

Provide the agent the absolute bundle path and this instruction:

> Review the screenshots using `review-context.md` and `manifest.json`. Separate
> observations from recommendations. Prioritize hierarchy, scanability, spacing,
> action clarity, responsive behavior, and accessibility cues. Do not critique the
> synthetic athlete copy or infer implementation defects from placeholder data.

## Scenario coverage

The catalog lives in `app/src/visual/fixtures.ts`. It includes normal, reduced, and
recovery-day recommendations; missing data; all major application pages; expanded
workout detail; the desktop Settings menu; and the mobile More drawer.

Add a scenario whenever a new state changes a visible decision, safety constraint,
or interaction surface. Fixtures must remain synthetic and use Europe/Warsaw calendar
dates.

## Future extensions

- Add Axe accessibility results to the review bundle.
- Add browser-console diagnostics to the manifest.
- Keep approved Playwright snapshot baselines separately for CI regression checks.
