import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(tempPath, targetPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES")) {
      throw error;
    }
  }

  const backupPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.bak`;
  await fs.rename(targetPath, backupPath);
  try {
    await fs.rename(tempPath, targetPath);
    await fs.unlink(backupPath).catch(() => undefined);
  } catch (error) {
    await fs.rename(backupPath, targetPath).catch(() => undefined);
    throw error;
  }
}

export async function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
  mode?: number,
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, content, { flag: "wx", mode });
    await replaceFile(tempPath, filePath);
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

export class KeyedFileQueue {
  private readonly pending = new Map<string, Promise<void>>();

  run<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(filePath) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(() => undefined, () => undefined);
    this.pending.set(filePath, settled);
    void settled.finally(() => {
      if (this.pending.get(filePath) === settled) this.pending.delete(filePath);
    });
    return result;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()]);
  }
}
