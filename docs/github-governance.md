# GitHub governance and evidence

## Require the final check on main

The repository ruleset requires a pull request and an up-to-date `verify` check issued by the GitHub Actions app. A change to workflows, policies, tests, dependencies or the wrapper also requires a code owner’s review. New commits dismiss stale approvals. The policy contains no bypass actors. When adopting the starter, replace the listed owners with maintainers who have write access and update the performance policy’s repository identity. [Reviewed ruleset](../.github/rulesets/main.json) · [Code owners](../.github/CODEOWNERS)

After this governance change lands and CI passes on main, run `node scripts/main-ruleset.mjs` to check readiness. An administrator activates it with `node scripts/main-ruleset.mjs --apply` using an authenticated GitHub CLI or a process-scoped `GH_TOKEN`. The installer checks the actual Contrarian step in the latest main push run, the reviewed ruleset at that commit and GitHub’s code-owner validation. It preserves existing rulesets and reports conflicts for review. [Installer](../scripts/main-ruleset.mjs)

## Keep timing comparable

Performance preparation and candidate measurement run sequentially inside `collect`. Keep both there when splitting other Playwright projects across runners. Even two jobs labelled `ubuntu-latest` can use different infrastructure. The independent `verify` job replays measurements from the original runner. [CI workflow](../.github/workflows/ci.yml) · [GitHub hosted compute](https://github.blog/changelog/2026-10-28-github-actions-adds-multi-cloud-compute-to-improve-reliability/)
