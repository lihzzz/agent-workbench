import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
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

const DEFAULT_OUTPUT_DIR = path.join("parity", "frozen", "source");
const DEFAULT_REPORT_JSON = path.join("parity", "source-freeze-intake.json");
const DEFAULT_REPORT_MD = path.join("parity", "source-freeze-intake.md");
const REQUIRED_FREEZE_FILES = [
  "freeze-summary.json",
  "manifest.json",
  "worktree.diff",
  "status-porcelain.txt",
  "untracked-files.txt",
  "head.tar",
];

function parseArgs(argv) {
  const args = {
    sourceFreezeDir: null,
    sourceFreezeArchive: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    reportJson: DEFAULT_REPORT_JSON,
    reportMd: DEFAULT_REPORT_MD,
    force: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--source-freeze-dir") {
      args.sourceFreezeDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--source-freeze-archive") {
      args.sourceFreezeArchive = readArgValue(argv, ++index, arg);
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

  if (args.sourceFreezeDir && args.sourceFreezeArchive) {
    throw new Error("Use only one of --source-freeze-dir or --source-freeze-archive");
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

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
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
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "harnss-source-freeze-"));
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

function findFreezeDirectory(root) {
  const absoluteRoot = path.resolve(root);
  if (hasFreezeFiles(absoluteRoot)) {
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
      if (hasFreezeFiles(child)) {
        return child;
      }
      queue.push(child);
    }
  }

  return null;
}

function hasFreezeFiles(directoryPath) {
  return existsSync(path.join(directoryPath, "freeze-summary.json"))
    && existsSync(path.join(directoryPath, "manifest.json"));
}

function validateFreezeDirectory(freezeDirectory) {
  const missing = REQUIRED_FREEZE_FILES.filter((fileName) => !existsSync(path.join(freezeDirectory, fileName)));
  const summary = readJson(path.join(freezeDirectory, "freeze-summary.json"));
  const manifest = readJson(path.join(freezeDirectory, "manifest.json"));
  const summaryManifestCount = summary?.manifestCount ?? null;
  const actualManifestCount = Array.isArray(manifest) ? manifest.length : null;
  const manifestCountMatches = summaryManifestCount === null
    || actualManifestCount === null
    || summaryManifestCount === actualManifestCount;

  return {
    complete: missing.length === 0 && Boolean(summary) && Array.isArray(manifest) && manifestCountMatches,
    missing,
    summary,
    manifestCount: actualManifestCount,
    manifestCountMatches,
  };
}

function listFreezeFiles(freezeDirectory) {
  const files = [];

  function visit(directoryPath) {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(freezeDirectory, absolutePath).split(path.sep).join("/");

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
        continue;
      }

      if (entry.isSymbolicLink()) {
        files.push({
          path: relativePath,
          type: "symlink",
        });
      }
    }
  }

  visit(freezeDirectory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function copyFreezeDirectory(sourceDirectory, outputDirectory, force) {
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

  for (const entry of readdirSync(sourceDirectory)) {
    const sourcePath = path.join(sourceDirectory, entry);
    const targetPath = path.join(outputDirectory, entry);
    const stats = lstatSync(sourcePath);

    if (stats.isDirectory()) {
      cpSync(sourcePath, targetPath, { recursive: true, verbatimSymlinks: true });
      continue;
    }

    if (stats.isFile()) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
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
      sourceFreezeDir: null,
      sourceFreezeArchive: null,
      outputDir: path.resolve(args.outputDir),
      force: args.force,
    },
    importedFreeze: null,
    validation: null,
    files: [],
    commands: [],
    note: "No source freeze directory or archive was provided.",
  };
}

