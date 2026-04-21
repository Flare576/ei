import React, { useRef, useEffect } from 'react';
import { GroupedCardList } from '../GroupedCardList';
import { DataItemCard } from '../DataItemCard';

interface Topic {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  category?: string;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
}

interface HumanTopicsTabProps {
  topics: Topic[];
  onChange: (id: string, field: keyof Topic, value: Topic[keyof Topic]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
  resolvePersonaName?: (id: string) => string;
  rewriteModelSet: boolean;
  availableGroups?: string[];

  isDedupeMode: boolean;
  selectedIds: string[];
  dedupingIds: string[];
  onToggleDedupeMode: () => void;
  onSelectionChange: (id: string) => void;
  onMerge: () => Promise<void>;
}

const topicSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How do you feel about this topic? -1: Hate it! | 0: Neutral | 1: Love it!' },
  { field: 'exposure_current', label: 'Current Exposure', min: 0, max: 1 },
  { field: 'exposure_desired', label: 'Desired Exposure', min: 0, max: 1 },
];

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

const CATEGORY_SUGGESTIONS = [
  'Interest', 'Goal', 'Dream', 'Conflict', 'Concern', 'Fear', 'Hope', 'Plan', 'Project'
];

const renderTopicCard = (
  topic: Topic,
  onChange: (field: keyof Topic, value: Topic[keyof Topic]) => void,
  onSave: () => void,
  onDelete: () => void,
  isDirty: boolean,
  sliders: { field: string; label: string; min?: number; max?: number }[],
  resolvePersonaName?: (id: string) => string,
  _onAiAssist?: unknown,
  _aiContext?: unknown,
  selectionMode?: boolean,
  _isSelected?: boolean,
  availableGroups: string[] = []
) => {
  const gapInfo = getEngagementGapInfo(topic.exposure_current, topic.exposure_desired);

  const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('category', e.target.value);
  };

  const renderCategoryInput = () => (
    <div style={{ 
      padding: '0 12px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }}>
      <label 
        style={{ 
          fontSize: '0.75rem', 
          color: 'var(--ei-text-secondary, #8b9aa8)',
          whiteSpace: 'nowrap',
        }}
      >
        Category:
      </label>
      <input
        type="text"
        value={topic.category || ''}
        onChange={handleCategoryChange}
        placeholder="Interest, Goal, Conflict..."
        list={selectionMode ? undefined : `category-suggestions-${topic.id}`}
        readOnly={selectionMode}
        style={{
          flex: 1,
          fontSize: '0.8rem',
          padding: '4px 8px',
          border: '1px solid var(--ei-border, #3d4f5f)',
          borderRadius: '4px',
          backgroundColor: 'var(--ei-bg-secondary, #1a2332)',
          color: 'var(--ei-text-primary, #e8eef4)',
        }}
      />
      {!selectionMode && (
        <datalist id={`category-suggestions-${topic.id}`}>
          {CATEGORY_SUGGESTIONS.map(cat => (
            <option key={cat} value={cat} />
          ))}
        </datalist>
      )}
    </div>
  );

  if (selectionMode) {
    return (
      <div className="ei-data-card">
        <div className="ei-data-card__content">
          <div className="ei-data-card__header">
            <input
              type="text"
              className="ei-data-card__name"
              value={topic.name}
              readOnly
            />
          </div>
          <textarea
            className="ei-data-card__description"
            value={topic.description}
            rows={2}
            readOnly
          />
          {topic.category && renderCategoryInput()}
        </div>
      </div>
    );
  }

  return (
    <div>
      <DataItemCard
        item={topic}
        sliders={sliders}
        onChange={onChange}
        onSave={onSave}
        onDelete={onDelete}
        isDirty={isDirty}
        renderAfterHeader={renderCategoryInput}
        resolvePersonaName={resolvePersonaName}
        availableGroups={availableGroups}
        headerBadge={(
          <div
            className={`ei-engagement-gap ${gapInfo.className}`}
            title={gapInfo.description}
          >
            {gapInfo.label}
          </div>
        )}
      />
    </div>
  );
};

export const HumanTopicsTab = ({
  topics,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
  resolvePersonaName,
  rewriteModelSet,
  availableGroups = [],
  isDedupeMode,
  selectedIds,
  onToggleDedupeMode,
  onSelectionChange,
  onMerge,
}: Omit<HumanTopicsTabProps, 'dedupingIds'>) => {
  const [filterQuery, setFilterQuery] = React.useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isDedupeMode) {
      searchInputRef.current?.focus();
    }
  }, [isDedupeMode]);

  const handleMerge = async () => {
    if (selectedIds.length < 2) return;
    await onMerge();
    setFilterQuery('');
  };

  const handleToggle = () => {
    setFilterQuery('');
    onToggleDedupeMode();
  };

  const filteredTopics = filterQuery.trim()
    ? topics.filter(t => t.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : isDedupeMode ? [] : topics;

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
          ref={searchInputRef}
          type="text"
          placeholder={isDedupeMode ? 'Search to find duplicates — e.g. "Bob"' : 'Filter topics…'}
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          className="ei-search-input"
        />
      </div>

      {isDedupeMode && !filterQuery.trim() && (
        <p className="ei-dedupe-empty-hint">Search for a name to find duplicates — then check the ones to merge.</p>
      )}

      <GroupedCardList
        items={filteredTopics}
        sliders={topicSliders}
        onChange={onChange}
        onSave={onSave}
        onDelete={isDedupeMode ? () => {} : onDelete}
        onAdd={isDedupeMode ? () => {} : onAdd}
        dirtyIds={dirtyIds}
        renderCard={renderTopicCard}
        resolvePersonaName={resolvePersonaName}
        selectionMode={isDedupeMode}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        availableGroups={availableGroups}
        hideGroupHeaders
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
