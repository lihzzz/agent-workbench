import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const CODEX_PATCH_PATH = "electron/src/ipc/codex-sessions.ts";
const GENERATED_FREEZE_PREFIX = "parity/frozen";

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    label: "workspace",
    output: null,
    skipArchive: false,
    skipUntrackedContent: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--workspace") {
      args.workspace = argv[++index];
    } else if (arg === "--label") {
      args.label = argv[++index];
    } else if (arg === "--output") {
      args.output = argv[++index];
    } else if (arg === "--skip-archive") {
      args.skipArchive = true;
    } else if (arg === "--skip-untracked-content") {
      args.skipUntrackedContent = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function runGit(repoRoot, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: options.encoding ?? "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
    });
  } catch (error) {
    if (options.allowFailure) {
      return options.encoding === "buffer" ? Buffer.alloc(0) : "";
    }

    const stderr = error.stderr?.toString().trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function resolveRepoRoot(workspace) {
  const root = runGit(workspace, ["rev-parse", "--show-toplevel"]).trim();
  return path.resolve(root);
}

function listGitFiles(repoRoot, args) {
  const output = runGit(repoRoot, [...args, "-z"]);
  return output.split("\0").filter(Boolean).sort();
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function getOutputRelativePrefix(repoRoot, outputDir) {
  const relative = path.relative(repoRoot, outputDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return toPosixPath(relative);
}

function shouldExcludeFromFreeze(relativePath, outputRelativePrefix) {
  if (relativePath === GENERATED_FREEZE_PREFIX || relativePath.startsWith(`${GENERATED_FREEZE_PREFIX}/`)) {
    return true;
  }

  if (!outputRelativePrefix) {
    return false;
  }

  return relativePath === outputRelativePrefix || relativePath.startsWith(`${outputRelativePrefix}/`);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hashFile(absolutePath) {
  return sha256(readFileSync(absolutePath));
}

function getPackageVersion(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function writeTextArtifact(outputDir, fileName, contents) {
  const filePath = path.join(outputDir, fileName);
  writeFileSync(filePath, contents.endsWith("\n") ? contents : `${contents}\n`);
  return describeArtifact(filePath);
}

function writeBufferArtifact(outputDir, fileName, contents) {
  const filePath = path.join(outputDir, fileName);
  writeFileSync(filePath, contents);
  return describeArtifact(filePath);
}

function describeArtifact(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  const stats = lstatSync(filePath);
  return {
    path: filePath,
    size: stats.size,
    sha256: hashFile(filePath),
  };
}

function createHeadArchive(repoRoot, outputDir, skipArchive) {
  if (skipArchive) {
    return { skipped: true };
  }

  const archivePath = path.join(outputDir, "head.tar");
  execFileSync("git", ["archive", "--format=tar", "--output", archivePath, "HEAD"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });

  return describeArtifact(archivePath);
}

function collectManifest(repoRoot, trackedFiles, untrackedFiles, outputRelativePrefix) {
  const allFiles = [
    ...trackedFiles.map((filePath) => ({ path: filePath, source: "tracked" })),
    ...untrackedFiles.map((filePath) => ({ path: filePath, source: "untracked" })),
  ].filter((entry) => !shouldExcludeFromFreeze(entry.path, outputRelativePrefix));

  return allFiles.map((entry) => {
    const absolutePath = path.join(repoRoot, entry.path);
    if (!existsSync(absolutePath)) {
      return {
        ...entry,
        type: "missing",
      };
    }

    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      return {
        ...entry,
        type: "symlink",
        mode: stats.mode,
        linkTarget: readlinkSync(absolutePath),
      };
    }

    if (!stats.isFile()) {
      return {
        ...entry,
        type: stats.isDirectory() ? "directory" : "other",
        mode: stats.mode,
      };
    }

    return {
      ...entry,
      type: "file",
      size: stats.size,
      mode: stats.mode,
      sha256: hashFile(absolutePath),
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function copyUntrackedContent(repoRoot, outputDir, untrackedFiles, outputRelativePrefix, skipUntrackedContent) {
  if (skipUntrackedContent) {
    return { skipped: true };
  }

  const contentDir = path.join(outputDir, "untracked-content");
  rmSync(contentDir, { recursive: true, force: true });

  let copied = 0;
  for (const relativePath of untrackedFiles) {
    if (shouldExcludeFromFreeze(relativePath, outputRelativePrefix)) {
      continue;
    }

    const sourcePath = path.join(repoRoot, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const targetPath = path.join(contentDir, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    const stats = lstatSync(sourcePath);
    if (stats.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), targetPath);
      copied += 1;
    } else if (stats.isFile()) {
      copyFileSync(sourcePath, targetPath);
      copied += 1;
    }
  }

  return {
    path: contentDir,
    copied,
  };
}

function buildFreezeSummary(repoRoot, label, outputDir, artifacts, manifest, untrackedContent) {
  const statusPorcelain = runGit(repoRoot, ["status", "--porcelain=v1"]).trim().split("\n").filter(Boolean);
  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const head = runGit(repoRoot, ["rev-parse", "HEAD"]).trim();

  return {
    generatedAt: new Date().toISOString(),
    label,
    repoRoot,
    outputDir,
    branch,
    head,
    packageVersion: getPackageVersion(repoRoot),
    statusCount: statusPorcelain.length,
    manifestCount: manifest.length,
    untrackedContent,
    artifacts,
  };
}

function freezeWorkspace() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = path.resolve(args.workspace);
  const repoRoot = resolveRepoRoot(workspace);
  const outputDir = path.resolve(args.output ?? path.join(repoRoot, "parity", "frozen", args.label));
  const outputRelativePrefix = getOutputRelativePrefix(repoRoot, outputDir);

  mkdirSync(outputDir, { recursive: true });

  const trackedFiles = listGitFiles(repoRoot, ["ls-files"]);
  const untrackedFiles = listGitFiles(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  const filteredUntrackedFiles = untrackedFiles.filter((filePath) =>
    !shouldExcludeFromFreeze(filePath, outputRelativePrefix),
  );

  const status = runGit(repoRoot, ["status", "--porcelain=v1"]);
  const binaryDiff = runGit(repoRoot, ["diff", "--binary", "HEAD"], { encoding: "buffer" });
  const codexPatch = runGit(repoRoot, ["diff", "--binary", "HEAD", "--", CODEX_PATCH_PATH], { encoding: "buffer" });
  const manifest = collectManifest(repoRoot, trackedFiles, untrackedFiles, outputRelativePrefix);
  const untrackedContent = copyUntrackedContent(
    repoRoot,
    outputDir,
    filteredUntrackedFiles,
    outputRelativePrefix,
    args.skipUntrackedContent,
  );

  const artifacts = {
    headArchive: createHeadArchive(repoRoot, outputDir, args.skipArchive),
    binaryDiff: writeBufferArtifact(outputDir, "worktree.diff", binaryDiff),
    codexSessionsPatch: codexPatch.length > 0
      ? writeBufferArtifact(outputDir, "codex-sessions.diff", codexPatch)
      : null,
    statusPorcelain: writeTextArtifact(outputDir, "status-porcelain.txt", status),
    untrackedFiles: writeTextArtifact(outputDir, "untracked-files.txt", filteredUntrackedFiles.join("\n")),
    manifest: writeTextArtifact(outputDir, "manifest.json", JSON.stringify(manifest, null, 2)),
  };

  const summary = buildFreezeSummary(repoRoot, args.label, outputDir, artifacts, manifest, untrackedContent);
  writeTextArtifact(outputDir, "freeze-summary.json", JSON.stringify(summary, null, 2));

  console.log(`Frozen ${args.label} workspace to ${outputDir}`);
  console.log(`Manifest entries: ${manifest.length}`);
  console.log(`Status entries: ${summary.statusCount}`);
}

freezeWorkspace();
