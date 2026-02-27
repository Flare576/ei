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
  resolvePersonaName?: (id: string) => string
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
}: GroupedCardListProps<T>) => {
  resolvePersonaName,
  const defaultRenderCard: RenderCardFn<T> = (item, onItemChange, onItemSave, onItemDelete, isDirty, itemSliders, resolvePersonaName) => (
    <DataItemCard
      key={item.id}
      item={item}
      sliders={itemSliders}
      onChange={onItemChange}
      onSave={onItemSave}
      onDelete={onItemDelete}
      isDirty={isDirty}
      resolvePersonaName={resolvePersonaName}
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

  if (hideGroupHeaders) {
    return (
      <div className="ei-grouped-list">
        <div className="ei-grouped-list__flat">
          {items.map((item) => (
            <div key={item.id}>
              {render(
                item,
                (field, value) => onChange(item.id, field, value),
                () => onSave(item.id),
                () => onDelete(item.id),
                dirtyIds.has(item.id),
                sliders,
                resolvePersonaName
              )}
            </div>
          ))}
        </div>
        <button className="ei-grouped-list__add-btn" onClick={onAdd}>
          + Add New
        </button>
      </div>
    );
  }

  return (
    <div className="ei-grouped-list">
      {groupNames.map((groupName) => {
        const groupItems = grouped[groupName];
        const isCollapsed = collapsedGroups.has(groupName);

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
            >
              <h3 className="ei-grouped-list__group-title">
                {groupName} ({groupItems.length})
              </h3>
              <span className="ei-grouped-list__group-toggle">▼</span>
            </div>
            <div className="ei-grouped-list__group-content">
              {groupItems.map((item) => (
                <div key={item.id}>
                  {render(
                    item,
                    (field, value) => onChange(item.id, field, value),
                    () => onSave(item.id),
                    () => onDelete(item.id),
                    dirtyIds.has(item.id),
                    sliders,
                    resolvePersonaName
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <button className="ei-grouped-list__add-btn" onClick={onAdd}>
        + Add New
      </button>
    </div>
  );
};
