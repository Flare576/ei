import { useState, useEffect } from 'react';
import { TabContainer } from './TabContainer';
import { HumanSettingsTab } from './tabs/HumanSettingsTab';
import { HumanFactsTab } from './tabs/HumanFactsTab';
import { HumanTraitsTab } from './tabs/HumanTraitsTab';
import { HumanTopicsTab } from './tabs/HumanTopicsTab';
import { HumanPeopleTab } from './tabs/HumanPeopleTab';
import { HumanQuotesTab } from './tabs/HumanQuotesTab';
import { QuoteManagementModal } from '../Quote/QuoteManagementModal';
import { ValidationLevel } from '../../../../src/core/types';
import type { Fact, Quote } from '../../../../src/core/types';

interface Trait {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  strength?: number;
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
}

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
  persona_groups?: string[];
}

interface HumanEntity {
  id: string;
  auto_save_interval_ms?: number;
  default_model?: string;
  queue_paused?: boolean;
  name_color?: string;
  name_display?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
  facts?: Fact[];
  traits?: Trait[];
  topics?: Topic[];
  people?: Person[];
  quotes?: Quote[];
}

interface HumanEditorProps {
  isOpen: boolean;
  onClose: () => void;
  human: HumanEntity;
  onUpdate: (updates: Partial<HumanEntity>) => void;
  onFactSave: (fact: Fact) => void;
  onFactDelete: (id: string) => void;
  onTraitSave: (trait: Trait) => void;
  onTraitDelete: (id: string) => void;
  onTopicSave: (topic: Topic) => void;
  onTopicDelete: (id: string) => void;
  onPersonSave: (person: Person) => void;
  onPersonDelete: (id: string) => void;
  onQuoteSave?: (id: string, updates: Partial<Quote>) => void;
  onQuoteDelete?: (id: string) => void;
}

const tabs = [
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'facts', label: 'Facts', icon: '📋' },
  { id: 'traits', label: 'Traits', icon: '🎭' },
  { id: 'people', label: 'People', icon: '👥' },
  { id: 'topics', label: 'Topics', icon: '💬' },
  { id: 'quotes', label: 'Quotes', icon: '✂️' },
];

