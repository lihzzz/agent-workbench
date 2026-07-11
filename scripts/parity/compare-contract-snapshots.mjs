import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SNAPSHOT_FILES = [
  "preload-api.json",
  "ipc-channels.json",
  "settings-defaults.json",
  "shared-types.json",
  "session-serialization.json",
  "package-dependencies.json",
  "build-config.json",
  "default-surface.json",
];

const sourceDir = process.argv[2] ?? path.join("parity", "snapshots", "source");
const targetDir = process.argv[3] ?? path.join("parity", "snapshots", "target");
const outputFile = process.argv[4] ?? path.join("parity", "snapshots", "contract-diff.json");
const outputMdFile = process.argv[5] ?? getDefaultMarkdownPath(outputFile);
const MAX_DIFFS_PER_FILE = 50;
const MAX_VALUE_LENGTH = 300;

function getDefaultMarkdownPath(jsonPath) {
  if (jsonPath.endsWith(".json")) {
    return jsonPath.replace(/\.json$/, ".md");
  }

  return `${jsonPath}.md`;
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return { exists: false, value: null };
  }

  return {
    exists: true,
    value: JSON.parse(readFileSync(filePath, "utf8")),
  };
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareSnapshotFile(fileName) {
  const sourcePath = path.join(sourceDir, fileName);
  const targetPath = path.join(targetDir, fileName);
  const source = readJsonIfExists(sourcePath);
  const target = readJsonIfExists(targetPath);

  if (!source.exists || !target.exists) {
    return {
      file: fileName,
      status: "missing",
      sourceExists: source.exists,
      targetExists: target.exists,
      diffCount: 1,
      sampleDiffs: [{
        path: "",
        kind: "snapshot-missing",
        sourceExists: source.exists,
        targetExists: target.exists,
      }],
    };
  }

  const sourceText = stableStringify(source.value);
  const targetText = stableStringify(target.value);
  const sampleDiffs = collectValueDiffs(source.value, target.value);
  const status = sourceText === targetText ? "equal" : "different";

  return {
    file: fileName,
    status,
    sourceBytes: Buffer.byteLength(sourceText),
    targetBytes: Buffer.byteLength(targetText),
    diffCount: status === "equal" ? 0 : countValueDiffs(source.value, target.value),
    sampleDiffs: status === "equal" ? [] : sampleDiffs,
  };
}

function countValueDiffs(source, target) {
  return collectValueDiffs(source, target, { limit: Number.POSITIVE_INFINITY }).length;
}

function collectValueDiffs(source, target, options = {}) {
  const limit = options.limit ?? MAX_DIFFS_PER_FILE;
  const diffs = [];

  compareValues(source, target, "", diffs, limit);
  return diffs;
}

function compareValues(source, target, currentPath, diffs, limit) {
  if (diffs.length >= limit) {
    return;
  }

  if (Object.is(source, target)) {
    return;
  }

  const sourceKind = getValueKind(source);
  const targetKind = getValueKind(target);
  if (sourceKind !== targetKind) {
    diffs.push({
      path: currentPath,
      kind: "type-different",
      sourceType: sourceKind,
      targetType: targetKind,
      sourceValue: summarizeValue(source),
      targetValue: summarizeValue(target),
    });
    return;
  }

  if (sourceKind === "array") {
    compareArrays(source, target, currentPath, diffs, limit);
    return;
  }

  if (sourceKind === "object") {
    compareObjects(source, target, currentPath, diffs, limit);
    return;
  }

  diffs.push({
    path: currentPath,
    kind: "value-different",
    sourceValue: summarizeValue(source),
    targetValue: summarizeValue(target),
  });
}

function compareArrays(source, target, currentPath, diffs, limit) {
  if (source.length !== target.length) {
    diffs.push({
      path: currentPath,
      kind: "array-length-different",
      sourceLength: source.length,
      targetLength: target.length,
    });
  }

  const sharedLength = Math.min(source.length, target.length);
  for (let index = 0; index < sharedLength && diffs.length < limit; index++) {
    compareValues(source[index], target[index], appendPath(currentPath, String(index)), diffs, limit);
  }
}

function compareObjects(source, target, currentPath, diffs, limit) {
  const sourceKeys = Object.keys(source).sort();
  const targetKeys = Object.keys(target).sort();
  const allKeys = [...new Set([...sourceKeys, ...targetKeys])].sort();

  for (const key of allKeys) {
    if (diffs.length >= limit) {
      return;
    }

    const pathForKey = appendPath(currentPath, key);
    if (!(key in source)) {
      diffs.push({
        path: pathForKey,
        kind: "source-key-missing",
        targetValue: summarizeValue(target[key]),
      });
      continue;
    }

    if (!(key in target)) {
      diffs.push({
        path: pathForKey,
        kind: "target-key-missing",
        sourceValue: summarizeValue(source[key]),
      });
      continue;
    }

    compareValues(source[key], target[key], pathForKey, diffs, limit);
  }
}

function getValueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function appendPath(basePath, segment) {
  return `${basePath}/${escapePathSegment(segment)}`;
}

function escapePathSegment(segment) {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function summarizeValue(value) {
  const text = JSON.stringify(value);
  if (!text || text.length <= MAX_VALUE_LENGTH) {
    return value;
  }

  return `${text.slice(0, MAX_VALUE_LENGTH)}...[truncated ${text.length - MAX_VALUE_LENGTH} chars]`;
}

function renderMarkdown(report) {
  const rows = report.results
    .map((result) => `| ${result.status} | \`${result.file}\` | ${result.diffCount ?? ""} | ${renderResultDetails(result)} |`)
    .join("\n");

  const sampleSections = report.results
    .filter((result) => result.sampleDiffs?.length > 0)
    .map(renderSampleSection)
    .join("\n\n");

  return `# Contract Snapshot Diff

Status: \`${report.status}\`

| Status | File | Diff count | Details |
|---|---|---:|---|
${rows}

## Sample Diffs

${sampleSections || "_No differences._"}
`;
}

function renderResultDetails(result) {
  if (result.status === "missing") {
    return `source: ${result.sourceExists ? "yes" : "no"}, target: ${result.targetExists ? "yes" : "no"}`;
  }

  if (result.status === "different") {
    return `source bytes: ${result.sourceBytes}, target bytes: ${result.targetBytes}`;
  }

  return "";
}

function renderSampleSection(result) {
  const rows = result.sampleDiffs
    .map((diff) => `| \`${diff.path || "/"}\` | ${diff.kind} | \`${escapeMarkdownTable(JSON.stringify(diff))}\` |`)
    .join("\n");

  return `### ${result.file}

| Path | Kind | Detail |
|---|---|---|
${rows}`;
}

function escapeMarkdownTable(value) {
  return value.replaceAll("|", "\\|").replaceAll("`", "\\`");
}

const results = SNAPSHOT_FILES.map(compareSnapshotFile);
const summary = {
  status: results.every((result) => result.status === "equal") ? "equal" : "not-equal",
  sourceDir,
  targetDir,
  maxDiffsPerFile: MAX_DIFFS_PER_FILE,
  results,
};

mkdirSync(path.dirname(outputFile), { recursive: true });
mkdirSync(path.dirname(outputMdFile), { recursive: true });
writeFileSync(outputFile, stableStringify(summary));
writeFileSync(outputMdFile, renderMarkdown(summary));

const failed = results.filter((result) => result.status !== "equal");
if (failed.length === 0) {
  console.log("Contract snapshots match.");
} else {
  console.log(`Contract snapshots differ or are missing: ${failed.map((result) => result.file).join(", ")}`);
}
