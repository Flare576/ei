import React from 'react';
import { SliderControl } from './SliderControl';
import { GroupChipEditor } from './GroupChipEditor';
import { BUILT_IN_IDENTIFIER_TYPES } from '../../../../src/core/constants/built-in-identifier-types.js';

export interface PersonIdentifier {
  type: string;
  value: string;
  is_primary?: boolean;
}

interface Person {
  id: string;
  name: string;
  relationship: string;
  description: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
  learned_on?: string;
  learned_by?: string;
  last_mentioned?: string;
  last_changed_by?: string;
  persona_groups?: string[];
  identifiers?: PersonIdentifier[];
  validated_date?: string;
}

interface SliderConfig {
  field: string;
  label: string;
  min?: number;
  max?: number;
  formatValue?: (v: number) => string;
}

export interface PersonaOption {
  id: string;
  display_name: string;
}

interface PersonCardProps {
  person: Person;
  sliders: SliderConfig[];
  onChange: (field: keyof Person, value: Person[keyof Person]) => void;
  onSave: () => void;
  onDelete: () => void;
  isDirty?: boolean;
  showMeta?: boolean;
  resolvePersonaName?: (id: string) => string;
  personas?: PersonaOption[];
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelectionChange?: () => void;
  onCreatePersona?: (person: Person) => void;
  onUpdatePersona?: (person: Person) => void;
  availableGroups?: string[];
}

const defaultFormat = (v: number) => v.toFixed(2);

const getEngagementGapInfo = (current: number, desired: number) => {
  const gap = desired - current;
  const gapPercent = Math.round(gap * 100);
  const threshold = 0.1;

  if (Math.abs(gap) < threshold) {
    return {
      className: 'ei-engagement-gap--neutral',
      label: '≈',
      description: 'Balanced engagement',
    };
  }

  if (gap > 0) {
    return {
      className: 'ei-engagement-gap--positive',
      label: '↑',
      description: `Wants more discussion (+${gapPercent}%)`,
    };
  }

  return {
    className: 'ei-engagement-gap--negative',
    label: '↓',
    description: `Avoiding discussion (${gapPercent}%)`,
  };
};

function buildTypeOptions(identifiers: PersonIdentifier[]): string[] {
  const all = [...BUILT_IN_IDENTIFIER_TYPES, ...identifiers.map(i => i.type)];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of all) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      const fromUser = identifiers.find(i => i.type.toLowerCase() === key);
      deduped.push(fromUser ? fromUser.type : t);
    }
  }
  return deduped;
}

