import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const REQUIRED_LEDGER_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];
const CONTRACT_SNAPSHOT_FILES = [
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
    side: "target",
    outputDir: path.join("parity", "artifacts"),
    snapshotDir: null,
    freezeDir: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--side") {
      args.side = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-dir") {
      args.outputDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--snapshot-dir") {
      args.snapshotDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--freeze-dir") {
      args.freezeDir = readArgValue(argv, ++index, arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["source", "target"].includes(args.side)) {
    throw new Error(`--side must be source or target, received: ${args.side}`);
  }

  return {
    ...args,
    outputDir: path.resolve(args.outputDir),
    snapshotDir: path.resolve(args.snapshotDir ?? path.join("parity", "snapshots", args.side)),
    freezeDir: path.resolve(args.freezeDir ?? path.join("parity", "frozen", args.side === "target" ? "target-current" : "source")),
  };
}

function readArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
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

function summarizeFreeze(freezeDir) {
  const summary = readJson(path.join(freezeDir, "freeze-summary.json"));
  if (!summary) {
    return {
      available: false,
      dir: freezeDir,
    };
  }

  return {
    available: true,
    dir: freezeDir,
    label: summary.label,
    branch: summary.branch,
    head: summary.head,
    statusCount: summary.statusCount,
    manifestCount: summary.manifestCount,
    artifacts: {
      headArchive: summary.artifacts?.headArchive?.sha256 ?? null,
      binaryDiff: summary.artifacts?.binaryDiff?.sha256 ?? null,
      manifest: summary.artifacts?.manifest?.sha256 ?? null,
      codexSessionsPatch: summary.artifacts?.codexSessionsPatch?.sha256 ?? null,
    },
  };
}

function summarizeSnapshots(snapshotDir) {
  return CONTRACT_SNAPSHOT_FILES.map((fileName) => ({
    file: fileName,
    ...describeFile(path.join(snapshotDir, fileName)),
  }));
}

function buildTargetDiffContext(ledgerId) {
  const index = readJson(path.join("parity", "target-diff-index.json"));
  if (!index) {
    return {
      available: false,
      entries: [],
      featureTags: {},
    };
  }

  const entries = (index.entries ?? [])
    .filter((entry) => entry.candidateLedgerIds?.includes(ledgerId))
    .map((entry) => ({
      path: entry.path,
      targetStatus: entry.targetStatus,
      matrixClass: entry.matrixClass,
      featureTags: entry.featureTags ?? [],
      evidenceStatus: entry.evidenceStatus,
      requiredAction: entry.requiredAction,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const featureTags = {};
  for (const entry of entries) {
    for (const tag of entry.featureTags) {
      featureTags[tag] ??= 0;
      featureTags[tag] += 1;
    }
  }

  return {
    available: true,
    evidenceRule: index.evidenceRule,
    sourceStatus: index.sourceStatus,
    entries,
    featureTags: Object.fromEntries(Object.entries(featureTags).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function buildArtifact({ ledgerItem, side, snapshotDir, freezeDir }) {
  const targetDiffContext = side === "target" ? buildTargetDiffContext(ledgerItem.id) : null;
  const freeze = summarizeFreeze(freezeDir);
  const contractSnapshots = summarizeSnapshots(snapshotDir);
  const missingSnapshots = contractSnapshots
    .filter((snapshot) => !snapshot.exists)
    .map((snapshot) => snapshot.file);
  const completeness = {
    complete: freeze.available && missingSnapshots.length === 0,
    freezeAvailable: freeze.available,
    snapshotFilesPresent: contractSnapshots.length - missingSnapshots.length,
    snapshotFilesExpected: CONTRACT_SNAPSHOT_FILES.length,
    missingSnapshots,
  };

  return {
    generatedAt: new Date().toISOString(),
    side,
    ledgerId: ledgerItem.id,
    functionContract: ledgerItem.functionContract,
    ledgerStatus: ledgerItem.status,
    evidenceStatus: side === "target" ? "target-artifact-only" : "source-artifact-only",
    evidenceRule: "This artifact packages one side of evidence only. It does not prove parity or close a ledger item.",
    completeness,
    freeze,
    contractSnapshots,
    targetDiffContext,
    expectedBehavior: ledgerItem.expectedBehavior ?? [],
    closeBlockers: ledgerItem.closeBlockers ?? [],
  };
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function renderIndex(side, artifacts) {
  const rows = artifacts
    .map((artifact) => {
      const targetFileCount = artifact.targetDiffContext?.entries?.length ?? "";
      const snapshotCount = artifact.contractSnapshots.filter((item) => item.exists).length;
      return `| ${artifact.ledgerId} | ${artifact.ledgerStatus} | ${artifact.completeness.complete ? "yes" : "no"} | ${snapshotCount} | ${targetFileCount} |`;
    })
    .join("\n");

  return `# ${side === "target" ? "Target" : "Source"} Ledger Artifacts

These artifacts package one side of evidence only. They do not prove parity and do not close P items.

| Ledger ID | Ledger status | Complete | Snapshot files | Target-index files |
|---|---|---|---:|---:|
${rows}
`;
}

function collectArtifacts() {
  const args = parseArgs(process.argv.slice(2));
  const ledger = readJson(path.join("parity", "parity-ledger.json"));
  if (!ledger) {
    throw new Error("parity/parity-ledger.json is missing");
  }

  const ledgerItems = new Map((ledger.items ?? []).map((item) => [item.id, item]));
  const artifacts = [];

  for (const ledgerId of REQUIRED_LEDGER_IDS) {
    const ledgerItem = ledgerItems.get(ledgerId);
    if (!ledgerItem) {
      throw new Error(`Missing ledger item: ${ledgerId}`);
    }

    const artifact = buildArtifact({
      ledgerItem,
      side: args.side,
      snapshotDir: args.snapshotDir,
      freezeDir: args.freezeDir,
    });
    artifacts.push(artifact);
    writeJson(path.join(args.outputDir, ledgerId, `${args.side}.json`), artifact);
  }

  mkdirSync(args.outputDir, { recursive: true });
  writeFileSync(path.join(args.outputDir, `${args.side}-index.md`), renderIndex(args.side, artifacts));

  console.log(`Wrote ${args.side} ledger artifacts to ${args.outputDir}`);
}

collectArtifacts();
