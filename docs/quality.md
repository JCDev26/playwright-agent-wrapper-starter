# Choose a quality task

Run `npm ci` in this checkout. Use `npm run --silent quality -- tasks` to list tasks or `npm run --silent quality -- run mobile` to execute one. The host maps exact area names to fixed local commands and propagates their exit status.

| Area | Evidence or question |
| --- | --- |
| code | TypeScript checks and wrapper unit tests |
| web, mobile | Desktop Chromium or mobile browser emulation with Chromium and WebKit |
| performance, load | Browser interaction timings or a separate k6 API workload |
| security | The local task board's three declared defensive contracts |
| governance | The wrapper's request validation, evidence verification, merge-rule logic and specialist transport controls |
| agent | Checkpoint recovery, peer delivery, role restrictions and calibrated reviewer cases |

Install the browsers for the selected task. Load testing needs k6. Real regressions against accepted main use the governed Performance specialist. A passing example covers its specific workload. For product-specific quality, replace the task-board fixtures, contracts and workloads with your own. [Adoption guide](reference-guide.md)

## Work on a real review

In a clean checkout with the operator bindings and collected artifacts described in the [Contrarian guide](contrarian-agent.md), run `npm run --silent quality -- review`. It calls the native reviewer and returns its complete verdict plus follow-up items for Performance, Security and Reporting. Exit codes are 0 for approved, 1 for a confirmed failure, and 2 for denied or incomplete review. The existing GitHub Actions final summary uses the same assignment logic on its original receipt. Its advancement decision still comes exclusively from the native gate.

Run `npm run --silent quality -- session` with the same host bindings. The trusted operator owns this console. Give an external tool only the role brief and collect its reply as data. Enter these commands one per line.

1. Enter `save reporting Verify the final report`, then `brief security`. Each save captures the next action, cursor and source readings and points to its parent. `history reporting` shows that job's saved packets. Copy the Security brief's `exampleReply` into a JSON file, give it a unique ID and write a note addressed to Reporting.
2. Enter `reply-file security reply.json`. The host re-reads the real verdict and validates the packet against the job, revision, connection and evidence before delivering it.
3. Enter `resume reporting`. Inspect the reconciled sources, previous assignment and messages received since the saved cursor. Enter `processed reporting 1` if 1 is the next addressed sequence.
4. Use `hold security` to prevent new outgoing handoffs for that role while other roles continue. Enter `continue security` to lift it. A hold here controls advisory messages. Merge and release permissions belong to the host.
5. Enter `review` for the current native result or `quit` to end the session.

A worker gets a new connection on resume. Old replies, mismatched evidence, extra authority fields and reuse of a message ID with different content are rejected. Session mail and checkpoints live in the operator process. CI assignment summaries can be read after that process exits.

## Rehearse without a CI job

Follow the [full workshop](checkpoint-workshop.md) for worker packets and steering or the [calibration guide](quality-calibration.md) for a blind reviewer comparison.

| Command after `npm run --silent quality --` | What it does |
| --- | --- |
| `demo` or `demo --json` | Play a fixed synthetic release review from first finding through the final local ledger. |
| `workshop` | Steer the running exercise. Try `signal`, `hold`, `suite`, `submit`, `inspect`, `continue`, `submit`, `draft`, `submit`, `save`, `gate`, `publish`. The first timing draft is held, then stale. |
| `memory` | Compare revocation, superseded evidence, wrong branches and corrective saves. |
| `memory save` and `memory check <file> revoked` | Export a JSON checkpoint to a UTF-8 file and compare it in a fresh process. |
| `calibrate brief`, `calibrate packet`, `calibrate score examples/calibration/reservation-comparison.json` | Give two reviewers the same blind case and score their answers. |

For the architecture obstacle course, the [reference repository](https://github.com/JCDev26/agentic-engineering-reference) supplies the questions and pressure-test prompt to copy into the target project. Optional wrapper tooling generates structured worksheets with `node scripts/architecture-challenge.mjs questions` and `node scripts/architecture-challenge.mjs plan answers.json`. It reads the bundled checklist and never executes commands in the target.
