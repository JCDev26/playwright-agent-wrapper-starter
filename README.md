# playwright-agent-wrapper-starter

Bounded, reviewable Playwright Test wrapper for external AI-assisted or automated QA callers.

This repository puts a deterministic wrapper between an external caller and raw Playwright execution. The caller may be a human, a script, or an AI system. The wrapper itself contains no LLM, prompt loop, or agent runtime.

## Why this exists

Letting an assistant construct arbitrary `npx playwright ...` commands is a weak operational boundary:

- execution scope is hard to review
- flags and paths are easy to over-permit
- outcomes arrive as raw terminal noise
- reasoning and execution stay tightly coupled

This project demonstrates a narrower pattern: accept a typed request, validate it, run only approved Playwright targets, and return a normalized JSON result with artifact references.

## What is bounded

The public request surface is intentionally small:

| Field | Rule |
|---|---|
| `project` | allowlisted (`smoke` in v1) |
| `spec` | optional; must stay under `tests/**/*.spec.ts` |
| `grep` | optional; non-empty string, max 200 chars |
| `headed` | optional boolean |
| `workers` | optional integer, 1–4 |

The wrapper builds argv itself (`shell: false`). Callers do not supply raw command strings.

## How a run works

```text
External caller
Human / AI / automation
        |
        v
  Bounded request
        |
        v
  Input validation
        |
        v
  Playwright wrapper
        |
        v
  Playwright Test
        |
        v
  Native artifacts
        |
        v
  Normalized JSON result
```

- **stdout** carries only the normalized JSON result
- **stderr** carries Playwright's human-readable run output
- native HTML/JSON/JUnit reports remain under `artifacts/`

## Quick Start

**Node.js:** `>=18` (see `.nvmrc` / `package.json` `engines`)

```bash
npm ci
npm run typecheck
npm test
```

This sample suite does not launch browsers, so no `playwright install` step is required for the default tests.

### Run the wrapper (developer-friendly)

```bash
npm run --silent wrapper:run -- --project smoke --spec tests/smoke/example.spec.ts --workers 1
```

`--silent` avoids npm's script banner so stdout stays pure JSON.

### Run the wrapper (machine-friendly)

Prefer invoking the CLI entrypoint directly when another system will parse stdout:

```bash
node node_modules/tsx/dist/cli.mjs src/playwright-wrapper/execution/runPlaywrightTargetCli.ts --project smoke --spec tests/smoke/example.spec.ts --workers 1
```

### Expected success shape

```json
{
  "ok": true,
  "status": "passed",
  "target": {
    "project": "smoke",
    "spec": "tests/smoke/example.spec.ts",
    "grep": null,
    "headed": false,
    "workers": 1
  },
  "command": "npx playwright test --project=smoke tests/smoke/example.spec.ts --workers=1",
  "exitCode": 0,
  "artifacts": {
    "htmlReport": "artifacts/playwright-report/index.html",
    "testResultsJson": "artifacts/test-results.json",
    "testResultsXml": "artifacts/test-results.xml",
    "traceFiles": []
  },
  "summary": {
    "message": "Playwright run completed successfully.",
    "nextReviewPoint": "Open the HTML report if deeper inspection is needed."
  }
}
```

Exit codes: `0` passed, `1` tests failed (wrapper still completed), `2` validation/execution/CLI error.

### Useful checks

```bash
# smoke target only (what the wrapper allowlists)
npm run test:smoke

# wrapper unit/boundary tests only
npm run test:unit

# rejected request stays honest and does not spawn Playwright
npm run --silent wrapper:run -- --project ui
```

## What this is / is not

**Is:** a concrete Playwright execution-boundary demo — validation, safe argv construction, normalized results, artifact references.

**Is not:** an LLM client, MCP server, autonomous QA agent, multi-agent system, prompt library, or generic command runner.

AI assistance is external. Separating intent from execution is the point.

## Repository structure

```text
src/playwright-wrapper/
  contract/      # request validation + result types
  execution/     # runner + CLI
  artifacts/     # Playwright artifact path collection
tests/
  smoke/         # allowlisted demo target for the wrapper
  unit/          # wrapper boundary/unit tests
docs/            # contracts and design notes
```

## Deeper docs

- [Architecture](docs/architecture.md)
- [Contracts](docs/contracts.md)
- [Wrapper contract](docs/wrapper-contract.md)
- [Result schema](docs/result-schema.md)
- [Artifact model](docs/artifact-model.md)
- [Human review model](docs/human-review-model.md)

## Out of scope for v1

Browser-driving agents, MCP, orchestration loops, test generation/self-healing, dashboards, enterprise approval systems, and distributed execution infrastructure.
