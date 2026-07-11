import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const LEDGER_PATH = path.join("parity", "parity-ledger.json");
const OUTPUT_JSON = path.join("parity", "parity-ledger-validation.json");
const OUTPUT_MD = path.join("parity", "parity-ledger-validation.md");
const REQUIRED_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];
const REQUIRED_ITEM_FIELDS = [
  "id",
  "class",
  "status",
  "functionContract",
  "sourceEvidence",
  "targetCurrent",
  "expectedBehavior",
  "implementation",
  "automatedTests",
  "manualScenarios",
  "crossPlatform",
  "deviations",
  "ownerSignoff",
  "closeBlockers",
];

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
  };
}

function readLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return null;
  }

  return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
}

function issue(id, severity, message) {
  return { id, severity, message };
}

function validateItemShape(item) {
  const issues = [];
  for (const field of REQUIRED_ITEM_FIELDS) {
    if (!(field in item)) {
      issues.push(issue(item.id ?? "unknown", "error", `missing required field: ${field}`));
    }
  }

  if (item.class !== "P") {
    issues.push(issue(item.id, "error", `unexpected class: ${item.class}`));
  }

  if (item.status !== "open" && item.status !== "closed") {
    issues.push(issue(item.id, "error", `unexpected status: ${item.status}`));
  }

  if (!Array.isArray(item.expectedBehavior) || item.expectedBehavior.length === 0) {
    issues.push(issue(item.id, "error", "expectedBehavior must be a non-empty array"));
  }

  for (const field of ["automatedTests", "manualScenarios", "deviations", "closeBlockers"]) {
    if (!Array.isArray(item[field])) {
      issues.push(issue(item.id, "error", `${field} must be an array`));
    }
  }

  for (const platform of ["macos", "windows", "linux"]) {
    if (!item.crossPlatform || typeof item.crossPlatform[platform] !== "string") {
      issues.push(issue(item.id, "error", `crossPlatform.${platform} must be present`));
    }
  }

  return issues;
}

function validateClosureRules(item) {
  const issues = [];
  if (item.status === "open") {
    if (!Array.isArray(item.closeBlockers) || item.closeBlockers.length === 0) {
      issues.push(issue(item.id, "error", "open item must list closeBlockers"));
    }
    return issues;
  }

  if (item.sourceEvidence?.status !== "recorded") {
    issues.push(issue(item.id, "error", "closed item requires recorded sourceEvidence"));
  }

  if (!item.implementation?.targetCommit) {
    issues.push(issue(item.id, "error", "closed item requires implementation.targetCommit"));
  }

  if (!Array.isArray(item.automatedTests) || item.automatedTests.length === 0) {
    issues.push(issue(item.id, "error", "closed item requires automatedTests"));
  }

  if (!Array.isArray(item.manualScenarios) || item.manualScenarios.length === 0) {
    issues.push(issue(item.id, "error", "closed item requires manualScenarios"));
  }

  if (!item.ownerSignoff) {
    issues.push(issue(item.id, "error", "closed item requires ownerSignoff"));
  }

  if (Array.isArray(item.closeBlockers) && item.closeBlockers.length > 0) {
    issues.push(issue(item.id, "error", "closed item cannot have closeBlockers"));
  }

  return issues;
}

function validateLedger(ledger) {
  if (!ledger) {
    return {
      status: "invalid",
      issues: [issue("ledger", "error", `${LEDGER_PATH} is missing`)],
      summary: { items: 0, open: 0, closed: 0 },
    };
  }

  const items = Array.isArray(ledger.items) ? ledger.items : [];
  const ids = new Set(items.map((item) => item.id));
  const issues = [];

  for (const id of REQUIRED_IDS) {
    if (!ids.has(id)) {
      issues.push(issue(id, "error", "required ledger item is missing"));
    }
  }

  for (const item of items) {
    if (!REQUIRED_IDS.includes(item.id)) {
      issues.push(issue(item.id ?? "unknown", "error", "unexpected ledger item id"));
    }
    issues.push(...validateItemShape(item));
    issues.push(...validateClosureRules(item));
  }

  const open = items.filter((item) => item.status === "open").length;
  const closed = items.filter((item) => item.status === "closed").length;

  return {
    status: issues.some((item) => item.severity === "error") ? "invalid" : "valid",
    issues,
    summary: {
      items: items.length,
      open,
      closed,
    },
  };
}

function renderMarkdown(report) {
  const issueRows = report.issues.length === 0
    ? "| PASS | ledger | no validation issues |\n"
    : report.issues
      .map((item) => `| ${item.severity.toUpperCase()} | ${item.id} | ${item.message} |`)
      .join("\n");

  return `# Parity Ledger Validation

Status: \`${report.status}\`

Summary: ${report.summary.items} items, ${report.summary.open} open, ${report.summary.closed} closed.

| Severity | ID | Message |
|---|---|---|
${issueRows}`;
}

function writeReport(report) {
  mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_MD, renderMarkdown(report));
}

const args = parseArgs(process.argv.slice(2));
const report = validateLedger(readLedger());
writeReport(report);

console.log(`Parity ledger validation: ${report.status} (${report.summary.open} open, ${report.summary.closed} closed)`);

if (args.strict && report.status !== "valid") {
  process.exitCode = 1;
}
