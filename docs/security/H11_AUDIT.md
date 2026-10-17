# H-11 historical secret-scan review

Gitleaks v8.24.0 (pinned official Linux release) scans the checked-out
repository's entire Git history in the `integration-release-gate / security`
CI job. Its release asset is installed directly on the hosted runner, avoiding
the separate GHCR Docker-image dependency. A failed installation or scan
must fail the job (never fall back to skipping the scan). On failure, CI
prints only the finding count, rule IDs and exact historical fingerprints
from Gitleaks' redacted JSON report; raw matches, secret values and file
contents remain private. The four exact fingerprints in
`.gitleaksignore` were reviewed on this branch. CI's `fetch-depth: 0` exposed
an additional earlier commit of the same synthetic smoke-test password that
the initial shallow local clone omitted; the clone was unshallowed and the
second exact fingerprint was inspected before adding it:

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
## S0 evaluation report review (2026-10-17, PR #31)

Gitleaks v8.24.0 flags `docs/knowledge-s0-results/baseline.json:36`
(`productionHashes.mail-access.ts`) as `generic-api-key`. The value is the
SHA-256 digest of the tracked `server/src/services/agent/mail-access.ts`,
recomputed locally and compared with the report. It is reproducibility
metadata, not an API key or an authentication credential.

Only the immutable finding fingerprint for commit
`73e8289cc32693454df9820652e5a598f90b1d30` is added to `.gitleaksignore`.
The evaluation report remains unchanged. No path, rule, or digest-pattern
exemption is introduced. Future findings still require individual review.

Validation: the pinned scanner passed a full `--all` Git-history scan after
this exact exception; both production dependency audit gates also passed.

## S2 public model digest review (2026-10-17, PR #33)

The failed security job in run 39031885606 reports two `generic-api-key`
findings at `server/semantic/model.json:13` and `:14` in commit
`8ff0e335cf25bbfce7f46b586de2bb161de1f79d`. These are SHA-256 file checksums
for `tokenizer.json` and `tokenizer_config.json`, not API credentials.
Both hashes were recomputed from the installed public model bytes and matched
both the frozen S0 model lock and the S2 model lock at revision
`e8f8c211226b894fcb81acc59f3b34ba3efd5f42` of the selected multilingual model.
The pinned Windows scanner also reproduces exactly the same two findings
when explicitly scanning the feature commit.

Only these two immutable commit/file/rule/line fingerprints are added to
`.gitleaksignore`. No path, rule, model-file, or hash-pattern allowlist is
added. The model lock, model identity and runtime are unchanged, so this
review does not trigger reindexing or change retrieval behavior.

Correction to the initial S2 local acceptance record: a full-history command
used `--log-level error` and was followed by successful Git inspection commands,
which masked its nonzero exit status. It must not be treated as a passed
secret scan. The PR failure exposed this reporting error. The repaired local
verification captures the scanner exit code immediately and fails explicitly;
full-history verification is rerun after the exact findings are reviewed.
The production dependency audits and guarded-braces regression pass separately.

Reverification: pinned v8.24.0 scanned all 77 available commits (~4 MB),
reported no findings, and exited 0 with the status captured immediately.
No functional code, model lock or frozen evaluation data changed.
