import { useState, useEffect } from 'react';
import { TabContainer } from './TabContainer';
import { PersonaSettingsTab } from './tabs/PersonaSettingsTab';
import { PersonaIdentityTab } from './tabs/PersonaIdentityTab';
import { PersonaTopicsTab } from './tabs/PersonaTopicsTab';
import { ContextWindowTab } from './tabs/ContextWindowTab';
import { ContextStatus } from '../../../../src/core/types';
import type { Message } from '../../../../src/core/types';

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
  perspective: string;
  approach: string;
  personal_stake: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
}

interface PersonaEntity {
  id: string;
  display_name: string;
  entity: "system";
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  group_primary?: string | null;
  groups_visible?: string[];
  traits: Trait[];
  topics: Topic[];
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  is_static: boolean;
  heartbeat_delay_ms?: number;
  context_window_hours?: number;
  context_boundary?: string;
  last_updated: string;
  last_activity: string;
  last_heartbeat?: string;
  last_extraction?: string;
  last_inactivity_ping?: string;
}

type PersonaEntityForSettings = Omit<PersonaEntity, 'traits' | 'topics'> & {
  traits: unknown[];
  topics: unknown[];
};

type PersonaEntityForIdentity = Omit<PersonaEntity, 'topics'> & {
  topics: unknown[];
};

interface PersonaEditorProps {
  isOpen: boolean;
  onClose: () => void;
  personaId: string;
  persona: PersonaEntity;
  messages: Message[];
  onUpdate: (updates: Partial<PersonaEntity>) => void;
  onTraitSave: (trait: Trait) => void;
  onTraitDelete: (id: string) => void;
  onTopicSave: (topic: Topic) => void;
  onTopicDelete: (id: string) => void;
  onContextStatusChange: (messageId: string, status: ContextStatus) => void;
  onBulkContextStatusChange: (messageIds: string[], status: ContextStatus) => void;
  onContextBoundaryChange: (timestamp: string | null) => void;
  onDeleteMessage: (messageId: string) => void;
  availableGroups?: string[];
}

const tabs = [
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'identity', label: 'Identity', icon: '🎭' },
  { id: 'topics', label: 'Topics', icon: '💬' },
  { id: 'context', label: 'Context', icon: '📜' },
];

