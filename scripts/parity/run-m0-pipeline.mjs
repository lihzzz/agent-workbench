import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const OUTPUT_JSON = path.join("parity", "m0-pipeline.json");
const OUTPUT_MD = path.join("parity", "m0-pipeline.md");
const MAX_CAPTURE_LENGTH = 12000;

function parseArgs(argv) {
  const args = {
    sourceWorkspace: null,
    sourceEvidenceDir: null,
    sourceBundle: null,
    sourceFreezeDir: null,
    sourceFreezeArchive: null,
    sourceSnapshotDir: null,
    sourceSnapshotArchive: null,
    preparedSourceDir: null,
    sourceCheckoutRef: null,
    targetWorkspace: process.cwd(),
    forceSourcePrepare: false,
    forceSourceFreezeImport: false,
    forceSourceSnapshotImport: false,
    strict: false,
    strictM0: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--source-workspace") {
      args.sourceWorkspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-evidence-dir") {
      args.sourceEvidenceDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-bundle") {
      args.sourceBundle = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-freeze-dir") {
      args.sourceFreezeDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-freeze-archive") {
      args.sourceFreezeArchive = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-snapshot-dir") {
      args.sourceSnapshotDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-snapshot-archive") {
      args.sourceSnapshotArchive = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--prepared-source-dir") {
      args.preparedSourceDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-checkout-ref") {
      args.sourceCheckoutRef = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--target-workspace") {
      args.targetWorkspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--force-source-prepare") {
      args.forceSourcePrepare = true;
      continue;
    }

    if (arg === "--force-source-freeze-import") {
      args.forceSourceFreezeImport = true;
      continue;
    }

    if (arg === "--force-source-snapshot-import") {
      args.forceSourceSnapshotImport = true;
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--strict-m0") {
      args.strictM0 = true;
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

function truncateText(value) {
  if (!value) {
    return "";
  }

  if (value.length <= MAX_CAPTURE_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_CAPTURE_LENGTH)}\n...[truncated ${value.length - MAX_CAPTURE_LENGTH} chars]`;
}

function runCommand(repoRoot, label, args, options = {}) {
  const command = process.execPath;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const stdout = execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: options.timeoutMs ?? 120000,
    });

    return {
      label,
      status: "pass",
      startedAt,
      durationMs: Date.now() - startMs,
      command: renderCommand(command, args),
      stdout: truncateText(stdout.trim()),
      stderr: "",
    };
  } catch (error) {
    return {
      label,
      status: options.allowFailure ? "expected-fail" : "fail",
      startedAt,
      durationMs: Date.now() - startMs,
      command: renderCommand(command, args),
      exitCode: error.status ?? null,
      stdout: truncateText(error.stdout?.toString().trim() ?? ""),
      stderr: truncateText(error.stderr?.toString().trim() ?? ""),
    };
  }
}

function skippedStep(label, reason) {
  return {
    label,
    status: "skipped",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    command: null,
    reason,
    stdout: "",
    stderr: "",
  };
}

function renderCommand(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function renderMarkdown(report) {
  const rows = report.steps
    .map((step) => `| ${step.status} | ${step.label} | ${step.command ? `\`${step.command.replaceAll("|", "\\|")}\`` : step.reason} |`)
    .join("\n");

  return `# M0 Pipeline

Status: \`${report.status}\`

Generated: ${report.generatedAt}

| Result | Step | Command / Reason |
|---|---|---|
${rows}
`;
}

function writeReport(report) {
  writeJson(OUTPUT_JSON, report);
  mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
  writeFileSync(OUTPUT_MD, renderMarkdown(report));
}

function resolveSourceEvidenceDir(sourceEvidenceDir) {
  if (!sourceEvidenceDir) {
    return {
      status: "not-provided",
      dir: null,
      manifestPath: null,
      manifestStatus: "not-provided",
      paths: {},
      missing: [],
    };
  }

  const dir = path.resolve(sourceEvidenceDir);
  const manifestPath = path.join(dir, "source-evidence-manifest.json");
  const paths = {
    sourceBundle: path.join(dir, "source.bundle"),
    sourceFreezeArchive: path.join(dir, "source-freeze.tar"),
    sourceSnapshotArchive: path.join(dir, "source-snapshots.tar"),
  };
  const missing = Object.entries(paths)
    .filter(([, filePath]) => !existsSync(filePath))
    .map(([name, filePath]) => ({ name, path: filePath }));
  const manifest = readJson(manifestPath);

  return {
    status: missing.length === 0 ? "available" : "incomplete",
    dir,
    manifestPath,
    manifestStatus: manifest ? "present" : "missing",
    manifestHead: manifest?.source?.head ?? null,
    manifestStatusValue: manifest?.status ?? null,
    paths,
    missing,
  };
}

function buildPipeline() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(getRepoRoot(process.cwd()));
  const targetRepoRoot = path.resolve(getRepoRoot(path.resolve(args.targetWorkspace)));
  const steps = [];

  const script = (name) => path.join(repoRoot, "scripts", "parity", name);
  const sourceEvidence = resolveSourceEvidenceDir(args.sourceEvidenceDir);
  const effectiveSourceBundle = args.sourceBundle ?? (
    sourceEvidence.status === "available" ? sourceEvidence.paths.sourceBundle : null
  );
  const effectiveSourceFreezeArchive = args.sourceFreezeArchive ?? (
    sourceEvidence.status === "available" ? sourceEvidence.paths.sourceFreezeArchive : null
  );
  const effectiveSourceSnapshotArchive = args.sourceSnapshotArchive ?? (
    sourceEvidence.status === "available" ? sourceEvidence.paths.sourceSnapshotArchive : null
  );

  steps.push(runCommand(repoRoot, "prepare source workspace", [
    script("prepare-source-workspace.mjs"),
    ...(effectiveSourceBundle ? ["--source-bundle", effectiveSourceBundle] : []),
    ...(args.preparedSourceDir ? ["--output-workspace", args.preparedSourceDir] : []),
    ...(args.sourceCheckoutRef ? ["--checkout-ref", args.sourceCheckoutRef] : []),
    ...(args.forceSourcePrepare ? ["--force"] : []),
  ]));

  steps.push(runCommand(repoRoot, "import source freeze", [
    script("import-source-freeze.mjs"),
    ...(args.sourceFreezeDir ? ["--source-freeze-dir", args.sourceFreezeDir] : []),
    ...(effectiveSourceFreezeArchive ? ["--source-freeze-archive", effectiveSourceFreezeArchive] : []),
    "--output-dir",
    path.join(repoRoot, "parity", "frozen", "source"),
    ...(args.forceSourceFreezeImport ? ["--force"] : []),
  ]));

  steps.push(runCommand(repoRoot, "import source contract snapshots", [
    script("import-source-snapshots.mjs"),
    ...(args.sourceSnapshotDir ? ["--source-snapshot-dir", args.sourceSnapshotDir] : []),
    ...(effectiveSourceSnapshotArchive ? ["--source-snapshot-archive", effectiveSourceSnapshotArchive] : []),
    "--output-dir",
    path.join(repoRoot, "parity", "snapshots", "source"),
    ...(args.forceSourceSnapshotImport ? ["--force"] : []),
  ]));

  const sourceIntake = readJson(path.join(repoRoot, "parity", "source-intake.json"));
  const sourceFreezeIntake = readJson(path.join(repoRoot, "parity", "source-freeze-intake.json"));
  const sourceSnapshotIntake = readJson(path.join(repoRoot, "parity", "source-snapshot-intake.json"));
  const preparedSourceWorkspace = sourceIntake?.status === "prepared"
    ? sourceIntake.preparedWorkspace?.repoRoot ?? null
    : null;
  const effectiveSourceWorkspace = preparedSourceWorkspace ?? args.sourceWorkspace;
  const sourceRepoRoot = resolveOptionalRepoRoot(effectiveSourceWorkspace);
  const sourceFreezeImported = sourceFreezeIntake?.status === "imported";
  const sourceFreezeDir = path.join(repoRoot, "parity", "frozen", "source");
  const sourceFreezeAvailable = sourceFreezeImported
    || existsSync(path.join(sourceFreezeDir, "freeze-summary.json"));
  const sourceSnapshotDir = path.join(repoRoot, "parity", "snapshots", "source");
  const sourceSnapshotsImported = sourceSnapshotIntake?.status === "imported";
  const sourceSnapshotsAvailable = sourceSnapshotsImported || hasContractSnapshots(sourceSnapshotDir);

  steps.push(runCommand(repoRoot, "resolve source workspace", [
    script("resolve-source-workspace.mjs"),
    ...(effectiveSourceWorkspace ? ["--source-workspace", effectiveSourceWorkspace] : []),
  ]));

  steps.push(runCommand(repoRoot, "freeze target workspace", [
    script("freeze-workspace.mjs"),
    "--workspace",
    targetRepoRoot,
    "--label",
    "target-current",
    "--output",
    path.join(repoRoot, "parity", "frozen", "target-current"),
  ]));

  if (effectiveSourceWorkspace && sourceRepoRoot) {
    steps.push(runCommand(repoRoot, "freeze source workspace", [
      script("freeze-workspace.mjs"),
      "--workspace",
      sourceRepoRoot,
      "--label",
      "source",
      "--output",
      sourceFreezeDir,
    ]));
  } else if (sourceFreezeAvailable) {
    steps.push(skippedStep("freeze source workspace", "source freeze artifact is already available"));
  } else if (effectiveSourceWorkspace) {
    steps.push(skippedStep("freeze source workspace", `source workspace is not a git repository or does not exist: ${effectiveSourceWorkspace}`));
  } else {
    steps.push(skippedStep("freeze source workspace", "no source workspace available from --source-bundle or --source-workspace, and no source freeze was imported"));
  }

  steps.push(runCommand(repoRoot, "collect M0 baseline", [
    script("collect-m0-baseline.mjs"),
    "--target-workspace",
    targetRepoRoot,
    "--output-dir",
    path.join(repoRoot, "parity"),
    ...(effectiveSourceWorkspace ? ["--source-workspace", effectiveSourceWorkspace] : []),
  ]));

  steps.push(runCommand(repoRoot, "collect target contract snapshots", [
    script("collect-contract-snapshots.mjs"),
    "--workspace",
    targetRepoRoot,
    "--target",
    "target",
  ]));

  if (sourceRepoRoot) {
    steps.push(runCommand(repoRoot, "collect source contract snapshots", [
      script("collect-contract-snapshots.mjs"),
      "--workspace",
      sourceRepoRoot,
      "--target",
      "source",
    ]));
  } else if (sourceSnapshotsAvailable) {
    steps.push(skippedStep("collect source contract snapshots", "source contract snapshots are already available"));
  } else {
    steps.push(skippedStep("collect source contract snapshots", "source workspace unavailable"));
  }

  steps.push(runCommand(repoRoot, "compare contract snapshots", [
    script("compare-contract-snapshots.mjs"),
  ]));

  steps.push(runCommand(repoRoot, "compare workspace freezes", [
    script("compare-freezes.mjs"),
  ]));

  steps.push(runCommand(repoRoot, "index target diff", [
    script("index-target-diff.mjs"),
  ]));

  steps.push(runCommand(repoRoot, "collect target ledger artifacts", [
    script("collect-ledger-artifacts.mjs"),
    "--side",
    "target",
    "--output-dir",
    path.join(repoRoot, "parity", "artifacts"),
    "--snapshot-dir",
    path.join(repoRoot, "parity", "snapshots", "target"),
    "--freeze-dir",
    path.join(repoRoot, "parity", "frozen", "target-current"),
  ]));

  if (sourceRepoRoot) {
    steps.push(runCommand(repoRoot, "collect source ledger artifacts", [
      script("collect-ledger-artifacts.mjs"),
      "--side",
      "source",
      "--output-dir",
      path.join(repoRoot, "parity", "artifacts"),
      "--snapshot-dir",
      path.join(repoRoot, "parity", "snapshots", "source"),
      "--freeze-dir",
      path.join(repoRoot, "parity", "frozen", "source"),
    ]));
  } else if (sourceFreezeAvailable || sourceSnapshotsAvailable) {
    steps.push(runCommand(repoRoot, "collect source ledger artifacts", [
      script("collect-ledger-artifacts.mjs"),
      "--side",
      "source",
      "--output-dir",
      path.join(repoRoot, "parity", "artifacts"),
      "--snapshot-dir",
      path.join(repoRoot, "parity", "snapshots", "source"),
      "--freeze-dir",
      sourceFreezeDir,
    ]));
  } else {
    steps.push(skippedStep("collect source ledger artifacts", "source workspace unavailable"));
  }

  steps.push(runCommand(repoRoot, "validate parity ledger", [
    script("validate-ledger.mjs"),
    "--strict",
  ]));

  steps.push(runCommand(repoRoot, "validate M8 readiness", [
    script("validate-m8-readiness.mjs"),
  ]));

  steps.push(runCommand(repoRoot, "generate draft final report", [
    script("generate-final-report.mjs"),
    "--draft",
  ]));

  steps.push(runCommand(repoRoot, "validate M0", [
    script("validate-m0.mjs"),
    ...(args.strictM0 ? ["--strict"] : []),
  ], { allowFailure: args.strictM0 }));

  const hardFailures = steps.filter((step) => step.status === "fail");

  return {
    generatedAt: new Date().toISOString(),
    status: hardFailures.length === 0 ? "complete-with-open-gates" : "failed",
    repoRoot,
    targetRepoRoot,
    sourceRepoRoot,
    sourceEvidence,
    sourceIntakeStatus: sourceIntake?.status ?? "missing",
    sourceFreezeIntakeStatus: sourceFreezeIntake?.status ?? "missing",
    sourceSnapshotIntakeStatus: sourceSnapshotIntake?.status ?? "missing",
    sourceBundleRequested: args.sourceBundle,
    effectiveSourceBundle,
    sourceFreezeDirRequested: args.sourceFreezeDir,
    sourceFreezeArchiveRequested: args.sourceFreezeArchive,
    effectiveSourceFreezeArchive,
    sourceSnapshotDirRequested: args.sourceSnapshotDir,
    sourceSnapshotArchiveRequested: args.sourceSnapshotArchive,
    effectiveSourceSnapshotArchive,
    sourceFreezeImported,
    sourceFreezeAvailable,
    sourceSnapshotsImported,
    sourceSnapshotsAvailable,
    preparedSourceWorkspace,
    sourceWorkspaceRequested: args.sourceWorkspace,
    effectiveSourceWorkspace,
    steps,
  };
}

function hasContractSnapshots(snapshotDir) {
  const requiredFiles = [
    "preload-api.json",
    "ipc-channels.json",
    "settings-defaults.json",
    "shared-types.json",
    "session-serialization.json",
    "package-dependencies.json",
    "build-config.json",
    "default-surface.json",
  ];

  return requiredFiles.every((fileName) => existsSync(path.join(snapshotDir, fileName)));
}

const report = buildPipeline();
writeReport(report);

console.log(`M0 pipeline: ${report.status}`);
for (const step of report.steps) {
  console.log(`- ${step.status}: ${step.label}`);
}

if (report.status === "failed" || (parseArgs(process.argv.slice(2)).strict && report.steps.some((step) => step.status !== "pass"))) {
  process.exitCode = 1;
}
