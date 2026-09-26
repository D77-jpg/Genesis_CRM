# H-11 historical secret-scan review

Gitleaks v8.24.0 scans the checked-out repository's Git history in the
`integration-release-gate / security` CI job. The three exact fingerprints in
`.gitleaksignore` were reviewed on this branch:

| Historical file | Reason for exact-fingerprint exception |
| --- | --- |
| `server/tests/template-feedback.test.ts` | Synthetic `requestKey` for a template-feedback unit test. Not an authentication credential. |
| `.github/workflows/integration-release-gate.yml` | Explicit `ci-fixture-jwt-secret-0123456789abcdef` used only by the test runner; not a deployed JWT key. |
| `scripts/smoke-test.ps1` | Synthetic `NewTempPass456` password for a disposable smoke-test user, not an operator credential. |

The list is not a file-, rule-, or directory-wide bypass. Every future
finding, including one on these same files or rules, must fail until separately
reviewed. Do not include actual key values in reports or CI output. Configure
production secrets privately; the CI test fixture must never be reused in
production.