export const PersonCard = ({
  person,
  sliders,
  onChange,
  onSave,
  onDelete,
  isDirty = false,
  showMeta = true,
  resolvePersonaName,
  personas = [],
  selectionMode = false,
  isSelected = false,
  onSelectionChange,
  onCreatePersona,
  onUpdatePersona,
  availableGroups = [],
}: PersonCardProps): React.ReactElement => {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const [newIdType, setNewIdType] = React.useState(BUILT_IN_IDENTIFIER_TYPES[0]);
  const [newIdValue, setNewIdValue] = React.useState('');
  const [isAddingCustomType, setIsAddingCustomType] = React.useState(false);
  const [customTypeInput, setCustomTypeInput] = React.useState('');
  const [identifiersExpanded, setIdentifiersExpanded] = React.useState(false);

  const identifiers: PersonIdentifier[] = person.identifiers ?? [];

  const handleSave = () => {
    if (!person.validated_date) {
      onChange('validated_date', new Date().toISOString());
    }
    onSave();
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (isDirty && cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      handleSave();
    }
  };

  const handleRelationshipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('relationship', e.target.value);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange('description', e.target.value);
  };

  const handleSliderChange = (field: string, value: number) => {
    onChange(field as keyof Person, value);
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const handleIdentifierValueChange = (index: number, value: string) => {
    const updated = identifiers.map((id, i) => i === index ? { ...id, value } : id);
    onChange('identifiers', updated);
  };

  const handleSetPrimary = (index: number) => {
    const updated = identifiers.map((id, i) => ({ ...id, is_primary: i === index }));
    onChange('identifiers', updated);
  };

  const handleDeleteIdentifier = (index: number) => {
    const updated = identifiers.filter((_, i) => i !== index);
    if (identifiers[index]?.is_primary && updated.length > 0) {
      updated[0] = { ...updated[0], is_primary: true };
    }
    onChange('identifiers', updated);
  };

  const handleAddIdentifier = () => {
    const resolvedType = isAddingCustomType ? customTypeInput.trim() : newIdType;
    if (!resolvedType || !newIdValue.trim()) return;

    const isPrimaryFirst = identifiers.length === 0;
    const newEntry: PersonIdentifier = {
      type: resolvedType,
      value: newIdValue.trim(),
      is_primary: isPrimaryFirst,
    };
    onChange('identifiers', [...identifiers, newEntry]);
    setNewIdValue('');
    setIsAddingCustomType(false);
    setCustomTypeInput('');
    if (isPrimaryFirst) {
      setTimeout(() => handleSave(), 0);
    }
  };

  const handleNewIdTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__custom__') {
      setIsAddingCustomType(true);
      setCustomTypeInput('');
    } else {
      setIsAddingCustomType(false);
      setNewIdType(val);
    }
  };

  const primaryIdentifier = identifiers.find(i => i.is_primary) ?? identifiers[0];
  const headingValue = primaryIdentifier
    ? (primaryIdentifier.type === 'Ei Persona' && resolvePersonaName
        ? resolvePersonaName(primaryIdentifier.value)
        : primaryIdentifier.value)
    : (person.name || '(no name)');

  const typeOptions = buildTypeOptions(identifiers);
  const isPreMigration = person.identifiers === undefined || person.identifiers === null;

  const gapInfo = getEngagementGapInfo(person.exposure_current, person.exposure_desired);

  const cardClassName = [
    'ei-data-card',
    isDirty ? 'ei-data-card--dirty' : '',
    selectionMode ? 'ei-data-card--selection-mode' : '',
    isSelected ? 'ei-data-card--selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={cardRef}
      className={cardClassName}
      style={{ position: 'relative' }}
      onBlur={handleBlur}
      onClick={selectionMode ? onSelectionChange : undefined}
    >
      {selectionMode && (
        <div className="ei-data-card__checkbox">
          <input type="checkbox" checked={isSelected} readOnly />
        </div>
      )}
      {!selectionMode && (
        <div
          className={`ei-engagement-gap ${gapInfo.className}`}
          style={{ position: 'absolute', top: '12px', right: '12px' }}
          title={gapInfo.description}
        >
          {gapInfo.label}
        </div>
      )}
      <div className="ei-data-card__content">
        <div className="ei-data-card__header">
          <span className="ei-person-heading" title="Set an identifier as primary to change this name">
            {headingValue}
          </span>
        </div>

        {!selectionMode && (
          <GroupChipEditor
            value={person.persona_groups || []}
            availableGroups={availableGroups}
            onChange={(groups) => onChange('persona_groups', groups)}
            compact
          />
        )}

        <div className="ei-data-card__body">

          <div className="ei-identifiers-collapsible">
            {isPreMigration && (
              <div className="ei-identifiers__migration-note">
                Migration pending — no identifiers yet
              </div>
            )}
            <button
              type="button"
              className="ei-identifiers-collapsible__toggle"
              onClick={() => setIdentifiersExpanded(v => !v)}
              aria-expanded={identifiersExpanded}
            >
              <span className="ei-identifiers-collapsible__arrow">{identifiersExpanded ? '▾' : '▸'}</span>
              Identifiers ({identifiers.length})
            </button>

            {identifiersExpanded && (
              <div className="ei-identifiers">
                {!isPreMigration && identifiers.length === 0 && (
                  <div className="ei-identifiers__empty">
                    No identifiers yet — add one below
                  </div>
                )}

                {!isPreMigration && identifiers.length > 0 && (
                  <div className="ei-identifiers__list">
                    {identifiers.map((id, index) => {
                        const displayValue =
                        id.type === 'Ei Persona' && resolvePersonaName
                          ? resolvePersonaName(id.value)
                          : id.value;

                      return (
                        <div
                          key={index}
                          className={`ei-identifier-row${id.is_primary ? ' ei-identifier-row--primary' : ''}`}
                        >
                          <span className="ei-identifier-row__type-badge">{id.type}</span>

                          {id.type === 'Ei Persona' && personas.length > 0 && !selectionMode ? (
                            <select
                              className="ei-identifier-row__value ei-select"
                              value={id.value}
                              onChange={e => handleIdentifierValueChange(index, e.target.value)}
                              aria-label={`${id.type} identifier value`}
                            >
                              <option value="">— pick a persona —</option>
                              {personas.map(p => (
                                <option key={p.id} value={p.id}>{p.display_name}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              className="ei-identifier-row__value"
                              value={id.type === 'Ei Persona' ? displayValue : id.value}
                              onChange={e => handleIdentifierValueChange(index, e.target.value)}
                              title={id.type === 'Ei Persona' ? `UUID: ${id.value}` : undefined}
                              readOnly={selectionMode || id.type === 'Ei Persona'}
                              aria-label={`${id.type} identifier value`}
                            />
                          )}

                          {!selectionMode && (
                            <div className="ei-identifier-row__actions">
                              <button
                                className={`ei-identifier-row__primary-btn${id.is_primary ? ' ei-identifier-row__primary-btn--active' : ''}`}
                                onClick={() => handleSetPrimary(index)}
                                title={id.is_primary ? 'Primary identifier' : 'Set as primary'}
                                aria-label={id.is_primary ? 'Primary identifier (active)' : 'Set as primary identifier'}
                              >
                                {id.is_primary ? '★' : '☆'}
                              </button>
                              <button
                                className="ei-identifier-row__delete-btn"
                                onClick={() => handleDeleteIdentifier(index)}
                                title="Delete identifier"
                                aria-label={`Delete ${id.type} identifier`}
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!selectionMode && !isPreMigration && (
                  <div className="ei-identifiers__add-row">
                    {isAddingCustomType ? (
                      <input
                        type="text"
                        className="ei-identifiers__type-input"
                        placeholder="Custom type…"
                        value={customTypeInput}
                        onChange={e => setCustomTypeInput(e.target.value)}
                        autoFocus
                        aria-label="Custom identifier type"
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            e.preventDefault();
                            setIsAddingCustomType(false);
                            setCustomTypeInput('');
                          }
                        }}
                      />
                    ) : (
                      <select
                        className="ei-identifiers__type-select ei-select"
                        value={newIdType}
                        onChange={handleNewIdTypeChange}
                        aria-label="Identifier type"
                      >
                        {typeOptions.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                        <option value="__custom__">+ Add new type…</option>
                      </select>
                    )}

                    {(isAddingCustomType ? customTypeInput : newIdType) === 'Ei Persona' && personas.length > 0 ? (
                      <select
                        className="ei-identifiers__value-input ei-select"
                        value={newIdValue}
                        onChange={e => setNewIdValue(e.target.value)}
                        aria-label="Select persona"
                      >
                        <option value="">— pick a persona —</option>
                        {personas.map(p => (
                          <option key={p.id} value={p.id}>{p.display_name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="ei-identifiers__value-input"
                        placeholder={
                          (isAddingCustomType ? customTypeInput : newIdType) === 'Ei Persona'
                            ? 'Persona UUID…'
                            : 'Value…'
                        }
                        value={newIdValue}
                        onChange={e => setNewIdValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleAddIdentifier();
                        }}
                        aria-label="Identifier value"
                      />
                    )}

                    <button
                      className="ei-btn ei-btn--secondary ei-identifiers__add-btn"
                      onClick={handleAddIdentifier}
                      disabled={!(isAddingCustomType ? customTypeInput.trim() : newIdType) || !newIdValue.trim()}
                      title="Add identifier"
                    >
                      Add
                    </button>
                  </div>
                )}

                {!selectionMode && !isPreMigration && (isAddingCustomType ? customTypeInput : newIdType) === 'Ei Persona' && (
                  <p className="ei-identifiers__hint">
                    Enter the persona's UUID, or use the persona editor to link from there
                  </p>
                )}
              </div>
            )}
          </div>

          {!selectionMode && (
            <input
              type="text"
              className="ei-data-card__relationship"
              value={person.relationship}
              onChange={handleRelationshipChange}
              placeholder="Relationship (e.g., friend, coworker, family)"
            />
          )}

          <textarea
            className="ei-data-card__description"
            value={person.description}
            onChange={handleDescriptionChange}
            placeholder="Description"
            rows={selectionMode ? 2 : undefined}
            readOnly={selectionMode}
          />

          {!selectionMode && (
            <div className="ei-data-card__sliders">
              {sliders.map((slider) => (
                <SliderControl
                  key={slider.field}
                  label={slider.label}
                  value={person[slider.field as keyof Person] as number}
                  min={slider.min}
                  max={slider.max}
                  onChange={(value) => handleSliderChange(slider.field, value)}
                  formatValue={slider.formatValue || defaultFormat}
                />
              ))}
            </div>
          )}
        </div>

        {!selectionMode && (
          <div className="ei-data-card__footer">
            {showMeta && (
              <div className="ei-data-card__meta">
                {(person.learned_by || person.learned_on) && (
                  <div className="ei-data-card__footer-row">
                    {person.learned_by
                      ? <>Learned By {resolvePersonaName ? resolvePersonaName(person.learned_by) : person.learned_by}{person.learned_on ? ` on ${formatTimestamp(person.learned_on)}` : ''}</>
                      : <>Learned on {formatTimestamp(person.learned_on!)}</>
                    }
                  </div>
                )}
                {(person.last_changed_by || person.last_mentioned || person.last_updated) && (
                  <div className="ei-data-card__footer-row">
                    {person.last_changed_by
                      ? <>Updated By {resolvePersonaName ? resolvePersonaName(person.last_changed_by) : person.last_changed_by} on {formatTimestamp(person.last_mentioned ?? person.last_updated)}</>
                      : <>Updated on {formatTimestamp(person.last_mentioned ?? person.last_updated)}</>
                    }
                  </div>
                )}
              </div>
            )}
            <div className="ei-data-card__actions">
              {onCreatePersona && (
                <button
                  className="ei-control-btn"
                  onClick={() => onCreatePersona(person)}
                  title="Create Persona from this person"
                >
                  +
                </button>
              )}
              {onUpdatePersona && (
                <button
                  className="ei-control-btn"
                  onClick={() => onUpdatePersona(person)}
                  title="Update Persona from this person"
                >
                  ↑
                </button>
              )}
              <button
                className="ei-control-btn ei-control-btn--danger"
                onClick={onDelete}
                title="Delete"
              >
                🗑️
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
