import { test, expect } from "@playwright/test";
import {
  InputValidationError,
  validateAndNormalizeTarget,
} from "../../tools/agent/contract/validateInputs";

test.describe("validateAndNormalizeTarget", () => {
  test("accepts a minimal valid request", async () => {
    const result = validateAndNormalizeTarget({
      project: "smoke",
    });

    expect(result).toEqual({
      project: "smoke",
      spec: null,
      grep: null,
      headed: false,
      workers: null,
    });
  });

  test("accepts a valid spec path inside tests", async () => {
    const result = validateAndNormalizeTarget({
      project: "smoke",
      spec: "tests/smoke/example.spec.ts",
    });

    expect(result.spec).toBe("tests/smoke/example.spec.ts");
  });

  test("normalizes backslashes in spec paths", async () => {
    const result = validateAndNormalizeTarget({
      project: "smoke",
      spec: "tests\\smoke\\example.spec.ts",
    });

    expect(result.spec).toBe("tests/smoke/example.spec.ts");
  });

  test("accepts a valid grep value", async () => {
    const result = validateAndNormalizeTarget({
      project: "smoke",
      grep: "@smoke",
    });

    expect(result.grep).toBe("@smoke");
  });

  test("accepts valid workers in the allowed range", async () => {
    const result = validateAndNormalizeTarget({
      project: "smoke",
      workers: 4,
    });

    expect(result.workers).toBe(4);
  });

  test("rejects an unknown project", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "ui",
      }),
    ).toThrowError(InputValidationError);

    expect(() =>
      validateAndNormalizeTarget({
        project: "ui",
      }),
    ).toThrow(/Project must be one of/);
  });

  test("rejects an absolute spec path", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        spec: "C:\\repo\\tests\\smoke\\example.spec.ts",
      }),
    ).toThrow(/repo-relative/);
  });

  test("rejects a spec path outside tests", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        spec: "src/example.spec.ts",
      }),
    ).toThrow(/inside tests/);
  });

  test("rejects parent-directory traversal in spec path", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        spec: "../tests/smoke/example.spec.ts",
      }),
    ).toThrow(/parent-directory traversal/);
  });

  test("rejects a spec path without .spec.ts suffix", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        spec: "tests/smoke/example.ts",
      }),
    ).toThrow(/\.spec\.ts/);
  });

  test("rejects an empty grep value", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        grep: "   ",
      }),
    ).toThrow(/Grep must not be empty/);
  });

  test("rejects grep values longer than 200 characters", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        grep: "a".repeat(201),
      }),
    ).toThrow(/must not exceed 200 characters/);
  });

  test("rejects non-boolean headed values", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        headed: "true" as never,
      }),
    ).toThrow(/Headed must be a boolean/);
  });

  test("rejects workers below the allowed range", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        workers: 0,
      }),
    ).toThrow(/between 1 and 4/);
  });

  test("rejects non-integer workers", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        workers: 1.5,
      }),
    ).toThrow(/integer/);
  });

  test("rejects workers above the allowed range", async () => {
    expect(() =>
      validateAndNormalizeTarget({
        project: "smoke",
        workers: 5,
      }),
    ).toThrow(/between 1 and 4/);
  });
});