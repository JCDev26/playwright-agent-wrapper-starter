# playwright-agent-wrapper-starter

A bounded, reviewable Playwright Test wrapper for human, script, or AI-assisted callers. It accepts a typed request, checks local prerequisites, executes an allowlisted target, and returns normalized JSON with current-run evidence. There is no LLM, prompt loop, or agent runtime inside the wrapper.

**Start with the [reference guide](docs/reference-guide.md)** for the separation between contract, execution, observation, reporting, and human review.

## Quick start

Use Node.js **>=22.12.0** and the committed lockfile. Playwright is pinned to **1.59.1**; this is the retained locked version, not a claim that it is the newest release.

```bash
npm ci
npx playwright install chromium
npm run --silent doctor
npm run typecheck
npm test
```

Installation commands are explicit user setup steps. Doctor never downloads, installs, or repairs anything. A fresh installation is not established by tests of an existing local setup.

The smoke suite launches Chromium against local HTML for a small task board: validation, adding a task, and completing it, with screenshot and trace evidence. It requires no server or external application. Running it successfully demonstrates the wrapper, not validation of your product; the existence of the test is not evidence of a passing browser run.

```bash
npm run test:smoke                      # doctor + browser smoke
npm run test:unit                       # unit-profile doctor + browser-free unit tests
npm run test:integration                # smoke-profile doctor + CLI/boundary integration
npm run --silent doctor -- --profile unit
```

## Local pre-flight doctor

`npm run --silent doctor` emits a JSON health report with `ready` or `blocked` status. The default smoke profile checks Node, manifest/lockfile direct development dependencies and installed direct dependencies plus the Playwright runtime, the configuration file's presence, artifact-directory writability, and the actual headless Chromium launch (including its required headless-shell executable). `--profile unit` explicitly skips the browser probe.

Doctor is a dependency-free entrypoint, also runnable as `node scripts/doctor.cjs`. It performs local checks only, creates `artifacts/` if needed, removes its temporary probe, and starts a browser process when needed. It is not a full transitive dependency integrity audit. The browser probe has a 10-second launch timeout and 15-second subprocess limit; timeout does not certify descendant-process cleanup. There is no general wrapper timeout for the target test invocation. It does not execute your Playwright configuration or certify application health, security, or test correctness. A headless launch is not proof that headed execution works.

`npm test` and `npm run test:smoke` are doctor-gated. The library wrapper validates the request first, then runs doctor before target execution. A blocked pre-flight returns `execution_error` with `error.code: PREFLIGHT_FAILED` and an additive `preflight` report. It does not claim that a test ran or failed an assertion. Unit-only readiness is not browser readiness. `npm test` includes unit, integration, and smoke coverage and therefore requires Chromium. `npm run test:integration` uses the smoke-profile gate. Direct low-level `npx playwright test` bypasses the script gate; the wrapper API still gates valid requests. A headed wrapper request uses a headed probe, whose success should not be claimed without observing it.

## Bounded request contract

| Field | Rule |
|---|---|
| `project` | Allowlisted: `smoke` |
| `spec` | Optional literal repo-relative `.spec.ts` path under `tests/`; no absolute paths, parent traversal, or NUL |
| `grep` | Optional Playwright regex string; non-empty, maximum 200 characters, no NUL |
| `headed` | Optional boolean |
| `workers` | Optional integer, 1–4 |

The wrapper constructs argv with `shell: false`; callers cannot supply arbitrary command strings. Spec filters are escaped and anchored so regex metacharacters cannot broaden file selection. Missing/nonmatching specs are execution errors. Omitted workers inherit Playwright defaults; the 1–4 limit applies to explicit requests.

This bounds the request surface, **not the authority of test code**. Configuration, tests, dependencies, and reporters must be trusted. It is not a sandbox.

## Run the wrapper

```bash
npm run --silent wrapper:run -- --project smoke --spec tests/smoke/example.spec.ts --workers 1
```

For machine callers, invoke the entrypoint directly:

```bash
node scripts/wrapper.cjs --project smoke --spec tests/smoke/example.spec.ts --workers 1
```

The dependency-free `scripts/wrapper.cjs` bootstrap runs the unit-profile doctor before loading TSX. A blocked bootstrap produces empty stdout, a JSON health report on stderr, and exit 2, outside the normalized wrapper-result contract. After bootstrap and parsing succeed, valid wrapper requests run the full smoke-profile doctor before target execution.

For requests reaching the wrapper, stdout contains the normalized JSON result; stderr carries human-readable run output. `--silent` suppresses npm's script banner. CLI parsing errors (unknown flags or missing arguments) are outside the wrapper-result contract: empty stdout, diagnostic stderr, exit 2.

### Outcome meanings

- `validation_error`, `ok: false`: the request was rejected before execution.
- `passed`, `ok: true`: trustworthy current-run Playwright results establish an accepted test outcome.
- `failed`, `ok: true`: trustworthy current-run results establish unexpected test outcomes.
- `execution_error`, `ok: false`: no trustworthy completed test judgment, including blocked pre-flight, no tests, all skipped, discovery/configuration errors, abnormal completion, or missing/unusable current-run JSON.

`ok` describes whether a test judgment was obtained, not whether assertions passed. Playwright's expected-failure and retry semantics remain authoritative. Child exit 0/1 alone never establishes passed/failed, and no result certifies broader product correctness.

CLI exit codes are **0** passed, **1** failed tests, **2** validation/execution/parser error. The result's `exitCode` is the observed child code; null means no numeric code was obtained, not necessarily that no process launched.

## Evidence and review

Each wrapper invocation isolates its JSON, HTML, JUnit, trace, and test output beneath `artifacts/wrapper-result-*/`. Use paths returned by that invocation, not an older shared report. Missing ancillary evidence is not a pass and must not replace the primary test judgment. A fresh artifact is attribution to a run, not authentication or approval.

The optional utilities in `src/reporting/` add a portable observation vocabulary while retaining native results. They are not a universally wired CLI/CI reporting service. Technical results, visual review, and owner approval remain separate. An editable approval field cannot authorize a commit, merge, or publication.

## Repository map

```text
scripts/doctor.cjs             local pre-flight checks
src/playwright-wrapper/
  contract/                   request validation + result types
  execution/                  runner + CLI
  artifacts/                  current-run artifact collection
src/reporting/                optional observation adapters
tests/smoke/                   allowlisted local browser demo
tests/unit/                    browser-free unit tests
tests/integration/             CLI and wrapper boundary integration
docs/                         contracts and design notes
```

## Further reading

- [Reference and adoption guide](docs/reference-guide.md)
- [Architecture](docs/architecture.md)
- [Contracts](docs/contracts.md) and [wrapper contract](docs/wrapper-contract.md)
- [Result schema](docs/result-schema.md) and [artifact model](docs/artifact-model.md)
- [Run evidence v1](docs/run-evidence-v1.md) and [human review model](docs/human-review-model.md)

V1 stops at a bounded wrapper. Autonomous browser agents, MCP, orchestration loops, self-healing tests, dashboards, enterprise approval enforcement, and distributed execution remain out of scope.
