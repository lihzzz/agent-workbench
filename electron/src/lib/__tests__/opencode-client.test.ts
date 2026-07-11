import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp",
  },
}));

let allocateLoopbackPort: typeof import("../opencode-client").allocateLoopbackPort;

beforeAll(async () => {
  ({ allocateLoopbackPort } = await import("../opencode-client"));
});

describe("OpenCode client infrastructure", () => {
  it("allocates a valid loopback port", async () => {
    const port = await allocateLoopbackPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);
  });
});
