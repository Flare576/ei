import { useState, useRef, useEffect } from 'react';

interface Trait {
  name: string;
  description: string;
  sentiment?: number;
  strength?: number;
}

interface Topic {
  name: string;
  perspective: string;
  exposure_current?: number;
  exposure_desired?: number;
}

interface NewPersonaData {
  name: string;
  aliases: string[];
  description: string;
  short_description?: string;
  traits: Partial<Trait>[];
  topics: Partial<Topic>[];
  model?: string;
  group_primary?: string;
}

interface PersonaCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (persona: NewPersonaData) => void;
  onAiAssist?: (field: string, currentValue: string) => Promise<string>;
}

type ExpandableSection = 'traits' | 'communication' | 'relationships' | 'topics' | 'model';

export function PersonaCreatorModal({
  isOpen,
  onClose,
  onCreate,
  onAiAssist,
}: PersonaCreatorModalProps) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [description, setDescription] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [model, setModel] = useState('');
  const [traits, setTraits] = useState<Partial<Trait>[]>([]);
  const [topics, setTopics] = useState<Partial<Topic>[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<ExpandableSection>>(new Set());
  const [aiLoadingField, setAiLoadingField] = useState<string | null>(null);
  
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setName('');
      setGroup('');
      setDescription('');
      setShortDescription('');
      setModel('');
      setTraits([]);
      setTopics([]);
      setExpandedSections(new Set());
      setAiLoadingField(null);
    }
  }, [isOpen]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      modalRef.current?.focus();
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      
      // Focus trap
      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements?.length) return;
        
        const first = focusableElements[0] as HTMLElement;
        const last = focusableElements[focusableElements.length - 1] as HTMLElement;
        
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleClose = () => {
    if (name || description || traits.length > 0 || topics.length > 0) {
      if (!confirm('Discard persona creation?')) {
        return;
      }
    }
    onClose();
  };

  const toggleSection = (section: ExpandableSection) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleAiAssistClick = async (field: string, currentValue: string) => {
    if (!onAiAssist) return;
    
    setAiLoadingField(field);
    try {
      const result = await onAiAssist(field, currentValue);
      
      // Apply result based on field
      if (field === 'description') {
        setDescription(result);
      } else if (field === 'short_description') {
        setShortDescription(result);
      }
      // Add more field handlers as needed
      
    } catch (error) {
      console.error('AI assist failed:', error);
    } finally {
      setAiLoadingField(null);
    }
  };

  const addTrait = () => {
    setTraits([...traits, { name: '', description: '' }]);
  };

  const updateTrait = (index: number, field: keyof Trait, value: string | number) => {
    const updated = [...traits];
    updated[index] = { ...updated[index], [field]: value };
    setTraits(updated);
  };

  const removeTrait = (index: number) => {
    setTraits(traits.filter((_, i) => i !== index));
  };

  const addTopic = () => {
    setTopics([...topics, { name: '', perspective: '' }]);
  };

  const updateTopic = (index: number, field: keyof Topic, value: string | number) => {
    const updated = [...topics];
    updated[index] = { ...updated[index], [field]: value };
    setTopics(updated);
  };

  const removeTopic = (index: number) => {
    setTopics(topics.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    // Validation
    if (!name.trim()) {
      alert('Please provide a name for the persona');
      return;
    }

    // Confirmation if no traits/topics
    if (traits.length === 0 && topics.length === 0 && description) {
      if (!confirm('Generate personality from description? AI will create traits and topics based on the description.')) {
        return;
      }
    }

    // Parse comma-delimited names into aliases
    const namesParsed = name.split(',').map(n => n.trim()).filter(n => n);
    const primaryName = namesParsed[0];
    const aliases = namesParsed;

    const personaData: NewPersonaData = {
      name: primaryName,
      aliases,
      description,
      short_description: shortDescription || undefined,
      traits,
      topics,
      model: model || undefined,
      group_primary: group.trim() || undefined,
    };

    onCreate(personaData);
  };

  if (!isOpen) return null;

  return (
    <div className="ei-modal-overlay" onClick={handleClose}>
      <div 
        className="ei-creator-modal"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-modal-title"
      >
        {/* Header */}
        <div className="ei-creator-modal__header">
          <h2 id="creator-modal-title" className="ei-creator-modal__title">
            Create New Persona
          </h2>
          <button 
            className="ei-btn ei-btn--icon"
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="ei-creator-modal__content">
          {/* Core Fields */}
          <div className="ei-creator-modal__core">
            <div className="ei-form-group">
              <label className="ei-form-label">Name (comma-delimited for aliases)</label>
              <input
                type="text"
                className="ei-input"
                placeholder="Primary Name, Alias 1, Alias 2..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <span className="ei-form-hint">
                First name will be primary, all others become aliases
              </span>
            </div>

            <div className="ei-form-group">
              <div className="ei-creator-modal__field-with-assist">
                <label className="ei-form-label">Description</label>
                {onAiAssist && (
                  <button
                    className="ei-ai-assist-btn"
                    onClick={() => handleAiAssistClick('description', description)}
                    disabled={aiLoadingField === 'description'}
                  >
                    ✨ AI Assist
                  </button>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <textarea
                  className="ei-textarea"
                  placeholder="Describe this persona's personality, background, and purpose..."
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                {aiLoadingField === 'description' && (
                  <div className="ei-field-loading-overlay">
                    <div className="ei-field-loading-overlay__spinner" />
                  </div>
                )}
              </div>
              <span className="ei-form-hint ei-creator-help-text">
                In a hurry? We'll pre-fill based on description
              </span>
            </div>

            <div className="ei-form-group">
              <label className="ei-form-label">Group</label>
              <input
                type="text"
                className="ei-input"
                placeholder="e.g., Work, Creative, Gaming..."
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
              <span className="ei-form-hint">
                Optional - organize personas into groups with shared visibility
              </span>
            </div>
          </div>

          {/* Expandable Sections */}
          <div className="ei-creator-modal__sections">
            {/* Traits Section */}
            <div className={`ei-creator-section ${expandedSections.has('traits') ? 'ei-creator-section--expanded' : ''}`}>
              <div 
                className="ei-creator-section-header"
                onClick={() => toggleSection('traits')}
              >
                <span className="ei-creator-section-header__text">
                  {expandedSections.has('traits') ? '▼' : '▶'} Add Personification
                </span>
                {onAiAssist && (
                  <button
                    className="ei-ai-assist-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAiAssistClick('traits', description);
                    }}
                    disabled={aiLoadingField === 'traits'}
                  >
                    ✨
                  </button>
                )}
              </div>
              
              {expandedSections.has('traits') && (
                <div className="ei-creator-section-content">
                  <p className="ei-creator-help-text">
                    Define personality traits that characterize this persona
                  </p>
                  {traits.map((trait, index) => (
                    <div key={index} className="ei-creator-mini-card">
                      <input
                        type="text"
                        className="ei-input ei-input--sm"
                        placeholder="Trait name (e.g., Analytical)"
                        value={trait.name || ''}
                        onChange={(e) => updateTrait(index, 'name', e.target.value)}
                      />
                      <textarea
                        className="ei-textarea ei-textarea--sm"
                        placeholder="Brief description..."
                        rows={2}
                        value={trait.description || ''}
                        onChange={(e) => updateTrait(index, 'description', e.target.value)}
                      />
                      <button
                        className="ei-btn ei-btn--danger ei-btn--sm"
                        onClick={() => removeTrait(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="ei-btn ei-btn--secondary ei-btn--sm"
                    onClick={addTrait}
                  >
                    + Add Trait
                  </button>
                </div>
              )}
            </div>

            {/* Topics Section */}
            <div className={`ei-creator-section ${expandedSections.has('topics') ? 'ei-creator-section--expanded' : ''}`}>
              <div 
                className="ei-creator-section-header"
                onClick={() => toggleSection('topics')}
              >
                <span className="ei-creator-section-header__text">
                  {expandedSections.has('topics') ? '▼' : '▶'} Add Topics of Interest
                </span>
                {onAiAssist && (
                  <button
                    className="ei-ai-assist-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAiAssistClick('topics', description);
                    }}
                    disabled={aiLoadingField === 'topics'}
                  >
                    ✨
                  </button>
                )}
              </div>
              
              {expandedSections.has('topics') && (
                <div className="ei-creator-section-content">
                  <p className="ei-creator-help-text">
                    Subjects this persona is knowledgeable about or interested in
                  </p>
                  {topics.map((topic, index) => (
                    <div key={index} className="ei-creator-mini-card">
                      <input
                        type="text"
                        className="ei-input ei-input--sm"
                        placeholder="Topic name (e.g., Quantum Physics)"
                        value={topic.name || ''}
                        onChange={(e) => updateTopic(index, 'name', e.target.value)}
                      />
                      <textarea
                        className="ei-textarea ei-textarea--sm"
                        placeholder="Their perspective on this topic..."
                        rows={2}
                        value={topic.perspective || ''}
                        onChange={(e) => updateTopic(index, 'perspective', e.target.value)}
                      />
                      <button
                        className="ei-btn ei-btn--danger ei-btn--sm"
                        onClick={() => removeTopic(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="ei-btn ei-btn--secondary ei-btn--sm"
                    onClick={addTopic}
                  >
                    + Add Topic
                  </button>
                </div>
              )}
            </div>

            {/* Model Selection Section */}
            <div className={`ei-creator-section ${expandedSections.has('model') ? 'ei-creator-section--expanded' : ''}`}>
              <div 
                className="ei-creator-section-header"
                onClick={() => toggleSection('model')}
              >
                <span className="ei-creator-section-header__text">
                  {expandedSections.has('model') ? '▼' : '▶'} Select LLM Model
                </span>
              </div>
              
              {expandedSections.has('model') && (
                <div className="ei-creator-section-content">
                  <p className="ei-creator-help-text">
                    Override the default model for this persona
                  </p>
                  <div className="ei-form-group">
                    <label className="ei-form-label">Model</label>
                    <input
                      type="text"
                      className="ei-input"
                      placeholder="e.g., gpt-4, claude-3-opus (leave empty for default)"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                    <span className="ei-form-hint">
                      Uses system default if not specified
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="ei-creator-modal__footer">
          <button
            className="ei-btn ei-btn--secondary"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            className="ei-btn ei-btn--primary"
            onClick={handleSubmit}
          >
            Create Persona
          </button>
        </div>
      </div>
    </div>
  );
}
