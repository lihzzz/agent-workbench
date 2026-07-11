import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";
import type { ChildProcess } from "child_process";
import { CodexRpcClient } from "@shared/lib/codex-rpc";

function createMockProcess(): ChildProcess & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough } {
  const proc = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.kill = (() => true) as ChildProcess["kill"];
  proc.killed = false;
  proc.exitCode = null;
  return proc;
}

describe("CodexRpcClient", () => {
  it("decodes UTF-8 characters split across stdout chunks", async () => {
    const proc = createMockProcess();
    const client = new CodexRpcClient(proc, {
      log: () => {},
      reportError: (_label, err) => err instanceof Error ? err.message : String(err),
    });

    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.onNotification = (msg) => resolve(msg.params);
    });

    const payload = Buffer.from(JSON.stringify({
      method: "test/notification",
      params: { text: "你好" },
    }) + "\n");
    const splitAt = payload.indexOf(Buffer.from("好")) + 1;
    proc.stdout.write(payload.subarray(0, splitAt));
    proc.stdout.write(payload.subarray(splitAt));

    await expect(received).resolves.toEqual({ text: "你好" });
  });
});
