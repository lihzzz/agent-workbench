import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockApp,
  mockWrite,
} = vi.hoisted(() => ({
  mockApp: {
    isPackaged: true,
    getPath: vi.fn(() => "/mock"),
  },
  mockWrite: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mockApp,
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const mocked = {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({ write: mockWrite })),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

import { formatLogData, log, logDebug } from "../logger";

describe("logger redaction", () => {
  beforeEach(() => {
    mockWrite.mockClear();
    delete process.env.HARNSS_EVENT_FULL;
    delete process.env.HARNSS_LOG_LEVEL;
  });

  it("redacts sensitive object fields recursively", () => {
    const line = formatLogData({
      headers: {
        Authorization: "Bearer super-secret-token",
      },
      nested: {
        refresh_token: "refresh-secret",
      },
      safe: "ok",
    });

    expect(line).toContain('"Authorization": "[REDACTED]"');
    expect(line).toContain('"refresh_token": "[REDACTED]"');
    expect(line).toContain('"safe": "ok"');
    expect(line).not.toContain("super-secret-token");
    expect(line).not.toContain("refresh-secret");
  });

  it("redacts credentials embedded in strings", () => {
    const line = formatLogData(
      "Authorization=Bearer super-secret https://user:pass@example.com/callback?access_token=abc123",
    );

    expect(line).toContain("Authorization=[REDACTED]");
    expect(line).toContain("https://[REDACTED]@example.com/callback?access_token=[REDACTED]");
    expect(line).not.toContain("super-secret");
    expect(line).not.toContain("user:pass");
    expect(line).not.toContain("abc123");
  });

  it("sanitizes logged errors", () => {
    log("TEST", new Error("token=abc123 failed"));

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const output = mockWrite.mock.calls[0][0] as string;
    expect(output).toContain("token=[REDACTED]");
    expect(output).not.toContain("abc123");
  });

  it("bounds strings, arrays, object keys, nesting, and formatted size", () => {
    const nested = { value: "leaf" };
    let current: Record<string, unknown> = nested;
    for (let index = 0; index < 10; index += 1) {
      current = { child: current };
    }

    const line = formatLogData({
      long: "x".repeat(3_000),
      list: Array.from({ length: 120 }, (_, index) => index),
      object: Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`key${index}`, index])),
      current,
      huge: "y".repeat(100_000),
    });

    expect(line).toContain("[truncated");
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(64 * 1_024);
  });

  it("only writes debug events when explicitly enabled", () => {
    logDebug("EVENT_FULL", { prompt: "hidden" });
    expect(mockWrite).not.toHaveBeenCalled();

    process.env.HARNSS_EVENT_FULL = "1";
    logDebug("EVENT_FULL", { prompt: "visible" });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });
});
