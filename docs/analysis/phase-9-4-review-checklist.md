# Phase 9.4 review checklist

- [x] decision date excluded at query boundary (`date < D`)
- [x] bounded one-range read uses the 28-day reference window
- [x] persisted rows pass the canonical check-in parser
- [x] ownership/date mismatches never enter baseline calculation
- [x] malformed rows remain visible as data-quality issues
- [x] sparse/missing/unavailable history produces `subjectiveBaseline: null`
- [x] raw historical rows do not enter recommendation persistence
- [x] current-date `DailyReadiness` receives the derived baseline
- [x] production selector remains `off`
- [x] forecast does not reuse a baseline with the wrong exclusive boundary
