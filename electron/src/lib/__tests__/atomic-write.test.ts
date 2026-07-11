import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFile, KeyedFileQueue } from "../atomic-write";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("atomic file writes", () => {
  it("replaces a file without leaving temporary files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "harnss-atomic-"));
    tempDirs.push(root);
    const target = path.join(root, "session.json");
    await atomicWriteFile(target, JSON.stringify({ generation: 1 }));
    await atomicWriteFile(target, JSON.stringify({ generation: 2 }));
    expect(JSON.parse(await readFile(target, "utf-8"))).toEqual({ generation: 2 });
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("serializes operations for the same path", async () => {
    const queue = new KeyedFileQueue();
    const order: number[] = [];
    const first = queue.run("session", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(1);
    });
    const second = queue.run("session", async () => {
      order.push(2);
    });
    await Promise.all([first, second]);
    await queue.flush();
    expect(order).toEqual([1, 2]);
  });
});
