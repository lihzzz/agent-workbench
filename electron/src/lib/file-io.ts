import path from "path";
import { promises as fs } from "fs";
import { atomicWriteFile } from "./atomic-write";

export const MAX_FILE_READ_BYTES = 500_000;

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertWritableProjectFile(filePath: string, projectRoot: string): Promise<{
  resolvedPath: string;
  stat: Awaited<ReturnType<typeof fs.stat>>;
}> {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedRoot || !resolvedPath || resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error("Invalid project root");
  }
  if (!isPathInside(resolvedRoot, resolvedPath)) {
    throw new Error("Path outside project directory");
  }

  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(resolvedRoot),
    fs.realpath(resolvedPath),
  ]);
  if (!isPathInside(realRoot, realTarget)) {
    throw new Error("Path resolves outside project directory");
  }

  const stat = await fs.stat(realTarget);
  if (!stat.isFile()) throw new Error("Path is not a file");
  return { resolvedPath: realTarget, stat };
}

function containsNullByte(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8_192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

export async function readTextFile(filePath: string): Promise<{
  content: string;
  mtimeMs: number;
  size: number;
}> {
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath || resolvedPath === path.parse(resolvedPath).root) {
    throw new Error("Invalid file path");
  }
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw new Error("Path is not a file");
  if (stat.size > MAX_FILE_READ_BYTES) throw new Error("File too large (max 500KB)");
  const content = await fs.readFile(resolvedPath, "utf-8");
  return { content, mtimeMs: stat.mtimeMs, size: stat.size };
}

export async function writeTextFile(options: {
  filePath: string;
  projectRoot: string;
  content: string;
  expectedMtimeMs?: number;
}): Promise<{ mtimeMs: number; size: number }> {
  const contentBuffer = Buffer.from(options.content, "utf-8");
  if (contentBuffer.length > MAX_FILE_READ_BYTES) {
    throw new Error("File too large (max 500KB)");
  }
  if (containsNullByte(contentBuffer)) throw new Error("Binary files cannot be edited");

  const { resolvedPath, stat } = await assertWritableProjectFile(options.filePath, options.projectRoot);
  if (stat.size > MAX_FILE_READ_BYTES) throw new Error("File too large (max 500KB)");
  if (options.expectedMtimeMs !== undefined && Math.abs(stat.mtimeMs - options.expectedMtimeMs) > 0.5) {
    throw new Error("File changed on disk. Reload it before saving.");
  }

  const existing = await fs.readFile(resolvedPath);
  if (containsNullByte(existing)) throw new Error("Binary files cannot be edited");

  await atomicWriteFile(resolvedPath, contentBuffer, stat.mode);

  const updated = await fs.stat(resolvedPath);
  return { mtimeMs: updated.mtimeMs, size: updated.size };
}
