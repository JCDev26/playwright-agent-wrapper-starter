# Run the security agent

The agent checks three specific properties of the example task board on the authorized candidate revision. Each test gets a fresh server bound to loopback. The policy selects one spec, one headless Chromium worker and one execution per job. The project runs with retries disabled. [Policy](../agents/security/policy.json) · [Contract tests](../tests/security/task-board.spec.ts)

| Check ID | What the test observes |
|---|---|
| `literal-task-title` | A user adds `<em>Review notes</em>` through the form. The task row contains the exact text, including the angle brackets, with zero `em` elements. |
| `invalid-update-preserves-task` | A test creates a task and submits a string for its boolean completion field. The API returns HTTP 400 and a fresh GET returns the original record. |
| `task-api-no-store` | A successful task-list GET includes the `no-store` directive in its `Cache-Control` header. |

The browser test waits for the open-task counter before inspecting the row. The API tests use Playwright's request fixture to observe response headers and persisted state. [Playwright assertions](https://playwright.dev/docs/test-assertions) · [Playwright API testing](https://playwright.dev/docs/api-testing)

## Run locally or from an agent host

Install the locked dependencies with `npm ci` and Chromium with `npx playwright install chromium`. A maintainer can run the underlying project with `npm run test:security`. To obtain the governed finding, start in a clean checkout. The host issues the job UUID and selects the approved revision before launching the client.

```powershell
$env:PW_AGENT_JOB_ID = [guid]::NewGuid().ToString()
$env:PW_AGENT_REVISION = (git rev-parse HEAD)
'{"name":"assess-security","arguments":{}}' | node --import tsx src/playwright-wrapper/security/cli.ts
```

For MCP, use the same checkout and host-issued environment. Launch `node --import tsx src/playwright-wrapper/security/cli.ts --mcp` over stdio. Give the client the single advertised tool and the role instructions. Keep the sources, configuration, job environment and claim directory under host control. [Agent instructions](../agents/security/AGENT.md)

The wrapper verifies the clean revision before and after execution. An atomic claim under `artifacts/security-agent-jobs/<uuid>/` consumes the job even if execution crashes. Keep that ledger for the lifetime of the grant.

## Interpret the finding

| Finding | Evidence | JSON CLI exit |
|---|---|---|
| `checks_passed` | All three first attempts passed and each includes its own passing assertion observation. | 0 |
| `checks_failed` | At least one contract assertion recorded a violation in the selected native run. Check the individual outcomes for any remaining gap. | 1 |
| `insufficient_evidence` | The wrapper could not establish coverage or attribution. Examples include a missing browser, an unexpected spec, or a setup failure before an assertion. | 2 |
| `denied` | The request or host authorization failed, the checkout changed before execution, or the job was already claimed. | 2 |

The JSON includes the job ID and revision when authorized, the native wrapper status, and a path and SHA-256 digest when a bounded native report is available. Match the digest when sharing the report. Each assertion records a small inline attachment under its stable check ID. The wrapper pairs that observation with the native first attempt and validates the full check manifest. A teardown or setup failure can produce a native `failed` status and an `inconclusive` check. [Playwright test attachments](https://playwright.dev/docs/api/class-testinfo#test-info-attach)

These checks apply to every authorized revision. When adopting them for another product, select the behaviors your team commits to, then change the reviewed spec and versioned policy together. Report the individual contract outcomes and keep release decisions with the maintainer.
