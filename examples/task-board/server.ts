import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface Task { id: string; title: string; completed: boolean }

function send(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function readBody(request: IncomingMessage) {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 2048) throw new Error("Request too large");
  }
  return JSON.parse(body);
}

/** Each instance owns its data. Parallel tests may start independent servers on port zero. */
export async function startBoard(port = 0) {
  const html = readFileSync(path.join(__dirname, "index.html"));
  const tasks = new Map<string, Task>();
  const server = createServer(async (request, response) => {
    const url = request.url;
    if (request.method === "GET" && url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (url === "/api/tasks" && request.method === "GET") {
      return send(response, 200, [...tasks.values()]);
    }
    try {
      if (url === "/api/tasks" && request.method === "POST") {
        const { title } = await readBody(request);
        if (typeof title !== "string" || !title.trim() || title.trim().length > 100)
          return send(response, 400, { error: "Enter a task of 1 to 100 characters." });
        const task = { id: randomUUID(), title: title.trim(), completed: false };
        tasks.set(task.id, task);
        return send(response, 201, task);
      }
      const id = /^\/api\/tasks\/([\w-]+)$/.exec(url ?? "")?.[1];
      const task = id && tasks.get(id);
      if (task && request.method === "PATCH") {
        const { completed } = await readBody(request);
        if (typeof completed !== "boolean") return send(response, 400, { error: "Expected a boolean." });
        task.completed = completed;
        return send(response, 200, task);
      }
      if (task && request.method === "DELETE") {
        tasks.delete(task.id);
        response.writeHead(204).end();
        return;
      }
      send(response, 404, { error: "Unknown resource." });
    } catch {
      send(response, 400, { error: "Invalid JSON request." });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

if (require.main === module) {
  startBoard(4173).then(board => console.log(board.url)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