export function PersonaEditor({
  isOpen,
  onClose,
  personaId: _personaId,
  persona,
  messages,
  onUpdate,
  onTraitSave,
  onTraitDelete,
  onTopicSave,
  onTopicDelete,
  onContextStatusChange,
  onBulkContextStatusChange,
  onContextBoundaryChange,
  onDeleteMessage,
  availableGroups = [],
}: PersonaEditorProps) {
  const [activeTab, setActiveTab] = useState('settings');
  const [localPersona, setLocalPersona] = useState<PersonaEntity>(persona);
  const [dirtyTraitIds, setDirtyTraitIds] = useState<Set<string>>(new Set());
  const [dirtyTopicIds, setDirtyTopicIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      setLocalPersona(structuredClone(persona));
      setDirtyTraitIds(new Set());
      setDirtyTopicIds(new Set());
    }
  }, [isOpen, persona]);

  const isDirty = dirtyTraitIds.size > 0 || dirtyTopicIds.size > 0;

  const handlePersonaFieldChange = (
    field: string,
    value: unknown
  ) => {
    setLocalPersona((prev) => ({
      ...prev,
      [field]: value,
    }));
    
    onUpdate({ [field]: value } as Partial<PersonaEntity>);
  };
  const handleTraitChange = (
    id: string,
    field: keyof Trait,
    value: Trait[keyof Trait]
  ) => {
    setLocalPersona((prev) => ({
      ...prev,
      traits: prev.traits.map((trait) =>
        trait.id === id ? { ...trait, [field]: value } : trait
      ),
    }));
    setDirtyTraitIds((prev) => new Set(prev).add(id));
  };

  const handleTraitSave = (id: string) => {
    const trait = localPersona.traits.find((t) => t.id === id);
    if (trait) {
      onTraitSave(trait);
      setDirtyTraitIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTraitDelete = (id: string) => {
    setLocalPersona((prev) => ({
      ...prev,
      traits: prev.traits.filter((t) => t.id !== id),
    }));
    setDirtyTraitIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onTraitDelete(id);
  };

  const handleTraitAdd = () => {
    const newTrait: Trait = {
      id: `trait-${Date.now()}`,
      name: 'New Trait',
      description: '',
      sentiment: 0,
      strength: 0.5,
      last_updated: new Date().toISOString(),
    };
    
    setLocalPersona((prev) => ({
      ...prev,
      traits: [...prev.traits, newTrait],
    }));
    setDirtyTraitIds((prev) => new Set(prev).add(newTrait.id));
  };

  const handleTopicChange = (
    id: string,
    field: keyof Topic,
    value: Topic[keyof Topic]
  ) => {
    setLocalPersona((prev) => ({
      ...prev,
      topics: prev.topics.map((topic) =>
        topic.id === id ? { ...topic, [field]: value } : topic
      ),
    }));
    setDirtyTopicIds((prev) => new Set(prev).add(id));
  };

  const handleTopicSave = (id: string) => {
    const topic = localPersona.topics.find((t) => t.id === id);
    if (topic) {
      onTopicSave(topic);
      setDirtyTopicIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTopicDelete = (id: string) => {
    setLocalPersona((prev) => ({
      ...prev,
      topics: prev.topics.filter((t) => t.id !== id),
    }));
    setDirtyTopicIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onTopicDelete(id);
  };

  const handleTopicAdd = () => {
    const newTopic: Topic = {
      id: `topic-${Date.now()}`,
      name: 'New Topic',
      perspective: '',
      approach: '',
      personal_stake: '',
      sentiment: 0,
      exposure_current: 0,
      exposure_desired: 0.5,
      last_updated: new Date().toISOString(),
    };
    
    setLocalPersona((prev) => ({
      ...prev,
      topics: [...prev.topics, newTopic],
    }));
    setDirtyTopicIds((prev) => new Set(prev).add(newTopic.id));
  };

  if (!isOpen) return null;

  return (
    <TabContainer
      title={`Edit Persona: ${persona.display_name}`}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onClose={onClose}
      isDirty={isDirty}
    >
      {activeTab === 'settings' && (
        <PersonaSettingsTab
          persona={localPersona as PersonaEntityForSettings}
          onChange={handlePersonaFieldChange}
          availableGroups={availableGroups}
        />
      )}

      {activeTab === 'identity' && (
        <PersonaIdentityTab
          persona={localPersona as PersonaEntityForIdentity}
          onChange={handlePersonaFieldChange}
          onTraitChange={handleTraitChange}
          onTraitSave={handleTraitSave}
          onTraitDelete={handleTraitDelete}
          onTraitAdd={handleTraitAdd}
          dirtyTraitIds={dirtyTraitIds}
        />
      )}

      {activeTab === 'topics' && (
        <PersonaTopicsTab
          topics={localPersona.topics}
          onChange={handleTopicChange}
          onSave={handleTopicSave}
          onDelete={handleTopicDelete}
          onAdd={handleTopicAdd}
          dirtyIds={dirtyTopicIds}
        />
      )}

      {activeTab === 'context' && (
        <ContextWindowTab
          personaName={persona.display_name}
          messages={messages}
          contextBoundary={localPersona.context_boundary}
          contextWindowHours={localPersona.context_window_hours ?? 8}
          onContextStatusChange={onContextStatusChange}
          onBulkContextStatusChange={onBulkContextStatusChange}
          onContextBoundaryChange={onContextBoundaryChange}
          onDeleteMessage={onDeleteMessage}
        />
      )}
    </TabContainer>
  );
}
