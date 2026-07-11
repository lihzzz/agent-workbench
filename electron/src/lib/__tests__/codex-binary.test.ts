import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAccessSync,
  mockExecFileSync,
  mockGetAppSetting,
  mockGetPath,
  mockLog,
  mockReaddirSync,
  mockReportError,
} = vi.hoisted(() => ({
  mockAccessSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockGetAppSetting: vi.fn<(key: string) => string>((key: string) => {
    if (key === "codexBinarySource") return "auto";
    if (key === "codexCustomBinaryPath") return "";
    return "Harnss";
  }),
  mockGetPath: vi.fn(() => "/Users/tester/Library/Application Support/Harnss"),
  mockLog: vi.fn(),
  mockReaddirSync: vi.fn(() => []),
  mockReportError: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    accessSync: mockAccessSync,
    mkdirSync: vi.fn(),
    readdirSync: mockReaddirSync,
    constants: { X_OK: 1 },
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: mockGetPath,
  },
}));

vi.mock("os", () => ({
  default: {
    arch: () => "arm64",
    homedir: () => "/Users/lh",
    tmpdir: () => "/tmp",
  },
}));

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../logger", () => ({
  log: mockLog,
}));

vi.mock("../error-utils", () => ({
  reportError: mockReportError,
}));

function allowExecutable(...filePaths: string[]): void {
  mockAccessSync.mockImplementation((candidate: string) => {
    if (filePaths.includes(candidate)) return;
    throw new Error("missing");
  });
}

async function loadModule() {
  vi.resetModules();
  return import("../codex-binary");
}

describe("codex binary resolution", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockAccessSync.mockReset();
    mockExecFileSync.mockReset();
    mockGetAppSetting.mockReset();
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "codexBinarySource") return "auto";
      if (key === "codexCustomBinaryPath") return "";
      return "Harnss";
    });
    mockGetPath.mockReset();
    mockGetPath.mockReturnValue("/Users/tester/Library/Application Support/Harnss");
    mockLog.mockReset();
    mockReaddirSync.mockReset();
    mockReaddirSync.mockReturnValue([]);
    mockReportError.mockReset();
  });

  it("selects a newer PATH binary over an older Codex.app bundle in auto mode", async () => {
    const appBundle = "/Applications/Codex.app/Contents/Resources/codex";
    const pathBinary = "/Users/lh/.nvm/versions/node/v24.13.0/bin/codex";
    allowExecutable(appBundle, pathBinary);
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "codex") return `${pathBinary}\n`;
      if (command === appBundle && args[0] === "--version") return "codex-cli 0.135.0-alpha.1\n";
      if (command === pathBinary && args[0] === "--version") return "codex-cli 0.144.1\n";
      throw new Error(`unexpected command: ${command}`);
    });

    const mod = await loadModule();

    await expect(mod.getCodexBinaryPath()).resolves.toBe(pathBinary);
  });

  it("finds a newer nvm binary when PATH lookup is unavailable", async () => {
    const appBundle = "/Applications/Codex.app/Contents/Resources/codex";
    const nvmBinary = "/Users/lh/.nvm/versions/node/v24.13.0/bin/codex";
    allowExecutable(appBundle, nvmBinary);
    mockReaddirSync.mockImplementation((directory: string) => {
      if (directory === "/Users/lh/.nvm/versions/node") {
        return [{ name: "v24.13.0", isDirectory: () => true }];
      }
      return [];
    });
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which" && args[0] === "codex") throw new Error("missing from PATH");
      if (command === appBundle && args[0] === "--version") return "codex-cli 0.135.0-alpha.1\n";
      if (command === nvmBinary && args[0] === "--version") return "codex-cli 0.144.1\n";
      throw new Error(`unexpected command: ${command}`);
    });

    const mod = await loadModule();

    await expect(mod.getCodexBinaryPath()).resolves.toBe(nvmBinary);
  });
});
