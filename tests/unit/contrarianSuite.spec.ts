import { expect, test } from "@playwright/test";
import { reviewSuite } from "../../src/playwright-wrapper/contrarian/suiteReview";
import policy from "../../agents/contrarian/policy.json";

const skip = policy.allowedSkips[0];
function spec(title: string, outcome = "expected", expected = "passed", terminal = "passed") {
  return { file: skip.file, title, tests: [{ projectName: skip.project, status: outcome, expectedStatus: expected,
    results: [{ status: terminal }] }] };
}
function report(specs: ReturnType<typeof spec>[], describe?: string) {
  const suite = describe ? { title: skip.file, specs: [], suites: [{ title: describe, specs }] } : { title: skip.file, specs };
  return { errors: [], suites: [suite] };
}

test("matches the full test identity even when the counts agree, and accepts growth and reordering", () => {
  const plan = report([spec("old journey"), spec("new journey")]);
  expect(reviewSuite(plan, report([spec("new journey"), spec("old journey")]), "linux"))
    .toMatchObject({ planned: 2, observed: 2, challenges: [] });
  expect(reviewSuite(plan, report([spec("old journey"), spec("different journey")]), "linux"))
    .toMatchObject({ planned: 2, observed: 2, missing: 1, extra: 1, challenges: ["discovery_mismatch"] });
  expect(reviewSuite(plan, report([spec("old journey")]), "linux"))
    .toMatchObject({ missing: 1, challenges: ["discovery_mismatch"] });
});

test("only the named top-level Windows skip is covered by the reviewed exception", () => {
  const skipped = spec(skip.title, "skipped", "skipped", "skipped");
  const actual = report([skipped]);
  expect(reviewSuite(actual, actual, "win32")).toMatchObject({ acceptedSkips: 1, challenges: [] });
  expect(reviewSuite(actual, actual, "linux")).toMatchObject({ otherSkips: 1, challenges: ["unapproved_skips"] });
  const nested = report([skipped], "another describe");
  expect(reviewSuite(nested, nested, "win32")).toMatchObject({ otherSkips: 1, challenges: ["unapproved_skips"] });
});

test("distinguishes actual planned failures, retries and expected-failure annotations", () => {
  const plan = report([spec("A"), spec("B"), spec("C", "expected", "failed")]);
  const actual = report([spec("A", "unexpected", "passed", "timedOut"), spec("B", "flaky"),
    spec("C", "unexpected", "failed", "passed"), spec("unknown", "unexpected", "passed", "failed")]);
  expect(reviewSuite(plan, actual, "linux")).toMatchObject({ plannedFailures: 1, extra: 1, flaky: 1, expectedFailures: 1,
    challenges: ["discovery_mismatch", "flaky_tests", "expected_failure_annotations"] });
});
