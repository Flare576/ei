import { useState, useEffect, useRef, useCallback } from 'react';
import { ProviderList, ProviderEditor } from '../Settings';
import { ModelPicker } from './ModelPicker';
import { ToolkitList } from './ToolkitList';
import { ToolkitEditor } from './ToolkitEditor';
import { ThemeList } from './ThemeList';
import { ThemeEditor } from './ThemeEditor';
import type { ProviderAccount, SyncCredentials, ToolProvider, ToolDefinition } from '../../../../src/core/types';
import type { ThemeDefinition } from '../../../../src/core/types/entities.js';
import type { Processor } from '../../../../src/core/processor';

interface SettingsData {
  name_display?: string;
  ceremony_time: string;
  conversation_model?: string;
  extraction_model?: string;
  oneshot_model?: string;
  rewrite_model?: string;
  accounts?: ProviderAccount[];
  sync?: SyncCredentials;
  default_heartbeat_ms?: number;
  default_context_window_ms?: number;
  message_min_count?: number;
  message_max_age_days?: number;
  event_window_hours?: number;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsData;
  onUpdate: (updates: Partial<SettingsData>) => void;
  onDownloadBackup: () => void;
  onUploadBackup: (file: File) => void;
  processor: Processor | null;
  toolProviders: ToolProvider[];
  toolDefinitions: ToolDefinition[];
  onToolProviderUpdate: (id: string, updates: Partial<Omit<ToolProvider, 'id' | 'created_at'>>) => void;
  onToolProviderRemove: (id: string) => void;
  onSpotifyConfigChange?: (refreshToken: string) => void;
  onToolUpdate: (id: string, updates: Partial<Omit<ToolDefinition, 'id' | 'created_at'>>) => void;
  activeTheme?: string;
  customThemes?: ThemeDefinition[];
  onThemeChange?: (id: string) => void;
  onCustomThemeUpsert?: (theme: ThemeDefinition) => void;
  onCustomThemeRemove?: (id: string) => void;
}

const tabs = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'providers', label: 'Providers', icon: '🔌' },
  { id: 'toolkits', label: 'Toolkits', icon: '🔧' },
  { id: 'data', label: 'Data', icon: '💾' },
];

