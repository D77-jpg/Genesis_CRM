# S8 local acceptance operator guide

This file accompanies `knowledge-agent-roadmap.md`, `knowledge-evaluation.md` and the S0-S7 reports. It does not authorize production deployment or real email delivery. PR39 is merged as main `f3240d2`. Post-merge replay found a cumulative-time accounting defect; fix `8da9f6f` is on `codex/s8-main-verification`, awaiting human PR/merge and a targeted clean-main recheck. See the current [post-merge report](knowledge-s8-results/post-merge/README.md).

## Reproducible isolated UI host

Run `server/tests/knowledge-acceptance-ui-fixture.ts` with the existing Node/tsx test runtime and locked local model environment documented in S7. It creates a new memory MongoDB, temporary uploads/index, two explicitly fictional projects, fictional customers and private-mail sentinels. It never imports the application bootstrap or connects to the configured real database. Default generation is mock; Embedding, index, OCR and Rerank are actual local components.

Required environment: `S8_UI_RECEIPT` is an absolute private output JSON path; optional `S8_UI_SUMMARY` stores final state on graceful shutdown. `S8_UI_PORT` defaults to 5012. Local component paths use `KNOWLEDGE_PYTHON`, `KNOWLEDGE_EMBEDDING_PYTHON`, `KNOWLEDGE_MODEL_DIR`, `KNOWLEDGE_TOKENIZER_DIR`, `KNOWLEDGE_RERANKER_DIR`.

```powershell
# From server/, with the local component paths configured:
node --require ./tests/os-user-info.cjs --import tsx tests/knowledge-acceptance-ui-fixture.ts
# From web/, in a separate terminal:
$env:VITE_API_PROXY_TARGET='http://127.0.0.1:5012'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5192 --strictPort
```

Accounts are disposable: `s8-demo` (admin), `s8-other` (other salesperson), password `S8-fictional-only`. These accounts exist only in the isolated memory instance. Reload/login again after restarting the host. No configured real mailbox is inherited. SMTP is a loopback-only, non-relaying test sink and accepts only recipients ending in `@example.test`; it cannot demonstrate Internet delivery. The application may display its normal SMTP label, so reports must identify this as **local simulated delivery**. Preparing a draft must produce zero deliveries/follow-ups; only the manual send action may produce them.

Live mode additionally requires `--live`, `S8_AUTHORIZED_ORIGIN=https://api.deepseek.com` and `S8_LIVE_KEY` supplied securely from local configuration. The host removes the temporary key environment variable after reading it. This flag is only for the user-authorized synthetic acceptance data. Do not import real data into this instance. Optional `S8_UI_TRACE` writes **synthetic outputs only** to a private JSONL file for diagnostics; it does not log request headers or keys. Do not commit these traces.

Read-only loopback `GET /__s8_snapshot` provides isolated evidence (rejects Origin-bearing browser requests); it is a test harness route, not part of production. `POST /__s8_stop` requires the receipt's `x-s8-control` token and gracefully closes parser/index/model workers, SMTP and memory DB. Keep receipt private. It contains a control token and temporary paths.

## Operator checks

1. Knowledge → Import and review: upload independent TXT/Markdown and scan samples with an explicit fictional source; verify source positions, OCR warnings and draft-only suggestions. Review a complete product fragment, save the draft, then explicitly publish its applicable version.
2. Search readiness: wait for the current generation, try English/Chinese questions and examine the actual source/version. Product applicability is strict: record reviewed product names in both languages where needed. Keywords alone do not broaden the product scope; Embedding cannot override it.
3. Customer/mail context → Sales assistant: prepare first outreach, inquiry reply, quotation explanation, sample reply and follow-up. Verify persistent steps, exact versions/conditions, missing-price/freight warnings, private mailbox exclusion, and no automatic send.
4. Review: edit the body, run recheck, save and reopen. Update one fictional publication, check changed-basis notice, regenerate, and verify the original draft has not changed.
5. Manual send: inspect recipient and body; submit only to the loopback fixture, then verify one accepted delivery and one successful-send follow-up. Never use the real CRM account or mailbox for this check.

## First measurements retained

- First fact development/holdout ordinary accuracy 15/16 each; gates failed. Fixes and post-fix regression are separately recorded; the holdout is no longer unseen after inspection. Frozen labels are unchanged.
- First full-email UI generation reached a saved draft but semantic verification did not complete; safe partial fallback was correctly visible. Structured evidence output and response truncation guards were added; full-email retests and remaining quality limits are recorded in knowledge-s8-results/README.md.
- Initial full regression 362/363; one keyword isolation assertion did not recur in three standalone repetitions or the later full 364/364 run. Root cause remains unproven; first failure is retained.
- Original/transfer frozen retrieval reruns: Recall@10 95%/100%; negative-state accuracy 97.5% each; unauthorized hits 0. Final scale/performance and UI results are recorded in knowledge-s8-results/README.md.

## Real package boundary

The supplied Genesis Bags ZIP was checked locally: CRC valid, 12/12 members structurally readable (UTF-8 text/JSON/CSV and DOCX/XLSX XML), no member script executed, no external requests and no knowledge published. Structural readability is not business approval, parser success or factual authenticity. Detailed names/headings remain in a private local audit. All 82 real drafts remain unmodified/unpublished.

A business owner must confirm: company/signature authority; each product/process scope; MOQ quantity units and conditions; sample amount/currency/refund/courier exclusions; lead-time start event and working/calendar units; price tier validity and quotation boundaries; certificate scope/expiry; logistics/destination and payment conditions; stale examples/conflicts and who may approve changes. Do not convert template examples or draft suggestions into policy.


## Current handoff

See [results and failures](knowledge-s8-results/README.md). The isolated acceptance hosts were gracefully stopped after saving final snapshots; their in-memory accounts/data are disposable. Restarting creates new IDs. The original branch runs were eb7d3d5/4658f74. PR39 merged as f3240d2; its clean-main five-task/send replay passed those portions but failed version-regeneration handoff. Incremental accounting fix 8da9f6f passed its targeted isolated replay. Human merge of that fix, targeted clean-main recheck, remote CI confirmation, business policy approval and independent whole-email quality confirmation remain required. Historical terminal tasks with inflated counters are not silently reset; retain their results and create a new smaller task. No production deployment is authorized by this guide.

Recovery: use the existing [S7 operations and migration guide](knowledge-s7-operations.md) for knowledge-only backup/preflight/restore/index rebuild. Do not replace real MongoDB configuration with fixture receipts or restore a test snapshot into the real database. Verify the intended target and empty restore destination. SMTP sink acceptance proves only the isolated send/follow-up transaction.
