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
const DEFAULT_OUTPUT_JSON = path.join("parity", "source-intake.json");
const DEFAULT_OUTPUT_MD = path.join("parity", "source-intake.md");

function parseArgs(argv) {
  const args = {
    sourceBundle: null,
    outputWorkspace: null,
    checkoutRef: null,
    expectedBranch: DEFAULT_EXPECTED_BRANCH,
    expectedHead: DEFAULT_EXPECTED_HEAD,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
    force: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--source-bundle") {
      args.sourceBundle = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-workspace") {
      args.outputWorkspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--checkout-ref") {
      args.checkoutRef = readArgValue(argv, ++index, arg);
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

    if (arg === "--force") {
      args.force = true;
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
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 30000,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    }).trim();

    return {
      status: "pass",
      command: renderCommand(command, commandArgs),
      cwd: options.cwd ?? process.cwd(),
      stdout,
      stderr: "",
    };
  } catch (error) {
    if (options.allowFailure) {
      return {
        status: "fail",
        command: renderCommand(command, commandArgs),
        cwd: options.cwd ?? process.cwd(),
        exitCode: error.status ?? null,
        stdout: error.stdout?.toString().trim() ?? "",
        stderr: error.stderr?.toString().trim() ?? "",
      };
    }

    const stderr = error.stderr?.toString().trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function runGit(cwd, gitArgs, options = {}) {
  return run("git", gitArgs, { ...options, cwd });
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

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function splitLines(output) {
  return output.split("\n").filter(Boolean);
}

function resolveRepoRoot(workspace) {
  if (!workspace || !existsSync(workspace)) {
    return null;
  }

  const result = runGit(workspace, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  return result.status === "pass" && result.stdout ? path.resolve(result.stdout) : null;
}

function getCurrentRepoRoot() {
  return resolveRepoRoot(process.cwd()) ?? process.cwd();
}

function getDefaultOutputWorkspace(repoRoot) {
  const repoName = path.basename(repoRoot);
  return path.join(path.dirname(repoRoot), `${repoName}-source-intake`);
}

function isDirectoryEmpty(directoryPath) {
  if (!existsSync(directoryPath)) {
    return true;
  }

  return readdirSync(directoryPath).length === 0;
}

function isFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

function readBundleHeads(bundlePath) {
  const result = run("git", ["bundle", "list-heads", bundlePath], { allowFailure: true });
  if (result.status !== "pass") {
    return {
      status: "fail",
      error: result.stderr || result.stdout || "git bundle list-heads failed",
      heads: [],
    };
  }

  return {
    status: "pass",
    heads: splitLines(result.stdout).map((line) => {
      const [commit, ...nameParts] = line.split(/\s+/);
      return {
        commit,
        ref: nameParts.join(" ") || null,
      };
    }),
  };
}

function verifyBundle(bundlePath) {
  const result = run("git", ["bundle", "verify", bundlePath], { allowFailure: true });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function inspectPreparedWorkspace(workspacePath) {
  const repoRoot = resolveRepoRoot(workspacePath);
  if (!repoRoot) {
    return null;
  }

  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true });
  const head = runGit(repoRoot, ["rev-parse", "HEAD"], { allowFailure: true });
  const status = runGit(repoRoot, ["status", "--porcelain=v1"], { allowFailure: true });

  return {
    path: path.resolve(workspacePath),
    repoRoot,
    branch: branch.status === "pass" ? branch.stdout : null,
    head: head.status === "pass" ? head.stdout : null,
    statusPorcelain: status.status === "pass" ? splitLines(status.stdout) : [],
  };
}

function hasCommit(repoRoot, revision) {
  const result = runGit(repoRoot, ["cat-file", "-t", revision], { allowFailure: true });
  return result.status === "pass" && result.stdout === "commit";
}

function resolveRemoteRef(repoRoot, refName) {
  const candidates = [
    `refs/remotes/origin/${refName}`,
    `refs/remotes/source-bundle/${refName}`,
    `refs/heads/${refName}`,
  ];

  for (const candidate of candidates) {
    const result = runGit(repoRoot, ["rev-parse", "--verify", candidate], { allowFailure: true });
    if (result.status === "pass" && result.stdout) {
      return candidate;
    }
  }

  return null;
}

function checkoutExpectedRef(repoRoot, expectedBranch, expectedHead, checkoutRef) {
  const desiredRef = checkoutRef ?? expectedHead;
  if (!hasCommit(repoRoot, desiredRef)) {
    return {
      status: "fail",
      reason: `checkout ref is not available: ${desiredRef}`,
    };
  }

  const expectedBranchRef = resolveRemoteRef(repoRoot, expectedBranch);
  if (expectedBranchRef) {
    const branchHead = runGit(repoRoot, ["rev-parse", expectedBranchRef], { allowFailure: true });
    if (branchHead.status === "pass" && branchHead.stdout.startsWith(expectedHead)) {
      const checkout = runGit(repoRoot, ["checkout", "-B", expectedBranch, expectedBranchRef], { allowFailure: true });
      return {
        status: checkout.status,
        reason: checkout.status === "pass" ? "checked-out-expected-branch" : checkout.stderr,
      };
    }
  }

  const checkout = runGit(repoRoot, ["checkout", "--detach", desiredRef], { allowFailure: true });
  return {
    status: checkout.status,
    reason: checkout.status === "pass" ? "checked-out-detached-ref" : checkout.stderr,
  };
}

function fetchBundleIntoExistingRepo(repoRoot, sourceBundle) {
  return runGit(repoRoot, [
    "fetch",
    sourceBundle,
    "+refs/heads/*:refs/remotes/source-bundle/*",
    "+refs/tags/*:refs/tags/*",
  ], {
    allowFailure: true,
    timeoutMs: 120000,
  });
}

function cloneBundle(sourceBundle, outputWorkspace) {
  mkdirSync(path.dirname(outputWorkspace), { recursive: true });
  return run("git", ["clone", "--no-checkout", sourceBundle, outputWorkspace], {
    allowFailure: true,
    timeoutMs: 120000,
  });
}

function prepareFromBundle(args, currentRepoRoot) {
  const sourceBundle = path.resolve(args.sourceBundle);
  const outputWorkspace = path.resolve(args.outputWorkspace ?? getDefaultOutputWorkspace(currentRepoRoot));
  const commands = [];

  if (!existsSync(sourceBundle)) {
    return {
      status: "failed",
      failureReason: "source-bundle-missing",
      commands,
      sourceBundle,
      outputWorkspace,
    };
  }

  if (!isFile(sourceBundle)) {
    return {
      status: "failed",
      failureReason: "source-bundle-not-a-file",
      commands,
      sourceBundle,
      outputWorkspace,
    };
  }

  const bundleVerify = verifyBundle(sourceBundle);
  const bundleHeads = readBundleHeads(sourceBundle);
  const bundle = {
    path: sourceBundle,
    size: statSync(sourceBundle).size,
    sha256: sha256File(sourceBundle),
    verify: bundleVerify,
    heads: bundleHeads.heads,
  };

  if (bundleVerify.status !== "pass" || bundleHeads.status !== "pass") {
    return {
      status: "failed",
      failureReason: "source-bundle-invalid",
      commands,
      sourceBundle,
      outputWorkspace,
      bundle,
    };
  }

  const outputExists = existsSync(outputWorkspace);
  const existingRepoRoot = resolveRepoRoot(outputWorkspace);
  if (outputExists && !existingRepoRoot && !isDirectoryEmpty(outputWorkspace) && !args.force) {
    return {
      status: "failed",
      failureReason: "output-workspace-exists-and-is-not-empty",
      commands,
      sourceBundle,
      outputWorkspace,
      bundle,
    };
  }

  if (outputExists && args.force) {
    rmSync(outputWorkspace, { recursive: true, force: true });
  }

  const repoRootAfterForce = resolveRepoRoot(outputWorkspace);
  if (repoRootAfterForce) {
    const status = runGit(repoRootAfterForce, ["status", "--porcelain=v1"], { allowFailure: true });
    if (status.status === "pass" && status.stdout && !args.force) {
      return {
        status: "failed",
        failureReason: "output-workspace-has-uncommitted-or-untracked-files",
        commands,
        sourceBundle,
        outputWorkspace,
        bundle,
        preparedWorkspace: inspectPreparedWorkspace(repoRootAfterForce),
      };
    }

    const fetch = fetchBundleIntoExistingRepo(repoRootAfterForce, sourceBundle);
    commands.push(fetch);
    if (fetch.status !== "pass") {
      return {
        status: "failed",
        failureReason: "source-bundle-fetch-failed",
        commands,
        sourceBundle,
        outputWorkspace,
        bundle,
      };
    }
  } else {
    const clone = cloneBundle(sourceBundle, outputWorkspace);
    commands.push(clone);
    if (clone.status !== "pass") {
      return {
        status: "failed",
        failureReason: "source-bundle-clone-failed",
        commands,
        sourceBundle,
        outputWorkspace,
        bundle,
      };
    }
  }

  const preparedRepoRoot = resolveRepoRoot(outputWorkspace);
  if (!preparedRepoRoot) {
    return {
      status: "failed",
      failureReason: "prepared-workspace-is-not-a-git-repository",
      commands,
      sourceBundle,
      outputWorkspace,
      bundle,
    };
  }

  const checkout = checkoutExpectedRef(
    preparedRepoRoot,
    args.expectedBranch,
    args.expectedHead,
    args.checkoutRef,
  );
  commands.push({
    status: checkout.status,
    command: `checkout ${args.checkoutRef ?? args.expectedHead}`,
    cwd: preparedRepoRoot,
    stdout: "",
    stderr: checkout.reason,
  });

  if (checkout.status !== "pass") {
    return {
      status: "failed",
      failureReason: checkout.reason,
      commands,
      sourceBundle,
      outputWorkspace,
      bundle,
      preparedWorkspace: inspectPreparedWorkspace(preparedRepoRoot),
    };
  }

  const preparedWorkspace = inspectPreparedWorkspace(preparedRepoRoot);
  const headMatches = Boolean(preparedWorkspace?.head?.startsWith(args.expectedHead));

  return {
    status: headMatches ? "prepared" : "failed",
    failureReason: headMatches ? null : `prepared HEAD does not match expected prefix ${args.expectedHead}`,
    commands,
    sourceBundle,
    outputWorkspace,
    bundle,
    preparedWorkspace,
  };
}

function buildNoInputReport(args, currentRepoRoot) {
  return {
    generatedAt: new Date().toISOString(),
    status: "no-input",
    expected: {
      branch: args.expectedBranch,
      headPrefix: args.expectedHead,
    },
    input: {
      sourceBundle: null,
      outputWorkspace: args.outputWorkspace ? path.resolve(args.outputWorkspace) : getDefaultOutputWorkspace(currentRepoRoot),
      checkoutRef: args.checkoutRef,
      force: args.force,
    },
    preparedWorkspace: null,
    note: "No --source-bundle was provided. The M0 pipeline will fall back to --source-workspace when present.",
    platform: {
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
    },
  };
}

function buildReport() {
  const args = parseArgs(process.argv.slice(2));
  const currentRepoRoot = getCurrentRepoRoot();
  const nowIso = new Date().toISOString();

  if (!args.sourceBundle) {
    return buildNoInputReport(args, currentRepoRoot);
  }

  const result = prepareFromBundle(args, currentRepoRoot);
  return {
    generatedAt: nowIso,
    status: result.status,
    failureReason: result.failureReason ?? null,
    expected: {
      branch: args.expectedBranch,
      headPrefix: args.expectedHead,
    },
    input: {
      sourceBundle: result.sourceBundle,
      outputWorkspace: result.outputWorkspace,
      checkoutRef: args.checkoutRef,
      force: args.force,
    },
    bundle: result.bundle ?? null,
    preparedWorkspace: result.preparedWorkspace ?? null,
    commands: result.commands ?? [],
    platform: {
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
    },
  };
}

function renderMarkdown(report) {
  const commandRows = (report.commands ?? [])
    .map((command) => `| ${command.status} | \`${command.command.replaceAll("|", "\\|")}\` | ${command.stderr ? `\`${command.stderr.replaceAll("|", "\\|")}\`` : ""} |`)
    .join("\n");
  const bundleHeads = (report.bundle?.heads ?? [])
    .map((head) => `- \`${head.commit}\` ${head.ref ? `\`${head.ref}\`` : ""}`)
    .join("\n");

  return `# Source Intake

Status: \`${report.status}\`

Generated: ${report.generatedAt}

Expected branch: \`${report.expected.branch}\`

Expected HEAD prefix: \`${report.expected.headPrefix}\`

Source bundle: ${report.input.sourceBundle ? `\`${report.input.sourceBundle}\`` : "_none_"}

Output workspace: \`${report.input.outputWorkspace}\`

Prepared workspace: ${report.preparedWorkspace ? `\`${report.preparedWorkspace.repoRoot}\`` : "_none_"}

Prepared HEAD: ${report.preparedWorkspace?.head ? `\`${report.preparedWorkspace.head}\`` : "_none_"}

Failure reason: ${report.failureReason ? `\`${report.failureReason}\`` : "_none_"}

## Bundle Heads

${bundleHeads || "_none_"}

## Commands

| Result | Command | Notes |
|---|---|---|
${commandRows || "| skipped | _none_ | No source bundle was provided. |"}
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

console.log(`Source intake: ${report.status}`);
if (report.preparedWorkspace) {
  console.log(`Prepared: ${report.preparedWorkspace.repoRoot}`);
}
if (report.status === "failed") {
  process.exitCode = 1;
}
