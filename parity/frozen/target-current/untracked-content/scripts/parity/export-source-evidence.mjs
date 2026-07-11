import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_EXPECTED_BRANCH = "hy_dev";
const DEFAULT_EXPECTED_HEAD = "0e1dab7";
const DEFAULT_OUTPUT_DIR = path.join("parity", "source-evidence");

function parseArgs(argv) {
  const args = {
    sourceWorkspace: process.cwd(),
    outputDir: DEFAULT_OUTPUT_DIR,
    expectedBranch: DEFAULT_EXPECTED_BRANCH,
    expectedHead: DEFAULT_EXPECTED_HEAD,
    force: false,
    strictExpected: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--source-workspace") {
      args.sourceWorkspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-dir") {
      args.outputDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--expected-branch") {
      args.expectedBranch = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--expected-head") {
      args.expectedHead = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (arg === "--strict-expected") {
      args.strictExpected = true;
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

function run(command, commandArgs, options = {}) {
  try {
    const stdout = execFileSync(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      encoding: options.encoding ?? "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
    });

    return {
      status: "pass",
      command: renderCommand(command, commandArgs),
      cwd: options.cwd ?? process.cwd(),
      stdout: options.encoding === "buffer" ? "" : stdout.trim(),
      stderr: "",
    };
  } catch (error) {
    return {
      status: "fail",
      command: renderCommand(command, commandArgs),
      cwd: options.cwd ?? process.cwd(),
      exitCode: error.status ?? null,
      stdout: error.stdout?.toString().trim() ?? "",
      stderr: error.stderr?.toString().trim() ?? "",
    };
  }
}

function renderCommand(command, commandArgs) {
  return [command, ...commandArgs].map(shellQuote).join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolveRepoRoot(workspace) {
  const result = run("git", ["rev-parse", "--show-toplevel"], { cwd: workspace });
  if (result.status !== "pass" || !result.stdout) {
    throw new Error(`Workspace is not a git repository: ${workspace}`);
  }

  return path.resolve(result.stdout);
}

function getScriptPath(scriptName) {
  return path.join(getCurrentRepoRoot(), "scripts", "parity", scriptName);
}

function getCurrentRepoRoot() {
  const result = run("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
  return result.status === "pass" && result.stdout ? path.resolve(result.stdout) : process.cwd();
}

function isDirectoryEmpty(directoryPath) {
  if (!existsSync(directoryPath)) {
    return true;
  }

  return readdirSync(directoryPath).length === 0;
}

function prepareOutputDirectory(outputDir, force) {
  if (existsSync(outputDir) && !isDirectoryEmpty(outputDir)) {
    if (!force) {
      throw new Error(`Output directory exists and is not empty: ${outputDir}`);
    }

    rmSync(outputDir, { recursive: true, force: true });
  }

  mkdirSync(outputDir, { recursive: true });
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function describeFile(filePath) {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      path: filePath,
    };
  }

  const stats = statSync(filePath);
  return {
    exists: true,
    path: filePath,
    size: stats.size,
    sha256: sha256File(filePath),
  };
}

function inspectRepo(repoRoot, expectedBranch, expectedHead) {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
  const head = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const status = run("git", ["status", "--porcelain=v1"], { cwd: repoRoot });
  const packageVersion = readPackageVersion(repoRoot);
  const branchName = branch.status === "pass" ? branch.stdout : null;
  const headSha = head.status === "pass" ? head.stdout : null;

  return {
    repoRoot,
    branch: branchName,
    head: headSha,
    packageVersion,
    statusPorcelain: status.status === "pass" ? status.stdout.split("\n").filter(Boolean) : [],
    expected: {
      branch: expectedBranch,
      headPrefix: expectedHead,
      branchMatches: branchName === expectedBranch,
      headMatches: Boolean(headSha?.startsWith(expectedHead)),
    },
  };
}

function readPackageVersion(repoRoot) {
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

function createGitBundle(repoRoot, outputDir) {
  const bundlePath = path.join(outputDir, "source.bundle");
  const result = run("git", ["bundle", "create", bundlePath, "--all"], {
    cwd: repoRoot,
    timeoutMs: 120000,
  });

  return {
    result,
    artifact: describeFile(bundlePath),
  };
}

function runFreeze(repoRoot, outputDir) {
  const freezeDir = path.join(outputDir, "frozen", "source");
  const result = run(process.execPath, [
    getScriptPath("freeze-workspace.mjs"),
    "--workspace",
    repoRoot,
    "--label",
    "source",
    "--output",
    freezeDir,
  ]);

  return {
    result,
    freezeDir,
  };
}

function runSnapshotCollection(repoRoot, outputDir) {
  const snapshotDir = path.join(outputDir, "snapshots", "source");
  const result = run(process.execPath, [
    getScriptPath("collect-contract-snapshots.mjs"),
    "--workspace",
    repoRoot,
    "--target",
    "source",
    "--output-dir",
    snapshotDir,
  ]);

  return {
    result,
    snapshotDir,
  };
}

function createTar(outputDir, archiveName, cwd, entryName) {
  const archivePath = path.join(outputDir, archiveName);
  const result = run("tar", ["-cf", archivePath, "-C", cwd, entryName], {
    timeoutMs: 120000,
  });

  return {
    result,
    artifact: describeFile(archivePath),
  };
}

function listFilesRecursive(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files = [];

  function visit(directoryPath) {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push({
          path: relativePath,
          size: statSync(absolutePath).size,
          sha256: sha256File(absolutePath),
        });
      }
    }
  }

  visit(rootDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function buildImportCommand(outputDir) {
  return [
    "node scripts/parity/run-m0-pipeline.mjs",
    `--source-evidence-dir ${shellQuote(outputDir)}`,
    "--prepared-source-dir /path/to/prepared-source-harnss",
    "--force-source-freeze-import",
    "--force-source-snapshot-import",
  ].join(" \\\n  ");
}

function renderMarkdown(report) {
  const commandRows = report.commands
    .map((command) => `| ${command.status} | \`${command.command.replaceAll("|", "\\|")}\` | ${command.stderr ? `\`${command.stderr.replaceAll("|", "\\|")}\`` : ""} |`)
    .join("\n");
  const artifactRows = Object.entries(report.artifacts)
    .map(([name, artifact]) => `| ${name} | ${artifact?.exists ? "yes" : "no"} | ${artifact?.path ? `\`${artifact.path}\`` : ""} | ${artifact?.sha256 ? `\`${artifact.sha256}\`` : ""} |`)
    .join("\n");

  return `# Source Evidence Export

Status: \`${report.status}\`

Generated: ${report.generatedAt}

Source workspace: \`${report.source.repoRoot}\`

Branch: \`${report.source.branch}\`

HEAD: \`${report.source.head}\`

Expected branch: \`${report.source.expected.branch}\` (${report.source.expected.branchMatches ? "match" : "mismatch"})

Expected HEAD prefix: \`${report.source.expected.headPrefix}\` (${report.source.expected.headMatches ? "match" : "mismatch"})

Status entries: ${report.source.statusPorcelain.length}

## Artifacts

| Artifact | Exists | Path | SHA-256 |
|---|---|---|---|
${artifactRows}

## Import Command

\`\`\`bash
${report.importCommand}
\`\`\`

## Commands

| Result | Command | Notes |
|---|---|---|
${commandRows}
`;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReports(report, outputDir) {
  writeJson(path.join(outputDir, "source-evidence-manifest.json"), report);
  writeFileSync(path.join(outputDir, "README.md"), renderMarkdown(report));
}

function exportSourceEvidence() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRepoRoot = resolveRepoRoot(path.resolve(args.sourceWorkspace));
  const outputDir = path.resolve(args.outputDir);
  prepareOutputDirectory(outputDir, args.force);

  const source = inspectRepo(sourceRepoRoot, args.expectedBranch, args.expectedHead);
  const commands = [];

  const freeze = runFreeze(sourceRepoRoot, outputDir);
  commands.push(freeze.result);

  const snapshots = runSnapshotCollection(sourceRepoRoot, outputDir);
  commands.push(snapshots.result);

  const bundle = createGitBundle(sourceRepoRoot, outputDir);
  commands.push(bundle.result);

  const freezeArchive = createTar(outputDir, "source-freeze.tar", path.join(outputDir, "frozen"), "source");
  commands.push(freezeArchive.result);

  const snapshotArchive = createTar(outputDir, "source-snapshots.tar", path.join(outputDir, "snapshots"), "source");
  commands.push(snapshotArchive.result);

  const failedCommands = commands.filter((command) => command.status !== "pass");
  const expectedHeadMatches = source.expected.headMatches;
  const status = failedCommands.length > 0
    ? "failed"
    : expectedHeadMatches
      ? "exported"
      : "exported-with-mismatch";
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    platform: {
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
    },
    source,
    outputDir,
    artifacts: {
      bundle: bundle.artifact,
      freezeArchive: freezeArchive.artifact,
      snapshotArchive: snapshotArchive.artifact,
      freezeSummary: describeFile(path.join(freeze.freezeDir, "freeze-summary.json")),
      freezeManifest: describeFile(path.join(freeze.freezeDir, "manifest.json")),
      snapshotManifest: {
        exists: existsSync(snapshots.snapshotDir),
        path: snapshots.snapshotDir,
        files: listFilesRecursive(snapshots.snapshotDir),
      },
    },
    importCommand: buildImportCommand(outputDir),
    commands,
  };

  writeReports(report, outputDir);

  console.log(`Source evidence export: ${report.status}`);
  console.log(`Output: ${outputDir}`);

  if (report.status === "failed" || (args.strictExpected && report.status !== "exported")) {
    process.exitCode = 1;
  }
}

exportSourceEvidence();
