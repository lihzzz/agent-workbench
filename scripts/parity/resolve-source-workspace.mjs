import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_EXPECTED_BRANCH = "hy_dev";
const DEFAULT_EXPECTED_HEAD = "0e1dab7";
const DEFAULT_OUTPUT_JSON = path.join("parity", "source-workspace-resolution.json");
const DEFAULT_OUTPUT_MD = path.join("parity", "source-workspace-resolution.md");
const DEFAULT_CANDIDATES = [
  "/Users/lihzz/PycharmProjects/code/harnss",
  "/Users/lh/PycharmProjects/code/harnss",
  "/Users/lh/git/harnss-source",
  "/Users/lh/git/harnss-hy_dev",
];
const DEFAULT_SEARCH_ROOTS = [
  "/Users/lh/git",
];
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "release", "parity"]);

function parseArgs(argv) {
  const args = {
    sourceWorkspace: null,
    expectedBranch: DEFAULT_EXPECTED_BRANCH,
    expectedHead: DEFAULT_EXPECTED_HEAD,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
    probeRemotes: false,
    searchRoots: [...DEFAULT_SEARCH_ROOTS],
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--source-workspace") {
      args.sourceWorkspace = readArgValue(argv, ++index, arg);
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

    if (arg === "--output-json") {
      args.outputJson = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-md") {
      args.outputMd = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--search-root") {
      args.searchRoots.push(readArgValue(argv, ++index, arg));
      continue;
    }

    if (arg === "--probe-remotes") {
      args.probeRemotes = true;
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

function runGit(cwd, gitArgs, options = {}) {
  try {
    return execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 15000,
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }

    const stderr = error.stderr?.toString().trim();
    throw new Error(`git ${gitArgs.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`);
  }
}

function splitLines(output) {
  return output.split("\n").filter(Boolean);
}

function resolveRepoRoot(workspace) {
  if (!workspace || !existsSync(workspace)) {
    return null;
  }

  const root = runGit(workspace, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  return root ? path.resolve(root) : null;
}

function getCurrentRepoRoot() {
  return resolveRepoRoot(process.cwd()) ?? process.cwd();
}

function getWorktreePaths(repoRoot) {
  const output = runGit(repoRoot, ["worktree", "list", "--porcelain"], { allowFailure: true });
  return splitLines(output)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function collectGitRepos(searchRoot, maxDepth = 2) {
  const root = path.resolve(searchRoot);
  if (!existsSync(root)) {
    return [];
  }

  const repos = [];

  function visit(dir, depth) {
    if (depth > maxDepth) {
      return;
    }

    if (existsSync(path.join(dir, ".git"))) {
      repos.push(dir);
      return;
    }

    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }

      visit(path.join(dir, entry.name), depth + 1);
    }
  }

  visit(root, 0);
  return repos;
}

function inspectRepo(candidatePath, expectedBranch, expectedHead, probeRemotes) {
  const absolutePath = path.resolve(candidatePath);
  const repoRoot = resolveRepoRoot(absolutePath);
  if (!repoRoot) {
    return {
      path: absolutePath,
      exists: existsSync(absolutePath),
      git: false,
      match: false,
      reason: existsSync(absolutePath) ? "not-a-git-repository" : "missing",
    };
  }

  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || null;
  const head = runGit(repoRoot, ["rev-parse", "HEAD"], { allowFailure: true }) || null;
  const statusPorcelain = splitLines(runGit(repoRoot, ["status", "--porcelain=v1"], { allowFailure: true }));
  const hasExpectedCommit = runGit(repoRoot, ["cat-file", "-t", expectedHead], { allowFailure: true }) === "commit";
  const localExpectedBranchCommit = runGit(repoRoot, ["rev-parse", "--verify", `${expectedBranch}^{commit}`], { allowFailure: true }) || null;
  const remoteExpectedHeads = probeRemotes
    ? splitLines(runGit(repoRoot, ["ls-remote", "--heads", "origin", `${expectedBranch}*`], {
      allowFailure: true,
      timeoutMs: 15000,
    }))
    : [];
  const headMatches = Boolean(head?.startsWith(expectedHead));
  const branchMatches = branch === expectedBranch;

  return {
    path: absolutePath,
    exists: true,
    git: true,
    repoRoot,
    branch,
    head,
    statusPorcelain,
    hasExpectedCommit,
    localExpectedBranchCommit,
    remoteExpectedHeads,
    branchMatches,
    headMatches,
    match: headMatches,
    reason: headMatches ? "head-matches-expected" : "head-does-not-match-expected",
  };
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((item) => path.resolve(item)))];
}

