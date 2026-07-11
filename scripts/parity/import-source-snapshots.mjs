import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_OUTPUT_DIR = path.join("parity", "snapshots", "source");
const DEFAULT_REPORT_JSON = path.join("parity", "source-snapshot-intake.json");
const DEFAULT_REPORT_MD = path.join("parity", "source-snapshot-intake.md");
const REQUIRED_SNAPSHOT_FILES = [
  "preload-api.json",
  "ipc-channels.json",
  "settings-defaults.json",
  "shared-types.json",
  "session-serialization.json",
  "package-dependencies.json",
  "build-config.json",
  "default-surface.json",
];

function parseArgs(argv) {
  const args = {
    sourceSnapshotDir: null,
    sourceSnapshotArchive: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    reportJson: DEFAULT_REPORT_JSON,
    reportMd: DEFAULT_REPORT_MD,
    force: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--source-snapshot-dir") {
      args.sourceSnapshotDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-snapshot-archive") {
      args.sourceSnapshotArchive = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-dir") {
      args.outputDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--report-json") {
      args.reportJson = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--report-md") {
      args.reportMd = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.sourceSnapshotDir && args.sourceSnapshotArchive) {
    throw new Error("Use only one of --source-snapshot-dir or --source-snapshot-archive");
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

function isDirectory(filePath) {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}

function isFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

function isDirectoryEmpty(directoryPath) {
  if (!existsSync(directoryPath)) {
    return true;
  }

  return readdirSync(directoryPath).length === 0;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
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

function run(command, commandArgs, options = {}) {
  try {
    const stdout = execFileSync(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 30000,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    }).trim();

    return {
      status: "pass",
      command: renderCommand(command, commandArgs),
      stdout,
      stderr: "",
    };
  } catch (error) {
    return {
      status: "fail",
      command: renderCommand(command, commandArgs),
      exitCode: error.status ?? null,
      stdout: error.stdout?.toString().trim() ?? "",
      stderr: error.stderr?.toString().trim() ?? "",
    };
  }
}

function extractArchive(archivePath) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "harnss-source-snapshots-"));
  const listing = run("tar", ["-tf", archivePath], {
    timeoutMs: 120000,
  });
  if (listing.status !== "pass") {
    return {
      temporaryDirectory,
      result: listing,
    };
  }

  const unsafeEntries = listing.stdout.split("\n").filter(isUnsafeArchiveEntry);
  if (unsafeEntries.length > 0) {
    return {
      temporaryDirectory,
      result: {
        status: "fail",
        command: renderCommand("tar", ["-tf", archivePath]),
        stdout: "",
        stderr: `archive contains unsafe paths: ${unsafeEntries.slice(0, 5).join(", ")}`,
      },
    };
  }

  const result = run("tar", ["-xf", archivePath, "-C", temporaryDirectory], {
    timeoutMs: 120000,
  });

  return {
    temporaryDirectory,
    result,
  };
}

function isUnsafeArchiveEntry(entryName) {
  if (!entryName) {
    return false;
  }

  if (entryName.startsWith("/") || entryName.includes("\0")) {
    return true;
  }

  return entryName.split("/").includes("..");
}

function findSnapshotDirectory(root) {
  const absoluteRoot = path.resolve(root);
  if (hasSnapshotFiles(absoluteRoot)) {
    return absoluteRoot;
  }

  const queue = [absoluteRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const child = path.join(current, entry.name);
      if (hasSnapshotFiles(child)) {
        return child;
      }
      queue.push(child);
    }
  }

  return null;
}

function hasSnapshotFiles(directoryPath) {
  return REQUIRED_SNAPSHOT_FILES.every((fileName) => existsSync(path.join(directoryPath, fileName)));
}

function validateSnapshotDirectory(snapshotDirectory) {
  const missing = REQUIRED_SNAPSHOT_FILES.filter((fileName) => !existsSync(path.join(snapshotDirectory, fileName)));
  const invalidJson = [];
  const files = [];

  for (const fileName of REQUIRED_SNAPSHOT_FILES) {
    const filePath = path.join(snapshotDirectory, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      readJson(filePath);
    } catch (error) {
      invalidJson.push({
        file: fileName,
        error: error.message,
      });
      continue;
    }

    files.push({
      file: fileName,
      size: statSync(filePath).size,
      sha256: sha256File(filePath),
    });
  }

  return {
    complete: missing.length === 0 && invalidJson.length === 0,
    missing,
    invalidJson,
    files,
  };
}

function copySnapshotDirectory(sourceDirectory, outputDirectory, force) {
  if (existsSync(outputDirectory) && !isDirectoryEmpty(outputDirectory)) {
    if (!force) {
      return {
        status: "fail",
        reason: "output-dir-exists-and-is-not-empty",
      };
    }

    rmSync(outputDirectory, { recursive: true, force: true });
  }

  mkdirSync(outputDirectory, { recursive: true });
  for (const fileName of REQUIRED_SNAPSHOT_FILES) {
    copyFileSync(path.join(sourceDirectory, fileName), path.join(outputDirectory, fileName));
  }

  return {
    status: "pass",
    reason: "copied",
  };
}

function buildNoInputReport(args) {
  return {
    generatedAt: new Date().toISOString(),
    status: "no-input",
    input: {
      sourceSnapshotDir: null,
      sourceSnapshotArchive: null,
      outputDir: path.resolve(args.outputDir),
      force: args.force,
    },
    importedSnapshots: null,
    validation: null,
    commands: [],
    note: "No source snapshot directory or archive was provided.",
  };
}

