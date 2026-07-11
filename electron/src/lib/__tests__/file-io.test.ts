import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_FILE_READ_BYTES, readTextFile, writeTextFile } from "../file-io";

const tempDirs: string[] = [];

async function createFixture(): Promise<{ root: string; filePath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harnss-file-io-"));
  tempDirs.push(root);
  const filePath = path.join(root, "notes.txt");
  await writeFile(filePath, "before", "utf-8");
  return { root, filePath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file I/O protection", () => {
  it("reads a bounded text file asynchronously", async () => {
    const { filePath } = await createFixture();
    await expect(readTextFile(filePath)).resolves.toMatchObject({ content: "before", size: 6 });
  });

  it("rejects oversized reads and writes", async () => {
    const { root, filePath } = await createFixture();
    await writeFile(filePath, "x".repeat(MAX_FILE_READ_BYTES + 1), "utf-8");
    await expect(readTextFile(filePath)).rejects.toThrow("File too large");
    await expect(writeTextFile({
      filePath,
      projectRoot: root,
      content: "x".repeat(MAX_FILE_READ_BYTES + 1),
    })).rejects.toThrow("File too large");
  });

  it("atomically replaces text and detects external modifications", async () => {
    const { root, filePath } = await createFixture();
    const initial = await readTextFile(filePath);
    await writeTextFile({ filePath, projectRoot: root, content: "after", expectedMtimeMs: initial.mtimeMs });
    expect(await readFile(filePath, "utf-8")).toBe("after");

    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(filePath, "external", "utf-8");
    await expect(writeTextFile({
      filePath,
      projectRoot: root,
      content: "stale",
      expectedMtimeMs: initial.mtimeMs,
    })).rejects.toThrow("changed on disk");
  });

  it("rejects paths and symlinks outside the project", async () => {
    const { root } = await createFixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "harnss-file-outside-"));
    tempDirs.push(outside);
    const outsideFile = path.join(outside, "outside.txt");
    await writeFile(outsideFile, "outside", "utf-8");
    await expect(writeTextFile({ filePath: outsideFile, projectRoot: root, content: "no" }))
      .rejects.toThrow("outside project");

    const linkDir = path.join(root, "links");
    await mkdir(linkDir);
    const link = path.join(linkDir, "outside.txt");
    await symlink(outsideFile, link);
    await expect(writeTextFile({ filePath: link, projectRoot: root, content: "no" }))
      .rejects.toThrow("resolves outside");
  });

  it("rejects binary content", async () => {
    const { root, filePath } = await createFixture();
    await expect(writeTextFile({ filePath, projectRoot: root, content: "a\0b" }))
      .rejects.toThrow("Binary files");
  });
});
