import React from "react";
import { ModelPicker } from "../../Settings/ModelPicker";
import { GroupChipEditor } from "../GroupChipEditor";
import type { ProviderAccount } from "../../../../../src/core/types";

interface PersonaEntity {
  entity: "system";
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  group_primary?: string | null;
  groups_visible?: string[];
  traits: unknown[];
  topics: unknown[];
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  is_static: boolean;
  heartbeat_delay_ms?: number;
  context_window_hours?: number;
  include_message_timestamps?: boolean;
  context_boundary?: string;
  last_updated: string;
  last_activity: string;
  last_heartbeat?: string;
  last_extraction?: string;
  last_inactivity_ping?: string;
  preferred_theme?: string;
}

const isEiPersona = (persona: PersonaEntity): boolean => {
  return persona.aliases?.[0]?.toLowerCase() === "ei";
};

interface PersonaSettingsTabProps {
  persona: PersonaEntity;
  onChange: (field: keyof PersonaEntity, value: PersonaEntity[keyof PersonaEntity]) => void;
  availableGroups?: string[];
  accounts?: ProviderAccount[];
  customThemes?: { id: string; name: string }[];
}

export const PersonaSettingsTab: React.FC<PersonaSettingsTabProps> = ({
  persona,
  onChange,
  availableGroups = [],
  accounts = [],
  customThemes = [],
}) => {
  
  const heartbeatMinutes = persona.heartbeat_delay_ms ? Math.round(persona.heartbeat_delay_ms / 60000) : 30;
  const contextHours = persona.context_window_hours ?? 8;

  const handleHeartbeatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const minutes = parseInt(e.target.value, 10);
    if (!isNaN(minutes) && minutes > 0) {
      onChange("heartbeat_delay_ms", minutes * 60000);
    }
  };

  const handleContextWindowChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hours = parseInt(e.target.value, 10);
    if (!isNaN(hours) && hours > 0) {
      onChange("context_window_hours", hours);
    }
  };

  const handlePausedToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isPaused = e.target.checked;
    onChange("is_paused", isPaused);
    if (!isPaused) {
      onChange("pause_until", undefined);
    }
  };

  const handlePauseUntilChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange("pause_until", e.target.value || undefined);
  };

  const handleArchivedToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isArchived = e.target.checked;
    onChange("is_archived", isArchived);
    if (isArchived && !persona.archived_at) {
      onChange("archived_at", new Date().toISOString());
    }
  };

  const handleStaticToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange("is_static", e.target.checked);
  };

  const handleTimestampsToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange("include_message_timestamps", e.target.checked);
  };



  return (
    <div className="ei-settings-form">
      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Behavior Settings</h3>

        <div className="ei-form-group">
          <label htmlFor="heartbeat-length" className="ei-form-label">
            Heartbeat Length (minutes)
          </label>
          <input
            id="heartbeat-length"
            type="number"
            min="1"
            className="ei-input"
            value={heartbeatMinutes}
            onChange={handleHeartbeatChange}
          />
          <small className="ei-form-hint">How often this persona checks for inactivity (default: 30 min)</small>
        </div>

        <div className="ei-form-group">
          <label htmlFor="context-window" className="ei-form-label">
            Default Context Window (hours)
          </label>
          <input
            id="context-window"
            type="number"
            min="1"
            className="ei-input"
            value={contextHours}
            onChange={handleContextWindowChange}
          />
          <small className="ei-form-hint">How far back to look for conversation context (default: 8 hours)</small>
        </div>

        <div className="ei-form-group">
          <label className="ei-checkbox-label">
            <input
              type="checkbox"
              className="ei-checkbox"
              checked={persona.is_static}
              onChange={handleStaticToggle}
            />
            <span>Static Persona</span>
          </label>
          <small className="ei-form-hint">Static personas skip all Ceremony phases (exposure decay, exploration, etc.)</small>
        </div>

        <div className="ei-form-group">
          <label className="ei-checkbox-label">
            <input
              type="checkbox"
              className="ei-checkbox"
              checked={persona.include_message_timestamps ?? false}
              onChange={handleTimestampsToggle}
            />
            <span>Show Timestamps to Persona</span>
          </label>
          <small className="ei-form-hint">Prepend date/time to each message so the persona can recognize patterns and time gaps</small>
        </div>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">State</h3>

        <div className="ei-form-group">
          <label className="ei-checkbox-label">
            <input
              type="checkbox"
              className="ei-checkbox"
              checked={persona.is_paused}
              onChange={handlePausedToggle}
            />
            <span>Paused</span>
          </label>
          <small className="ei-form-hint">Paused personas don't respond to messages or run background tasks</small>
        </div>

        {persona.is_paused && (
          <div className="ei-form-group">
            <label htmlFor="pause-until" className="ei-form-label">
              Pause Until (optional)
            </label>
            <input
              id="pause-until"
              type="datetime-local"
              className="ei-input"
              value={persona.pause_until ? persona.pause_until.slice(0, 16) : ""}
              onChange={handlePauseUntilChange}
            />
            <small className="ei-form-hint">Leave empty to pause indefinitely</small>
          </div>
        )}

        <div className="ei-form-group">
          <label className="ei-checkbox-label">
            <input
              type="checkbox"
              className="ei-checkbox"
              checked={persona.is_archived}
              onChange={handleArchivedToggle}
            />
            <span>Archived</span>
          </label>
          <small className="ei-form-hint">Archived personas are hidden from normal view</small>
        </div>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Appearance</h3>

        <div className="ei-form-group">
          <label htmlFor="preferred-theme" className="ei-form-label">
            Preferred Theme
          </label>
          <select
            id="preferred-theme"
            className="ei-input"
            value={persona.preferred_theme ?? ""}
            onChange={(e) => onChange("preferred_theme", e.target.value || undefined)}
          >
            <option value="">Use global theme</option>
            <optgroup label="Built-in">
              <option value="default">Default</option>
              <option value="dark">Dark</option>
              <option value="coder">c0d3r</option>
              <option value="depressing">Depressing</option>
              <option value="cotton-candy">Cotton Candy</option>
              <option value="crimuh">Crimuh</option>
              <option value="spoopy">Spoopy</option>
              <option value="lovey-dovey">Lovey-Dovey</option>
              <option value="lucky">Lucky</option>
            </optgroup>
            {customThemes.length > 0 && (
              <optgroup label="Custom">
                {customThemes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <small className="ei-form-hint">
            Sets the chat panel theme when talking to this persona. Leave empty to use the global theme.
          </small>
        </div>
      </section>

      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Model &amp; Groups</h3>

        <ModelPicker
          id="model-override"
          label="LLM Model Override"
          value={persona.model}
          onChange={(modelId) => onChange("model", modelId)}
          accounts={accounts}
          allowEmpty
          optionalLabel
          hint="Leave empty to use the system default model."
        />

        {isEiPersona(persona) ? (
          <>
            <div className="ei-form-group">
              <label className="ei-form-label">Primary Group</label>
              <input
                type="text"
                className="ei-input"
                value="General"
                disabled
              />
              <small className="ei-form-hint">Ei always belongs to the General group</small>
            </div>

            <div className="ei-form-group">
              <label className="ei-form-label">Can See Data From</label>
              <div className="ei-group-chips">
                <span className="ei-group-chip ei-group-chip--active ei-group-chip--disabled">
                  <span className="ei-group-chip__check">✓</span>
                  All Groups
                </span>
              </div>
              <small className="ei-form-hint">Ei can see all data regardless of group</small>
            </div>
          </>
        ) : (
          <>
            <div className="ei-form-group">
              <label htmlFor="primary-group" className="ei-form-label">
                Primary Group
              </label>
              <input
                id="primary-group"
                type="text"
                className="ei-input"
                value={persona.group_primary || ""}
                onChange={(e) => onChange("group_primary", e.target.value || null)}
                placeholder="Enter group name or click below"
              />
              {availableGroups.length > 0 && (
                <div className="ei-group-chips">
                  {availableGroups.map((group) => (
                    <button
                      key={group}
                      type="button"
                      className={`ei-group-chip ${persona.group_primary === group ? "ei-group-chip--selected" : ""}`}
                      onClick={() => onChange("group_primary", group)}
                    >
                      {group}
                    </button>
                  ))}
                </div>
              )}
              <small className="ei-form-hint">The main group this persona belongs to</small>
            </div>

            <GroupChipEditor
              label="Can See Data From"
              value={persona.groups_visible || []}
              availableGroups={availableGroups}
              onChange={(groups) => onChange("groups_visible", groups)}
            />
          </>
        )}
      </section>
    </div>
  );
};
