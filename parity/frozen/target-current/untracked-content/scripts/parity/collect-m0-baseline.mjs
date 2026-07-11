import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const EXPECTED_SOURCE_BRANCH = "hy_dev";
const EXPECTED_SOURCE_HEAD = "0e1dab7";
const SOURCE_CANDIDATE_PATHS = [
  "/Users/lihzz/PycharmProjects/code/harnss",
];
const TARGET_PATHS = [
  "src",
  "electron/src",
  "shared",
  "package.json",
  "pnpm-lock.yaml",
  "electron-builder.config.js",
  "vite.config.ts",
  "tsup.config.ts",
  "tsup.electron.config.ts",
];

const HOTSPOTS = [
  "src/hooks/useSessionManager.ts",
  "src/hooks/useEngineBase.ts",
  "src/hooks/session/useSessionPersistence.ts",
  "src/components/AppLayout.tsx",
  "src/components/AppSidebar.tsx",
  "src/components/SettingsView.tsx",
  "electron/src/preload.ts",
  "src/types/window.d.ts",
  "src/stores/settings-store.ts",
  "shared/lib/session-persistence.ts",
  "shared/types/engine.ts",
  "electron/src/ipc/sessions.ts",
  "src/components/ChatView.tsx",
  "pnpm-lock.yaml",
];

const LEDGER_ITEMS = [
  ["P01", "Logging governance", "logger and complete-event call sites for Claude/ACP/Codex"],
  ["P02", "File read/write and File Preview", "file:read, file:write, editor interactions, hardening"],
  ["P03", "Input history and archived preview", "history storage/search/refill and readonly archive rendering"],
  ["P04", "Session restore and persistence", "Space cold restore, delayed hydration, atomic writes, unload save"],
  ["P05", "Todo / Checklist", "status aliases, spinner semantics, main area and split wiring"],
  ["P06", "Long-session virtualization", "tail, overscan, measurement cache, search jump, UI state"],
  ["P07", "OpenCode engine", "binary/client/IPC/adapter/hook/lifecycle/settings"],
  ["P08", "Relay collaboration", "recipes, orchestration, handoff, UI, persistence"],
  ["P09", "Codex configured model fallback", "cwd config/read, dedupe, fallback, conservative capabilities"],
  ["P10", "Defaults and contracts", "Sidebar, Settings, store, preload, types, IPC, serialization"],
];

