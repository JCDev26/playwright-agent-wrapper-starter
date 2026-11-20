import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    [process.env.CI ? "failures" : "list"],
    ["html", { outputFolder: "artifacts/playwright-report", open: "never" }],
    ["json", { outputFile: "artifacts/test-results.json" }],
    ["junit", { outputFile: "artifacts/test-results.xml" }],
  ],
  use: {
    trace: "retain-on-failure",
  },
  outputDir: "artifacts/test-results",
  projects: [
    { name: "integration", testDir: "./tests/integration", testMatch: /.*\.spec\.ts/ },
    {
      name: "smoke",
      use: { browserName: "chromium", trace: "on" },
      testDir: "./tests/smoke",
      testMatch: /.*\.spec\.ts/,
    },
    ...(["mobile-android", "mobile-ios"] as const).map(name => ({
      name,
      default: false,
      testDir: "./tests",
      testMatch: ["**/smoke/*.spec.ts", "**/mobile/*.spec.ts"],
      use: devices[name === "mobile-ios" ? "iPhone 17" : "Pixel 10"],
    })),
    {
      name: "performance", default: false, testDir: "./tests/performance", workers: 1, retries: 0,
      use: { browserName: "chromium", trace: "off" },
    },
    {
      name: "unit",
      testDir: "./tests/unit",
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
