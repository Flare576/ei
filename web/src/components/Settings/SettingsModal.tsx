import { useState, useEffect, useRef, useCallback } from 'react';
import { ProviderList, ProviderEditor } from '../Settings';
import type { ProviderAccount, SyncCredentials } from '../../../../src/core/types';

interface SettingsData {
  name_display?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
  ceremony_time: string;
  default_model?: string;
  accounts?: ProviderAccount[];
  sync?: SyncCredentials;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsData;
  onUpdate: (updates: Partial<SettingsData>) => void;
  onDownloadBackup: () => void;
  onUploadBackup: (file: File) => void;
}

const tabs = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'providers', label: 'Providers', icon: '🔌' },
  { id: 'data', label: 'Data', icon: '💾' },
];

export const SettingsModal = ({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onDownloadBackup,
  onUploadBackup,
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState('general');
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [localAccounts, setLocalAccounts] = useState<ProviderAccount[]>(settings.accounts || []);
  const [accountEditorOpen, setAccountEditorOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ProviderAccount | null>(null);
  
  const [syncUsername, setSyncUsername] = useState(settings.sync?.username || "");
  const [syncPassphrase, setSyncPassphrase] = useState(settings.sync?.passphrase || "");
  const [showPassphrase, setShowPassphrase] = useState(false);

  const combinedLength = syncUsername.trim().length + syncPassphrase.trim().length;
  const isCredentialsValid = combinedLength >= 15;

  useEffect(() => {
    if (isOpen) {
      setLocalAccounts(settings.accounts || []);
      setSyncUsername(settings.sync?.username || "");
      setSyncPassphrase(settings.sync?.passphrase || "");
      modalRef.current?.focus();
    }
  }, [isOpen, settings]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleChange = useCallback((field: keyof SettingsData, value: string) => {
    onUpdate({ [field]: value });
  }, [onUpdate]);

  const handleAccountAdd = useCallback(() => {
    setEditingAccount(null);
    setAccountEditorOpen(true);
  }, []);

  const handleAccountEdit = useCallback((account: ProviderAccount) => {
    setEditingAccount(account);
    setAccountEditorOpen(true);
  }, []);

  const handleAccountDelete = useCallback((id: string) => {
    const updated = localAccounts.filter(a => a.id !== id);
    setLocalAccounts(updated);
    onUpdate({ accounts: updated });
  }, [localAccounts, onUpdate]);

  const handleAccountToggle = useCallback((id: string, enabled: boolean) => {
    const updated = localAccounts.map(a => a.id === id ? { ...a, enabled } : a);
    setLocalAccounts(updated);
    onUpdate({ accounts: updated });
  }, [localAccounts, onUpdate]);

  const handleAccountSave = useCallback((account: ProviderAccount) => {
    const existing = localAccounts.find(a => a.id === account.id);
    const updated = existing
      ? localAccounts.map(a => a.id === account.id ? account : a)
      : [...localAccounts, account];
    setLocalAccounts(updated);
    onUpdate({ accounts: updated });
    setAccountEditorOpen(false);
    setEditingAccount(null);
  }, [localAccounts, onUpdate]);

  const handleAccountEditorClose = useCallback(() => {
    setAccountEditorOpen(false);
    setEditingAccount(null);
  }, []);

  const handleSyncSave = useCallback(() => {
    if (syncUsername.trim() && syncPassphrase.trim() && isCredentialsValid) {
      onUpdate({ sync: { username: syncUsername.trim(), passphrase: syncPassphrase.trim() } });
    }
  }, [syncUsername, syncPassphrase, isCredentialsValid, onUpdate]);

  const handleSyncClear = useCallback(() => {
    setSyncUsername("");
    setSyncPassphrase("");
    onUpdate({ sync: undefined });
  }, [onUpdate]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadBackup(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [onUploadBackup]);

  if (!isOpen) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="ei-settings-form">
            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Display</h3>
              
              <div className="ei-form-group">
                <label htmlFor="name-display" className="ei-form-label">Name Display</label>
                <input
                  id="name-display"
                  type="text"
                  className="ei-input"
                  value={settings.name_display || ""}
                  onChange={(e) => handleChange("name_display", e.target.value)}
                  placeholder="Your display name in chat"
                />
              </div>

              <div className="ei-form-group">
                <label htmlFor="time-mode" className="ei-form-label">Time Mode</label>
                <select
                  id="time-mode"
                  className="ei-input ei-select"
                  value={settings.time_mode || "24h"}
                  onChange={(e) => handleChange("time_mode", e.target.value)}
                >
                  <option value="24h">24-Hour</option>
                  <option value="12h">12-Hour</option>
                  <option value="local">Local Time</option>
                  <option value="utc">UTC</option>
                </select>
              </div>
            </section>

            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Ceremony</h3>
              
              <div className="ei-form-group">
                <label htmlFor="ceremony-time" className="ei-form-label">Daily Ceremony Time</label>
                <input
                  id="ceremony-time"
                  type="time"
                  className="ei-input"
                  value={settings.ceremony_time}
                  onChange={(e) => handleChange("ceremony_time", e.target.value)}
                  required
                />
                <small className="ei-form-hint">When personas reflect on conversations and evolve their knowledge</small>
              </div>
            </section>
          </div>
        );

      case 'providers':
        return (
          <div className="ei-settings-form">
            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Default Model</h3>
              
              <div className="ei-form-group">
                <label htmlFor="default-model" className="ei-form-label">Model</label>
                <input
                  id="default-model"
                  type="text"
                  className="ei-input"
                  value={settings.default_model || ""}
                  onChange={(e) => handleChange("default_model", e.target.value)}
                  placeholder="e.g., openai:gpt-4o or local:qwen3-30b"
                />
                <small className="ei-form-hint">Format: provider:model (e.g., openai:gpt-4o, local:google/gemma-3-12b)</small>
              </div>
            </section>

            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Provider Accounts</h3>
              <p className="ei-settings-section__description">
                Configure LLM and storage providers. Use account-name:model format in Default Model above.
              </p>
              <ProviderList
                accounts={localAccounts}
                onAdd={handleAccountAdd}
                onEdit={handleAccountEdit}
                onDelete={handleAccountDelete}
                onToggle={handleAccountToggle}
              />
            </section>

            <ProviderEditor
              isOpen={accountEditorOpen}
              account={editingAccount}
              onSave={handleAccountSave}
              onClose={handleAccountEditorClose}
            />
          </div>
        );

      case 'data':
        return (
          <div className="ei-settings-form">
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
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div 
      className="ei-modal-overlay" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div 
        className="ei-settings-modal ei-modal" 
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="ei-modal__header">
          <h2 id="settings-modal-title">Settings</h2>
          <button 
            className="ei-btn ei-btn--icon" 
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="ei-modal__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`ei-modal__tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="ei-modal__tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="ei-modal__content">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};