function buildImportReport(args) {
  const inputPath = path.resolve(args.sourceSnapshotDir ?? args.sourceSnapshotArchive);
  const outputDir = path.resolve(args.outputDir);
  const commands = [];
  let temporaryDirectory = null;
  let snapshotRoot = null;

  if (args.sourceSnapshotDir) {
    if (!isDirectory(inputPath)) {
      return buildFailedReport(args, inputPath, outputDir, "source-snapshot-dir-missing-or-not-directory", commands);
    }

    snapshotRoot = findSnapshotDirectory(inputPath);
  } else {
    if (!isFile(inputPath)) {
      return buildFailedReport(args, inputPath, outputDir, "source-snapshot-archive-missing-or-not-file", commands);
    }

    const extraction = extractArchive(inputPath);
    commands.push(extraction.result);
    temporaryDirectory = extraction.temporaryDirectory;

    if (extraction.result.status !== "pass") {
      return buildFailedReport(args, inputPath, outputDir, "source-snapshot-archive-extract-failed", commands);
    }

    snapshotRoot = findSnapshotDirectory(temporaryDirectory);
  }

  if (!snapshotRoot) {
    cleanupTemporaryDirectory(temporaryDirectory);
    return buildFailedReport(args, inputPath, outputDir, "required-snapshot-files-not-found", commands);
  }

  const validation = validateSnapshotDirectory(snapshotRoot);
  if (!validation.complete) {
    cleanupTemporaryDirectory(temporaryDirectory);
    return {
      ...buildFailedReport(args, inputPath, outputDir, "source-snapshots-incomplete", commands),
      snapshotRoot,
      validation,
    };
  }

  const copyResult = copySnapshotDirectory(snapshotRoot, outputDir, args.force);
  if (copyResult.status !== "pass") {
    cleanupTemporaryDirectory(temporaryDirectory);
    return {
      ...buildFailedReport(args, inputPath, outputDir, copyResult.reason, commands),
      snapshotRoot,
      validation,
    };
  }

  const importedValidation = validateSnapshotDirectory(outputDir);
  cleanupTemporaryDirectory(temporaryDirectory);

  return {
    generatedAt: new Date().toISOString(),
    status: "imported",
    failureReason: null,
    input: buildInput(args, inputPath, outputDir),
    importedSnapshots: {
      dir: outputDir,
      fileCount: importedValidation.files.length,
      files: importedValidation.files,
    },
    validation: importedValidation,
    commands,
  };
}

function buildFailedReport(args, inputPath, outputDir, failureReason, commands) {
  return {
    generatedAt: new Date().toISOString(),
    status: "failed",
    failureReason,
    input: buildInput(args, inputPath, outputDir),
    importedSnapshots: null,
    validation: null,
    commands,
  };
}

function buildInput(args, inputPath, outputDir) {
  return {
    sourceSnapshotDir: args.sourceSnapshotDir ? inputPath : null,
    sourceSnapshotArchive: args.sourceSnapshotArchive ? inputPath : null,
    outputDir,
    force: args.force,
  };
}

function cleanupTemporaryDirectory(temporaryDirectory) {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function renderMarkdown(report) {
  const commandRows = (report.commands ?? [])
    .map((command) => `| ${command.status} | \`${command.command.replaceAll("|", "\\|")}\` | ${command.stderr ? `\`${command.stderr.replaceAll("|", "\\|")}\`` : ""} |`)
    .join("\n");
  const fileRows = (report.importedSnapshots?.files ?? [])
    .map((file) => `| \`${file.file}\` | ${file.size} | \`${file.sha256}\` |`)
    .join("\n");

  return `# Source Snapshot Intake

Status: \`${report.status}\`

Generated: ${report.generatedAt}

Failure reason: ${report.failureReason ? `\`${report.failureReason}\`` : "_none_"}

Source snapshot directory: ${report.input.sourceSnapshotDir ? `\`${report.input.sourceSnapshotDir}\`` : "_none_"}

Source snapshot archive: ${report.input.sourceSnapshotArchive ? `\`${report.input.sourceSnapshotArchive}\`` : "_none_"}

Output directory: \`${report.input.outputDir}\`

Imported snapshot files: ${report.importedSnapshots?.fileCount ?? 0}

## Commands

| Result | Command | Notes |
|---|---|---|
${commandRows || "| skipped | _none_ | No source snapshot directory or archive was provided. |"}

## Imported Files

| File | Size | SHA-256 |
|---|---:|---|
${fileRows || "| _none_ |  |  |"}
`;
}

function writeReport(report, reportJson, reportMd) {
  mkdirSync(path.dirname(reportJson), { recursive: true });
  mkdirSync(path.dirname(reportMd), { recursive: true });
  writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMd, renderMarkdown(report));
}

const args = parseArgs(process.argv.slice(2));
const report = args.sourceSnapshotDir || args.sourceSnapshotArchive
  ? buildImportReport(args)
  : buildNoInputReport(args);
writeReport(report, args.reportJson, args.reportMd);

console.log(`Source snapshot intake: ${report.status}`);
if (report.importedSnapshots?.dir) {
  console.log(`Imported: ${report.importedSnapshots.dir}`);
}
if (report.status === "failed") {
  process.exitCode = 1;
}
