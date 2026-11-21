# Playwright test automation starter

Test a task board on desktop and mobile, measure a real interaction, and give an AI assistant the evidence to explain a failure. The starter uses TypeScript, Playwright Test 1.65.1, and a small HTTP app that runs on your machine.

## Run your first test

Use the Node version in `.nvmrc` or a newer supported Node release.

```sh
npm ci
npx playwright install chromium
npm run test:smoke
npm run show-report
```

On a fresh Linux runner, use `npx playwright install --with-deps chromium`. In the HTML report, open **add and complete a review task** and choose its trace. Follow the reopen step from the checkbox action to the PATCH response and the open-task counter. For interactive development, run `npx playwright test --ui --project=smoke`.

## Write your next test

Read [the first browser journey](tests/smoke/example.spec.ts) and [its seed](tests/smoke/seed.spec.ts). Add a spec under `tests/smoke/` with the same fixture import. Try adding two tasks, completing one, and checking that the other stays open after a reload. The [fixture](tests/support/board.ts) gives each test its own loopback server and fresh data, including retries. Use `npm run demo` to explore the app manually at `http://127.0.0.1:4173`.

When adopting this in your codebase, point the fixture at your application and seed independent test data. Playwright's [webServer and baseURL configuration](https://playwright.dev/docs/test-webserver) can start an existing development server for the suite.

| Run | Coverage |
|---|---|
| `npm run test:smoke` | Desktop Chromium. Validation, task completion, reopening and persistence. |
| `npm test` | Default projects covering the desktop journey, wrapper unit tests and CLI integration. |
| `npm run test:mobile` | Pixel 10 on Chromium and iPhone 17 on WebKit. Both repeat the desktop journey and exercise a long task name on a touch screen. Install the engines with `npx playwright install chromium webkit`. |
| `npm run test:performance` | One warm-up and ten measured submissions in Chromium, with the raw durations and median attached to the HTML report. |
| `npm run test:security` | Three defensive contracts on a fresh local task board. Inspect literal rendering, update validation and cache behavior in the native report. |
| `npm run test:load` | Starts a private task API and runs k6 at five create/list/delete journeys per second for 15 seconds. Requires the [k6 executable](https://grafana.com/docs/k6/latest/set-up/install-k6/) on PATH. |

The [Playwright config](playwright.config.ts) uses opt-in projects for mobile, performance and security. CI selects the mobile projects in the regular suite and runs each executing specialist separately. Try `npx playwright test --project=smoke --shuffle` to check test isolation. Repeat with the printed seed to investigate an order-dependent failure.

## Interpret the measurements

**Mobile** uses emulated device settings. The [touch test](tests/mobile/task-board.spec.ts) checks viewport overflow, checkbox reachability and the resulting counter. Physical devices and native apps need their own coverage.

**Browser performance** measures from the submit handler to the counter's DOM update, including the API round trip. It excludes browser startup and subsequent paint. The [test](tests/performance/task-timing.spec.ts) uses one worker, a warm page and tracing disabled. Establish a baseline on a fixed runner before setting `TASK_MEDIAN_BUDGET_MS` to enforce a positive millisecond budget. The HTML attachment records every sample, the browser version and the environment.

**API load** checks successful operations, p95 HTTP latency, error rate and dropped iterations. The [k6 scenario](examples/load/tasks.js) includes example thresholds for this loopback demo. Select rates and budgets from your service objectives when adapting it.

## Use the same test with an AI assistant

Each specialist exposes one tool over MCP or JSON stdio. The host grants the client a role and binds it to a clean Git revision and a job. Codex and other clients use the same checked-in policy and receive the same structured findings.

| Specialist | What its tool answers | Operator guide |
|---|---|---|
| Performance · `assess-performance` | Did task-submission latency regress against the last CI-accepted main? Both apps start with 50 tasks on the same runner. Adding tests leaves the per-submission budget intact. | [Measure a candidate](docs/performance-agent.md) |
| Security · `assess-security` | Which of the three local task-board protections passed, failed or lacked evidence? | [Run the defensive checks](docs/security-agent.md) |
| Reporting · `summarize-evidence` | What passed or failed in this job, and which expected evidence is missing or inconclusive? A client can reread the same sealed evidence. | [Interpret a job](docs/reporting-agent.md) |
| Contrarian · `review-verdict` | Does the pipeline's verdict hold up against independent discovery, native outcomes and the accepted-main measurements? Only `approved` permits advancement. | [Gate a pipeline](docs/contrarian-agent.md) |

On pull requests and pushes to main, the **collect** job runs the suite, Security and Performance and publishes Reporting's summary. The final **verify** job challenges the evidence on a fresh runner, including after a collection failure. Its summary explains whether downstream jobs may proceed. A confirmed failure stays visible when another lane lacks evidence. Maintainers decide whether to merge. [CI workflow](.github/workflows/ci.yml)

Start with the [planner, generator and failure-diagnosis exercise](docs/ai-workflow.md). It includes a seed, a human-readable plan and a reproducible product regression. The default suite runs without a model or credentials.

```sh
node scripts/wrapper.cjs --project smoke --spec tests/smoke/example.spec.ts --workers 1
```

The wrapper accepts a named project and bounded options, probes the required browser, and emits one JSON result on stdout after successful bootstrap and parsing. Playwright diagnostics go to stderr. Use the returned artifact paths to open the HTML, trace and native JSON from that invocation.

| Status | Meaning | CLI exit |
|---|---|---|
| `passed` | Current-run evidence establishes an accepted Playwright outcome. | 0 |
| `failed` | Current-run evidence establishes an unexpected test outcome. Both passed and failed judgments carry `ok: true`. | 1 |
| `validation_error` | Request rejected before execution. | 2 |
| `execution_error` | No trustworthy completed judgment, including missing prerequisites or no matching tests. | 2 |

See the [request contract](docs/wrapper-contract.md), [result schema](docs/result-schema.md), [artifact model](docs/artifact-model.md) and [adoption guide](docs/reference-guide.md) for integration details. To diagnose setup, run `npm run --silent doctor` or `npm run --silent doctor -- --profile mobile-ios`. Run `npm run typecheck` to check the example app and tests.
