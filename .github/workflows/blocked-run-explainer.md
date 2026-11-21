---
name: Explain a blocked Playwright run
description: Give maintainers an advisory explanation of a completed, blocked CI attempt.
on:
  workflow_dispatch:
    inputs:
      run_id:
        description: Blocked CI workflow run ID
        required: true
        type: string
      attempt:
        description: CI run attempt number
        required: true
        type: string
  workflow_run:
    workflows: [ci]
    types: [completed]
    branches: [main]
if: >-
  vars.ENABLE_BLOCKED_RUN_EXPLAINER == 'true' &&
  github.ref == format('refs/heads/{0}', github.event.repository.default_branch) &&
  (github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'failure')
permissions: {}
concurrency:
  job-discriminator: ${{ github.run_id }}
engine:
  id: copilot
  bare: true
checkout: false
network: defaults
tools:
  github: false
  bash: false
  edit: false
  cli-proxy: false
max-turns: 3
timeout-minutes: 5
jobs:
  evidence:
    if: >-
      vars.ENABLE_BLOCKED_RUN_EXPLAINER == 'true' &&
      github.ref == format('refs/heads/{0}', github.event.repository.default_branch) &&
      (github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'failure')
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      actions: read
      contents: read
    outputs:
      facts: ${{ steps.bind.outputs.facts }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          ref: ${{ github.workflow_sha }}
          persist-credentials: false
          sparse-checkout: scripts/blocked_run_evidence.py
          sparse-checkout-cone-mode: false
      - id: bind
        name: Bind a blocked verify job to its reviewed summary
        env:
          GH_TOKEN: ${{ github.token }}
          SOURCE_RUN: ${{ github.event.workflow_run.id || inputs.run_id }}
          SOURCE_ATTEMPT: ${{ github.event.workflow_run.run_attempt || inputs.attempt }}
        run: python3 scripts/blocked_run_evidence.py
  agent:
    needs: [evidence]
    if: needs.evidence.result == 'success' && needs.evidence.outputs.facts != ''
safe-outputs:
  create-issue: false
  report-failure-as-issue: false
  report-failed-jobs: false
  report-missing-tool: false
  report-missing-data: false
  report-incomplete:
    create-issue: false
  threat-detection:
    report-as-issue: false
  scripts:
    explain-block:
      description: Put an advisory note in this explainer run's job summary.
      inputs:
        text:
          description: Plain text explanation for a maintainer, up to 1200 characters.
          required: true
          type: string
          max-length: 1200
      script: |
        const value = String(item.text).slice(0, 1200);
        const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        await core.summary.addHeading("Advisory explanation", 3).addRaw("<pre>" + escaped + "</pre>").write();
        return { success: true };
---

Explain why this Playwright CI attempt stopped. Use only the verified facts below. Lead with the gate decision. Distinguish confirmed failed checks from missing or inconsistent evidence. Give the maintainer one concrete place to investigate. A failing test alone cannot establish the product's root cause. Keep merge, retry and release decisions with the maintainer.

Verified facts from the evidence job

```json
${{ needs.evidence.outputs.facts }}
```

Submit the explanation once through `explain_block`. Use plain text and refer to the original run and attempt.
