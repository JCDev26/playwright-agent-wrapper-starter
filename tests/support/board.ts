import { test as base } from "@playwright/test";
import { startBoard } from "../../examples/task-board/server";

export const test = base.extend({
  baseURL: async ({}, use) => {
    const board = await startBoard();
    try {
      await use(board.url);
    } finally {
      await board.close();
    }
  },
});
export { expect } from "@playwright/test";
