# Human review model

This document defines how a human reviewer is expected to interact with wrapper outputs in this repository.

The goal is not to create an approval workflow system or a formal governance platform. The goal is to make bounded Playwright execution understandable enough that a reviewer can quickly determine what happened, what evidence exists, and what should happen next.

## Why this model exists

A governed execution wrapper is only half of the design.

The other half is review.

If a system can request a Playwright run but the output is still difficult to interpret, then the operational boundary is weak in practice. Invocation safety alone is not enough. The result also has to support efficient human judgment.

This review model exists to answer one practical question:

**What should a reviewer be able to understand from one normalized execution result without reconstructing shell history?**

## Design goals

The first-version human review model is designed to do a few things well:

- orient the reviewer around structured outputs
- reduce dependence on raw terminal logs
- make evidence easy to locate
- distinguish validation failures from execution failures and test failures
- support bounded next-step decisions
- remain lightweight enough for a small public repository

This is a review model, not a workflow engine.

## Core review principle

The wrapper should produce enough structured information that a reviewer can answer five questions quickly:

1. what was requested
2. what was actually run
3. what happened
4. what evidence exists
5. what should be inspected next

If those questions are easy to answer, the review model is doing its job.

## Review inputs

A human reviewer is expected to use a small set of inputs together:

- the normalized result object
- artifact references
- the HTML report when deeper inspection is needed
- trace files or machine-readable results when the failure requires more detail

The reviewer should not need to reconstruct execution from terminal history as the default path.

## Review flow

The intended review flow for v1 is intentionally simple.

### Step 1: inspect the normalized result

The reviewer should start with the top-level result fields:

- `ok`
- `status`
- `target`
- `command`
- `summary`

This should give enough context to determine whether the run:

- passed cleanly
- failed at the test layer
- was rejected at validation
- encountered an execution problem

### Step 2: confirm the approved target

Before looking at deeper artifacts, the reviewer should confirm the approved target.

That means checking fields such as:

- project
- spec
- grep
- headed
- workers

This prevents time being wasted reviewing the wrong run or misinterpreting a valid result for the wrong target.

### Step 3: inspect primary evidence

The primary evidence path should usually be:

1. normalized result summary
2. HTML report
3. machine-readable results
4. trace files if deeper debugging is needed

This keeps the review order predictable and lightweight.

### Step 4: decide the next action

The review model should help a human reach a bounded decision such as:

- no further action needed
- inspect failing assertions in the report
- inspect traces for deeper debugging
- correct invalid input or wrapper usage
- investigate environment or execution issues

The point is not just to surface data.

The point is to support an informed next step.

## Outcome model for review

The review model becomes much easier to use when result outcomes are normalized into a small set.

### Passed

Interpretation:

- the wrapper accepted the request
- execution completed normally
- the selected Playwright target passed

Typical reviewer action:

- record success
- inspect artifacts only if additional confirmation is needed

### Failed

Interpretation:

- the wrapper accepted the request
- execution completed normally
- the selected Playwright target failed

Typical reviewer action:

- inspect the HTML report first
- inspect traces if the report is insufficient
- determine whether the failure is product, test, or setup related

### Validation error

Interpretation:

- the wrapper rejected the request before execution
- the issue occurred at the policy or input layer

Typical reviewer action:

- correct the request
- verify that the caller used an allowed target shape
- confirm that the rejection was expected and well explained

### Execution error

Interpretation:

- the wrapper attempted execution
- the run did not complete normally
- the issue is operational rather than a simple failing assertion

Typical reviewer action:

- inspect execution context and artifact availability
- determine whether the issue is environmental, configuration-related, or wrapper-related

## Outcome matrix

| `ok` | `status` | Reviewer interpretation | Typical next action |
|---|---|---|---|
| `true` | `passed` | Request accepted, execution completed, tests passed | Record success and move on |
| `true` | `failed` | Request accepted, execution completed, tests failed | Open HTML report, then inspect traces if needed |
| `false` | `validation_error` | Request rejected before execution | Correct request shape or caller behavior |
| `false` | `execution_error` | Execution did not complete normally | Inspect environment, wrapper behavior, and available artifacts |

This matrix is intentionally small.

Its purpose is to make first-pass review fast and consistent.

## Review posture

The first version of the repository should remain strongly human-in-the-loop.

That means:

- the wrapper can normalize and summarize
- the wrapper can surface evidence
- the wrapper can suggest where to inspect next

But the wrapper should not pretend to replace reviewer judgment.

This is an important architectural choice.

The repository is demonstrating review-friendly execution, not autonomous correctness.

## What the reviewer should not have to do

A good review model removes unnecessary work.

A reviewer should not have to:

- reconstruct the run from ad hoc terminal history
- guess where artifacts were written
- infer whether the problem was validation, execution, or test failure
- reverse-engineer the requested target from raw CLI fragments
- interpret arbitrary output formats with no stable structure

If those tasks are still required, the wrapper has not improved the operational boundary enough.

## Summary guidance

The summary portion of the result should help a reviewer orient quickly.

For v1, the summary can stay small, but it should still answer two questions:

- what happened
- what should be inspected next

Example:

```json
{
  "summary": {
    "message": "Playwright run completed with failing tests.",
    "nextReviewPoint": "Open the HTML report and inspect the failing smoke spec."
  }
}
```

That small amount of guidance is often more useful than a much larger block of unstructured output.

## Relationship to native Playwright reporting

This review model does not replace native Playwright reports.

Instead, it uses them as deeper evidence.

That distinction matters:

- Playwright remains the source of detailed test reporting
- the wrapper provides a bounded execution layer
- the review model provides a compact way to interpret and navigate the output

This makes the repository complementary to Playwright rather than competitive with it.

## Non-goals

This human review model is not trying to be:

- an approval workflow engine
- a ticketing workflow
- a dashboard product
- a compliance system
- an autonomous remediation loop

It is a lightweight model for understanding the output of governed execution.

## Extension posture

The review model may grow later to include richer review summaries, explicit review notes, or more structured recommended actions.

For v1, the stronger choice is restraint.

A small review model that is consistent and useful is better than a larger one that feels speculative or productized before the core pattern is proven.

## Design stance

This repository assumes that trustworthy externally assisted execution is not just a question of what can be run.

It is also a question of what a human can understand afterward.

That is why the review model is part of the architecture.