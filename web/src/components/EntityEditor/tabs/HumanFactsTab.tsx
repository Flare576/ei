import type { Fact } from '../../../../../src/core/types';
import { GroupedCardList } from '../GroupedCardList';
import { FactCard } from '../FactCard';

interface SliderConfig {
  field: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
  tooltip?: string;
}

interface HumanFactsTabProps {
  facts: Fact[];
  onChange: (id: string, field: keyof Fact, value: Fact[keyof Fact]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
  resolvePersonaName?: (id: string) => string;
}

const factSliders: SliderConfig[] = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How do you feel about this aspect of your life? -1: Hate it! | 0: Neutral | 1: Love it!' },
];

export const HumanFactsTab = ({
  facts,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
  resolvePersonaName,
}: HumanFactsTabProps) => {
  const renderFactCard = (
    item: Fact,
    onItemChange: (field: keyof Fact, value: Fact[keyof Fact]) => void,
    onItemSave: () => void,
    onItemDelete: () => void,
    isDirty: boolean,
    sliders: SliderConfig[],
    resolvePersonaName?: (id: string) => string
  ) => (
    <FactCard
      key={item.id}
      fact={item}
      sliders={sliders}
      onChange={onItemChange}
      onSave={onItemSave}
      onDelete={onItemDelete}
      isDirty={isDirty}
      resolvePersonaName={resolvePersonaName}
    />
  );

  return (
    <GroupedCardList
      items={facts}
      sliders={factSliders}
      onChange={onChange}
      onSave={onSave}
      onDelete={onDelete}
      onAdd={onAdd}
      dirtyIds={dirtyIds}
      renderCard={renderFactCard}
      resolvePersonaName={resolvePersonaName}
    />
  );
};
