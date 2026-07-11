import type { RemoteCommandKind } from "@shared/types/remote";

interface RateRule {
  windowMs: number;
  limit: number;
}

const DEFAULT_RULE: RateRule = { windowMs: 60_000, limit: 120 };

const RATE_RULES: Partial<Record<RemoteCommandKind, RateRule>> = {
  "chat.send": { windowMs: 60_000, limit: 30 },
  "task.start": { windowMs: 60_000, limit: 10 },
  "turn.interrupt": { windowMs: 60_000, limit: 20 },
  "turn.stop": { windowMs: 60_000, limit: 20 },
  "permission.respond": { windowMs: 60_000, limit: 5 },
  "terminal.write": { windowMs: 60_000, limit: 60 },
  "terminal.ctrl_c": { windowMs: 60_000, limit: 20 },
  "diff.file": { windowMs: 60_000, limit: 30 },
};

interface Bucket {
  startedAt: number;
  count: number;
}

export class RemoteRateLimit {
  private buckets = new Map<string, Bucket>();

  check(input: {
    userId: string;
    kind: RemoteCommandKind;
    now?: number;
  }): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const now = input.now ?? Date.now();
    const rule = RATE_RULES[input.kind] ?? DEFAULT_RULE;
    const key = `${input.userId}:${input.kind}`;
    const existing = this.buckets.get(key);

    if (!existing || now - existing.startedAt >= rule.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true };
    }

    if (existing.count >= rule.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, rule.windowMs - (now - existing.startedAt)),
      };
    }

    existing.count += 1;
    return { allowed: true };
  }

  reset(): void {
    this.buckets.clear();
  }
}
