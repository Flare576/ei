import React, { useState } from "react";

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
  context_boundary?: string;
  last_updated: string;
  last_activity: string;
  last_heartbeat?: string;
  last_extraction?: string;
  last_inactivity_ping?: string;
}

const isEiPersona = (persona: PersonaEntity): boolean => {
  return persona.aliases?.[0]?.toLowerCase() === "ei";
};

interface PersonaSettingsTabProps {
  persona: PersonaEntity;
  onChange: (field: keyof PersonaEntity, value: PersonaEntity[keyof PersonaEntity]) => void;
  availableGroups?: string[];
}

export const PersonaSettingsTab: React.FC<PersonaSettingsTabProps> = ({
  persona,
  onChange,
  availableGroups = [],
}) => {
  const [newVisibleGroup, setNewVisibleGroup] = useState("");
  
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

  const handleGroupVisibilityToggle = (group: string) => {
    const current = persona.groups_visible || [];
    const updated = current.includes(group)
      ? current.filter((g: string) => g !== group)
      : [...current, group];
    onChange("groups_visible", updated);
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
        <h3 className="ei-settings-section__title">Model &amp; Groups</h3>

        <div className="ei-form-group">
          <label htmlFor="model-override" className="ei-form-label">
            LLM Model Override
          </label>
          <input
            id="model-override"
            type="text"
            className="ei-input"
            value={persona.model || ""}
            onChange={(e) => onChange("model", e.target.value || undefined)}
            placeholder="e.g., openai:gpt-4o or local:qwen3-30b"
          />
          <small className="ei-form-hint">
            Format: provider:model (leave empty to use system default)
          </small>
        </div>

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

            <div className="ei-form-group">
              <label className="ei-form-label">Can See Data From</label>
              <div className="ei-group-input-row">
                <input
                  type="text"
                  className="ei-input"
                  value={newVisibleGroup}
                  onChange={(e) => setNewVisibleGroup(e.target.value)}
                  placeholder="Add new group"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newVisibleGroup.trim()) {
                      e.preventDefault();
                      const group = newVisibleGroup.trim();
                      if (!(persona.groups_visible || []).includes(group)) {
                        onChange("groups_visible", [...(persona.groups_visible || []), group]);
                      }
                      setNewVisibleGroup("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="ei-btn ei-btn--secondary"
                  onClick={() => {
                    const group = newVisibleGroup.trim();
                    if (group && !(persona.groups_visible || []).includes(group)) {
                      onChange("groups_visible", [...(persona.groups_visible || []), group]);
                    }
                    setNewVisibleGroup("");
                  }}
                  disabled={!newVisibleGroup.trim()}
                >
                  Add
                </button>
              </div>
              <div className="ei-group-chips">
                {(() => {
                  const allGroups = [...new Set([...availableGroups, ...(persona.groups_visible || [])])];
                  return allGroups.map((group) => {
                    const isVisible = (persona.groups_visible || []).includes(group);
                    return (
                      <button
                        key={group}
                        type="button"
                        className={`ei-group-chip ei-group-chip--toggle ${isVisible ? "ei-group-chip--active" : ""}`}
                        onClick={() => handleGroupVisibilityToggle(group)}
                      >
                        <span className="ei-group-chip__check">{isVisible ? "✓" : "○"}</span>
                        {group}
                      </button>
                    );
                  });
                })()}
              </div>
              <small className="ei-form-hint">Groups whose data this persona can access</small>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