export const SettingsModal = ({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onDownloadBackup,
  onUploadBackup,
  toolProviders,
  toolDefinitions,
  onToolProviderUpdate,
  onToolProviderRemove,
  onToolUpdate,
  onSpotifyConfigChange,
  activeTheme,
  customThemes = [],
  onThemeChange,
  onCustomThemeUpsert,
  onCustomThemeRemove,
  processor,
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState('general');
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [localAccounts, setLocalAccounts] = useState<ProviderAccount[]>(settings.accounts || []);
  const [accountEditorOpen, setAccountEditorOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ProviderAccount | null>(null);
  const [toolkitEditorOpen, setToolkitEditorOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ToolProvider | null>(null);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<ThemeDefinition | null>(null);
  
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
    }
  }, [isOpen, settings]);

  useEffect(() => {
    if (isOpen) {
      modalRef.current?.focus();
    }
  }, [isOpen]);

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

  const handleAccountDelete = useCallback(async (id: string) => {
    if (!processor) return;
    const result = await processor.deleteProvider(id);
    if (!result.success) {
      alert(`Failed to delete provider: ${result.error ?? 'Unknown error'}`);
      return;
    }
    const updated = localAccounts.filter(a => a.id !== id);
    setLocalAccounts(updated);
    onUpdate({ accounts: updated });
  }, [processor, localAccounts, onUpdate]);

  const handleAccountToggle = useCallback((id: string, enabled: boolean) => {
    const updated = localAccounts.map(a => a.id === id ? { ...a, enabled } : a);
    setLocalAccounts(updated);
    onUpdate({ accounts: updated });
  }, [localAccounts, onUpdate]);

  const handleAccountSave = useCallback(async (account: ProviderAccount) => {
    if (!processor) return;

    const result = await processor.upsertProviderAccount(account);
    if (!result.success) {
      alert(`Failed to save provider: ${result.error ?? 'Unknown error'}`);
      return;
    }

    // Re-read from the processor instead of hand-building the array from
    // localAccounts: upsertProviderAccount() mutates HumanSettings.accounts
    // in place (state-manager.ts push/index-assign), and localAccounts is
    // initialized straight from that same array reference (never cloned by
    // stripHumanEmbeddings), so appending to it here would double the just-
    // saved account (provider-management E2E "can add a new provider").
    const freshHuman = await processor.getHuman();
    const updated = freshHuman.settings?.accounts ?? [];
    setLocalAccounts(updated);
    onUpdate({ accounts: updated });
    setAccountEditorOpen(false);
    setEditingAccount(null);
  }, [processor, onUpdate]);

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


            </section>

            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Persona Defaults</h3>
              
              <div className="ei-form-group">
                <label htmlFor="default-heartbeat" className="ei-form-label">Default Heartbeat (minutes)</label>
                <input
                  id="default-heartbeat"
                  type="number"
                  className="ei-input"
                  min="1"
                  value={settings.default_heartbeat_ms != null ? Math.round(settings.default_heartbeat_ms / 60000) : 30}
                  onChange={(e) => onUpdate({ default_heartbeat_ms: Number(e.target.value) * 60000 })}
                />
                <small className="ei-form-hint">Default heartbeat interval for new personas</small>
              </div>

              <div className="ei-form-group">
                <label htmlFor="default-context-window" className="ei-form-label">Default Context Window (hours)</label>
                <input
                  id="default-context-window"
                  type="number"
                  className="ei-input"
                  min="1"
                  value={Math.round((settings.default_context_window_ms ?? 28800000) / 3600000)}
                  onChange={(e) => onUpdate({ default_context_window_ms: Number(e.target.value) * 3600000 })}
                />
                <small className="ei-form-hint">How far back to include conversation history</small>
              </div>
            </section>

            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Message Lifecycle</h3>
              
              <div className="ei-form-group">
                <label htmlFor="message-min-count" className="ei-form-label">Min Messages to Keep</label>
                <input
                  id="message-min-count"
                  type="number"
                  className="ei-input"
                  min="1"
                  value={settings.message_min_count ?? 200}
                  onChange={(e) => onUpdate({ message_min_count: Number(e.target.value) })}
                />
                <small className="ei-form-hint">Minimum messages preserved per persona during cleanup</small>
              </div>

              <div className="ei-form-group">
                <label htmlFor="message-max-age" className="ei-form-label">Message Rolloff Age (days)</label>
                <input
                  id="message-max-age"
                  type="number"
                  className="ei-input"
                  min="1"
                  value={settings.message_max_age_days ?? 14}
                  onChange={(e) => onUpdate({ message_max_age_days: Number(e.target.value) })}
                />
                <small className="ei-form-hint">Messages older than this may be cleaned up</small>
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

              <div className="ei-form-group">
                <label htmlFor="event-window-hours" className="ei-form-label">Event Window (hours)</label>
                <input
                  id="event-window-hours"
                  type="number"
                  className="ei-input"
                  min="1"
                  value={settings.event_window_hours ?? ""}
                  onChange={(e) => onUpdate({ event_window_hours: e.target.value ? Number(e.target.value) : undefined })}
                />
                <small className="ei-form-hint">Treat gaps of this duration or more as separate events</small>
              </div>
            </section>
          </div>
        );

      case 'appearance':
        return (
          <div className="ei-settings-form">
            <ThemeList
              activeTheme={activeTheme}
              customThemes={customThemes}
              onSelect={(id) => onThemeChange?.(id)}
              onEdit={(theme) => {
                setEditingTheme(theme);
                setThemeEditorOpen(true);
              }}
              onDelete={(id) => onCustomThemeRemove?.(id)}
              onCreateNew={() => {
                setEditingTheme(null);
                setThemeEditorOpen(true);
              }}
            />

            <ThemeEditor
              isOpen={themeEditorOpen}
              theme={editingTheme}
              onSave={(saved) => {
                onCustomThemeUpsert?.(saved);
                setThemeEditorOpen(false);
                setEditingTheme(null);
              }}
              onClose={() => {
                setThemeEditorOpen(false);
                setEditingTheme(null);
              }}
              activeTheme={activeTheme}
              customThemes={customThemes}
            />
          </div>
        );

      case 'providers':
        return (
          <div className="ei-settings-form">
            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Default Models</h3>
              
              <ModelPicker
                id="conversation-model"
                label="Conversation Model"
                value={settings.conversation_model}
                onChange={(modelId) => onUpdate({ conversation_model: modelId })}
                accounts={localAccounts}
                hint="Used for chat responses and all background processing."
              />

              <ModelPicker
                id="extraction-model"
                label="Extraction Model"
                value={settings.extraction_model}
                onChange={(modelId) => onUpdate({ extraction_model: modelId })}
                accounts={localAccounts}
                allowEmpty
                optionalLabel
                hint="Fallback model for background extraction and analysis tasks."
              />

              <ModelPicker
                id="oneshot-model"
                label="🪄 Wand Model"
                value={settings.oneshot_model}
                onChange={(modelId) => onUpdate({ oneshot_model: modelId })}
                accounts={localAccounts}
                allowEmpty
                optionalLabel
                hint="Model used for AI-assist (✨) buttons. Falls back to Conversation Model if not set."
              />

              <ModelPicker
                id="rewrite-model"
                label="🔄 Rewrite Model"
                value={settings.rewrite_model}
                onChange={(modelId) => onUpdate({ rewrite_model: modelId })}
                accounts={localAccounts}
                allowEmpty
                optionalLabel
                hint="Model for the nightly Rewrite ceremony. Use a capable model (Sonnet/Opus class). Unset = rewrite disabled."
              />
            </section>

            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Provider Accounts</h3>
              <p className="ei-settings-section__description">
                Configure LLM and storage providers. Use account-name:model format in Conversation Model above.
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

      case 'toolkits':
        return (
          <div className="ei-settings-form">
            <section className="ei-settings-section">
              <h3 className="ei-settings-section__title">Tool Kits</h3>
              <p className="ei-settings-section__description">
                Manage tool providers that personas can use during conversations.
              </p>
              <ToolkitList
                providers={toolProviders}
                tools={toolDefinitions}
                onEdit={(provider) => {
                  setEditingProvider(provider);
                  setToolkitEditorOpen(true);
                }}
                onDelete={onToolProviderRemove}
                onToggleProvider={(id, enabled) => onToolProviderUpdate(id, { enabled })}
                onToggleTool={(id, enabled) => onToolUpdate(id, { enabled })}
              />
            </section>

            <ToolkitEditor
              onSpotifyConfigChange={onSpotifyConfigChange}
              isOpen={toolkitEditorOpen}
              provider={editingProvider}
              tools={toolDefinitions}
              onToolUpdate={onToolUpdate}
              onSave={(updated) => {
                onToolProviderUpdate(updated.id, {
                  display_name: updated.display_name,
                  description: updated.description,
                  enabled: updated.enabled,
                  config: updated.config,
                });
                setToolkitEditorOpen(false);
                setEditingProvider(null);
              }}
              onClose={() => {
                setToolkitEditorOpen(false);
                setEditingProvider(null);
              }}
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
