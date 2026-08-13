# Architecture

This repository demonstrates a small, deterministic wrapper around Playwright Test.

An external caller — human, script, or AI system — submits a narrow request. The wrapper validates that request, constructs an approved Playwright invocation, runs it, and returns a normalized JSON result with artifact references.

The wrapper does not include an LLM, prompt loop, MCP server, or agent runtime. Keeping reasoning outside the execution path is intentional.

## Flow

```text
External caller
Human / AI / automation
        |
        v
  Bounded request
        |
        v
  Input validation   (src/playwright-wrapper/contract)
        |
        v
  Playwright wrapper (src/playwright-wrapper/execution)
        |
        v
  Playwright Test
        |
        v
  Native artifacts   (surfaced by src/playwright-wrapper/artifacts)
        |
        v
  Normalized JSON result
```

## Source layout

| Path | Responsibility |
|---|---|
| `src/playwright-wrapper/contract/` | Request validation and result types |
| `src/playwright-wrapper/execution/` | Bounded runner and CLI |
| `src/playwright-wrapper/artifacts/` | Presence checks for known Playwright artifact paths |
| `tests/smoke/` | Allowlisted demo target (`project: smoke`) |
| `tests/unit/` | Wrapper boundary and validation tests |

Native Playwright HTML/JSON/JUnit output remains the detailed reporting surface. This repository does not implement a separate reporting product.

## Boundaries that matter

1. **Request vs command** — callers supply a request object; the shell command is derived internally from validated fields (`shell: false`, argv array).
2. **Validation vs execution** — invalid requests fail before Playwright is spawned.
3. **Wrapper outcome vs test outcome** — `ok` describes wrapper completion; `status: "failed"` can still mean `ok: true` when tests fail normally.
4. **stdout vs stderr** — CLI stdout is the JSON result channel; Playwright human output goes to stderr.

## What "bounded" means here

Bounded refers to the enforced request/execution surface:

- allowlisted `project`
- repo-relative `spec` under `tests/**/*.spec.ts`
- constrained `grep`, `headed`, and `workers`
- no raw command-string API

It does not claim OS sandboxing, network isolation, or enterprise governance.

## Non-goals

Arbitrary command execution, browser-driving agent orchestration, MCP infrastructure, autonomous multi-step planning, dashboards, and telemetry platforms.

## Related docs

- [Contracts](contracts.md) — request/result TypeScript shapes
- [Wrapper contract](wrapper-contract.md) — execution boundary rules
- [Result schema](result-schema.md) — outcome semantics
- [Artifact model](artifact-model.md) — evidence references
- [Human review model](human-review-model.md) — how to read a result
