import { GroupedCardList } from '../GroupedCardList';
import { PersonCard } from '../PersonCard';

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
}

interface HumanPeopleTabProps {
  people: Person[];
  onChange: (id: string, field: keyof Person, value: Person[keyof Person]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
  resolvePersonaName?: (id: string) => string;
}

const personSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How do you feel about this person in your life? -1: Hate them! | 0: Neutral | 1: Love them!' },
  { field: 'exposure_current', label: 'Current Exposure', min: 0, max: 1 },
  { field: 'exposure_desired', label: 'Desired Exposure', min: 0, max: 1 },
];

const renderPersonCard = (
  person: Person,
  onChange: (field: keyof Person, value: Person[keyof Person]) => void,
  onSave: () => void,
  onDelete: () => void,
  isDirty: boolean,
  sliders: { field: string; label: string; min?: number; max?: number }[],
  resolvePersonaName?: (id: string) => string
) => (
  <PersonCard
    person={person}
    sliders={sliders}
    onChange={onChange}
    onSave={onSave}
    onDelete={onDelete}
    isDirty={isDirty}
    resolvePersonaName={resolvePersonaName}
  />
);

export const HumanPeopleTab = ({
  people,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
  resolvePersonaName,
}: HumanPeopleTabProps) => {
  return (
    <GroupedCardList
      items={people}
      sliders={personSliders}
      onChange={onChange}
      onSave={onSave}
      onDelete={onDelete}
      onAdd={onAdd}
      dirtyIds={dirtyIds}
      renderCard={renderPersonCard}
      resolvePersonaName={resolvePersonaName}
    />
  );
};
