import { describe, expect, it } from "vitest";
import type { RowDescriptor } from "@/components/ChatView";
import { computeTailStartIndex, getCachedMeasuredHeight, setCachedMeasuredHeight } from "./virtualization";

function messageRow(id: string, role: "user" | "assistant"): RowDescriptor {
  return {
    kind: "message",
    originalIndex: Number(id.replace(/\D/g, "")) || 0,
    msg: { id, role, content: id, timestamp: 1 },
  };
}

describe("chat virtualization", () => {
  it("keeps the last eight idle rows in document flow", () => {
    const rows = Array.from({ length: 20 }, (_, index) => messageRow(`m${index}`, "assistant"));
    expect(computeTailStartIndex(rows, false)).toBe(12);
  });

  it("keeps the processing turn and six preceding rows in document flow", () => {
    const rows = Array.from({ length: 20 }, (_, index) => messageRow(`m${index}`, index === 15 ? "user" : "assistant"));
    expect(computeTailStartIndex(rows, true)).toBe(9);
  });

  it("reuses measured heights", () => {
    setCachedMeasuredHeight("measured-row", 144);
    expect(getCachedMeasuredHeight("measured-row")).toBe(144);
  });
});
