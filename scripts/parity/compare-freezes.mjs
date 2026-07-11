import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_SOURCE_DIR = path.join("parity", "frozen", "source");
const DEFAULT_TARGET_DIR = path.join("parity", "frozen", "target-current");
const DEFAULT_OUTPUT_JSON = path.join("parity", "freeze-comparison.json");
const DEFAULT_OUTPUT_MD = path.join("parity", "freeze-comparison.md");
const RUNTIME_PREFIXES = [
  "electron/src/",
  "shared/",
  "src/",
];
const RUNTIME_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "electron-builder.config.js",
  "vite.config.ts",
  "tsup.config.ts",
  "tsup.electron.config.ts",
]);

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
    targetDir: DEFAULT_TARGET_DIR,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--source") {
      args.sourceDir = argv[++index];
    } else if (arg === "--target") {
      args.targetDir = argv[++index];
    } else if (arg === "--output-json") {
      args.outputJson = argv[++index];
    } else if (arg === "--output-md") {
      args.outputMd = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readFreeze(dir) {
  const summaryPath = path.join(dir, "freeze-summary.json");
  const manifestPath = path.join(dir, "manifest.json");
  return {
    dir,
    summaryPath,
    manifestPath,
    summary: readJson(summaryPath),
    manifest: readJson(manifestPath),
  };
}

function manifestByPath(manifest) {
  const map = new Map();
  for (const entry of Array.isArray(manifest) ? manifest : []) {
    map.set(entry.path, entry);
  }
  return map;
}

function comparableHash(entry) {
  if (!entry) return null;
  if (entry.type === "file") return entry.sha256 ?? null;
  if (entry.type === "symlink") return `symlink:${entry.linkTarget}`;
  return `${entry.type}:${entry.mode ?? ""}`;
}

function classifyPath(filePath, sourceEntry, targetEntry) {
  const sourceHash = comparableHash(sourceEntry);
  const targetHash = comparableHash(targetEntry);

  if (sourceEntry && !targetEntry) return "source-only";
  if (!sourceEntry && targetEntry) return "target-only";
  if (sourceHash === targetHash) return "identical";
  return "both-modified";
}

function isRuntimePath(filePath) {
  return RUNTIME_FILES.has(filePath) || RUNTIME_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isGeneratedPath(filePath) {
  return filePath.startsWith("parity/")
    || filePath.startsWith("scripts/parity/")
    || filePath.startsWith("dist/")
    || filePath.startsWith("electron/dist/")
    || filePath.startsWith("logs/");
}

function annotate(filePath) {
  if (isGeneratedPath(filePath)) {
    return "generated";
  }

  if (!isRuntimePath(filePath)) {
    return "non-runtime";
  }

  return "runtime";
}

function buildMissingReport(source, target) {
  const missing = [];
  if (!source.summary) missing.push(source.summaryPath);
  if (!source.manifest) missing.push(source.manifestPath);
  if (!target.summary) missing.push(target.summaryPath);
  if (!target.manifest) missing.push(target.manifestPath);

  return {
    status: "missing-input",
    generatedAt: new Date().toISOString(),
    missing,
    source: summarizeFreeze(source),
    target: summarizeFreeze(target),
    summary: {
      total: 0,
      sourceOnly: 0,
      targetOnly: 0,
      bothModified: 0,
      identical: 0,
      runtimeOpen: 0,
    },
    entries: [],
  };
}

function summarizeFreeze(freeze) {
  if (!freeze.summary) {
    return {
      dir: freeze.dir,
      available: false,
    };
  }

  return {
    dir: freeze.dir,
    available: true,
    branch: freeze.summary.branch,
    head: freeze.summary.head,
    manifestCount: freeze.summary.manifestCount,
    statusCount: freeze.summary.statusCount,
  };
}

function compareFreezes(source, target) {
  if (!source.summary || !source.manifest || !target.summary || !target.manifest) {
    return buildMissingReport(source, target);
  }

  const sourceMap = manifestByPath(source.manifest);
  const targetMap = manifestByPath(target.manifest);
  const allPaths = [...new Set([...sourceMap.keys(), ...targetMap.keys()])].sort();
  const entries = allPaths.map((filePath) => {
    const sourceEntry = sourceMap.get(filePath);
    const targetEntry = targetMap.get(filePath);
    const matrixClass = classifyPath(filePath, sourceEntry, targetEntry);
    return {
      path: filePath,
      matrixClass,
      annotation: annotate(filePath),
      source: sourceEntry ? compactEntry(sourceEntry) : null,
      target: targetEntry ? compactEntry(targetEntry) : null,
    };
  });
  const openRuntimeEntries = entries.filter((entry) =>
    entry.annotation === "runtime" && entry.matrixClass !== "identical"
  );

  return {
    status: openRuntimeEntries.length === 0 ? "equal-runtime" : "different-runtime",
    generatedAt: new Date().toISOString(),
    source: summarizeFreeze(source),
    target: summarizeFreeze(target),
    summary: {
      total: entries.length,
      sourceOnly: entries.filter((entry) => entry.matrixClass === "source-only").length,
      targetOnly: entries.filter((entry) => entry.matrixClass === "target-only").length,
      bothModified: entries.filter((entry) => entry.matrixClass === "both-modified").length,
      identical: entries.filter((entry) => entry.matrixClass === "identical").length,
      runtimeOpen: openRuntimeEntries.length,
      generatedOpen: entries.filter((entry) => entry.annotation === "generated" && entry.matrixClass !== "identical").length,
      nonRuntimeOpen: entries.filter((entry) => entry.annotation === "non-runtime" && entry.matrixClass !== "identical").length,
    },
    entries,
  };
}

function compactEntry(entry) {
  return {
    source: entry.source,
    type: entry.type,
    size: entry.size,
    sha256: entry.sha256,
    linkTarget: entry.linkTarget,
  };
}

function renderMarkdown(report) {
  const summary = report.summary;
  const openEntries = report.entries
    .filter((entry) => entry.matrixClass !== "identical")
    .slice(0, 80)
    .map((entry) => `| ${entry.matrixClass} | ${entry.annotation} | \`${entry.path}\` |`)
    .join("\n");

  return `# Freeze Comparison

Status: \`${report.status}\`

| Metric | Count |
|---|---:|
| Total entries | ${summary.total} |
| Source only | ${summary.sourceOnly} |
| Target only | ${summary.targetOnly} |
| Both modified | ${summary.bothModified} |
| Identical | ${summary.identical} |
| Runtime open | ${summary.runtimeOpen} |

## Inputs

| Side | Available | Branch | HEAD | Manifest |
|---|---|---|---|---:|
| Source | ${report.source.available ? "yes" : "no"} | ${report.source.branch ?? ""} | ${report.source.head ?? ""} | ${report.source.manifestCount ?? 0} |
| Target | ${report.target.available ? "yes" : "no"} | ${report.target.branch ?? ""} | ${report.target.head ?? ""} | ${report.target.manifestCount ?? 0} |

## Open Entries

${openEntries || "_No open entries, or inputs are missing._"}
`;
}

function writeOutputs(report, outputJson, outputMd) {
  mkdirSync(path.dirname(outputJson), { recursive: true });
  mkdirSync(path.dirname(outputMd), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outputMd, renderMarkdown(report));
}

const args = parseArgs(process.argv.slice(2));
const source = readFreeze(args.sourceDir);
const target = readFreeze(args.targetDir);
const report = compareFreezes(source, target);
writeOutputs(report, args.outputJson, args.outputMd);

console.log(`Freeze comparison: ${report.status} (${report.summary.runtimeOpen} runtime open)`);