function buildReport() {
  const args = parseArgs(process.argv.slice(2));
  const currentRepoRoot = getCurrentRepoRoot();
  const candidatePaths = uniquePaths([
    args.sourceWorkspace,
    ...DEFAULT_CANDIDATES,
    ...getWorktreePaths(currentRepoRoot),
    ...args.searchRoots.flatMap((root) => collectGitRepos(root)),
  ]);
  const candidates = candidatePaths
    .map((candidatePath) => inspectRepo(candidatePath, args.expectedBranch, args.expectedHead, args.probeRemotes))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.path.localeCompare(b.path));
  const matchingWorkspace = candidates.find((candidate) => candidate.match) ?? null;
  const commitAvailableIn = candidates.filter((candidate) => candidate.hasExpectedCommit).map((candidate) => candidate.repoRoot);

  return {
    generatedAt: new Date().toISOString(),
    status: matchingWorkspace ? "available" : "unavailable",
    expected: {
      branch: args.expectedBranch,
      headPrefix: args.expectedHead,
    },
    currentRepoRoot,
    requestedSourceWorkspace: args.sourceWorkspace ? path.resolve(args.sourceWorkspace) : null,
    probeRemotes: args.probeRemotes,
    searchRoots: uniquePaths(args.searchRoots),
    matchingWorkspace: matchingWorkspace ? compactCandidate(matchingWorkspace) : null,
    commitAvailableIn: [...new Set(commitAvailableIn)].filter(Boolean),
    candidates: candidates.map(compactCandidate),
  };
}

function scoreCandidate(candidate) {
  if (candidate.match) return 100;
  if (candidate.hasExpectedCommit) return 80;
  if (candidate.branchMatches) return 60;
  if (candidate.git) return 20;
  return 0;
}

function compactCandidate(candidate) {
  return {
    path: candidate.path,
    exists: candidate.exists,
    git: candidate.git,
    repoRoot: candidate.repoRoot ?? null,
    branch: candidate.branch ?? null,
    head: candidate.head ?? null,
    statusCount: candidate.statusPorcelain?.length ?? null,
    hasExpectedCommit: Boolean(candidate.hasExpectedCommit),
    localExpectedBranchCommit: candidate.localExpectedBranchCommit ?? null,
    remoteExpectedHeads: candidate.remoteExpectedHeads ?? [],
    branchMatches: Boolean(candidate.branchMatches),
    headMatches: Boolean(candidate.headMatches),
    match: Boolean(candidate.match),
    reason: candidate.reason,
  };
}

function renderMarkdown(report) {
  const rows = report.candidates
    .map((candidate) => `| ${candidate.match ? "yes" : "no"} | \`${candidate.path}\` | ${candidate.git ? "yes" : "no"} | ${candidate.branch ?? ""} | ${candidate.head ?? ""} | ${candidate.reason} |`)
    .join("\n");

  return `# Source Workspace Resolution

Status: \`${report.status}\`

Expected branch: \`${report.expected.branch}\`

Expected HEAD prefix: \`${report.expected.headPrefix}\`

Matching workspace: ${report.matchingWorkspace ? `\`${report.matchingWorkspace.path}\`` : "_none_"}

Commit available in repos: ${report.commitAvailableIn.length > 0 ? report.commitAvailableIn.map((item) => `\`${item}\``).join(", ") : "_none_"}

| Match | Path | Git | Branch | HEAD | Reason |
|---|---|---|---|---|---|
${rows}
`;
}

function writeReport(report, outputJson, outputMd) {
  mkdirSync(path.dirname(outputJson), { recursive: true });
  mkdirSync(path.dirname(outputMd), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outputMd, renderMarkdown(report));
}

const args = parseArgs(process.argv.slice(2));
const report = buildReport();
writeReport(report, args.outputJson, args.outputMd);

console.log(`Source workspace resolution: ${report.status}`);
if (report.matchingWorkspace) {
  console.log(`Matched: ${report.matchingWorkspace.path}`);
}
