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

interface HumanTraitsTabProps {
  traits: Trait[];
  onChange: (id: string, field: keyof Trait, value: Trait[keyof Trait]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
  resolvePersonaName?: (id: string) => string;
}

const traitSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How do you feel about this aspect of yourself? -1: Hate it! | 0: Neutral | 1: Love it!' },
  { field: 'strength', label: 'Strength', min: 0, max: 1 },
];

export const HumanTraitsTab = ({
  traits,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
  resolvePersonaName,
}: HumanTraitsTabProps) => {
  return (
    <GroupedCardList
      items={traits}
      sliders={traitSliders}
      onChange={onChange}
      onSave={onSave}
      onDelete={onDelete}
      onAdd={onAdd}
      dirtyIds={dirtyIds}
      resolvePersonaName={resolvePersonaName}
    />
  );
};
