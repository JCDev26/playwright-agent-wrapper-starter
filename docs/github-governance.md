# GitHub governance and evidence

## Require the final check on main

The repository ruleset requires a pull request and an up-to-date `verify` check issued by the GitHub Actions app. A change to workflows, policies, tests, dependencies or the wrapper also requires a code owner’s review. New commits dismiss stale approvals. The policy contains no bypass actors. When adopting the starter, replace the listed owners with maintainers who have write access and update the performance policy’s repository identity. [Reviewed ruleset](../.github/rulesets/main.json) · [Code owners](../.github/CODEOWNERS)

After this governance change lands and CI passes on main, run `node scripts/main-ruleset.mjs` to check readiness. An administrator activates it with `node scripts/main-ruleset.mjs --apply` using an authenticated GitHub CLI or a process-scoped `GH_TOKEN`. The installer checks the actual Contrarian step in the latest main push run, the reviewed ruleset at that commit and GitHub’s code-owner validation. It preserves existing rulesets and reports conflicts for review. [Installer](../scripts/main-ruleset.mjs)

## Keep timing comparable

Performance preparation and candidate measurement run sequentially inside `collect`. Keep both there when splitting other Playwright projects across runners. Even two jobs labelled `ubuntu-latest` can use different infrastructure. The independent `verify` job replays measurements from the original runner. [CI workflow](../.github/workflows/ci.yml) · [GitHub hosted compute](https://github.blog/changelog/2026-10-28-github-actions-adds-multi-cloud-compute-to-improve-reliability/)

## Update Actions dependencies

Dependabot checks GitHub Actions weekly. Review dependency changes alongside the generated lockfile. CI runs the official verifier before collecting evidence. The workflow files also retain their full commit SHAs so adopters can identify the exact code that runs directly from each workflow. [Dependabot configuration](../.github/dependabot.yml) · [GitHub lockfile guide](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies)

## Explain a blocked run

Maintainers can enable an advisory workflow that reads the retained evidence for a failed CI attempt and writes an explanation to its own job summary. The Contrarian supplies the required check, and maintainers review and merge the change. The guide covers provider selection, credentials, and how to select a specific run and attempt. [Blocked-run explainer](blocked-run-explainer.md)

## Verify release evidence

Publishing a release starts a separate workflow that binds the tag to its accepted main run, signs a manifest of the reviewed files, and publishes the manifest for consumers. The operator guide includes signature and digest checks, retention limits, and instructions for immutable releases. [Release evidence](release-evidence.md)
