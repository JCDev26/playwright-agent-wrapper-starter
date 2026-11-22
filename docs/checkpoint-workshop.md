# Steer a specialist while a job is running

A release reviewer has a passing suite and a timing report ready to publish. Security spots two suspicious samples. Performance can investigate immediately, Reporting can finish the suite section, and the conductor can hold the timing section. Run the example to see which work survives the interruption, what the returning worker learns, and what actually reaches the publisher.

## Run the release review

From the wrapper checkout, use the Node version in `.nvmrc` and run the following commands.

```sh
npm ci
npm run --silent quality -- demo
npm run --silent quality -- workshop
```

The demo runs a fixed interleaving. A security finding wakes a waiting Performance job. A timing draft is already in flight when the conductor sends a hold. The suite section commits while timing waits. When the draft reaches its write boundary, the host returns `held`. Performance checks the final routes. Sample 18 ended at `/login`, sample 19 reached `/tasks`, and sample 20 supplies the third valid observation. The median is **120 ms** for the three fixture samples.

Lifting the hold leaves the old draft `stale`. Performance sends the corrected numbers directly to Reporting while Reporting is disconnected. The same reporting job reconnects, reads its missed mail, drafts from the current evidence, and saves. The final gate checks the recorded claims and both report sections against the sources. Publication appends one entry to the local ledger. Retrying returns `already-published` with the count still at one. Add `--json` to `demo` to see the initial state, deliveries, decisions and final ledger.

### Take the conductor's seat

In `workshop`, enter one command per line. Inspect the values between steps.

| Try these commands in order | What to look for |
| --- | --- |
| `signal`, `hold`, `suite`, `submit` | The suite write returns `accepted`. The in-flight timing draft returns `held`. |
| `ack`, `gate`, `inspect`, `continue`, `submit` | Acknowledging the instruction leaves the finding open. After the check and release, the old draft returns `stale`. |
| `receive`, `save`, `disconnect`, `resume`, `draft`, `submit`, `save` | Reporting reconnects to its existing job. Its replacement draft commits against the new evidence. |
| `gate`, `revoke`, `publish` | The earlier gate was clear. Publication now returns `held` and records zero calls. The suite still passed. |
| `regrant`, `save`, `publish`, `publish` | The newly issued grant gets its own evidence reference. The ledger records one release. |

Use `status` for the shared project snapshot, `events` for the ordered transcript, `reset` for a fresh fixture and `quit` to exit.

## What the latest save can tell you

The host selects the latest checkpoint for the **repository, task, branch and logical job**. Each save points to its parent and records when it was saved, when each fact was observed, the last addressed message processed, the versions of shared outputs, open questions and the next action. The source of each fact is designated by the host. In this example those sources are the candidate revision, the native suite result and the owner's scoped grant.

On resume, compare **each claim** with its current source for this candidate and action. The receipt keeps the original, the latest reading, the time of comparison and the reason for the result.

| Disposition | Example | Consequence for this release |
| --- | --- | --- |
| `current` | The same candidate and native suite result still show a pass. | Carry that fact forward. Publication also requires a current, positive grant. |
| `historical` | The candidate advanced, the source superseded the evidence, or the grant expired. | Retain the old observation in history. Obtain applicable evidence before acting. |
| `contradicted` | The saved note says the suite failed and its designated source shows it passed. | Inspect the discrepancy and record the correction in a child checkpoint. |
| `unverified` | The grant reader is unavailable, conflicting or provides a grant for another action. | Keep the question open and hold the dependent action. |

A freshly saved packet can still contain an old test result. The `advanced` case demonstrates this. The `branch` case gives the other branch a newer timestamp and shows which save the host actually selects. The `correction` case retains the worker's original mistake alongside its correction.

```sh
npm run --silent quality -- memory
npm run --silent quality -- memory save > reporting-handoff.json
npm run --silent quality -- memory check reporting-handoff.json revoked
```

On Windows PowerShell 5.1, use `npm.cmd run --silent quality -- memory save | Set-Content -Encoding UTF8 reporting-handoff.json` for the middle command. The last command compares the file against a freshly initialized fixture and prints both readings. The file stays intact and the publisher call count is zero.

## Who talks to whom