function parseArgs(argv) {
  const args = {
    sourceWorkspace: null,
    targetWorkspace: process.cwd(),
    outputDir: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--source-workspace") {
      args.sourceWorkspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--target-workspace") {
      args.targetWorkspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-dir") {
      args.outputDir = readArgValue(argv, ++index, arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function readArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function getRepoRoot(workspace) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getOutputBaseRepoRoot() {
  try {
    return getRepoRoot(process.cwd());
  } catch {
    return process.cwd();
  }
}

function resolveOptionalRepoRoot(workspace) {
  if (!workspace) {
    return null;
  }

  const absoluteWorkspace = path.resolve(workspace);
  if (!existsSync(absoluteWorkspace)) {
    return null;
  }

  try {
    return path.resolve(getRepoRoot(absoluteWorkspace));
  } catch {
    return null;
  }
}

function splitLines(output) {
  return output.split("\n").filter(Boolean);
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: targetRepoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 30000,
    }).trimEnd();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }

    const stderr = error.stderr?.toString().trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function runCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: targetRepoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 30000,
    }).trimEnd();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }

    const stderr = error.stderr?.toString().trim();
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function runGitIn(cwd, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 30000,
    }).trimEnd();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }

    const stderr = error.stderr?.toString().trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`);
  }
}

function hasGitObject(revision) {
  runGit(["cat-file", "-e", `${revision}^{commit}`], { allowFailure: true });
  return runGit(["cat-file", "-t", revision], { allowFailure: true }) === "commit";
}

function inspectSourceCandidates() {
  const candidatePaths = [
    ...(args.sourceWorkspace ? [args.sourceWorkspace] : []),
    ...SOURCE_CANDIDATE_PATHS,
  ];
  const uniqueCandidatePaths = [...new Set(candidatePaths.map((candidatePath) => path.resolve(candidatePath)))];

  return uniqueCandidatePaths.map((candidatePath) => {
    const exists = existsSync(candidatePath);
    const candidateRepoRoot = resolveOptionalRepoRoot(candidatePath);

    if (!exists || !candidateRepoRoot) {
      return {
        path: candidatePath,
        exists,
        git: Boolean(candidateRepoRoot),
      };
    }

    return {
      path: candidatePath,
      exists,
      git: true,
      repoRoot: candidateRepoRoot,
      branch: runGitIn(candidateRepoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || null,
      head: runGitIn(candidateRepoRoot, ["rev-parse", "HEAD"], { allowFailure: true }) || null,
      statusPorcelain: splitLines(runGitIn(candidateRepoRoot, ["status", "--porcelain=v1"], { allowFailure: true })),
    };
  });
}

function inspectSourceWorkspace() {
  if (!sourceRepoRoot) {
    return null;
  }

  return {
    requestedPath: args.sourceWorkspace ? path.resolve(args.sourceWorkspace) : null,
    repoRoot: sourceRepoRoot,
    branch: runGitIn(sourceRepoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || null,
    head: runGitIn(sourceRepoRoot, ["rev-parse", "HEAD"], { allowFailure: true }) || null,
    packageVersion: readPackageVersion(sourceRepoRoot),
    statusPorcelain: splitLines(runGitIn(sourceRepoRoot, ["status", "--porcelain=v1"], { allowFailure: true })),
    diffNameStatus: splitLines(runGitIn(sourceRepoRoot, ["diff", "--name-status", "HEAD", "--", ...TARGET_PATHS], { allowFailure: true })),
  };
}

function inspectImportedSourceFreeze() {
  const freezeDir = path.join(parityDir, "frozen", "source");
  const summaryPath = path.join(freezeDir, "freeze-summary.json");
  const manifestPath = path.join(freezeDir, "manifest.json");

  if (!existsSync(summaryPath) || !existsSync(manifestPath)) {
    return null;
  }

  const summary = readJson(summaryPath);
  const manifest = readJson(manifestPath);
  const requiredArtifactFiles = [
    "head.tar",
    "worktree.diff",
    "status-porcelain.txt",
    "untracked-files.txt",
    "manifest.json",
  ];
  const missingLocalFiles = requiredArtifactFiles.filter((fileName) => !existsSync(path.join(freezeDir, fileName)));
  const missingArtifacts = [
    ["headArchive", summary?.artifacts?.headArchive],
    ["binaryDiff", summary?.artifacts?.binaryDiff],
    ["statusPorcelain", summary?.artifacts?.statusPorcelain],
    ["untrackedFiles", summary?.artifacts?.untrackedFiles],
    ["manifest", summary?.artifacts?.manifest],
    ["codexSessionsPatch", summary?.artifacts?.codexSessionsPatch],
  ].filter(([, artifact]) => !artifact).map(([name]) => name);

  return {
    dir: freezeDir,
    summaryPath,
    manifestPath,
    branch: summary?.branch ?? null,
    head: summary?.head ?? null,
    statusCount: summary?.statusCount ?? null,
    manifestCount: summary?.manifestCount ?? null,
    manifestEntries: Array.isArray(manifest) ? manifest.length : null,
    missingLocalFiles,
    missingArtifacts,
    complete: missingLocalFiles.length === 0
      && missingArtifacts.length === 0
      && Boolean(summary?.head)
      && Array.isArray(manifest),
  };
}

function parseNameStatus(output) {
  if (!output) {
    return [];
  }

  return output.split("\n").filter(Boolean).map((line) => {
    const parts = line.split("\t");
    const status = parts[0];
    const filePath = parts.at(-1);
    const previousPath = parts.length > 2 ? parts[1] : undefined;

    return {
      path: filePath,
      previousPath,
      targetStatus: status,
      matrixClass: "source-pending",
      hotspot: HOTSPOTS.includes(filePath),
      requiredAction: "Compare against the frozen source snapshot before retaining behavior.",
    };
  });
}

function listFilesForManifest() {
  const trackedOutput = runGit(["ls-files", "--", ...TARGET_PATHS]);
  const untrackedOutput = runGit(["ls-files", "--others", "--exclude-standard", "--", ...TARGET_PATHS]);
  const files = new Set();

  for (const line of `${trackedOutput}\n${untrackedOutput}`.split("\n")) {
    if (!line) {
      continue;
    }

    const absolutePath = path.join(targetRepoRoot, line);
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
      files.add(line);
    }
  }

  return [...files].sort();
}

function hashFile(relativePath) {
  const data = readFileSync(path.join(targetRepoRoot, relativePath));
  return createHash("sha256").update(data).digest("hex");
}

function buildManifest() {
  return listFilesForManifest().map((filePath) => ({
    path: filePath,
    sha256: hashFile(filePath),
  }));
}

function getPackageManagerVersions() {
  return {
    node: runCommand("node", ["--version"], { allowFailure: true }),
    pnpm: runCommand("pnpm", ["--version"], { allowFailure: true }),
  };
}

function readPackageVersion(workspaceRoot) {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function buildSourceBaseline(nowIso) {
  const localBranchCommit = runGit(["rev-parse", "--verify", `${EXPECTED_SOURCE_BRANCH}^{commit}`], {
    allowFailure: true,
  });
  const remoteHeads = runGit(["ls-remote", "--heads", "origin", `${EXPECTED_SOURCE_BRANCH}*`], {
    allowFailure: true,
    timeoutMs: 15000,
  }).split("\n").filter(Boolean);
  const expectedCommitAvailable = hasGitObject(EXPECTED_SOURCE_HEAD);
  const sourceWorkspace = inspectSourceWorkspace();
  const sourceWorkspaceMatches = Boolean(sourceWorkspace?.head?.startsWith(EXPECTED_SOURCE_HEAD));
  const importedSourceFreeze = inspectImportedSourceFreeze();
  const importedSourceFreezeMatches = Boolean(
    importedSourceFreeze?.complete && importedSourceFreeze.head?.startsWith(EXPECTED_SOURCE_HEAD),
  );
  const status = sourceWorkspaceMatches || expectedCommitAvailable || importedSourceFreezeMatches
    ? "available"
    : sourceWorkspace
      ? "source-mismatch"
      : importedSourceFreeze
        ? "source-freeze-mismatch"
      : "source-unavailable";
  const missingM0Inputs = status === "available" ? [] : [
    ...(sourceWorkspace && !sourceWorkspaceMatches ? [`source workspace at expected head prefix ${EXPECTED_SOURCE_HEAD}`] : []),
    ...(importedSourceFreeze && !importedSourceFreezeMatches ? [`source freeze at expected head prefix ${EXPECTED_SOURCE_HEAD} with complete artifacts`] : []),
    "source HEAD archive",
    "source git diff --binary HEAD",
    "source untracked file list",
    "source git status --porcelain=v1",
    "source SHA-256 manifest",
    "electron/src/ipc/codex-sessions.ts source patch and patch SHA-256",
  ];

  return {
    generatedAt: nowIso,
    status,
    expected: {
      branch: EXPECTED_SOURCE_BRANCH,
      headPrefix: EXPECTED_SOURCE_HEAD,
    },
    evidence: {
      localBranchCommit: localBranchCommit || null,
      expectedCommitAvailable,
      remoteHeads,
      sourceWorkspace,
      importedSourceFreeze,
      sourceCandidates: inspectSourceCandidates(),
    },
    missingM0Inputs,
    note: "This file records source availability only until the frozen source workspace is imported.",
  };
}

function buildTargetBaseline(nowIso) {
  const manifest = buildManifest();
  const nameStatus = runGit(["diff", "--name-status", "HEAD", "--", ...TARGET_PATHS]);

  return {
    generatedAt: nowIso,
    repository: targetRepoRoot,
    branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    head: runGit(["rev-parse", "HEAD"]),
    packageVersion: readPackageVersion(targetRepoRoot),
    versions: getPackageManagerVersions(),
    statusPorcelain: splitLines(runGit(["status", "--porcelain=v1"])),
    diffNameStatus: splitLines(nameStatus),
    diffStat: splitLines(runGit(["diff", "--stat", "HEAD", "--", ...TARGET_PATHS])),
    manifest,
  };
}

function buildFileMatrix() {
  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: "source-pending",
    entries: parseNameStatus(runGit(["diff", "--name-status", "HEAD", "--", ...TARGET_PATHS])),
  };
}

function buildLedger() {
  const rows = LEDGER_ITEMS.map(([id, contract, focus]) => (
    `| ${id} | ${contract} | open | missing: frozen source snapshot not imported | ${focus} |`
  )).join("\n");

  return `# Parity Ledger

