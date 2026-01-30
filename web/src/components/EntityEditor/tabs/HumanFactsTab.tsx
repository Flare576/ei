import { GroupedCardList } from '../GroupedCardList';

interface Fact {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  confidence: number;
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
  last_confirmed?: string;
}

interface HumanFactsTabProps {
  facts: Fact[];
  onChange: (id: string, field: keyof Fact, value: Fact[keyof Fact]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
}

const factSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1 },
  { field: 'confidence', label: 'Confidence', min: 0, max: 1 },
];

export const HumanFactsTab = ({
  facts,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
}: HumanFactsTabProps) => {
  return (
    <GroupedCardList
      items={facts}
      sliders={factSliders}
      onChange={onChange}
      onSave={onSave}
      onDelete={onDelete}
      onAdd={onAdd}
      dirtyIds={dirtyIds}
    />
  );
};
