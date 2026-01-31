import React from "react";

interface HumanSettings {
  auto_save_interval_ms?: number;
  default_model?: string;
  queue_paused?: boolean;
  name_color?: string;
  name_display?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
}

interface HumanSettingsTabProps {
  settings: HumanSettings;
  onChange: (field: keyof HumanSettings, value: HumanSettings[keyof HumanSettings]) => void;
}

export const HumanSettingsTab: React.FC<HumanSettingsTabProps> = ({ settings, onChange }) => {
  const intervalMinutes = settings.auto_save_interval_ms ? Math.round(settings.auto_save_interval_ms / 60000) : 1;

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const minutes = parseInt(e.target.value, 10);
    if (!isNaN(minutes) && minutes > 0) {
      onChange("auto_save_interval_ms", minutes * 60000);
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
    </div>
  );
};
