# Repository work

Fast decision is a small explicit-only skill and dependency-free Node CLI. Read `SKILL.md` for consuming-agent behavior and `docs/contract.md` before changing request, response, or exit semantics.

- Keep Gateway `/v1/evaluate` types distinct from TypeSafe's direct API. Verify changes against primary provider docs; do not guess wire shapes.
- Preserve explicit delegation, bounded I/O, credential precedence, fixed endpoint, and fail-closed validation. The host owns actions and authorization. No silent retries, secret logging, or default acceptance thresholds.
- Runtime code belongs under `scripts/`, including local imports, so copied skill installations work without npm installation. Do not add a framework or dependency without a concrete need.
- Add offline regression tests for behavior changes. Use synthetic data and injected transports, never recorded private payloads or real credentials. Do not make paid/live calls without explicit authorization.
- Run `npm run check`, `npm test`, and `npm run test:coverage`. Shipped JSON examples are validated by the test suite. Report actual verification and distinguish mocked contracts from live compatibility.
- Keep `README.md`, `SKILL.md`, and the contract consistent. Do not claim benchmark results, provider privacy guarantees, or review approval that was not obtained.
- Use a pull request and preserve repository protection/review requirements. Do not modify CODEOWNERS, branch rules, or CI permissions to get a change merged.