function buildImportReport(args) {
  const inputPath = path.resolve(args.sourceFreezeDir ?? args.sourceFreezeArchive);
  const outputDir = path.resolve(args.outputDir);
  const commands = [];
  let temporaryDirectory = null;
  let freezeRoot = null;

  if (args.sourceFreezeDir) {
    if (!isDirectory(inputPath)) {
      return buildFailedReport(args, inputPath, outputDir, "source-freeze-dir-missing-or-not-directory", commands);
    }

    freezeRoot = findFreezeDirectory(inputPath);
  } else {
    if (!isFile(inputPath)) {
      return buildFailedReport(args, inputPath, outputDir, "source-freeze-archive-missing-or-not-file", commands);
    }

    const extraction = extractArchive(inputPath);
    commands.push(extraction.result);
    temporaryDirectory = extraction.temporaryDirectory;

    if (extraction.result.status !== "pass") {
      return buildFailedReport(args, inputPath, outputDir, "source-freeze-archive-extract-failed", commands);
    }

    freezeRoot = findFreezeDirectory(temporaryDirectory);
  }

  if (!freezeRoot) {
    cleanupTemporaryDirectory(temporaryDirectory);
    return buildFailedReport(args, inputPath, outputDir, "freeze-summary-and-manifest-not-found", commands);
  }

  const validation = validateFreezeDirectory(freezeRoot);
  if (!validation.complete) {
    cleanupTemporaryDirectory(temporaryDirectory);
    return {
      ...buildFailedReport(args, inputPath, outputDir, "source-freeze-incomplete", commands),
      freezeRoot,
      validation,
    };
  }

  const copyResult = copyFreezeDirectory(freezeRoot, outputDir, args.force);
  if (copyResult.status !== "pass") {
    cleanupTemporaryDirectory(temporaryDirectory);
    return {
      ...buildFailedReport(args, inputPath, outputDir, copyResult.reason, commands),
      freezeRoot,
      validation,
    };
  }

  const importedValidation = validateFreezeDirectory(outputDir);
  const files = listFreezeFiles(outputDir);
  cleanupTemporaryDirectory(temporaryDirectory);

  return {
    generatedAt: new Date().toISOString(),
    status: "imported",
    failureReason: null,
    input: buildInput(args, inputPath, outputDir),
    importedFreeze: summarizeImportedFreeze(outputDir, importedValidation.summary),
    validation: importedValidation,
    files,
    commands,
  };
}

function buildFailedReport(args, inputPath, outputDir, failureReason, commands) {
  return {
    generatedAt: new Date().toISOString(),
    status: "failed",
    failureReason,
    input: buildInput(args, inputPath, outputDir),
    importedFreeze: null,
    validation: null,
    files: [],
    commands,
  };
}

function buildInput(args, inputPath, outputDir) {
  return {
    sourceFreezeDir: args.sourceFreezeDir ? inputPath : null,
    sourceFreezeArchive: args.sourceFreezeArchive ? inputPath : null,
    outputDir,
    force: args.force,
  };
}

function summarizeImportedFreeze(outputDir, summary) {
  return {
    dir: outputDir,
    branch: summary?.branch ?? null,
    head: summary?.head ?? null,
    label: summary?.label ?? null,
    statusCount: summary?.statusCount ?? null,
    manifestCount: summary?.manifestCount ?? null,
    packageVersion: summary?.packageVersion ?? null,
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
  const fileRows = (report.files ?? [])
    .slice(0, 40)
    .map((file) => `| \`${file.path}\` | ${file.size ?? ""} | ${file.sha256 ? `\`${file.sha256}\`` : ""} |`)
    .join("\n");

  return `# Source Freeze Intake

Status: \`${report.status}\`

Generated: ${report.generatedAt}

Failure reason: ${report.failureReason ? `\`${report.failureReason}\`` : "_none_"}

Source freeze directory: ${report.input.sourceFreezeDir ? `\`${report.input.sourceFreezeDir}\`` : "_none_"}

Source freeze archive: ${report.input.sourceFreezeArchive ? `\`${report.input.sourceFreezeArchive}\`` : "_none_"}

Output directory: \`${report.input.outputDir}\`

Imported HEAD: ${report.importedFreeze?.head ? `\`${report.importedFreeze.head}\`` : "_none_"}

Imported manifest entries: ${report.importedFreeze?.manifestCount ?? 0}

## Commands

| Result | Command | Notes |
|---|---|---|
${commandRows || "| skipped | _none_ | No source freeze directory or archive was provided. |"}

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
const report = args.sourceFreezeDir || args.sourceFreezeArchive
  ? buildImportReport(args)
  : buildNoInputReport(args);
writeReport(report, args.reportJson, args.reportMd);

console.log(`Source freeze intake: ${report.status}`);
if (report.importedFreeze?.dir) {
  console.log(`Imported: ${report.importedFreeze.dir}`);
}
if (report.status === "failed") {
  process.exitCode = 1;
}
