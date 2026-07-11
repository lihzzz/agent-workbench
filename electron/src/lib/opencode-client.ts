import net from "net";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { extractErrorMessage } from "./error-utils";
import { log } from "./logger";

export interface OpenCodeServerHandle {
  process: ChildProcessWithoutNullStreams;
  client: OpencodeClient;
  url: string;
  stderr: string;
  close: () => Promise<void>;
}

export async function allocateLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export async function terminateProcess(processHandle: ChildProcessWithoutNullStreams): Promise<void> {
  if (processHandle.exitCode !== null || processHandle.killed) return;
  if (process.platform === "win32" && processHandle.pid) {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], () => resolve());
    });
    return;
  }
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => processHandle.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

async function waitForServer(url: string, processHandle: ChildProcessWithoutNullStreams, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("OpenCode start canceled", "AbortError");
    if (processHandle.exitCode !== null) throw new Error(`OpenCode server exited before it became ready (${processHandle.exitCode})`);
    try {
      const response = await fetch(`${url}/path`, { signal });
      if (response.ok) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("OpenCode server start timed out after 20 seconds");
}

export async function startOpenCodeServer(options: {
  binaryPath: string;
  cwd: string;
  signal: AbortSignal;
}): Promise<OpenCodeServerHandle> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await allocateLoopbackPort();
    const url = `http://127.0.0.1:${port}`;
    const processHandle = spawn(options.binaryPath, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    processHandle.stdout.on("data", (chunk: Buffer) => log("OPENCODE_SERVER", chunk.toString().trim()));
    processHandle.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_384);
      log("OPENCODE_SERVER_ERR", chunk.toString().trim());
    });

    try {
      await waitForServer(url, processHandle, options.signal);
      const { createOpencodeClient } = await import("@opencode-ai/sdk");
      const client = createOpencodeClient({ baseUrl: url, directory: options.cwd });
      return {
        process: processHandle,
        client,
        url,
        get stderr() { return stderr; },
        close: () => terminateProcess(processHandle),
      };
    } catch (error) {
      lastError = error;
      await terminateProcess(processHandle);
      if (options.signal.aborted) throw error;
      if (!stderr.includes("EADDRINUSE") && !extractErrorMessage(error).includes("EADDRINUSE")) throw error;
    }
  }
  throw new Error(`OpenCode failed to bind a local port: ${extractErrorMessage(lastError)}`);
}
