import { safeStorage } from "electron";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { getDataDir } from "../data-dir";
import { atomicWriteFile } from "../atomic-write";

export interface RemoteCredential {
  desktopId: string;
  serverUrl: string;
  desktopName: string;
  deviceToken: string;
  pairedAt: number;
}

interface StoredRemoteCredential {
  version: 1;
  desktopId: string;
  serverUrl: string;
  desktopName: string;
  pairedAt: number;
  tokenEncoding: "safeStorage" | "plaintext";
  tokenCiphertext: string;
}

export interface RemoteCredentialPublicState {
  paired: boolean;
  desktopId?: string;
  serverUrl?: string;
  desktopName?: string;
  pairedAt?: number;
}

function credentialPath(): string {
  return path.join(getDataDir(), "remote-control-credential.json");
}

function normalizeServerUrl(serverUrl: string): string {
  const parsed = new URL(serverUrl.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Remote server URL must use http(s) or ws(s)");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptToken(token: string): Pick<StoredRemoteCredential, "tokenEncoding" | "tokenCiphertext"> {
  if (canEncrypt()) {
    return {
      tokenEncoding: "safeStorage",
      tokenCiphertext: safeStorage.encryptString(token).toString("base64"),
    };
  }
  return {
    tokenEncoding: "plaintext",
    tokenCiphertext: Buffer.from(token, "utf-8").toString("base64"),
  };
}

function decryptToken(stored: StoredRemoteCredential): string {
  const bytes = Buffer.from(stored.tokenCiphertext, "base64");
  if (stored.tokenEncoding === "safeStorage") {
    return safeStorage.decryptString(bytes);
  }
  return bytes.toString("utf-8");
}

async function readStoredCredential(): Promise<StoredRemoteCredential | null> {
  try {
    const raw = await fs.readFile(credentialPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredRemoteCredential>;
    if (
      parsed.version !== 1 ||
      typeof parsed.desktopId !== "string" ||
      typeof parsed.serverUrl !== "string" ||
      typeof parsed.desktopName !== "string" ||
      typeof parsed.pairedAt !== "number" ||
      (parsed.tokenEncoding !== "safeStorage" && parsed.tokenEncoding !== "plaintext") ||
      typeof parsed.tokenCiphertext !== "string"
    ) {
      return null;
    }
    return parsed as StoredRemoteCredential;
  } catch {
    return null;
  }
}

export class RemoteCredentialStore {
  async get(): Promise<RemoteCredential | null> {
    const stored = await readStoredCredential();
    if (!stored) return null;
    try {
      return {
        desktopId: stored.desktopId,
        serverUrl: stored.serverUrl,
        desktopName: stored.desktopName,
        pairedAt: stored.pairedAt,
        deviceToken: decryptToken(stored),
      };
    } catch {
      return null;
    }
  }

  async getPublicState(): Promise<RemoteCredentialPublicState> {
    const stored = await readStoredCredential();
    if (!stored) return { paired: false };
    return {
      paired: true,
      desktopId: stored.desktopId,
      serverUrl: stored.serverUrl,
      desktopName: stored.desktopName,
      pairedAt: stored.pairedAt,
    };
  }

  async save(input: {
    serverUrl: string;
    desktopName: string;
    deviceToken: string;
    desktopId?: string;
  }): Promise<RemoteCredential> {
    const credential: RemoteCredential = {
      desktopId: input.desktopId?.trim() || crypto.randomUUID(),
      serverUrl: normalizeServerUrl(input.serverUrl),
      desktopName: input.desktopName.trim() || "Harnss Desktop",
      deviceToken: input.deviceToken,
      pairedAt: Date.now(),
    };
    const encrypted = encryptToken(credential.deviceToken);
    const stored: StoredRemoteCredential = {
      version: 1,
      desktopId: credential.desktopId,
      serverUrl: credential.serverUrl,
      desktopName: credential.desktopName,
      pairedAt: credential.pairedAt,
      ...encrypted,
    };
    await atomicWriteFile(credentialPath(), JSON.stringify(stored, null, 2), 0o600);
    return credential;
  }

  async clear(): Promise<void> {
    await fs.unlink(credentialPath()).catch(() => undefined);
  }
}