export const HumanEditor = ({
  isOpen,
  onClose,
  human,
  onUpdate,
  onFactSave,
  onFactDelete,
  onTraitSave,
  onTraitDelete,
  onTopicSave,
  onTopicDelete,
  onPersonSave,
  onPersonDelete,
  onQuoteSave,
  onQuoteDelete,
}: HumanEditorProps) => {
  const [activeTab, setActiveTab] = useState('settings');
  const [localSettings, setLocalSettings] = useState({
    auto_save_interval_ms: human.auto_save_interval_ms,
    default_model: human.default_model,
    queue_paused: human.queue_paused,
    name_color: human.name_color,
    name_display: human.name_display,
    time_mode: human.time_mode,
  });
  const [localFacts, setLocalFacts] = useState<Fact[]>(human.facts || []);
  const [localTraits, setLocalTraits] = useState<Trait[]>(human.traits || []);
  const [localTopics, setLocalTopics] = useState<Topic[]>(human.topics || []);
  const [localPeople, setLocalPeople] = useState<Person[]>(human.people || []);
  const [localQuotes, setLocalQuotes] = useState<Quote[]>(human.quotes || []);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  
  const [dirtyFactIds, setDirtyFactIds] = useState<Set<string>>(new Set());
  const [dirtyTraitIds, setDirtyTraitIds] = useState<Set<string>>(new Set());
  const [dirtyTopicIds, setDirtyTopicIds] = useState<Set<string>>(new Set());
  const [dirtyPersonIds, setDirtyPersonIds] = useState<Set<string>>(new Set());
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalSettings({
        auto_save_interval_ms: human.auto_save_interval_ms,
        default_model: human.default_model,
        queue_paused: human.queue_paused,
        name_color: human.name_color,
        name_display: human.name_display,
        time_mode: human.time_mode,
      });
      setLocalFacts(human.facts || []);
      setLocalTraits(human.traits || []);
      setLocalTopics(human.topics || []);
      setLocalPeople(human.people || []);
      setLocalQuotes(human.quotes || []);
      setDirtyFactIds(new Set());
      setDirtyTraitIds(new Set());
      setDirtyTopicIds(new Set());
      setDirtyPersonIds(new Set());
      setSettingsDirty(false);
      setEditingQuote(null);
    }
  }, [isOpen, human]);

  const isDirty = settingsDirty || 
    dirtyFactIds.size > 0 || 
    dirtyTraitIds.size > 0 || 
    dirtyTopicIds.size > 0 || 
    dirtyPersonIds.size > 0;

  const handleSettingChange = (field: keyof typeof localSettings, value: typeof localSettings[keyof typeof localSettings]) => {
    setLocalSettings(prev => ({ ...prev, [field]: value }));
    setSettingsDirty(true);
  };

  const handleSettingsSave = () => {
    onUpdate(localSettings);
    setSettingsDirty(false);
  };

  const handleFactChange = (id: string, field: keyof Fact, value: Fact[keyof Fact]) => {
    setLocalFacts(prev => prev.map(fact => 
      fact.id === id ? { ...fact, [field]: value } : fact
    ));
    setDirtyFactIds(prev => new Set(prev).add(id));
  };

  const handleFactSave = (id: string) => {
    const fact = localFacts.find(f => f.id === id);
    if (fact) {
      onFactSave(fact);
      setDirtyFactIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleFactDelete = (id: string) => {
    onFactDelete(id);
    setLocalFacts(prev => prev.filter(f => f.id !== id));
    setDirtyFactIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleFactAdd = () => {
    const newFact: Fact = {
      id: `temp-fact-${Date.now()}`,
      name: '',
      description: '',
      sentiment: 0,
      validated: ValidationLevel.None,
      validated_date: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
    setLocalFacts(prev => [...prev, newFact]);
    setDirtyFactIds(prev => new Set(prev).add(newFact.id));
  };

  const handleTraitChange = (id: string, field: keyof Trait, value: Trait[keyof Trait]) => {
    setLocalTraits(prev => prev.map(trait => 
      trait.id === id ? { ...trait, [field]: value } : trait
    ));
    setDirtyTraitIds(prev => new Set(prev).add(id));
  };

  const handleTraitSave = (id: string) => {
    const trait = localTraits.find(t => t.id === id);
    if (trait) {
      onTraitSave(trait);
      setDirtyTraitIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTraitDelete = (id: string) => {
    onTraitDelete(id);
    setLocalTraits(prev => prev.filter(t => t.id !== id));
    setDirtyTraitIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleTraitAdd = () => {
    const newTrait: Trait = {
      id: `temp-trait-${Date.now()}`,
      name: '',
      description: '',
      sentiment: 0,
      strength: 0.5,
      last_updated: new Date().toISOString(),
    };
    setLocalTraits(prev => [...prev, newTrait]);
    setDirtyTraitIds(prev => new Set(prev).add(newTrait.id));
  };

  const handleTopicChange = (id: string, field: keyof Topic, value: Topic[keyof Topic]) => {
    setLocalTopics(prev => prev.map(topic => 
      topic.id === id ? { ...topic, [field]: value } : topic
    ));
    setDirtyTopicIds(prev => new Set(prev).add(id));
  };

  const handleTopicSave = (id: string) => {
    const topic = localTopics.find(t => t.id === id);
    if (topic) {
      onTopicSave(topic);
      setDirtyTopicIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTopicDelete = (id: string) => {
    onTopicDelete(id);
    setLocalTopics(prev => prev.filter(t => t.id !== id));
    setDirtyTopicIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleTopicAdd = () => {
    const newTopic: Topic = {
      id: `temp-topic-${Date.now()}`,
      name: '',
      description: '',
      sentiment: 0,
      exposure_current: 0,
      exposure_desired: 0.5,
      last_updated: new Date().toISOString(),
    };
    setLocalTopics(prev => [...prev, newTopic]);
    setDirtyTopicIds(prev => new Set(prev).add(newTopic.id));
  };

  const handlePersonChange = (id: string, field: keyof Person, value: Person[keyof Person]) => {
    setLocalPeople(prev => prev.map(person => 
      person.id === id ? { ...person, [field]: value } : person
    ));
    setDirtyPersonIds(prev => new Set(prev).add(id));
  };

  const handlePersonSave = (id: string) => {
    const person = localPeople.find(p => p.id === id);
    if (person) {
      onPersonSave(person);
      setDirtyPersonIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePersonDelete = (id: string) => {
    onPersonDelete(id);
    setLocalPeople(prev => prev.filter(p => p.id !== id));
    setDirtyPersonIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handlePersonAdd = () => {
    const newPerson: Person = {
      id: `temp-person-${Date.now()}`,
      name: '',
      relationship: '',
      description: '',
      sentiment: 0,
      exposure_current: 0,
      exposure_desired: 0.5,
      last_updated: new Date().toISOString(),
    };
    setLocalPeople(prev => [...prev, newPerson]);
    setDirtyPersonIds(prev => new Set(prev).add(newPerson.id));
  };

  const handleQuoteEdit = (quote: Quote) => {
    setEditingQuote(quote);
  };

  const handleQuoteSaveClick = (id: string, updates: Partial<Quote>) => {
    onQuoteSave?.(id, updates);
    setLocalQuotes(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
    setEditingQuote(null);
  };

  const handleQuoteDeleteClick = (id: string) => {
    onQuoteDelete?.(id);
    setLocalQuotes(prev => prev.filter(q => q.id !== id));
    setEditingQuote(null);
  };

  if (!isOpen) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'settings':
        return (
          <div>
            <HumanSettingsTab 
              settings={localSettings} 
              onChange={handleSettingChange}
            />
            {settingsDirty && (
              <button 
                className="ei-btn ei-btn--primary"
                onClick={handleSettingsSave}
                style={{ marginTop: '1rem' }}
              >
                Save Settings
              </button>
            )}
          </div>
        );
      case 'facts':
        return (
          <HumanFactsTab
            facts={localFacts}
            onChange={handleFactChange}
            onSave={handleFactSave}
            onDelete={handleFactDelete}
            onAdd={handleFactAdd}
            dirtyIds={dirtyFactIds}
          />
        );
      case 'traits':
        return (
          <HumanTraitsTab
            traits={localTraits}
            onChange={handleTraitChange}
            onSave={handleTraitSave}
            onDelete={handleTraitDelete}
            onAdd={handleTraitAdd}
            dirtyIds={dirtyTraitIds}
          />
        );
      case 'topics':
        return (
          <HumanTopicsTab
            topics={localTopics}
            onChange={handleTopicChange}
            onSave={handleTopicSave}
            onDelete={handleTopicDelete}
            onAdd={handleTopicAdd}
            dirtyIds={dirtyTopicIds}
          />
        );
       case 'people':
         return (
           <HumanPeopleTab
             people={localPeople}
             onChange={handlePersonChange}
             onSave={handlePersonSave}
             onDelete={handlePersonDelete}
             onAdd={handlePersonAdd}
             dirtyIds={dirtyPersonIds}
           />
         );
       case 'quotes':
         return (
           <HumanQuotesTab
             quotes={localQuotes}
             dataItems={[
               ...(human.topics || []).map(i => ({ id: i.id, name: i.name, type: 'Topic' })),
               ...(human.people || []).map(i => ({ id: i.id, name: i.name, type: 'Person' })),
               ...(human.traits || []).map(i => ({ id: i.id, name: i.name, type: 'Trait' })),
               ...(human.facts || []).map(i => ({ id: i.id, name: i.name, type: 'Fact' })),
             ]}
             humanDisplayName={human.name_display}
             onEdit={handleQuoteEdit}
             onDelete={handleQuoteDeleteClick}
           />
         );
       default:
         return null;
    }
  };

  return (
    <>
      <TabContainer
        title={`Edit Human: ${human.name_display || 'Unknown'}`}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={onClose}
        isDirty={isDirty}
      >
        {renderTabContent()}
      </TabContainer>
      
      {editingQuote && (
        <QuoteManagementModal
          isOpen={editingQuote !== null}
          quote={editingQuote}
          message={null}
          personaName=""
          dataItems={[
            ...(human.topics || []).map(i => ({ id: i.id, name: i.name, type: 'Topic' })),
            ...(human.people || []).map(i => ({ id: i.id, name: i.name, type: 'Person' })),
            ...(human.traits || []).map(i => ({ id: i.id, name: i.name, type: 'Trait' })),
            ...(human.facts || []).map(i => ({ id: i.id, name: i.name, type: 'Fact' })),
          ]}
          skipDeleteConfirm={false}
          onClose={() => setEditingQuote(null)}
          onSave={handleQuoteSaveClick}
          onDelete={handleQuoteDeleteClick}
          onSkipDeleteConfirmChange={() => {}}
        />
      )}
    </>
  );
};
