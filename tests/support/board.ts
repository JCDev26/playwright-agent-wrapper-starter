import { test as base } from "@playwright/test";
import path from "node:path";

export const test = base.extend({
  baseURL: async ({}, use, info) => {
    const root = info.project.name === "performance" && process.env.PW_PERF_REFERENCE_ROOT || process.cwd();
    const { startBoard } = require(path.resolve(root, "examples/task-board/server.ts")) as typeof import("../../examples/task-board/server");
    const board = await startBoard();
    try {
      await use(board.url);
    } finally {
      await board.close();
    }
  },
});
export { expect } from "@playwright/test";
