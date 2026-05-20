import { StateManager } from "./state-manager.js";
import type { Ei_Interface, HumanEntity } from "./types.js";
import type { Storage } from "../storage/interface.js";

const DEFAULT_OPENCODE_POLLING_MS = 60000;
const DEFAULT_CLAUDE_CODE_POLLING_MS = 60000;
const DEFAULT_CURSOR_POLLING_MS = 60000;
const DEFAULT_CODEX_POLLING_MS = 60000;
const DEFAULT_PI_POLLING_MS = 60000;

export class IntegrationSyncManager {
  private lastOpenCodeSync = 0;
  private openCodeImportInProgress = false;
  private lastClaudeCodeSync = 0;
  private claudeCodeImportInProgress = false;
  private lastCursorSync = 0;
  private cursorImportInProgress = false;
  private lastCodexSync = 0;
  private codexImportInProgress = false;
  private lastPiSync = 0;
  private piImportInProgress = false;
  private lastSlackSync = 0;
  private slackImportInProgress = false;
  private personaHistoryImportInProgress = false;

  constructor(
    private stateManager: StateManager,
    private isTUI: boolean,
    private storage: Storage | null,
    private importAbortController: AbortController,
    private ei: Ei_Interface,
  ) {}

  resetImportFlags(): void {
    if (this.openCodeImportInProgress) {
      console.log("[IntegrationSyncManager] Clearing openCodeImportInProgress flag");
      this.openCodeImportInProgress = false;
    }
    if (this.claudeCodeImportInProgress) {
      console.log("[IntegrationSyncManager] Clearing claudeCodeImportInProgress flag");
      this.claudeCodeImportInProgress = false;
    }
    if (this.cursorImportInProgress) {
      console.log("[IntegrationSyncManager] Clearing cursorImportInProgress flag");
      this.cursorImportInProgress = false;
    }
    if (this.codexImportInProgress) {
      console.log("[IntegrationSyncManager] Clearing codexImportInProgress flag");
      this.codexImportInProgress = false;
    }
    if (this.piImportInProgress) {
      console.log("[IntegrationSyncManager] Clearing piImportInProgress flag");
      this.piImportInProgress = false;
    }
    if (this.slackImportInProgress) {
      console.log("[IntegrationSyncManager] Clearing slackImportInProgress flag");
      this.slackImportInProgress = false;
    }
  }

  updateAbortController(controller: AbortController): void {
    this.importAbortController = controller;
  }

  async checkAll(human: HumanEntity, now: number): Promise<void> {
    if (
      this.isTUI &&
      human.settings?.opencode?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncOpenCode(human, now);
    }

    if (this.isTUI && human.settings?.backup?.enabled) {
      await this.checkAndRunRollingBackup(human, now);
    }

    if (
      this.isTUI &&
      human.settings?.claudeCode?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncClaudeCode(human, now);
    }

    if (
      this.isTUI &&
      human.settings?.cursor?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncCursor(human, now);
    }

    if (
      this.isTUI &&
      human.settings?.codex?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncCodex(human, now);
    }

    if (
      this.isTUI &&
      human.settings?.pi?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncPi(human, now);
    }

    if (
      this.isTUI &&
      human.settings?.personaHistory?.integration &&
      !human.settings.personaHistory.complete &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncPersonaHistory(human);
    }

    if (
      this.isTUI &&
      Object.values(human.settings?.slack?.workspaces ?? {}).some(ws => ws.integration && ws.auth) &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncSlack(human, now);
    }
  }

