import { useState } from 'react';
import { GroupedCardList } from '../GroupedCardList';

interface Trait {
  id: string;
  name: string;
  description: string;
  sentiment: number;           // -1 to 1
  strength?: number;           // 0 to 1
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
}

interface PersonaEntity {
  entity: "system";
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  group_primary?: string | null;
  groups_visible?: string[];
  traits: Trait[];
  topics: unknown[];
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  heartbeat_delay_ms?: number;
  context_window_hours?: number;
  context_boundary?: string;
  last_updated: string;
  last_activity: string;
  last_heartbeat?: string;
  last_extraction?: string;
  last_inactivity_ping?: string;
}

interface PersonaIdentityTabProps {
  persona: PersonaEntity;
  onChange: (field: keyof PersonaEntity, value: PersonaEntity[keyof PersonaEntity]) => void;
  onTraitChange: (id: string, field: keyof Trait, value: Trait[keyof Trait]) => void;
  onTraitSave: (id: string) => void;
  onTraitDelete: (id: string) => void;
  onTraitAdd: () => void;
  dirtyTraitIds: Set<string>;
}

const traitSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1 },
  { field: 'strength', label: 'Strength', min: 0, max: 1 },
];

export const PersonaIdentityTab = ({
  persona,
  onChange,
  onTraitChange,
  onTraitSave,
  onTraitDelete,
  onTraitAdd,
  dirtyTraitIds,
}: PersonaIdentityTabProps) => {
  const [newAlias, setNewAlias] = useState('');

  const handleAddAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    
    const currentAliases = persona.aliases || [];
    if (!currentAliases.includes(trimmed)) {
      onChange('aliases', [...currentAliases, trimmed]);
    }
    setNewAlias('');
  };

  const handleRemoveAlias = (alias: string) => {
    const currentAliases = persona.aliases || [];
    onChange('aliases', currentAliases.filter(a => a !== alias));
  };

  const handleAliasKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAlias();
    }
  };

  return (
    <div className="ei-persona-identity-tab">
      {/* Image Display Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Profile Image</label>
        <div className="ei-persona-image-placeholder">
          <span className="ei-persona-image-placeholder__text">
            Image display coming in future version
          </span>
        </div>
        <span className="ei-form-hint">Image upload will be available in a future update</span>
      </div>

      {/* Aliases Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Aliases</label>
        <div className="ei-aliases-container">
          <div className="ei-aliases-list">
            {persona.aliases && persona.aliases.length > 0 ? (
              persona.aliases.map((alias) => (
                <span key={alias} className="ei-alias-chip">
                  {alias}
                  <button
                    type="button"
                    className="ei-alias-chip__remove"
                    onClick={() => handleRemoveAlias(alias)}
                    aria-label={`Remove alias ${alias}`}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <span className="ei-form-hint">No aliases yet</span>
            )}
          </div>
          <div className="ei-aliases-input-group">
            <input
              type="text"
              className="ei-input"
              placeholder="Add new alias..."
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={handleAliasKeyDown}
            />
            <button
              type="button"
              className="ei-btn ei-btn--secondary ei-btn--sm"
              onClick={handleAddAlias}
              disabled={!newAlias.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Short Description Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Short Description</label>
        <input
          type="text"
          className="ei-input"
          placeholder="Brief one-line description..."
          value={persona.short_description || ''}
          onChange={(e) => onChange('short_description', e.target.value)}
        />
      </div>

      {/* Long Description Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Long Description</label>
        <textarea
          className="ei-textarea"
          placeholder="Detailed description of this persona..."
          rows={6}
          value={persona.long_description || ''}
          onChange={(e) => onChange('long_description', e.target.value)}
        />
        <span className="ei-form-hint">
          Dual-mode markdown editor will be available in a future update
        </span>
      </div>

      {/* Traits Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Traits</label>
        <GroupedCardList
          items={persona.traits}
          sliders={traitSliders}
          onChange={onTraitChange}
          onSave={onTraitSave}
          onDelete={onTraitDelete}
          onAdd={onTraitAdd}
          dirtyIds={dirtyTraitIds}
          hideGroupHeaders
        />
      </div>
    </div>
  );
};
