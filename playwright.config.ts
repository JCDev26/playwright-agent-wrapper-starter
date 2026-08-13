import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/playwright-report", open: "never" }],
    ["json", { outputFile: "artifacts/test-results.json" }],
    ["junit", { outputFile: "artifacts/test-results.xml" }],
  ],
  use: {
    trace: "retain-on-failure",
  },
  outputDir: "artifacts/test-results",
  projects: [
    {
      name: "smoke",
      testDir: "./tests/smoke",
      testMatch: /.*\.spec\.ts/,
    },
    {
      name: "unit",
      testDir: "./tests/unit",
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