  private async checkAndRunRollingBackup(human: HumanEntity, now: number): Promise<void> {
    if (!this.storage) return;
    const cfg = human.settings!.backup!;
    const intervalMs = cfg.interval_ms ?? 3_600_000;
    const maxBackups = cfg.max_backups ?? 24;
    const lastBackup = cfg.last_backup ? new Date(cfg.last_backup).getTime() : 0;

    if (now - lastBackup < intervalMs) return;

    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        backup: { ...cfg, last_backup: new Date(now).toISOString() },
      },
    });

    const state = this.stateManager.getStorageState();
    try {
      await this.storage.saveRollingBackup(state, maxBackups);
      console.log(`[Processor] Rolling backup saved (max=${maxBackups})`);
    } catch (err) {
      console.warn(`[Processor] Rolling backup failed:`, err);
    }
  }

  private async checkAndSyncOpenCode(human: HumanEntity, now: number): Promise<void> {
    if (this.openCodeImportInProgress) {
      return;
    }

    const opencode = human.settings?.opencode;
    const pollingInterval = opencode?.polling_interval_ms ?? DEFAULT_OPENCODE_POLLING_MS;
    const lastSync = opencode?.last_sync ? new Date(opencode.last_sync).getTime() : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastOpenCodeSync > 0) {
      return;
    }

    this.lastOpenCodeSync = now;
    const syncTimestamp = new Date().toISOString();
    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        opencode: {
          ...opencode,
          last_sync: syncTimestamp,
        },
      },
    });

    this.openCodeImportInProgress = true;
    import("../integrations/opencode/importer.js")
      .then(({ importOpenCodeSessions }) =>
        importOpenCodeSessions({
          stateManager: this.stateManager,
          interface: this.ei,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] OpenCode sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.messagesImported} messages imported, ` +
              `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] OpenCode sync failed:`, err);
      })
      .finally(() => {
        this.openCodeImportInProgress = false;
      });
  }

  private async checkAndSyncClaudeCode(human: HumanEntity, now: number): Promise<void> {
    if (this.claudeCodeImportInProgress) {
      return;
    }

    const claudeCode = human.settings?.claudeCode;
    const pollingInterval = claudeCode?.polling_interval_ms ?? DEFAULT_CLAUDE_CODE_POLLING_MS;
    const lastSync = claudeCode?.last_sync ? new Date(claudeCode.last_sync).getTime() : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastClaudeCodeSync > 0) {
      return;
    }

    this.lastClaudeCodeSync = now;
    const syncTimestamp = new Date().toISOString();
    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        claudeCode: {
          ...claudeCode,
          last_sync: syncTimestamp,
        },
      },
    });

    this.claudeCodeImportInProgress = true;
    import("../integrations/claude-code/importer.js")
      .then(({ importClaudeCodeSessions }) =>
        importClaudeCodeSessions({
          stateManager: this.stateManager,
          interface: this.ei,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] Claude Code sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.messagesImported} messages imported, ` +
              `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] Claude Code sync failed:`, err);
      })
      .finally(() => {
        this.claudeCodeImportInProgress = false;
      });
  }

  private async checkAndSyncCursor(human: HumanEntity, now: number): Promise<void> {
    if (this.cursorImportInProgress) {
      return;
    }

    const cursor = human.settings?.cursor;
    const pollingInterval = cursor?.polling_interval_ms ?? DEFAULT_CURSOR_POLLING_MS;
    const lastSync = cursor?.last_sync ? new Date(cursor.last_sync).getTime() : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastCursorSync > 0) {
      return;
    }

    this.lastCursorSync = now;
    const syncTimestamp = new Date().toISOString();
    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        cursor: {
          ...cursor,
          last_sync: syncTimestamp,
        },
      },
    });

    this.cursorImportInProgress = true;
    import("../integrations/cursor/importer.js")
      .then(({ importCursorSessions }) =>
        importCursorSessions({
          stateManager: this.stateManager,
          interface: this.ei,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] Cursor sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.messagesImported} messages imported, ` +
              `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] Cursor sync failed:`, err);
      })
      .finally(() => {
        this.cursorImportInProgress = false;
      });
  }

  private async checkAndSyncCodex(human: HumanEntity, now: number): Promise<void> {
    if (this.codexImportInProgress) {
      return;
    }

    const codex = human.settings?.codex;
    const pollingInterval = codex?.polling_interval_ms ?? DEFAULT_CODEX_POLLING_MS;
    const lastSync = codex?.last_sync ? new Date(codex.last_sync).getTime() : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastCodexSync > 0) {
      return;
    }

    this.lastCodexSync = now;
    const syncTimestamp = new Date().toISOString();
    const currentHuman = this.stateManager.getHuman();
    this.stateManager.setHuman({
      ...currentHuman,
      settings: {
        ...currentHuman.settings,
        codex: {
          ...codex,
          last_sync: syncTimestamp,
        },
      },
    });

    this.codexImportInProgress = true;
    import("../integrations/codex/importer.js")
      .then(({ importCodexSessions }) =>
        importCodexSessions({
          stateManager: this.stateManager,
          interface: this.ei,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] Codex sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.messagesImported} messages imported, ` +
              `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] Codex sync failed:`, err);
      })
      .finally(() => {
        this.codexImportInProgress = false;
      });
  }

  private async checkAndSyncPi(human: HumanEntity, now: number): Promise<void> {
    if (this.piImportInProgress) {
      return;
    }

    const pi = human.settings?.pi;
    const pollingInterval = pi?.polling_interval_ms ?? DEFAULT_PI_POLLING_MS;
    const lastSync = pi?.last_sync ? new Date(pi.last_sync).getTime() : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastPiSync > 0) {
      return;
    }

    this.lastPiSync = now;
    const syncTimestamp = new Date().toISOString();
    const currentHuman = this.stateManager.getHuman();
    this.stateManager.setHuman({
      ...currentHuman,
      settings: {
        ...currentHuman.settings,
        pi: {
          ...pi,
          last_sync: syncTimestamp,
        },
      },
    });

    this.piImportInProgress = true;
    import("../integrations/pi/importer.js")
      .then(({ importPiSessions }) =>
        importPiSessions({
          stateManager: this.stateManager,
          interface: this.ei,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] Pi sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.messagesImported} messages imported, ` +
              `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] Pi sync failed:`, err);
      })
      .finally(() => {
        this.piImportInProgress = false;
      });
  }

  private async checkAndSyncSlack(human: HumanEntity, now: number): Promise<void> {
    if (this.slackImportInProgress) return;

    const slack = human.settings?.slack;
    const pollingInterval = slack?.polling_interval_ms ?? 60_000;

    if (now - this.lastSlackSync < pollingInterval && this.lastSlackSync > 0) return;

    this.lastSlackSync = now;

    this.slackImportInProgress = true;
    import("../integrations/slack/importer.js")
      .then(({ importSlackChannel }) =>
        importSlackChannel({
          stateManager: this.stateManager,
          interface: this.ei,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.channelProcessed) {
          console.log(
            `[Processor] Slack sync: #${result.channelProcessed} — ` +
            `${result.messagesImported} messages, ${result.threadsProcessed} threads, ` +
            `${result.scansQueued} scans queued`
          );
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        const stack = err instanceof Error ? err.stack : undefined;
        console.warn(`[Processor] Slack sync failed: ${msg}${stack ? `\n${stack}` : ''}`);
      })
      .finally(() => {
        this.slackImportInProgress = false;
      });
  }

  private async checkAndSyncPersonaHistory(_human: HumanEntity): Promise<void> {
    if (this.personaHistoryImportInProgress) return;

    this.personaHistoryImportInProgress = true;
    import("../integrations/persona-history/importer.js")
      .then(({ importPersonaHistory }) =>
        importPersonaHistory({ stateManager: this.stateManager })
      )
      .then((result) => {
        if (result.scansQueued > 0) {
          console.log(
            `[Processor] PersonaHistory: ${result.scansQueued} scans queued` +
            (result.complete ? " — import complete" : "")
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] PersonaHistory sync failed:`, err);
      })
      .finally(() => {
        this.personaHistoryImportInProgress = false;
      });
  }
}
