# Explain a blocked CI run

**Explain a blocked Playwright run** gives a maintainer a short AI interpretation of the Contrarian's decision. Open the explainer run's **safe_outputs** job summary for the advisory note. The original CI run's **verify** job and its receipt remain the authority for advancement. [Contrarian Agent](contrarian-agent.md) · [Explainer workflow](../.github/workflows/blocked-run-explainer.md)

## Enable and run

1. Once the workflow is on the default branch, configure a GitHub Actions secret named `COPILOT_GITHUB_TOKEN` for Copilot inference. Use a credential scoped to inference. Live runs consume the configured provider's allowance. [GitHub Agentic Workflows authentication](https://github.github.com/gh-aw/reference/engines/copilot/#selection-and-authentication)
2. Set the repository Actions variable `ENABLE_BLOCKED_RUN_EXPLAINER` to `true`. A failed `ci` run on `main` can then trigger an explanation automatically. Set the variable to `false` to turn it off.
3. To explain a blocked pull request or an earlier attempt, select **Actions → Explain a blocked Playwright run → Run workflow**, select the default branch, and enter the original CI **run ID** and **attempt number**. The run ID is the number in its Actions URL. A rerun increments the attempt number. GitHub must still retain the evidence artifacts.

The evidence job checks that the selected repository's `ci.yml` completed with a failed **verify** job. It verifies the artifact archive digests, the receipt's pin on the Reporting summary, the job UUID, tested commit and manifest hash. For pull requests it checks the merge SHA recorded in the artifact name from that attempt. A missing receipt, an approved run or a summary that failed Contrarian validation stops the model call. [Evidence adapter](../scripts/blocked_run_evidence.py)

The model receives the run identifiers, gate decision, confirmed lanes, known challenge codes, source outcomes and suite counts. Its output capability displays up to 1,200 characters of plain text in the advisory run. Repository browsing, shell execution, source edits and issue reporting are disabled. Tests, logs, attachments and free-form diagnostics stay in the CI artifacts.

## Maintain the workflow

The Markdown file contains the prompt, engine and permission declarations. GitHub Agentic Workflows **v1.2.2** produced the checked-in Actions YAML. To use another supported engine, change the engine configuration and credential, recompile, and run the offline checks to verify its permissions. [GitHub Agentic Workflows engines](https://github.github.com/gh-aw/reference/engines/) · [Compilation](https://github.github.com/gh-aw/reference/compilation-process/)

```sh
gh aw compile blocked-run-explainer
python3 -B -m unittest discover -s tests/advisory
```

CI runs these Python standard-library tests with a stub model response. They cover successful and blocked CI selection, PR merge revisions, missing or changed evidence, malformed ZIP members and the generated handler that renders the note. [Offline tests](../tests/advisory/test_blocked_run.py)