Generated by \`pnpm exec node scripts/parity/collect-m0-baseline.mjs\`.

The ledger is intentionally open. A P item can only be closed after the frozen source evidence,
target implementation commit, shared contract tests, manual scenario, cross-platform status, and
approved deviations are recorded.

| ID | Function contract | Status | Source evidence | Target validation focus |
|---|---|---|---|---|
${rows}
`;
}

const args = parseArgs(process.argv.slice(2));
const outputBaseRepoRoot = getOutputBaseRepoRoot();
const targetRepoRoot = path.resolve(getRepoRoot(path.resolve(args.targetWorkspace)));
const sourceRepoRoot = resolveOptionalRepoRoot(args.sourceWorkspace);
const nowIso = new Date().toISOString();
const parityDir = path.resolve(args.outputDir ?? path.join(outputBaseRepoRoot, "parity"));
mkdirSync(parityDir, { recursive: true });

writeFileSync(
  path.join(parityDir, "source-baseline.json"),
  `${JSON.stringify(buildSourceBaseline(nowIso), null, 2)}\n`,
);
writeFileSync(
  path.join(parityDir, "target-baseline.json"),
  `${JSON.stringify(buildTargetBaseline(nowIso), null, 2)}\n`,
);
writeFileSync(
  path.join(parityDir, "file-matrix.json"),
  `${JSON.stringify(buildFileMatrix(), null, 2)}\n`,
);
writeFileSync(path.join(parityDir, "parity-ledger.md"), buildLedger());

console.log(`Wrote M0 parity artifacts to ${path.relative(outputBaseRepoRoot, parityDir)}`);
