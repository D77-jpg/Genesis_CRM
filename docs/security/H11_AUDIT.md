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


## S3 报告摘要字段复核

最终交付前的 staged scan 命中9份评测报告中 `productionHashes.mail-access.ts` 的源码SHA-256（generic-api-key）。已逐条与当前 `server/src/services/agent/mail-access.ts` 字节重算一致；未发现凭证。报告改为明确的 `{path, sha256}` 记录数组，摘要值与原始报告rawReportSha256保留，不把含access的文件名作为可能被误解为凭据的JSON键。此调整仅涉及报告DTO，不修改扫描器、规则或ignore；没有新增豁免。提交前和提交后再次扫描，退出码即时检查。


## S7 报告摘要字段逐条复核（2026-10-19）

最终全历史扫描在b214b775e91a68c31a83ef49951dc055e360d28a提交的4份冻结回归报告第52行命中generic-api-key。均为productionHashes.mail-access.ts的代码字节SHA-256。逐份解析报告定位字段，并重算当前已跟踪server/src/services/agent/mail-access.ts字节，全部一致；这些不是API密钥，也无鉴权用途。

因该提交已经进入本地Git历史，按既有S0/S2约定仅增加四个精确的commit/file/rule/line指纹，不增加路径、规则或摘要模式豁免，不修改模型、权限或质量门槛。当前报告把该元数据改为productionSourceHashes的path/sha256RawBytes记录数组，并保存archivedRawReportSha256；题目、标签、观察值、初始失败和最终分数均原样保留。扫描器版本仍为8.24.0。

初次最终扫描退出1已明确记录，不能说全历史扫描已经通过。精确核验和修改后重新运行全历史扫描，并立即保存退出码；最终结果由S7 verification.json记录。生产依赖门禁另行通过，xlsx豁免仍按原到期日2026-10-26，没有增加依赖漏洞豁免。

## S8 报告摘要字段复核（2026-10-19）
提交前目录扫描退出1，在两份检索回归报告的productionHashes.mail-access.ts字段命中generic-api-key。逐份与已跟踪server/src/services/agent/mail-access.ts原始字节SHA-256重算一致，不是凭证。沿用S3/S7报告DTO约定，改为productionSourceHashes数组，保留原始报告archivedRawReportSha256及全部题目/标签/观察值/分数/dirtyTree。没有增加路径、规则或模式豁免，没有修改模型或业务权限。最终全历史扫描必须单独检查即时退出码，不能把此次首次失败写成通过。

