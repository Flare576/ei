import React, { useState } from 'react';
import type { ThemeDefinition } from '../../../../src/core/types/entities.js';
import { BUILT_IN_THEME_NAMES } from '../../../../src/core/utils/theme-codec.js';

interface ThemeListProps {
  activeTheme: string | undefined;
  customThemes: ThemeDefinition[];
  onSelect: (id: string) => void;
  onEdit: (theme: ThemeDefinition) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
}

type SwatchColors = { accent: string; bgPrimary: string; textPrimary: string };

const PRESET_SWATCHES: Record<string, SwatchColors> = {
  'default':      { accent: '#007bff', bgPrimary: '#ffffff', textPrimary: '#212529' },
  'dark':         { accent: '#4dabf7', bgPrimary: '#1a1a1a', textPrimary: '#e9ecef' },
  'coder':        { accent: '#98971a', bgPrimary: '#282828', textPrimary: '#ebdbb2' },
  'depressing':   { accent: '#81a1c1', bgPrimary: '#eceff4', textPrimary: '#2e3440' },
  'cotton-candy': { accent: '#ea76cb', bgPrimary: '#eff1f5', textPrimary: '#4c4f69' },
  'crimuh':       { accent: '#c41e3a', bgPrimary: '#0a1628', textPrimary: '#f0f4f8' },
  'spoopy':       { accent: '#fab387', bgPrimary: '#1e1e2e', textPrimary: '#cdd6f4' },
  'lovey-dovey':  { accent: '#f5c2e7', bgPrimary: '#1e1e2e', textPrimary: '#cdd6f4' },
  'lucky':        { accent: '#b8bb26', bgPrimary: '#282828', textPrimary: '#ebdbb2' },
};

const PRESET_LABELS: Record<string, string> = {
  'default':      'Default',
  'dark':         'Dark',
  'coder':        'c0d3r',
  'depressing':   'Depressing',
  'cotton-candy': 'Cotton Candy',
  'crimuh':       'Crimuh',
  'spoopy':       'Spoopy',
  'lovey-dovey':  'Lovey Dovey',
  'lucky':        'Lucky',
};

export const ThemeList: React.FC<ThemeListProps> = ({
  activeTheme,
  customThemes,
  onSelect,
  onEdit,
  onDelete,
  onCreateNew,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const effectiveActive = activeTheme ?? 'default';

  return (
    <div className="ei-theme-list">
      <section className="ei-settings-section">
        <h3 className="ei-settings-section__title">Built-in Presets</h3>
        <div className="ei-theme-presets">
          {(BUILT_IN_THEME_NAMES as readonly string[]).map((name) => {
            const swatch = PRESET_SWATCHES[name] ?? PRESET_SWATCHES['default'];
            const isActive = effectiveActive === name;
            return (
              <div
                key={name}
                className={`ei-theme-preset-card${isActive ? ' ei-theme-preset-card--active' : ''}`}
                onClick={() => onSelect(name)}
                role="button"
                aria-label={`Select ${PRESET_LABELS[name] ?? name} theme`}
                aria-pressed={isActive}
              >
                <div className="ei-theme-preset-card__swatch">
                  <span
                    className="ei-theme-preset-card__swatch-dot"
                    style={{ backgroundColor: swatch.accent }}
                  />
                  <span
                    className="ei-theme-preset-card__swatch-dot"
                    style={{ backgroundColor: swatch.bgPrimary }}
                  />
                  <span
                    className="ei-theme-preset-card__swatch-dot"
                    style={{ backgroundColor: swatch.textPrimary }}
                  />
                </div>
                <span className="ei-theme-preset-card__name">{PRESET_LABELS[name] ?? name}</span>
                {isActive && <span className="ei-theme-preset-card__check">✓</span>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="ei-settings-section">
        <div className="ei-theme-custom__header">
          <h3 className="ei-settings-section__title">My Themes</h3>
          <button
            type="button"
            className="ei-btn ei-btn--primary ei-btn--sm"
            onClick={onCreateNew}
          >
            + New Theme
          </button>
        </div>

        <div className="ei-theme-custom">
          {customThemes.length === 0 ? (
            <div className="ei-theme-custom__empty">
              No custom themes yet. Create one to get started.
            </div>
          ) : (
            customThemes.map((theme) => {
              const isDeleting = deleteConfirmId === theme.id;
              const isActive = effectiveActive === theme.id;

              if (isDeleting) {
                return (
                  <div key={theme.id} className="ei-theme-custom-card ei-theme-custom-card--deleting">
                    <div className="ei-theme-custom-card__delete-confirm">
                      <span className="ei-theme-custom-card__delete-text">
                        Delete "{theme.name}"?
                      </span>
                      <div className="ei-theme-custom-card__actions">
                        <button
                          className="ei-btn ei-btn--danger ei-btn--sm"
                          onClick={() => { onDelete(theme.id); setDeleteConfirmId(null); }}
                        >
                          Delete
                        </button>
                        <button
                          className="ei-btn ei-btn--secondary ei-btn--sm"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={theme.id}
                  className={`ei-theme-custom-card${isActive ? ' ei-theme-custom-card--active' : ''}`}
                  onClick={() => onSelect(theme.id)}
                  role="button"
                  aria-pressed={isActive}
                >
                  <div className="ei-theme-custom-card__info">
                    <div className="ei-theme-custom-card__name">
                      {isActive && '✓ '}{theme.name}
                    </div>
                    {theme.base && (
                      <div className="ei-theme-custom-card__base">
                        Based on: {PRESET_LABELS[theme.base] ?? theme.base}
                      </div>
                    )}
                  </div>
                  <div
                    className="ei-theme-custom-card__actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="ei-btn ei-btn--primary ei-btn--sm"
                      onClick={() => onEdit(theme)}
                    >
                      Edit
                    </button>
                    <button
                      className="ei-btn ei-btn--danger ei-btn--sm"
                      onClick={() => setDeleteConfirmId(theme.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};
