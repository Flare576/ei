import React from "react";
import { ProviderList, ProviderEditor } from '../../Settings';
import type { ProviderAccount, SyncCredentials } from '../../../../../src/core/types.js';

interface HumanSettings {
  auto_save_interval_ms?: number;
  default_model?: string;
  queue_paused?: boolean;
  name_color?: string;
  name_display?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
  accounts?: ProviderAccount[];
  sync?: SyncCredentials;
}

interface HumanSettingsTabProps {
  settings: HumanSettings;
  onChange: (field: keyof HumanSettings, value: HumanSettings[keyof HumanSettings]) => void;
  accounts: ProviderAccount[];
  onAccountAdd: () => void;
  onAccountEdit: (account: ProviderAccount) => void;
  onAccountDelete: (id: string) => void;
  onAccountToggle: (id: string, enabled: boolean) => void;
  editorOpen: boolean;
  editingAccount: ProviderAccount | null;
  onEditorClose: () => void;
  onAccountSave: (account: ProviderAccount) => void;
  onDownloadBackup: () => void;
  onUploadBackup: (file: File) => void;
  onSyncCredentialsChange: (sync: SyncCredentials | undefined) => void;
}

export const HumanSettingsTab: React.FC<HumanSettingsTabProps> = ({ 
  settings, 
  onChange,
  accounts,
  onAccountAdd,
  onAccountEdit,
  onAccountDelete,
  onAccountToggle,
  editorOpen,
  editingAccount,
  onEditorClose,
  onAccountSave,
  onDownloadBackup,
  onUploadBackup,
  onSyncCredentialsChange,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const intervalMinutes = settings.auto_save_interval_ms ? Math.round(settings.auto_save_interval_ms / 60000) : 1;
  const [syncUsername, setSyncUsername] = React.useState(settings.sync?.username || "");
  const [syncPassphrase, setSyncPassphrase] = React.useState(settings.sync?.passphrase || "");
  const [showPassphrase, setShowPassphrase] = React.useState(false);

  const combinedLength = syncUsername.trim().length + syncPassphrase.trim().length;
  const isCredentialsValid = combinedLength >= 15;

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const minutes = parseInt(e.target.value, 10);
    if (!isNaN(minutes) && minutes > 0) {
      onChange("auto_save_interval_ms", minutes * 60000);
    }
  };

  const handleSyncSave = () => {
    if (syncUsername.trim() && syncPassphrase.trim() && isCredentialsValid) {
      onSyncCredentialsChange({ username: syncUsername.trim(), passphrase: syncPassphrase.trim() });
    }
  };

  const handleSyncClear = () => {
    setSyncUsername("");
    setSyncPassphrase("");
    onSyncCredentialsChange(undefined);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadBackup(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="ei-settings-form">
      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Display Settings</h3>
        
        <div className="ei-form-group">
          <label htmlFor="name-display" className="ei-form-label">Name Display</label>
          <input
            id="name-display"
            type="text"
            className="ei-input"
            value={settings.name_display || ""}
            onChange={(e) => onChange("name_display", e.target.value)}
            placeholder="Your display name in chat"
          />
        </div>

        <div className="ei-form-group">
          <label htmlFor="name-color" className="ei-form-label">Name Color</label>
          <div className="ei-color-input-wrapper">
            <input
              id="name-color"
              type="color"
              className="ei-color-input"
              value={settings.name_color || "#007bff"}
              onChange={(e) => onChange("name_color", e.target.value)}
            />
            <span className="ei-color-value">{settings.name_color || "#007bff"}</span>
          </div>
        </div>

        <div className="ei-form-group">
          <label htmlFor="time-mode" className="ei-form-label">Time Mode</label>
          <select
            id="time-mode"
            className="ei-input ei-select"
            value={settings.time_mode || "24h"}
            onChange={(e) => onChange("time_mode", e.target.value as HumanSettings["time_mode"])}
          >
            <option value="24h">24-Hour</option>
            <option value="12h">12-Hour</option>
            <option value="local">Local Time</option>
            <option value="utc">UTC</option>
          </select>
        </div>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">System Settings</h3>

        <div className="ei-form-group">
          <label htmlFor="auto-save-interval" className="ei-form-label">Auto-save Interval (minutes)</label>
          <input
            id="auto-save-interval"
            type="number"
            min="1"
            className="ei-input"
            value={intervalMinutes}
            onChange={handleIntervalChange}
          />
          <small className="ei-form-hint">How often to automatically save your progress</small>
        </div>

        <div className="ei-form-group">
          <label htmlFor="default-model" className="ei-form-label">Default Model</label>
          <input
            id="default-model"
            type="text"
            className="ei-input"
            value={settings.default_model || ""}
            onChange={(e) => onChange("default_model", e.target.value)}
            placeholder="e.g., openai:gpt-4o or local:qwen3-30b"
          />
          <small className="ei-form-hint">Format: provider:model (e.g., openai:gpt-4o, local:google/gemma-3-12b)</small>
        </div>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Backup & Restore</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            type="button"
            className="ei-btn ei-btn--primary"
            onClick={onDownloadBackup}
          >
            📥 Download Backup
          </button>
          <button
            type="button"
            className="ei-btn ei-btn--secondary"
            onClick={handleUploadClick}
          >
            📤 Upload Backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>
        <small className="ei-form-hint">Download creates a JSON backup file. Upload restores from a backup.</small>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Cloud Sync</h3>
        <p className="ei-settings-section__description">
          Sync your data across devices. Data is encrypted before leaving your device.
        </p>
        
        <div className="ei-form-group">
          <label htmlFor="sync-username" className="ei-form-label">Username</label>
          <input
            id="sync-username"
            type="text"
            className="ei-input"
            value={syncUsername}
            onChange={(e) => setSyncUsername(e.target.value)}
            placeholder="Choose a username"
          />
        </div>

        <div className="ei-form-group">
          <label htmlFor="sync-passphrase" className="ei-form-label">Passphrase</label>
          <div className="ei-input-with-button">
            <input
              id="sync-passphrase"
              type={showPassphrase ? "text" : "password"}
              className="ei-input"
              value={syncPassphrase}
              onChange={(e) => setSyncPassphrase(e.target.value)}
              placeholder="Choose a strong passphrase"
            />
            <button
              type="button"
              className="ei-btn ei-btn--icon ei-input-toggle"
              onClick={() => setShowPassphrase(!showPassphrase)}
              title={showPassphrase ? "Hide passphrase" : "Show passphrase"}
            >
              {showPassphrase ? "🙈" : "👁️"}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="ei-btn ei-btn--primary"
            onClick={handleSyncSave}
            disabled={!syncUsername.trim() || !syncPassphrase.trim() || !isCredentialsValid}
          >
            {settings.sync ? '🔄 Update Sync' : '☁️ Enable Sync'}
          </button>
          {settings.sync && (
            <button
              type="button"
              className="ei-btn ei-btn--secondary"
              onClick={handleSyncClear}
            >
              🚫 Disable Sync
            </button>
          )}
        </div>
        {!isCredentialsValid && (syncUsername || syncPassphrase) && (
          <small className="ei-form-hint ei-form-hint--error" style={{ marginTop: '0.5rem', display: 'block' }}>
            Username + Passphrase must be at least 15 characters to generate a reliable encryption key ({combinedLength}/15)
          </small>
        )}
        {settings.sync && (
          <small className="ei-form-hint" style={{ marginTop: '0.5rem', display: 'block' }}>
            ✅ Cloud sync enabled for user: {settings.sync.username}
          </small>
        )}
        <div className="ei-form-warning">
          ⚠️ Only you, on this computer, can see the Passphrase. If you lose this device and forget your Passphrase, it is NOT recoverable. Keep it safe.
        </div>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Provider Accounts</h3>
        <p className="ei-settings-section__description">
          Configure LLM and storage providers. Use account-name:model format in Default Model above.
        </p>
        <ProviderList
          accounts={accounts}
          onAdd={onAccountAdd}
          onEdit={onAccountEdit}
          onDelete={onAccountDelete}
          onToggle={onAccountToggle}
        />
      </section>

      <ProviderEditor
        isOpen={editorOpen}
        account={editingAccount}
        onSave={onAccountSave}
        onClose={onEditorClose}
      />
    </div>
  );
};
