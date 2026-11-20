import { spawn } from "node:child_process";
import { startBoard } from "../task-board/server";

async function main() {
  const board = await startBoard();
  try {
    const child = spawn("k6", ["run", "--no-usage-report", "examples/load/tasks.js"], {
      shell: false, stdio: "inherit", env: { ...process.env, TASK_BOARD_URL: board.url },
    });
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => resolve(code ?? 1));
    });
  } finally {
    await board.close();
  }
}

main().catch(error => {
  console.error(error.code === "ENOENT" ? "Install k6 and add its executable to PATH." : error.message);
  process.exitCode = 1;
});
