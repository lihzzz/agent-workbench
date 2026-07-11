import { Buffer } from "buffer";
import { gitExec } from "../git-exec";
import { RemotePathAuthorizer } from "../remote/remote-path-authorizer";
import type {
  RemoteDiffFilePayload,
  RemoteDiffFileResult,
  RemoteDiffSummary,
  RemoteGitFileChange,
  RemotePathRef,
} from "@shared/types/remote";

const DEFAULT_MAX_DIFF_BYTES = 512 * 1024;

function parseStatus(raw: string): {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: RemoteGitFileChange[];
} {
  let branch: string | undefined;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  const files: RemoteGitFileChange[] = [];
  const statusMap: Record<string, string> = {
    M: "modified",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    U: "unmerged",
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        ahead = Number.parseInt(match[1], 10);
        behind = Number.parseInt(match[2], 10);
      }
      continue;
    }
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const isRename = line.startsWith("2 ");
      let filePath: string;
      let oldPath: string | undefined;
      if (isRename) {
        const rest = parts.slice(8).join(" ");
        const tabParts = rest.split("\t");
        filePath = tabParts[0] ?? "";
        oldPath = tabParts[1];
      } else {
        filePath = parts.slice(8).join(" ");
      }

      const staged = xy[0];
      const unstaged = xy[1];
      if (staged !== "." && staged !== "?") {
        files.push({
          path: filePath,
          oldPath: isRename ? oldPath : undefined,
          status: statusMap[staged] ?? "modified",
          group: "staged",
        });
      }
      if (unstaged !== "." && unstaged !== "?") {
        files.push({
          path: filePath,
          status: statusMap[unstaged] ?? "modified",
          group: "unstaged",
        });
      }
      continue;
    }
    if (line.startsWith("u ")) {
      const parts = line.split(" ");
      files.push({ path: parts.slice(10).join(" "), status: "unmerged", group: "unstaged" });
      continue;
    }
    if (line.startsWith("? ")) {
      files.push({ path: line.slice(2), status: "untracked", group: "untracked" });
    }
  }

  return { branch, upstream, ahead, behind, files };
}

function parseShortStat(raw: string): { additions: number; deletions: number } {
  const insertions = raw.match(/(\d+) insertion/);
  const deletions = raw.match(/(\d+) deletion/);
  return {
    additions: insertions ? Number.parseInt(insertions[1], 10) : 0,
    deletions: deletions ? Number.parseInt(deletions[1], 10) : 0,
  };
}

function truncateByUtf8Bytes(value: string, maxBytes: number): { value: string; truncated: boolean; sizeBytes: number } {
  const sizeBytes = Buffer.byteLength(value, "utf-8");
  if (sizeBytes <= maxBytes) return { value, truncated: false, sizeBytes };
  let bytes = 0;
  let index = 0;
  for (const char of value) {
    const nextBytes = Buffer.byteLength(char, "utf-8");
    if (bytes + nextBytes > maxBytes) break;
    bytes += nextBytes;
    index += char.length;
  }
  return { value: value.slice(0, index), truncated: true, sizeBytes };
}

function looksBinaryDiff(diff: string): boolean {
  return diff.includes("Binary files ") || diff.includes("GIT binary patch");
}

export class RestrictedGitService {
  constructor(
    private readonly authorizer = new RemotePathAuthorizer(),
    private readonly maxDiffBytes = DEFAULT_MAX_DIFF_BYTES,
  ) {}

  async status(pathRef: RemotePathRef): Promise<RemoteDiffSummary> {
    const authorized = this.authorizer.authorize(pathRef);
    const raw = await gitExec(["status", "--porcelain=v2", "--branch"], authorized.repoRoot);
    const status = parseStatus(raw);
    return {
      branch: status.branch,
      files: status.files,
      additions: 0,
      deletions: 0,
    };
  }

  async diffSummary(pathRef: RemotePathRef): Promise<RemoteDiffSummary> {
    const authorized = this.authorizer.authorize(pathRef);
    const [statusRaw, unstagedRaw, stagedRaw] = await Promise.all([
      gitExec(["status", "--porcelain=v2", "--branch"], authorized.repoRoot),
      gitExec(["diff", "--shortstat"], authorized.repoRoot).catch(() => ""),
      gitExec(["diff", "--cached", "--shortstat"], authorized.repoRoot).catch(() => ""),
    ]);
    const status = parseStatus(statusRaw);
    const unstaged = parseShortStat(unstagedRaw);
    const staged = parseShortStat(stagedRaw);
    return {
      branch: status.branch,
      files: status.files,
      additions: unstaged.additions + staged.additions,
      deletions: unstaged.deletions + staged.deletions,
    };
  }

  async diffFile(payload: RemoteDiffFilePayload): Promise<RemoteDiffFileResult> {
    const authorized = this.authorizer.authorize(payload.path);
    if (!authorized.relativePath) {
      throw new Error("relativePath is required for diff.file");
    }
    const diffArgs = payload.staged
      ? ["diff", "--staged", "--", authorized.relativePath]
      : ["diff", "--", authorized.relativePath];
    const diff = await gitExec(diffArgs, authorized.repoRoot);
    const truncated = truncateByUtf8Bytes(diff, this.maxDiffBytes);
    return {
      path: authorized.relativePath,
      diff: truncated.value,
      staged: !!payload.staged,
      binary: looksBinaryDiff(diff),
      truncated: truncated.truncated,
      sizeBytes: truncated.sizeBytes,
    };
  }
}
