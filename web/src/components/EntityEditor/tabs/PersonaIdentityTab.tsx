import { useState, useRef, useEffect } from 'react';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';
import { GroupedCardList } from '../GroupedCardList';
import { PersonaAvatar } from '../../Avatar/PersonaAvatar';
import type { PersonaTrait, PersonaEntity } from '../../../../../src/core/types';

interface PersonaIdentityTabProps {
  persona: PersonaEntity;
  onChange: (field: keyof PersonaEntity, value: PersonaEntity[keyof PersonaEntity]) => void;
  onTraitChange: (id: string, field: keyof PersonaTrait, value: PersonaTrait[keyof PersonaTrait]) => void;
  onTraitSave: (id: string) => void;
  onTraitDelete: (id: string) => void;
  onTraitAdd: () => void;
  dirtyTraitIds: Set<string>;
  onAiAssist?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

const traitSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How does this persona feel about this characteristic of theirs? -1: They hate it! | 0: Neutral | 1: They love it!' },
  { field: 'strength', label: 'Strength', min: 0, max: 1 },
];

async function resizeToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const size = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 64, 64);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const PersonaIdentityTab = ({
  persona,
  onChange,
  onTraitChange,
  onTraitSave,
  onTraitDelete,
  onTraitAdd,
  dirtyTraitIds,
  onAiAssist,
}: PersonaIdentityTabProps) => {
  const [newAlias, setNewAlias] = useState('');
  const [aiLoadingField, setAiLoadingField] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, { text: string; prev?: string }>>({});
  const [avatarTab, setAvatarTab] = useState<'emoji' | 'image'>(persona.avatar_image ? 'image' : 'emoji');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiInput, setEmojiInput] = useState(persona.avatar_emoji ?? '');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  const handleEmojiInputChange = (value: string) => {
    setEmojiInput(value);
    const match = value.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u);
    const first = match?.[0] ?? value.trim().charAt(0);
    if (first) {
      onChange('avatar_emoji', first);
      onChange('avatar_image', undefined);
    }
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setEmojiInput(emojiData.emoji);
    onChange('avatar_emoji', emojiData.emoji);
    onChange('avatar_image', undefined);
    setPickerOpen(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await resizeToAvatar(file);
      onChange('avatar_image', base64);
      onChange('avatar_emoji', undefined);
      setEmojiInput('');
    } catch {
      return;
    }
    e.target.value = '';
  };

  const handleAiAssist = async (field: string, systemPrompt: string, userPrompt: string) => {
    if (!onAiAssist) return;
    setAiLoadingField(field);
    try {
      const result = await onAiAssist(systemPrompt, userPrompt);
      setSuggestions(prev => ({ ...prev, [field]: { text: result, prev: prev[field]?.text } }));
    } catch (err) {
      console.error('AI assist failed:', err);
    } finally {
      setAiLoadingField(null);
    }
  };

  const acceptSuggestion = (field: 'short_description' | 'long_description') => {
    const s = suggestions[field];
    if (!s) return;
    onChange(field, s.text);
    setSuggestions(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const dismissSuggestion = (field: string) => {
    setSuggestions(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const rerollSuggestion = (field: string, systemPrompt: string, userPrompt: string) => {
    const s = suggestions[field];
    const negativeClause = s?.text
      ? `\n\nThe user didn't like this previous version — avoid it:\n"${s.text}"`
      : '';
    handleAiAssist(field, systemPrompt + negativeClause, userPrompt);
  };

  const handleAddAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    
    const currentAliases = persona.aliases || [];
    if (!currentAliases.includes(trimmed)) {
      onChange('aliases', [...currentAliases, trimmed]);
    }
    setNewAlias('');
  };

  const handleRemoveAlias = (alias: string) => {
    const currentAliases = persona.aliases || [];
    onChange('aliases', currentAliases.filter(a => a !== alias));
  };

  const handleAliasKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAlias();
    }
  };

  return (
    <div className="ei-persona-identity-tab">
      {/* Avatar Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Avatar</label>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <PersonaAvatar
            personaId={persona.id}
            displayName={persona.display_name}
            size={64}
            avatarEmoji={persona.avatar_emoji}
            avatarImage={persona.avatar_image}
            style={{ fontSize: '1.75rem' }}
          />
          <div className="ei-avatar-tabs" style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className={`ei-btn ei-btn--sm ${avatarTab === 'emoji' ? 'ei-btn--primary' : 'ei-btn--secondary'}`}
              onClick={() => setAvatarTab('emoji')}
            >
              Emoji
            </button>
            <button
              type="button"
              className={`ei-btn ei-btn--sm ${avatarTab === 'image' ? 'ei-btn--primary' : 'ei-btn--secondary'}`}
              onClick={() => setAvatarTab('image')}
            >
              Image
            </button>
          </div>
        </div>

        {avatarTab === 'emoji' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                className="ei-input"
                placeholder="Paste or type an emoji…"
                value={emojiInput}
                onChange={(e) => handleEmojiInputChange(e.target.value)}
                style={{ width: '160px' }}
              />
              <button
                type="button"
                className="ei-btn ei-btn--secondary ei-btn--sm"
                onClick={() => setPickerOpen((o) => !o)}
              >
                Pick Emoji
              </button>
              {persona.avatar_emoji && (
                <button
                  type="button"
                  className="ei-btn ei-btn--ghost ei-btn--sm"
                  onClick={() => {
                    onChange('avatar_emoji', undefined);
                    setEmojiInput('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {pickerOpen && (
              <div ref={pickerRef} style={{ position: 'relative', zIndex: 100 }}>
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  lazyLoadEmojis
                />
              </div>
            )}
          </div>
        )}

        {avatarTab === 'image' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="file"
                accept="image/*"
                className="ei-input"
                onChange={handleImageUpload}
                style={{ flex: 1 }}
              />
              {persona.avatar_image && (
                <button
                  type="button"
                  className="ei-btn ei-btn--ghost ei-btn--sm"
                  onClick={() => onChange('avatar_image', undefined)}
                >
                  Clear
                </button>
              )}
            </div>
            <span className="ei-form-hint">Image will be cropped and resized to 64×64.</span>
          </div>
        )}
      </div>

      {/* Aliases Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Aliases</label>
        <div className="ei-aliases-container">
          <div className="ei-aliases-list">
            {persona.aliases && persona.aliases.length > 0 ? (
              persona.aliases.map((alias) => (
                <span key={alias} className="ei-alias-chip">
                  {alias}
                  <button
                    type="button"
                    className="ei-alias-chip__remove"
                    onClick={() => handleRemoveAlias(alias)}
                    aria-label={`Remove alias ${alias}`}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <span className="ei-form-hint">No aliases yet</span>
            )}
          </div>
          <div className="ei-aliases-input-group">
            <input
              type="text"
              className="ei-input"
              placeholder="Add new alias..."
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={handleAliasKeyDown}
            />
            <button
              type="button"
              className="ei-btn ei-btn--secondary ei-btn--sm"
              onClick={handleAddAlias}
              disabled={!newAlias.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Short Description Section */}
      <div className="ei-form-group">
        <div className="ei-creator-modal__field-with-assist">
          <label className="ei-form-label">Short Description</label>
          {onAiAssist && (
            <button
              className="ei-ai-assist-btn"
              onClick={() => handleAiAssist('short_description',
                `You are helping improve a persona's short description. Return only the improved one-line description, nothing else.`,
                `Current description: "${persona.short_description || ''}"\n\nPersona context: ${persona.long_description || 'No long description yet'}\n\nImprove this short description to be vivid and memorable in one sentence.`
              )}
              disabled={aiLoadingField === 'short_description'}
            >
              ✨
            </button>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="ei-input"
            placeholder="Brief one-line description..."
            value={persona.short_description || ''}
            onChange={(e) => onChange('short_description', e.target.value)}
          />
          {aiLoadingField === 'short_description' && (
            <div className="ei-field-loading-overlay">
              <div className="ei-field-loading-overlay__spinner" />
            </div>
          )}
        </div>
        {suggestions['short_description'] && (
          <div className="ei-ai-suggestion">
            <div className="ei-ai-suggestion__text">{suggestions['short_description'].text}</div>
            <div className="ei-ai-suggestion__actions">
              <button className="ei-btn ei-btn--primary ei-btn--sm" onClick={() => acceptSuggestion('short_description')}>Accept</button>
              <button className="ei-btn ei-btn--secondary ei-btn--sm" onClick={() => rerollSuggestion('short_description',
                `You are helping improve a persona's short description. Return only the improved one-line description, nothing else.`,
                `Current description: "${persona.short_description || ''}"\n\nPersona context: ${persona.long_description || 'No long description yet'}\n\nImprove this short description to be vivid and memorable in one sentence.`
              )}>Re-roll</button>
              <button className="ei-btn ei-btn--ghost ei-btn--sm" onClick={() => dismissSuggestion('short_description')}>Dismiss</button>
            </div>
          </div>
        )}
      </div>

      {/* Long Description Section */}
      <div className="ei-form-group">
        <div className="ei-creator-modal__field-with-assist">
          <label className="ei-form-label">Long Description</label>
          {onAiAssist && (
            <button
              className="ei-ai-assist-btn"
              onClick={() => handleAiAssist('long_description',
                `You are helping improve a persona's long description. Return only the improved description, nothing else. Use vivid, specific language.`,
                `Current description: "${persona.long_description || ''}"\n\nShort description: ${persona.short_description || 'None'}\n\nImprove or expand this description to bring the persona to life.`
              )}
              disabled={aiLoadingField === 'long_description'}
            >
              ✨
            </button>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <textarea
            className="ei-textarea"
            placeholder="Detailed description of this persona..."
            rows={6}
            value={persona.long_description || ''}
            onChange={(e) => onChange('long_description', e.target.value)}
          />
          {aiLoadingField === 'long_description' && (
            <div className="ei-field-loading-overlay">
              <div className="ei-field-loading-overlay__spinner" />
            </div>
          )}
        </div>
        {suggestions['long_description'] && (
          <div className="ei-ai-suggestion">
            <div className="ei-ai-suggestion__text">{suggestions['long_description'].text}</div>
            <div className="ei-ai-suggestion__actions">
              <button className="ei-btn ei-btn--primary ei-btn--sm" onClick={() => acceptSuggestion('long_description')}>Accept</button>
              <button className="ei-btn ei-btn--secondary ei-btn--sm" onClick={() => rerollSuggestion('long_description',
                `You are helping improve a persona's long description. Return only the improved description, nothing else. Use vivid, specific language.`,
                `Current description: "${persona.long_description || ''}"\n\nShort description: ${persona.short_description || 'None'}\n\nImprove or expand this description to bring the persona to life.`
              )}>Re-roll</button>
              <button className="ei-btn ei-btn--ghost ei-btn--sm" onClick={() => dismissSuggestion('long_description')}>Dismiss</button>
            </div>
          </div>
        )}
        <span className="ei-form-hint">
          Dual-mode markdown editor will be available in a future update
        </span>
      </div>

      {/* Traits Section */}
      <div className="ei-form-group">
        <label className="ei-form-label">Traits</label>
        <GroupedCardList
          items={persona.traits}
          sliders={traitSliders}
          onChange={onTraitChange}
          onSave={onTraitSave}
          onDelete={onTraitDelete}
          onAdd={onTraitAdd}
          dirtyIds={dirtyTraitIds}
          hideGroupHeaders
          onAiAssist={onAiAssist}
          aiContext={persona.long_description}
          showGroupEditor={false}
        />
      </div>
    </div>
  );
};
