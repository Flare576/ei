import { ReactNode, useState } from 'react';
import { DataItemCard } from './DataItemCard';

interface DataItemBase {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
}

interface SliderConfig {
  field: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
}

type RenderCardFn<T extends DataItemBase> = (
  item: T,
  onChange: (field: keyof T, value: T[keyof T]) => void,
  onSave: () => void,
  onDelete: () => void,
  isDirty: boolean,
  sliders: SliderConfig[],
  resolvePersonaName?: (id: string) => string,
  onAiAssist?: (systemPrompt: string, userPrompt: string) => Promise<string>,
  aiContext?: string,
  selectionMode?: boolean,
  isSelected?: boolean,
  availableGroups?: string[],
  showGroupEditor?: boolean
) => ReactNode;

interface GroupedCardListProps<T extends DataItemBase> {
  items: T[];
  groupBy?: (item: T) => string;
  sliders: SliderConfig[];
  onChange: (id: string, field: keyof T, value: T[keyof T]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds?: Set<string>;
  renderEmpty?: () => ReactNode;
  hideGroupHeaders?: boolean;
  renderCard?: RenderCardFn<T>;
  resolvePersonaName?: (id: string) => string;
  onAiAssist?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  aiContext?: string;
  selectionMode?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (id: string) => void;
  availableGroups?: string[];
  showGroupEditor?: boolean;
}

const defaultGroupBy = <T extends DataItemBase>(item: T): string => {
  return item.persona_groups?.[0] || 'Ungrouped';
};

export const GroupedCardList = <T extends DataItemBase>({
  items,
  groupBy = defaultGroupBy,
  sliders,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds = new Set(),
  renderEmpty,
  hideGroupHeaders = false,
  renderCard,
  resolvePersonaName,
  onAiAssist,
  aiContext,
  selectionMode = false,
  selectedIds = [],
  onSelectionChange,
  availableGroups = [],
  showGroupEditor = true,
  }: GroupedCardListProps<T>) => {
  const defaultRenderCard: RenderCardFn<T> = (item, onItemChange, onItemSave, onItemDelete, isDirty, itemSliders, resolvePersonaNameFn, onAiAssistFn, aiCtx, selMode, isSel, groups, showGrpEditor) => (
    <DataItemCard
      item={item}
      sliders={itemSliders}
      onChange={onItemChange}
      onSave={onItemSave}
      onDelete={onItemDelete}
      isDirty={isDirty}
      resolvePersonaName={resolvePersonaNameFn}
      onAiAssist={onAiAssistFn}
      aiContext={aiCtx}
      selectionMode={selMode}
      isSelected={isSel}
      onSelectionChange={onSelectionChange ? () => onSelectionChange(item.id) : undefined}
      availableGroups={groups}
      showGroupEditor={showGrpEditor}
    />
  );

  const render = renderCard || defaultRenderCard;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  if (items.length === 0 && renderEmpty) {
    return <>{renderEmpty()}</>;
  }

  const grouped = items.reduce((acc, item) => {
    const groupName = groupBy(item);
    if (!acc[groupName]) {
      acc[groupName] = [];
    }
    acc[groupName].push(item);
    return acc;
  }, {} as Record<string, T[]>);

  const groupNames = Object.keys(grouped).sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });

  const toggleGroup = (groupName: string) => {
    if (selectionMode) return;
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  if (hideGroupHeaders || selectionMode) {
    return (
      <div className="ei-grouped-list">
        <div className="ei-grouped-list__flat">
          {items.map((item, index) => {
            const isSelected = selectedIds.includes(item.id);
            return (
            <div
              key={item.id || `${item.name}-${index}`}
              className={selectionMode ? `ei-selection-wrapper${isSelected ? ' ei-selection-wrapper--selected' : ''}` : undefined}
              onClick={selectionMode && onSelectionChange ? () => onSelectionChange(item.id) : undefined}
            >
              {selectionMode && (
                <input
                  type="checkbox"
                  className="ei-selection-checkbox"
                  checked={isSelected}
                  onChange={() => onSelectionChange?.(item.id)}
                  onClick={e => e.stopPropagation()}
                />
              )}
              <div className={selectionMode ? 'ei-selection-card-body' : ''}>
                {render(
                  item,
                  (field, value) => onChange(item.id, field, value),
                  () => onSave(item.id),
                  () => onDelete(item.id),
                  dirtyIds.has(item.id),
                  sliders,
                  resolvePersonaName,
                  onAiAssist,
                  aiContext,
                  selectionMode,
                  selectedIds.includes(item.id),
                  availableGroups,
                  showGroupEditor
                )}
              </div>
            </div>
            );
          })}
        </div>
        {!selectionMode && (
          <button className="ei-grouped-list__add-btn" onClick={onAdd}>
            + Add New
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ei-grouped-list">
      {groupNames.map((groupName) => {
        const groupItems = grouped[groupName];
        const isCollapsed = collapsedGroups.has(groupName) && !selectionMode;

        return (
          <div
            key={groupName}
            className={`ei-grouped-list__group ${
              isCollapsed ? 'ei-grouped-list__group--collapsed' : ''
            }`}
          >
            <div
              className="ei-grouped-list__group-header"
              onClick={() => toggleGroup(groupName)}
              style={{ cursor: selectionMode ? 'default' : 'pointer' }}
            >
              <h3 className="ei-grouped-list__group-title">
                {groupName} ({groupItems.length})
              </h3>
              <span className="ei-grouped-list__group-toggle">▼</span>
            </div>
            <div className="ei-grouped-list__group-content">
              {groupItems.map((item, index) => (
                <div key={item.id || `${item.name}-${index}`}>
                  {render(
                    item,
                    (field, value) => onChange(item.id, field, value),
                    () => onSave(item.id),
                    () => onDelete(item.id),
                    dirtyIds.has(item.id),
                    sliders,
                    resolvePersonaName,
                    onAiAssist,
                    aiContext,
                    false,
                    false,
                    availableGroups,
                    showGroupEditor
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {!selectionMode && (
        <button className="ei-grouped-list__add-btn" onClick={onAdd}>
          + Add New
        </button>
      )}
    </div>
  );
};
