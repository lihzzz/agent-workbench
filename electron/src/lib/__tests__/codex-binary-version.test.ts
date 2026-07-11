import { describe, expect, it } from "vitest";
import { parseCodexCliVersion, pickNewestCodexBinary } from "@shared/lib/codex-binary-version";

describe("Codex binary version selection", () => {
  it("parses codex CLI version output", () => {
    expect(parseCodexCliVersion("codex-cli 0.144.1")).toMatchObject({
      major: 0,
      minor: 144,
      patch: 1,
      prerelease: null,
    });
    expect(parseCodexCliVersion("codex-cli 0.135.0-alpha.1")).toMatchObject({
      major: 0,
      minor: 135,
      patch: 0,
      prerelease: "alpha.1",
    });
  });

  it("selects the newer PATH binary over an older Codex.app bundle", () => {
    const selected = pickNewestCodexBinary([
      {
        path: "/Applications/Codex.app/Contents/Resources/codex",
        versionOutput: "codex-cli 0.135.0-alpha.1",
      },
      {
        path: "/Users/lh/.nvm/versions/node/v24.13.0/bin/codex",
        versionOutput: "codex-cli 0.144.1",
      },
    ]);

    expect(selected?.path).toBe("/Users/lh/.nvm/versions/node/v24.13.0/bin/codex");
  });

  it("keeps a stable release over a prerelease with the same base version", () => {
    const selected = pickNewestCodexBinary([
      { path: "/alpha/codex", versionOutput: "codex-cli 0.144.1-alpha.1" },
      { path: "/stable/codex", versionOutput: "codex-cli 0.144.1" },
    ]);

    expect(selected?.path).toBe("/stable/codex");
  });
});
