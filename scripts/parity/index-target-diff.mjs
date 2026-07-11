import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE_MATRIX_PATH = path.join("parity", "file-matrix.json");
const OUTPUT_JSON = path.join("parity", "target-diff-index.json");
const OUTPUT_MD = path.join("parity", "target-diff-index.md");
const LEDGER_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"];

const RULES = [
  {
    tag: "file-io",
    ledgerIds: ["P02"],
    matches: [/^electron\/src\/ipc\/files\.ts$/, /FilePreview/, /^src\/lib\/file-access\.ts$/],
  },
  {
    tag: "input-history",
    ledgerIds: ["P03"],
    matches: [/useInputHistory/, /^src\/components\/input-bar\/InputBar\.tsx$/, /^src\/components\/input-bar\/input-bar-utils\.ts$/],
  },
  {
    tag: "archive-preview",
    ledgerIds: ["P03", "P10"],
    matches: [/ArchivedSettings/, /archived/i, /^src\/components\/sidebar\/SessionItem\.tsx$/, /^src\/lib\/sidebar\/grouping\.ts$/],
  },
  {
    tag: "session-persistence",
    ledgerIds: ["P04", "P10"],
    matches: [
      /session-persistence/,
      /^electron\/src\/ipc\/claude-sessions\.ts$/,
      /^electron\/src\/ipc\/terminal\.ts$/,
      /^electron\/src\/ipc\/sessions\.ts$/,
      /^src\/hooks\/app-layout\/useAppSessionActions\.ts$/,
      /^src\/hooks\/session\//,
      /^src\/hooks\/useACP\.ts$/,
      /^src\/hooks\/useAppOrchestrator\.ts$/,
      /^src\/hooks\/useClaude\.ts$/,
      /^src\/hooks\/useCodex\.ts$/,
      /^src\/hooks\/useEngineBase\.ts$/,
      /^src\/hooks\/useSessionManager\.ts$/,
      /^src\/lib\/background\/claude-handler\.ts$/,
      /^src\/lib\/background\/context-usage\.test\.ts$/,
      /^src\/lib\/background\/session-store\.ts$/,
      /^src\/lib\/session\/records/,
      /^src\/types\/engine-hook\.ts$/,
      /^src\/types\/session\.ts$/,
    ],
  },
  {
    tag: "todo-checklist",
    ledgerIds: ["P05"],
    matches: [/Todo/, /todo/i, /^src\/components\/ToolCall\.tsx$/],
  },
  {
    tag: "virtualization",
    ledgerIds: ["P06"],
    matches: [/virtualization/, /^src\/components\/ChatView\.tsx$/],
  },
  {
    tag: "opencode",
    ledgerIds: ["P07", "P10"],
    matches: [/opencode/i],
  },
  {
    tag: "relay",
    ledgerIds: ["P08", "P10"],
    matches: [/relay/i, /workflow/i, /handoff/i, /lane/i],
  },
  {
    tag: "codex-model-fallback",
    ledgerIds: ["P09", "P10"],
    matches: [/codex/i, /^src\/lib\/model-utils/, /^electron\/src\/lib\/claude-model-cache/, /^electron\/src\/lib\/__tests__\/claude-model-cache/],
  },
  {
    tag: "preload-ipc-contract",
    ledgerIds: ["P10"],
    matches: [/^electron\/src\/preload\.ts$/, /^electron\/src\/main\.ts$/, /^src\/types\/window\.d\.ts$/, /^shared\/types\/engine\.ts$/],
  },
  {
    tag: "settings-contract",
    ledgerIds: ["P10"],
    matches: [/Settings/, /^src\/stores\/settings-store\.ts$/, /^src\/components\/settings\//],
  },
  {
    tag: "prompt-templates",
    ledgerIds: ["P10"],
    matches: [/prompt-template/i, /Template/],
  },
  {
    tag: "subagents",
    ledgerIds: ["P10"],
    matches: [/subagent/i, /^src\/hooks\/useSubagents\.ts$/],
  },
  {
    tag: "skills",
    ledgerIds: ["P10"],
    matches: [/SkillsSettings/, /^src\/hooks\/useSkills\.ts$/],
  },
  {
    tag: "usage-dashboard",
    ledgerIds: ["P04", "P10"],
    matches: [/Usage/, /usage-aggregation/, /model-usage/, /CostDashboard/, /MiniBarChart/],
  },
  {
    tag: "session-export",
    ledgerIds: ["P04", "P10"],
    matches: [/session-export/, /sessions:export/],
  },
  {
    tag: "branch-context",
    ledgerIds: ["P10"],
    matches: [/Branch/, /branch/],
  },
  {
    tag: "tool-rendering",
    ledgerIds: ["P05", "P10"],
    matches: [/ToolCall/, /leaked-tool-parse/, /^src\/components\/MessageBubble\.tsx$/],
  },
  {
    tag: "app-shell",
    ledgerIds: ["P10"],
    matches: [
      /^src\/components\/AppLayout\.tsx$/,
      /^src\/components\/AppSidebar\.tsx$/,
      /^src\/components\/AgentContext\.tsx$/,
      /^src\/components\/sidebar\/FolderSection\.tsx$/,
      /^src\/components\/sidebar\/PinnedSection\.tsx$/,
      /^src\/components\/sidebar\/ProjectSection\.tsx$/,
      /^src\/components\/sidebar\/SidebarActionsContext\.tsx$/,
      /^src\/hooks\/useFolderManager\.ts$/,
      /^src\/lib\/engine-colors\.ts$/,
      /^src\/types\/index\.ts$/,
      /^electron-builder\.config\.js$/,
      /^pnpm-lock\.yaml$/,
    ],
  },
];

function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} is missing`);
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function ruleMatches(rule, filePath) {
  return rule.matches.some((matcher) => matcher.test(filePath));
}

function classifyEntry(entry) {
  const matchingRules = RULES.filter((rule) => ruleMatches(rule, entry.path));
  const ledgerIds = [...new Set(matchingRules.flatMap((rule) => rule.ledgerIds))].sort();
  const featureTags = [...new Set(matchingRules.map((rule) => rule.tag))].sort();
  const candidateLedgerIds = ledgerIds.length > 0 ? ledgerIds : ["P10"];

  return {
    path: entry.path,
    targetStatus: entry.targetStatus,
    matrixClass: entry.matrixClass,
    hotspot: entry.hotspot,
    candidateLedgerIds,
    featureTags: featureTags.length > 0 ? featureTags : ["unmapped-contract-review"],
    evidenceStatus: "target-index-only",
    requiredAction: entry.requiredAction,
  };
}

function buildIndex(fileMatrix) {
  const entries = (fileMatrix.entries ?? []).map(classifyEntry);
  const byLedgerId = Object.fromEntries(LEDGER_IDS.map((id) => [
    id,
    entries.filter((entry) => entry.candidateLedgerIds.includes(id)).map((entry) => entry.path),
  ]));
  const byFeatureTag = {};
  for (const entry of entries) {
    for (const tag of entry.featureTags) {
      byFeatureTag[tag] ??= [];
      byFeatureTag[tag].push(entry.path);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: fileMatrix.sourceStatus,
    evidenceRule: "Target-side routing only. This index does not prove source parity or close ledger items.",
    summary: {
      total: entries.length,
      byLedgerId: Object.fromEntries(Object.entries(byLedgerId).map(([id, files]) => [id, files.length])),
      byFeatureTag: Object.fromEntries(Object.entries(byFeatureTag).sort(([a], [b]) => a.localeCompare(b)).map(([tag, files]) => [tag, files.length])),
      unmappedContractReview: entries.filter((entry) => entry.featureTags.includes("unmapped-contract-review")).length,
    },
    entries,
    byLedgerId,
    byFeatureTag: Object.fromEntries(Object.entries(byFeatureTag).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function renderMarkdown(index) {
  const ledgerRows = LEDGER_IDS
    .map((id) => `| ${id} | ${index.summary.byLedgerId[id] ?? 0} |`)
    .join("\n");
  const tagRows = Object.entries(index.summary.byFeatureTag)
    .map(([tag, count]) => `| ${tag} | ${count} |`)
    .join("\n");
  const entryRows = index.entries
    .map((entry) => `| \`${entry.path}\` | ${entry.targetStatus} | ${entry.candidateLedgerIds.join(", ")} | ${entry.featureTags.join(", ")} |`)
    .join("\n");

  return `# Target Diff Index

This is a target-side routing index only. It does not prove parity, does not replace source evidence,
and cannot close any P item.

Source status: \`${index.sourceStatus}\`

## Ledger Counts

| Ledger ID | Candidate files |
|---|---:|
${ledgerRows}

## Feature Tags

| Feature tag | Files |
|---|---:|
${tagRows}

## Entries

| Path | Status | Candidate ledger IDs | Feature tags |
|---|---|---|---|
${entryRows}
`;
}

function writeOutputs(index) {
  mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(OUTPUT_MD, renderMarkdown(index));
}

const index = buildIndex(readJson(FILE_MATRIX_PATH));
writeOutputs(index);
console.log(`Target diff index: ${index.summary.total} files, ${index.summary.unmappedContractReview} unmapped`);
