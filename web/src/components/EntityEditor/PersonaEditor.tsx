import { useState, useEffect } from 'react';
import { TabContainer } from './TabContainer';
import { PersonaSettingsTab } from './tabs/PersonaSettingsTab';
import { PersonaIdentityTab } from './tabs/PersonaIdentityTab';
import { PersonaTopicsTab } from './tabs/PersonaTopicsTab';
import { ContextWindowTab } from './tabs/ContextWindowTab';
import { PersonaToolsTab } from './tabs/PersonaToolsTab';
import { ContextStatus } from '../../../../src/core/types';
import type { Message, ToolProvider, ToolDefinition, ProviderAccount, PersonaTrait, PersonaTopic, PersonaEntity } from '../../../../src/core/types';

interface PersonaEditorProps {
  isOpen: boolean;
  onClose: () => void;
  personaId: string;
  persona: PersonaEntity;
  messages: Message[];
  onUpdate: (updates: Partial<PersonaEntity>) => void;
  onTraitSave: (trait: PersonaTrait) => void;
  onTraitDelete: (id: string) => void;
  onTopicSave: (topic: PersonaTopic) => void;
  onTopicDelete: (id: string) => void;
  onContextStatusChange: (messageId: string, status: ContextStatus) => void;
  onBulkContextStatusChange: (messageIds: string[], status: ContextStatus) => void;
  onContextBoundaryChange: (timestamp: string | null) => void;
  onDeleteMessage: (messageId: string) => void;
  availableGroups?: string[];
  onAiAssist?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  toolProviders?: ToolProvider[];
  toolDefinitions?: ToolDefinition[];
  accounts?: ProviderAccount[];
  customThemes?: { id: string; name: string }[];
}

const tabs = [
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'identity', label: 'Identity', icon: '🎭' },
  { id: 'topics', label: 'Topics', icon: '💬' },
  { id: 'context', label: 'Context', icon: '📜' },
  { id: 'tools', label: 'Tools', icon: '🔧' },
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
  onAiAssist,
  toolProviders = [],
  toolDefinitions = [],
  accounts = [],
  customThemes = [],
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
    field: keyof PersonaTrait,
    value: PersonaTrait[keyof PersonaTrait]
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
    const newTrait: PersonaTrait = {
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
    field: keyof PersonaTopic,
    value: PersonaTopic[keyof PersonaTopic]
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
    const newTopic: PersonaTopic = {
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
          persona={localPersona}
          onChange={handlePersonaFieldChange}
          availableGroups={availableGroups}
          accounts={accounts}
          customThemes={customThemes}
        />
      )}

      {activeTab === 'identity' && (
        <PersonaIdentityTab
          persona={localPersona}
          onChange={handlePersonaFieldChange}
          onTraitChange={handleTraitChange}
          onTraitSave={handleTraitSave}
          onTraitDelete={handleTraitDelete}
          onTraitAdd={handleTraitAdd}
          dirtyTraitIds={dirtyTraitIds}
          onAiAssist={onAiAssist}
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
          onAiAssist={onAiAssist}
          aiContext={localPersona.long_description}
        />
      )}

      {activeTab === 'context' && (
        <ContextWindowTab
          personaName={persona.display_name}
          messages={messages}
          contextBoundary={localPersona.context_boundary}
          contextWindowHours={Math.round((localPersona.context_window_ms ?? 28800000) / 3600000)}
          onContextStatusChange={onContextStatusChange}
          onBulkContextStatusChange={onBulkContextStatusChange}
          onContextBoundaryChange={onContextBoundaryChange}
          onDeleteMessage={onDeleteMessage}
        />
      )}

      {activeTab === 'tools' && (
        <PersonaToolsTab
          assignedToolIds={localPersona.tools ?? []}
          providers={toolProviders}
          tools={toolDefinitions}
          onUpdate={(toolIds) => {
            setLocalPersona((prev) => ({ ...prev, tools: toolIds }));
            onUpdate({ tools: toolIds });
          }}
        />
      )}
    </TabContainer>
  );
}
