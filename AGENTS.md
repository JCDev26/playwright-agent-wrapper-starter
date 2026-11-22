# Agent entry point

This is a bounded Playwright Test wrapper, not a production agent platform.
Read README.md first; load task-specific contracts and tests only as needed.
For a quality task, use docs/quality.md to select an existing area. The operator owns the task console. A specialist receives its role-bound brief and returns a data packet.
Input contract: src/playwright-wrapper/contract; execution and judgment: src/playwright-wrapper/execution; artifacts: src/playwright-wrapper/artifacts.
Portable observation contract: docs/run-evidence-v1.md; implementation: src/reporting/run-report.ts.
Each governed specialist has its own role instructions and versioned policy under
`agents/performance/`, `agents/security/`, `agents/reporting/` or `agents/contrarian/`. Use the corresponding
operator guide under `docs/` and expose only the endpoint granted by the host.

Use the locked dependencies: npm ci. Validate npm run typecheck and npm test; git diff --check.
Do not claim a test passed merely because a wrapper returned ok or a process exited zero.
Unit/static work needs Node; browser work needs the project's installed compatible browsers;
unavailable capabilities are inconclusive. Keep stdout machine-readable where documented.
Preserve native failure causes and current-run evidence. New report metadata is additive;
do not rewrite historical reports or infer human acceptance from technical checks.

Preserve unrelated work and reviewable branch scope. No live provider integration, paid
model calls, deployment, ruleset/permission changes, or publication without separate authority.
Human-controlled approval is never delegated to an editable report field. Keep the v1
stopping boundary; add the smallest tested change earned by a real finding.
