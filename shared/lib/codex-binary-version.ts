export interface CodexBinaryCandidate {
  path: string;
  versionOutput?: string | null;
}

interface ParsedCodexVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseCodexCliVersion(output: string | null | undefined): ParsedCodexVersion | null {
  if (!output) return null;
  const match = output.match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aParts = a.split(".");
  const bParts = b.split(".");
  const maxLength = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart == null) return -1;
    if (bPart == null) return 1;

    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : null;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : null;
    if (aNumber != null && bNumber != null) {
      if (aNumber !== bNumber) return aNumber - bNumber;
      continue;
    }
    if (aNumber != null) return -1;
    if (bNumber != null) return 1;
    const lexical = aPart.localeCompare(bPart);
    if (lexical !== 0) return lexical;
  }
  return 0;
}

function compareParsedCodexVersions(a: ParsedCodexVersion, b: ParsedCodexVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function pickNewestCodexBinary<T extends CodexBinaryCandidate>(candidates: T[]): T | null {
  let best: T | null = null;
  let bestVersion: ParsedCodexVersion | null = null;

  for (const candidate of candidates) {
    const candidateVersion = parseCodexCliVersion(candidate.versionOutput);
    if (!best) {
      best = candidate;
      bestVersion = candidateVersion;
      continue;
    }

    if (candidateVersion && !bestVersion) {
      best = candidate;
      bestVersion = candidateVersion;
      continue;
    }

    if (!candidateVersion || !bestVersion) continue;
    if (compareParsedCodexVersions(candidateVersion, bestVersion) > 0) {
      best = candidate;
      bestVersion = candidateVersion;
    }
  }

  return best;
}
