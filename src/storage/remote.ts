import type { StorageState } from "../core/types.js";
import { encrypt, decrypt, generateUserId, type CryptoCredentials, type EncryptedPayload } from "./crypto.js";
import { compress, decompress, isCompressed } from "./compress.js";

const API_BASE = "https://flare576.com/ei/api";

export interface RemoteSyncCredentials extends CryptoCredentials {}

export interface RemoteTimestamp {
  exists: boolean;
  lastModified: Date | null;
}

export interface SyncResult {
  success: boolean;
  error?: string;
  retryAfter?: number;
}

export interface FetchResult {
  success: boolean;
  state?: StorageState;
  error?: string;
}

export class RemoteSync {
  private credentials: RemoteSyncCredentials | null = null;
  private userId: string | null = null;

  private lastEtag: string | null = null;
  async configure(credentials: RemoteSyncCredentials): Promise<void> {
    this.credentials = credentials;
    this.userId = await generateUserId(credentials);
  }

  isConfigured(): boolean {
    return this.credentials !== null && this.userId !== null;
  }

  async checkRemote(): Promise<RemoteTimestamp> {
    if (!this.userId) {
      return { exists: false, lastModified: null };
    }

    try {
      const response = await fetch(`${API_BASE}/${this.userId}`, {
        method: "HEAD",
      });

      if (response.status === 404) {
        return { exists: false, lastModified: null };
      }

      if (!response.ok) {
        return { exists: false, lastModified: null };
      }

      const lastModifiedHeader = response.headers.get("Last-Modified");
      const lastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
      // Capture etag for concurrency protection
      this.lastEtag = response.headers.get("ETag");
      return { exists: true, lastModified };
    } catch {
      return { exists: false, lastModified: null };
    }
  }

  async sync(state: StorageState): Promise<SyncResult> {
    if (!this.credentials || !this.userId) {
      return { success: false, error: "Not configured" };
    }

    try {
      const stateJson = JSON.stringify(state);
      const compressed = await compress(stateJson);
      const encrypted = await encrypt(compressed, this.credentials);
      const encryptedJson = JSON.stringify(encrypted);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.lastEtag) {
        headers["If-Match"] = this.lastEtag;
      }
      const response = await fetch(`${API_BASE}/${this.userId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: encryptedJson }),
      });

      if (response.status === 412) {
        return { success: false, error: "conflict" };
      }
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "3600", 10);
        return { success: false, error: "Rate limit exceeded", retryAfter };
      }
      if (!response.ok) {
        return { success: false, error: `Server error: ${response.status}` };
      }

      // Capture new etag after successful push
      this.lastEtag = response.headers.get("ETag");
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  async fetch(): Promise<FetchResult> {
    if (!this.credentials || !this.userId) {
      return { success: false, error: "Not configured" };
    }

    try {
      const response = await fetch(`${API_BASE}/${this.userId}`, {
        method: "GET",
      });

      if (response.status === 404) {
        return { success: false, error: "No remote state found" };
      }

      if (!response.ok) {
        return { success: false, error: `Server error: ${response.status}` };
      }

      const body = await response.json();
      const encrypted: EncryptedPayload = JSON.parse(body.data);
      const decryptedPayload = await decrypt(encrypted, this.credentials);
      // Support both compressed (new) and uncompressed (legacy) remote state
      const decryptedJson = isCompressed(decryptedPayload) ? await decompress(decryptedPayload) : decryptedPayload;
      const state = JSON.parse(decryptedJson) as StorageState;
      // Capture etag for concurrency protection
      this.lastEtag = response.headers.get("ETag");
      return { success: true, state };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  clear(): void {
    this.credentials = null;
    this.userId = null;
    this.lastEtag = null;
  }
}

export const remoteSync = new RemoteSync();
