import React from 'react';
import { GroupedCardList } from '../GroupedCardList';
import { PersonCard, PersonIdentifier, PersonaOption } from '../PersonCard';

interface Person {
  id: string;
  name: string;
  relationship: string;
  description: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
  learned_by?: string;
  last_changed_by?: string;
  persona_groups?: string[];
  identifiers?: PersonIdentifier[];
  validated_date?: string;
}

interface HumanPeopleTabProps {
  people: Person[];
  onChange: (id: string, field: keyof Person, value: Person[keyof Person]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
  resolvePersonaName?: (id: string) => string;
  personas?: PersonaOption[];
  rewriteModelSet: boolean;
  onCreatePersona?: (person: Person) => void;
  onUpdatePersona?: (person: Person) => void;

  // Dedupe selection mode props
  isDedupeMode: boolean;
  selectedIds: string[];
  dedupingIds: string[];
  onToggleDedupeMode: () => void;
  onSelectionChange: (id: string) => void;
  onMerge: () => Promise<void>;
}

const personSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How do you feel about this person in your life? -1: Hate them! | 0: Neutral | 1: Love them!' },
  { field: 'exposure_current', label: 'Current Exposure', min: 0, max: 1 },
  { field: 'exposure_desired', label: 'Desired Exposure', min: 0, max: 1 },
];

export const HumanPeopleTab = ({
  people,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
  resolvePersonaName,
  personas,
  rewriteModelSet,
  onCreatePersona,
  onUpdatePersona,
  isDedupeMode,
  selectedIds,
  onToggleDedupeMode,
  onSelectionChange,
  onMerge,
}: Omit<HumanPeopleTabProps, 'dedupingIds'>) => {
  const [filterQuery, setFilterQuery] = React.useState('');

  const renderPersonCard = (
    person: Person,
    personOnChange: (field: keyof Person, value: Person[keyof Person]) => void,
    personOnSave: () => void,
    personOnDelete: () => void,
    isDirty: boolean,
    sliders: { field: string; label: string; min?: number; max?: number }[],
    resolvePersonaNameFn?: (id: string) => string,
    _onAiAssist?: unknown,
    _aiContext?: unknown,
    selectionMode?: boolean,
    isSelected?: boolean
  ) => (
    <PersonCard
      person={person}
      sliders={sliders}
      onChange={personOnChange}
      onSave={personOnSave}
      onDelete={personOnDelete}
      isDirty={isDirty}
      resolvePersonaName={resolvePersonaNameFn}
      personas={personas}
      onCreatePersona={onCreatePersona}
      onUpdatePersona={onUpdatePersona}
      selectionMode={selectionMode}
      isSelected={isSelected}
      onSelectionChange={onSelectionChange ? () => onSelectionChange(person.id) : undefined}
    />
  );

  const handleMerge = async () => {
    if (selectedIds.length < 2) return;
    await onMerge();
    setFilterQuery('');
  };

  const handleToggle = () => {
    setFilterQuery('');
    onToggleDedupeMode();
  };

  const filteredPeople = filterQuery.trim()
    ? people.filter(p => {
        const q = filterQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.identifiers ?? []).some(id => id.value.toLowerCase().includes(q))
        );
      })
    : isDedupeMode ? [] : people;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 8px 8px' }}>
        <button
          onClick={handleToggle}
          disabled={!rewriteModelSet}
          title={!rewriteModelSet ? 'Set a Default Rewrite Model in Settings first' : undefined}
          className={isDedupeMode ? 'ei-btn ei-btn--ghost' : 'ei-btn ei-btn--secondary'}
        >
          {isDedupeMode ? 'Cancel' : 'Merge Duplicates'}
        </button>
      </div>

      <div style={{ padding: '0 8px 8px' }}>
        <input
          type="text"
          autoFocus={isDedupeMode}
          placeholder={isDedupeMode ? 'Search to find duplicates — e.g. "Bob"' : 'Filter people…'}
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          className="ei-search-input"
        />
      </div>

      {isDedupeMode && !filterQuery.trim() && (
        <p className="ei-dedupe-empty-hint">Search for a name to find duplicates — then check the ones to merge.</p>
      )}

      <GroupedCardList
        items={filteredPeople}
        sliders={personSliders}
        onChange={onChange}
        onSave={onSave}
        onDelete={isDedupeMode ? () => {} : onDelete}
        onAdd={isDedupeMode ? () => {} : onAdd}
        dirtyIds={dirtyIds}
        renderCard={renderPersonCard}
        resolvePersonaName={resolvePersonaName}
        selectionMode={isDedupeMode}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
      />

      {isDedupeMode && selectedIds.length >= 2 && (
        <div className="ei-sticky-footer">
          <span className="ei-sticky-footer__info">{selectedIds.length} selected</span>
          <button className="ei-btn ei-btn--ghost" onClick={() => onSelectionChange('__deselect_all__')}>
            Deselect All
          </button>
          <button className="ei-btn ei-btn--primary" onClick={handleMerge}>
            Merge {selectedIds.length} into one
          </button>
        </div>
      )}
    </>
  );
};
