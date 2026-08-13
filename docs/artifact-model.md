# Artifact model

This document defines how the wrapper layer should think about execution evidence in the first version of the repository.

The goal is not to replace Playwright reporting. The goal is to define a small, review-friendly artifact model that makes evidence easier to locate, reason about, and reference from normalized results.

## Why this model exists

A Playwright run can already produce useful outputs such as HTML reports, traces, JSON results, XML results, screenshots, and videos.

Those outputs are valuable, but raw artifact generation alone does not create a strong review model.

The wrapper layer needs a compact way to answer questions such as:

- what evidence was expected from the run
- what evidence is available now
- where a reviewer should look first
- how artifact references should appear in normalized results

This document defines that smaller evidence contract.

## Design goals

The first-version artifact model is designed to do a few things well:

- treat evidence as a first-class part of execution output
- use stable repo-relative paths
- make artifact references easy to consume from normalized results
- support human review without requiring deep Playwright knowledge
- stay small enough to remain believable in v1

This is an evidence model, not a reporting platform.

## Core design stance

The wrapper should not try to duplicate all Playwright reporting behavior.

Instead, it should do something narrower and more useful for review:

- identify the expected evidence locations
- collect artifact references in a stable shape
- surface those references in the result object
- help a reviewer understand where to inspect next

That keeps the wrapper focused on bounded execution and review support.

## First-version artifact categories

The first version should focus on a small set of evidence categories:

- HTML report
- machine-readable test results
- trace files
- optional media artifacts such as screenshots or videos if they exist

This keeps the model understandable while still reflecting real Playwright run outputs.

## Recommended artifact fields

The normalized result should expose artifact references through a compact object such as:

```json
{
  "artifacts": {
    "htmlReport": "artifacts/playwright-report/index.html",
    "testResultsJson": "artifacts/test-results.json",
    "testResultsXml": "artifacts/test-results.xml",
    "traceFiles": []
  }
}
```

This structure is intentionally small.

It is enough to support review without building a second reporting system.

## Path policy

Artifact references should use repo-relative paths.

That matters for three reasons:

- the result becomes easier to read in local development
- the artifact references remain portable across environments
- the wrapper avoids leaking machine-specific absolute paths into its public output model

For v1, consistency is more important than exhaustiveness.

## Expected evidence locations

The repository is expected to use an `artifacts/` area as the wrapper-facing evidence root.

Recommended locations include:

- `artifacts/playwright-report/`
- `artifacts/test-results.json`
- `artifacts/test-results.xml`

Additional nested evidence such as trace files may also exist under subdirectories created by Playwright.

The wrapper does not need to invent a complicated storage scheme in v1.

## Artifact presence model

The wrapper should distinguish between:

- artifact paths that are part of the expected output model
- artifact files that are actually present after a run

That distinction matters because a result may still include known artifact fields even when some artifacts were not produced.

For v1, the artifact presence rules should be explicit:

- the `artifacts` object is always present
- `htmlReport`, `testResultsJson`, and `testResultsXml` are `string | null`
- `traceFiles` is always an array
- missing scalar artifact files are represented by `null`
- no artifact keys are omitted from the result shape

Examples:

- an HTML report path may be known and returned as a string when report output is expected
- an HTML report value may be `null` when no report path is available
- trace file arrays may be empty for runs that produced no traces
- machine-readable result paths may still be present even when execution failed early enough that the files were not ultimately written

This approach keeps the result shape stable for reviewers and downstream systems.

## Review priority

The artifact model should support a simple review order.

A reasonable first-version order is:

1. normalized result summary
2. HTML report
3. machine-readable results
4. trace files
5. other media artifacts if present

This helps the wrapper remain oriented toward human review rather than raw artifact dumping.

## Wrapper responsibilities for artifacts

The wrapper layer is responsible for:

- knowing the expected artifact paths it cares about
- collecting stable references to those artifacts
- returning those references in the normalized result
- keeping artifact references compact and predictable

The wrapper is not responsible for:

- reformatting native Playwright reports
- parsing every artifact into a second data model
- building dashboards
- storing historical run evidence over time
- replacing native debugging workflows

These are important limits.

## Artifact references in the result schema

Artifact references should appear as part of the normalized result because evidence is part of the contract.

A reviewer should not need to guess where to look after a run completes.

At minimum, the result should make these questions easy to answer:

- where is the HTML report
- where are the machine-readable results
- are there any trace files
- what evidence exists for deeper inspection

That is enough for the first release.

## Trace handling posture

Trace files are useful because they preserve deeper debugging evidence without forcing the wrapper to interpret everything up front.

For v1, the strongest design is simple:

- surface trace file references when they exist
- allow the list to be empty
- do not invent rich trace metadata yet

That gives the repo a credible evidence model without overbuilding.

## Optional artifact expansion later

The model may expand later to include:

- screenshots
- video files
- stderr or stdout capture references
- artifact existence flags
- artifact counts
- timestamps
- richer artifact typing

Those are possible future improvements, but they are not required to prove the core pattern.

## Non-goals

This artifact model is not intended to be:

- a telemetry pipeline
- a dashboard schema
- a generic evidence format for every tool
- a replacement for Playwright reports
- a complete artifact catalog

It exists to support governed execution and human review.

## Design stance

The important idea is simple:

artifact references should be deliberate, stable, and review-oriented.

That is more useful in this repository than trying to expose every possible piece of runner output.