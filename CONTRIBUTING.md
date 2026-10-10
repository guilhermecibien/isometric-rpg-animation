# Contributing

1. `npm install && python3 -m pip install -r requirements.txt`
2. `npm run assets:demo` (regenerates `assets/examples/hero`; commit the result if the generator changed)
3. Before a PR: `npm run typecheck && npm test && npm run test:py && npm run validate:skill`; for demo/adapter changes also `npx playwright install chromium && npm run test:e2e`.

Rules
- Core code in `src/core` must not import Phaser. Phaser APIs are used only in `src/phaser`, through the `scene` you are given.
- TS: strict, no `any`. Python: type hints, `IsoAnimError` for user errors, documented exit codes.
- Keep TS and Python manifest validation identical; change both plus both test suites.
- A validation check must say whether it is `objective` or `heuristic`. Never add a check or message implying that motion "is natural".
- No fake implementations: if something needs an external tool, build the interface, document it, and say in the docs what was not run.
- Only add assets/code whose license permits MIT redistribution; list them in `THIRD_PARTY.md`.
- Add a test for every bug fix (a failing test first).