- **Specialists can address a peer directly.** A note goes to its recipient and the conductor's transcript. A finding also reaches the specialists subscribed to the affected section. The conductor can observe both without forwarding each message.
- **The conductor steers the decision.** A hold takes effect at the next write boundary, including for work already in flight. Processing a message advances an ordered cursor. Acknowledging a hold confirms receipt. Closing a finding requires the assigned verifier to supply a conclusion consistent with current evidence. Changed evidence can reopen it.
- **Each output has an owner.** Performance owns verified timings. Reporting owns the report sections. Each draft carries its input and its section version. A competing write or superseded input makes that draft stale. A replacement connection retires the earlier writer.
- **The host owns the effect.** The final gate re-reads the candidate, suite, scoped grant, findings, holds and report sections at the publication boundary. A checkpoint, peer message or earlier clear gate gives a specialist no publication capability.

### Bring a response from your own tool

In the workshop, enter `brief security`. The JSON includes Security's own checkpoint, current source readings, output versions, addressed mail and a complete `exampleReply`. Give that brief to a human, a script or your chosen model. Have it return the example's envelope with a unique `messageId` and its proposed `message`. Save the full reply as `reply.json`, then enter `reply-file security reply.json` in the same workshop. You can also paste a compact packet after `reply security`. A fresh `brief reporting` shows a note addressed to Reporting.

Try returning this message inside Security's envelope to challenge just **one** sample.

```json
{"kind":"finding","section":"timing","sampleIds":["19"],"text":"Did sample 19 finish on the login page?","evidenceRef":"route-audit/19"}
```

Enter `inspect`. Performance checks the capture and returns `disproved` for this finding because sample 19 actually reached the product. If several findings are open, use `inspect <sequence>`. To supply the conclusion yourself, enter `measure`, obtain `brief performance` and send a `response` with the finding's `replyTo` sequence, `disposition` and `evidenceRef`. The host checks the conclusion against the capture. Reporting can send an `acknowledged` message with the steering instruction's `replyTo` sequence.

The operator binds each reply to a worker. The host rejects packets from a different job, revision or replaced connection, and rejects a request to grant itself authority or publish. An identical message retry returns its original delivery. The experiment runs without a model SDK or external service. [Worker packet implementation](../src/playwright-wrapper/swarm/worker-port.ts)

The host runs trusted TypeScript in one Node process with a controlled clock, synthetic observations and a local ledger. Worker reconnect and mailbox replay require that host to survive. The portable handoff supports a read-only comparison across processes. An independent service would need durable storage, authenticated worker identities and a publication endpoint that enforces its own authority and retry contract.

## Try the same questions on your repository

Use the target's real operation and independent observation in place of the fixture. Freeze the respondent's prediction before changing the input. [Architecture Challenge checklist](../examples/architecture-challenge/claim-checklist.md)

| Existing Challenge questions | Change one thing | Inspect the effect |
| --- | --- | --- |
| C04, C05, C17, C18 | Revoke the grant between a clear preflight and a local test action. Run an unchanged-grant control first. | Count actual effects in the target. Check that unrelated evidence stays usable. |
| C08–C13 | Restore a checkpoint with an old revision, an incorrect summary or an unavailable source. | Inspect the original, the per-claim verdict and the corrective action the system actually took. |
| C16–C19 | Deliver a peer finding while the owner is mid-write. Hold that section, let unrelated work continue, then disconnect and reconnect the owner. | Inspect delivery, the stale writer's result, the replayed messages and the eventual accepted output. |

For a measured comparison of ordinary review and the two-pass challenge, run the [reviewer calibration exercise](quality-calibration.md).

## Design sources and implementation

The choice to check remembered claims against independently retained evidence follows Anthropic's study of how memory errors persist and can be corrected. The output-version check applies the same optimistic concurrency principle Kubernetes describes for writes based on stale reads. [Anthropic on agent memory](https://www.anthropic.com/research/components-of-agent-memory) · [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)

The distinction between sending an instruction and observing its effect draws on Temporal's workflow message semantics. The mailbox also follows the retry principle that one request ID must represent one intent. Repeating an identical delivery returns its original record. Reusing its ID for a different payload is rejected. [Temporal workflow messages](https://docs.temporal.io/encyclopedia/workflow-message-passing) · [AWS on idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

Follow a single release through the [checkpoint contract](../src/playwright-wrapper/swarm/checkpoints.ts), [mailbox](../src/playwright-wrapper/swarm/mailbox.ts), [governed release desk](../src/playwright-wrapper/swarm/release-desk.ts) and [executable steering tests](../tests/unit/swarm-steering.spec.ts).
