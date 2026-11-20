# Reference guide: a bounded Playwright execution boundary

This starter separates a caller's intent from test execution and the evidence used to judge it. The caller can be a person, a script, or an AI system. Playwright Test remains the source of truth for test discovery, execution, assertion outcomes, retries, and native evidence. The wrapper does not turn a request or a successful process exit into a test pass.

## Five responsibilities

| Responsibility | Owns | Does not establish |
|---|---|---|
| Contract | Validate the allowlisted project and bounded request fields | Whether the environment or product works |
| Pre-flight | Probe local prerequisites for the selected profile | Test success, full configuration validity, or application health |
| Execution | Build argv, invoke local Playwright, preserve failure causes | Human acceptance or permission to publish |
| Observation | Interpret trustworthy current-run results and link evidence | Broader product correctness or authenticated identity |
| Reporting | Present native results or adapt them into a portable vocabulary | New evidence, orchestration, or approval authority |

The practical order is **validate request -> doctor -> execute Playwright -> interpret fresh evidence -> report**. Invalid requests stop at validation. A blocked doctor stops target execution. Missing or unusable execution evidence remains an execution error, not a fabricated assertion failure.

## Doctor is a prerequisite check, not a validator

Run `npm run --silent doctor` for the default smoke profile, or `node scripts/doctor.cjs` when diagnosing setup without the npm script banner. The entrypoint needs no installed dependencies merely to start reporting setup problems.

The smoke profile checks:

- Node >=22.12.0.
- Manifest/lockfile direct development dependency agreement and installed direct dependencies plus the Playwright runtime matching lockfile versions. This is not a full transitive dependency integrity audit.
- Presence of the Playwright configuration file.
- Ability to write a temporary artifact probe.
- The actual headless Chromium launch, including the headless-shell executable it requires, rather than a separate full-browser executable check.

`--profile unit` explicitly skips the browser probe. `ready` means the selected prerequisite probes succeeded at that moment; it is not a guarantee against later filesystem, process, configuration, or application failures. Headless readiness says nothing about a graphical desktop session. A headed wrapper request uses a headed probe; do not claim headed validation without evidence from that mode.

Doctor makes no network calls, installs no packages or browsers, and performs no automatic repair. It creates `artifacts/` if absent, removes its temporary write/read probe, and starts a browser process. The browser launch timeout is 10 seconds and the subprocess limit is 15 seconds; timeout does not certify descendant-process cleanup. No general wrapper timeout is imposed on the target test invocation. It does not execute the Playwright configuration to certify it. Review a blocked report, fix the stated prerequisite deliberately, and rerun the same profile before trying the target again.

`npm test` covers unit, integration, and smoke tests and requires Chromium. Both it and `npm run test:smoke` gate execution on doctor; `npm run test:integration` also uses the smoke-profile gate. `npm run test:unit` uses the unit profile for browser-free tests with injected pre-flight results where needed. Direct low-level `npx playwright test` bypasses the script gate intentionally. The library wrapper applies the same fail-fast principle after request validation and before target execution. Its blocked result is `execution_error` with `error.code: PREFLIGHT_FAILED`, plus an additive `preflight` report. Distinguish that from an assertion failure or a discovery/configuration error after the pre-flight succeeds.

The dependency-free `scripts/wrapper.cjs` bootstrap runs the unit-profile doctor before loading TSX. A blocked bootstrap produces empty stdout, a JSON health report on stderr, and exit 2, outside the normalized wrapper-result contract. After bootstrap and parsing succeed, valid wrapper requests run the full smoke-profile doctor before target execution. Prefer `node scripts/wrapper.cjs --project smoke` for machine callers.

## Read outcomes without overstating them

- `passed`: native current-run results support an accepted Playwright outcome.
- `failed`: native current-run results support unexpected test outcomes.
- `validation_error`: the request never passed the contract.
- `execution_error`: no trustworthy completed test judgment is available.

Both `passed` and `failed` have `ok: true`, because both represent a usable judgment. An exit code alone, a JSON file's existence, a skipped test, or a report adapter returning successfully is not proof that a test passed. Expected failures and retries retain Playwright's meaning.

A setup failure does not prove the product is defective. Conversely, passing doctor does not make every later failure a product bug: configuration, discovery, infrastructure, and test-code errors can still occur.

## What the browser demonstration can prove

The smoke test uses a local HTML task board, with no server or external application. It exercises validation, adding a task, and completing it in Chromium, and produces screenshot and trace evidence. This is a small real browser workflow rather than a browser-free assertion sample.

A successful, observed run demonstrates the starter's execution/evidence path in that environment; the installed test alone proves no browser validation passed. It does not establish your application's behavior, headed-browser support, cross-browser compatibility, production security, or visual acceptance. The retained Playwright version is exactly 1.59.1; it is not represented as the newest stable version. A clean install must be verified separately from an already-installed local run.

## Keep evidence tied to the invocation

Wrapper evidence is isolated beneath `artifacts/wrapper-result-*/`: native JSON, HTML, JUnit, trace, and test output. Follow the result's paths for that run. Do not infer success from a report left over by a previous command, and do not promote a missing screenshot or trace into visual acceptance.

Native JSON supports the wrapper's test judgment. HTML, traces, and screenshots help investigate and review that judgment. Evidence paths are not an authentication mechanism. Keep revision and environment claims accurate, particularly for uncommitted changes: a commit identifier alone does not describe a dirty worktree.

The optional adapters in `src/reporting/` preserve native results and expose the vocabulary in [run evidence v1](run-evidence-v1.md). They do not install a universal reporting service or change every CLI/CI producer. Technical, visual, and owner-review states remain independent. A human-controlled approval must be obtained through an appropriate independent process; editing a report's approval field grants no authority.

## Adopt the pattern in another repository

1. **Choose a narrow target.** Define an explicit project allowlist and intended spec root. Keep bounded request validation and literal spec matching; do not expose arbitrary shell commands or unrestricted CLI flags.
2. **Trust the code being executed.** Review tests, configuration, reporters, and dependencies. Test code can execute with the runner's permissions. This wrapper is not a sandbox or a safe executor for untrusted contributed code.
3. **Match local prerequisites.** Pin and lock the supported tools, set a Node baseline, and adapt doctor to the repository's config path, dependencies, artifact directory, and browser profile. Do not use unit readiness to authorize a browser workload.
4. **Configure real Playwright projects and reporters.** Align allowlisted names with the repository's Playwright configuration. Preserve native JSON for judgment and isolate HTML/JUnit/output per invocation. Adapt evidence collection deliberately rather than assuming another repository uses the same paths.
5. **Replace the demo with a meaningful test.** Specify the app/server setup, credentials if required, intended assertions, browser capabilities, and cleanup. Keep secrets out of artifacts and logs. A local demo pass is not application validation.
6. **Test boundary failures as well as success.** Cover invalid requests, blocked prerequisites, literal path selection, missing/no/all-skipped tests, malformed or stale results, assertion failures, and current-run artifact attribution. Run type checking and the relevant test profiles.
7. **Keep review outside the result object.** Use optional reporting adapters only where useful. Define who reviews visual evidence and who can approve changes; preserve that authority separately from editable metadata.

Start small: one trusted project, one real smoke workflow, honest environment failures, and evidence attributable to the invocation. Add broader orchestration only when a demonstrated need earns it.
