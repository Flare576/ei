import React, { useState, useEffect, useRef } from 'react';
import type { ThemeDefinition } from '../../../../src/core/types/entities.js';
import {
  decodeTheme,
  encodeTheme,
  makeThemeDefinition,
  THEME_TOKEN_ORDER,
  BUILT_IN_THEME_NAMES,
} from '../../../../src/core/utils/theme-codec.js';
import type { ThemeTokenMap } from '../../../../src/core/utils/theme-codec.js';

interface ThemeEditorProps {
  isOpen: boolean;
  theme: ThemeDefinition | null;
  onSave: (theme: ThemeDefinition) => void;
  onClose: () => void;
  activeTheme: string | undefined;
  customThemes: ThemeDefinition[];
}

const TOKEN_SECTIONS: Array<{ title: string; tokens: string[] }> = [
  { title: 'Backgrounds', tokens: ['bg-primary', 'bg-secondary', 'bg-tertiary'] },
  { title: 'Borders', tokens: ['border', 'border-light'] },
  { title: 'Text', tokens: ['text-primary', 'text-secondary', 'text-muted'] },
  { title: 'Accent', tokens: ['accent', 'accent-hover'] },
  { title: 'Semantic', tokens: ['success', 'success-hover', 'warning', 'warning-text', 'danger'] },
  { title: 'Status', tokens: ['status-thinking', 'status-ready', 'status-unread', 'status-paused'] },
  { title: 'Room Modes', tokens: ['room-cyp', 'room-ffa', 'room-map'] },
  { title: 'Archive Button', tokens: ['archive-bg-start', 'archive-bg-end', 'archive-border'] },
  { title: 'AI Assist Button', tokens: ['ai-assist-start', 'ai-assist-end'] },
  {
    title: 'Code Theme',
    tokens: [
      'code-bg', 'code-bg-controls', 'code-border',
      'code-text', 'code-text-muted',
      'code-accent', 'code-string', 'code-error', 'code-success', 'code-special',
    ],
  },
];

const PRESET_DEFAULTS: Record<string, Record<string, string>> = {
  'default': {
    '--ei-bg-primary': '#ffffff', '--ei-bg-secondary': '#f8f9fa', '--ei-bg-tertiary': '#e9ecef',
    '--ei-text-primary': '#212529', '--ei-text-secondary': '#6c757d', '--ei-text-muted': '#adb5bd',
    '--ei-border': '#dee2e6', '--ei-border-light': '#e9ecef',
    '--ei-accent': '#007bff', '--ei-accent-hover': '#0056b3',
    '--ei-success': '#28a745', '--ei-success-hover': '#218838',
    '--ei-warning': '#ffc107', '--ei-warning-text': '#856404',
    '--ei-danger': '#dc3545',
    '--ei-status-thinking': '#ffc107', '--ei-status-ready': '#28a745',
    '--ei-status-unread': '#dc3545', '--ei-status-paused': '#6c757d',
    '--ei-room-cyp': '#0056b3', '--ei-room-ffa': '#1a7a35', '--ei-room-map': '#6f42c1',
    '--ei-archive-bg-start': '#fde8c8', '--ei-archive-bg-end': '#fcd9a8', '--ei-archive-border': '#d4923a',
    '--ei-ai-assist-start': '#667eea', '--ei-ai-assist-end': '#764ba2',
    '--ei-code-bg': '#0a0e14', '--ei-code-bg-controls': '#0f131a', '--ei-code-border': '#1a2332',
    '--ei-code-text': '#c7c7c7', '--ei-code-text-muted': '#8892a6',
    '--ei-code-accent': '#59c2ff', '--ei-code-string': '#ffcc66',
    '--ei-code-error': '#ff6b6b', '--ei-code-success': '#50fa7b', '--ei-code-special': '#bd93f9',
  },
  'dark': {
    '--ei-bg-primary': '#1a1a1a', '--ei-bg-secondary': '#2d2d2d', '--ei-bg-tertiary': '#3d3d3d',
    '--ei-text-primary': '#e9ecef', '--ei-text-secondary': '#adb5bd', '--ei-text-muted': '#6c757d',
    '--ei-border': '#404040', '--ei-border-light': '#333333',
    '--ei-accent': '#4dabf7', '--ei-accent-hover': '#339af0',
    '--ei-success': '#51cf66', '--ei-success-hover': '#40c057',
    '--ei-warning': '#ffd43b', '--ei-warning-text': '#e67700',
    '--ei-danger': '#ff6b6b',
    '--ei-status-thinking': '#ffd43b', '--ei-status-ready': '#51cf66',
    '--ei-status-unread': '#ff6b6b', '--ei-status-paused': '#6c757d',
    '--ei-room-cyp': '#339af0', '--ei-room-ffa': '#51cf66', '--ei-room-map': '#cc5de8',
    '--ei-archive-bg-start': '#5c3d11', '--ei-archive-bg-end': '#4a3008', '--ei-archive-border': '#c07800',
    '--ei-ai-assist-start': '#5c7cfa', '--ei-ai-assist-end': '#9c36b5',
    '--ei-code-bg': '#0a0e14', '--ei-code-bg-controls': '#0f131a', '--ei-code-border': '#1a2332',
    '--ei-code-text': '#c7c7c7', '--ei-code-text-muted': '#8892a6',
    '--ei-code-accent': '#59c2ff', '--ei-code-string': '#ffcc66',
    '--ei-code-error': '#ff6b6b', '--ei-code-success': '#50fa7b', '--ei-code-special': '#bd93f9',
  },
  'spoopy': {
    '--ei-bg-primary': '#1e1e2e', '--ei-bg-secondary': '#181825', '--ei-bg-tertiary': '#313244',
    '--ei-text-primary': '#cdd6f4', '--ei-text-secondary': '#a6adc8', '--ei-text-muted': '#6c7086',
    '--ei-border': '#45475a', '--ei-border-light': '#313244',
    '--ei-accent': '#fab387', '--ei-accent-hover': '#f9823a',
    '--ei-success': '#a6e3a1', '--ei-success-hover': '#7dc97a',
    '--ei-warning': '#f9e2af', '--ei-warning-text': '#c9a227',
    '--ei-danger': '#f38ba8',
    '--ei-status-thinking': '#f9e2af', '--ei-status-ready': '#a6e3a1',
    '--ei-status-unread': '#f38ba8', '--ei-status-paused': '#6c7086',
    '--ei-room-cyp': '#89b4fa', '--ei-room-ffa': '#a6e3a1', '--ei-room-map': '#cba6f7',
    '--ei-archive-bg-start': '#45475a', '--ei-archive-bg-end': '#313244', '--ei-archive-border': '#fab387',
    '--ei-ai-assist-start': '#cba6f7', '--ei-ai-assist-end': '#fab387',
    '--ei-code-bg': '#11111b', '--ei-code-bg-controls': '#181825', '--ei-code-border': '#313244',
    '--ei-code-text': '#cdd6f4', '--ei-code-text-muted': '#7f849c',
    '--ei-code-accent': '#fab387', '--ei-code-string': '#a6e3a1',
    '--ei-code-error': '#f38ba8', '--ei-code-success': '#a6e3a1', '--ei-code-special': '#cba6f7',
  },
};

const PRESET_LABELS: Record<string, string> = {
  'default': 'Default', 'dark': 'Dark', 'coder': 'c0d3r', 'depressing': 'Depressing',
  'cotton-candy': 'Cotton Candy', 'crimuh': 'Crimuh', 'spoopy': 'Spoopy',
  'lovey-dovey': 'Lovey Dovey', 'lucky': 'Lucky',
};

function getBaseTokens(baseId: string | undefined, customThemes: ThemeDefinition[], fallback: ThemeTokenMap): ThemeTokenMap {
  if (!baseId) return fallback;

  if ((BUILT_IN_THEME_NAMES as readonly string[]).includes(baseId)) {
    const preset = PRESET_DEFAULTS[baseId];
    if (preset) {
      const full: ThemeTokenMap = {};
      for (const key of THEME_TOKEN_ORDER) {
        full[`--ei-${key}`] = preset[`--ei-${key}`] ?? fallback[`--ei-${key}`] ?? '#000000';
      }
      return full;
    }
    const computed = getComputedThemeTokens(baseId);
    if (computed) return computed;
  }

  const custom = customThemes.find(t => t.id === baseId);
  if (custom) {
    const decoded = decodeTheme(custom.encoded);
    if (decoded) return decoded;
  }

  return fallback;
}

function getComputedThemeTokens(themeId: string): ThemeTokenMap | null {
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', themeId);
  const style = getComputedStyle(document.documentElement);
  const tokens: ThemeTokenMap = {};
  for (const key of THEME_TOKEN_ORDER) {
    const val = style.getPropertyValue(`--ei-${key}`).trim();
    tokens[`--ei-${key}`] = val || '#000000';
  }
  if (prevTheme) {
    document.documentElement.setAttribute('data-theme', prevTheme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  return tokens;
}

function buildDefaultTokens(): ThemeTokenMap {
  const tokens: ThemeTokenMap = {};
  for (const key of THEME_TOKEN_ORDER) {
    tokens[`--ei-${key}`] = '#000000';
  }
  return tokens;
}

function tokenLabel(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function applyPreviewTheme(tokens: ThemeTokenMap): void {
  document.getElementById('ei-custom-theme')?.remove();
  document.documentElement.setAttribute('data-theme', 'custom');
  const style = document.createElement('style');
  style.id = 'ei-custom-theme';
  const declarations = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  style.textContent = `[data-theme="custom"] {\n${declarations}\n}`;
  document.head.appendChild(style);
}

export const ThemeEditor: React.FC<ThemeEditorProps> = ({
  isOpen,
  theme,
  onSave,
  onClose,
  activeTheme,
  customThemes,
}) => {
  const [name, setName] = useState('');
  const [tokens, setTokens] = useState<ThemeTokenMap>(buildDefaultTokens());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const savedActiveTheme = useRef<string | undefined>(undefined);
  const savedCustomStyleContent = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      savedActiveTheme.current = document.documentElement.getAttribute('data-theme') ?? undefined;
      const existingStyle = document.getElementById('ei-custom-theme');
      savedCustomStyleContent.current = existingStyle?.textContent ?? null;
      modalRef.current?.focus();

      if (theme) {
        setName(theme.name);
        const decoded = decodeTheme(theme.encoded);
        const initialTokens = decoded ?? buildDefaultTokens();
        setTokens(initialTokens);
        applyPreviewTheme(initialTokens);
      } else {
        setName('');
        const base = activeTheme ?? 'default';
        const initialTokens = getBaseTokens(base, customThemes, buildDefaultTokens());
        setTokens(initialTokens);
        applyPreviewTheme(initialTokens);
      }
      setErrors({});
      setShowImport(false);
      setImportText('');
      setImportError('');
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    document.getElementById('ei-custom-theme')?.remove();
    if (savedActiveTheme.current) {
      document.documentElement.setAttribute('data-theme', savedActiveTheme.current);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (savedCustomStyleContent.current) {
      const style = document.createElement('style');
      style.id = 'ei-custom-theme';
      style.textContent = savedCustomStyleContent.current;
      document.head.appendChild(style);
    }
    onClose();
  };

  const handleTokenChange = (cssVar: string, value: string) => {
    const updated = { ...tokens, [cssVar]: value };
    setTokens(updated);
    applyPreviewTheme(updated);
  };

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const base = theme?.base ?? (activeTheme && !(theme) ? activeTheme : undefined);
    const saved = theme
      ? { ...theme, name: name.trim(), encoded: encodeTheme(tokens) }
      : makeThemeDefinition(name.trim(), tokens, base);

    document.getElementById('ei-custom-theme')?.remove();
    onSave(saved);
  };

  const handleExport = async () => {
    const encoded = encodeTheme(tokens);
    try {
      await navigator.clipboard.writeText(encoded);
      alert('Theme string copied to clipboard!');
    } catch {
      prompt('Copy this theme string:', encoded);
    }
  };

  const handleImportApply = () => {
    const decoded = decodeTheme(importText.trim());
    if (!decoded) {
      setImportError('Invalid theme string. Expected format: ei-theme:v1:...');
      return;
    }
    setTokens(decoded);
    applyPreviewTheme(decoded);
    setShowImport(false);
    setImportText('');
    setImportError('');
  };

  const baseName = theme?.base
    ? (PRESET_LABELS[theme.base] ?? theme.base)
    : null;

  return (
    <div className="ei-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div
        className="ei-theme-editor"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ei-theme-editor__header">
          <h2 id="theme-editor-title" className="ei-theme-editor__title">
            {theme ? `Edit Theme: ${theme.name}` : 'New Theme'}
          </h2>
          <button className="ei-theme-editor__close" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        <div className="ei-theme-editor__content">
          <div className="ei-form-group">
            <label htmlFor="theme-name" className="ei-form-label">
              Name <span className="ei-form-required">*</span>
            </label>
            <input
              id="theme-name"
              type="text"
              className={`ei-input${errors.name ? ' ei-input--error' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Theme"
            />
            {errors.name && <span className="ei-form-error">{errors.name}</span>}
          </div>

          {baseName && (
            <div className="ei-form-group">
              <label className="ei-form-label">Based On</label>
              <div className="ei-color-value">{baseName}</div>
            </div>
          )}

          {TOKEN_SECTIONS.map((section) => (
            <div key={section.title} className="ei-theme-editor__token-section">
              <h4 className="ei-theme-editor__section-title">{section.title}</h4>
              {section.tokens.map((key) => {
                const cssVar = `--ei-${key}`;
                const value = tokens[cssVar] ?? '#000000';
                const hexOnly = value.startsWith('#') ? value : '#000000';
                return (
                  <div key={key} className="ei-theme-editor__token-row">
                    <span className="ei-theme-editor__token-label">{tokenLabel(key)}</span>
                    <div className="ei-color-input-wrapper">
                      <input
                        type="color"
                        className="ei-color-input"
                        value={hexOnly}
                        onChange={(e) => handleTokenChange(cssVar, e.target.value)}
                        aria-label={tokenLabel(key)}
                      />
                      <input
                        type="text"
                        className="ei-input"
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          handleTokenChange(cssVar, v);
                        }}
                        placeholder="#000000"
                        style={{ width: '90px', marginBottom: 0 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {showImport && (
            <div className="ei-theme-editor__import-area">
              <label className="ei-form-label">Paste Theme String</label>
              <textarea
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportError(''); }}
                placeholder="ei-theme:v1:..."
                rows={3}
              />
              {importError && <span className="ei-form-error">{importError}</span>}
              <div style={{ display: 'flex', gap: 'var(--ei-spacing-xs)' }}>
                <button className="ei-btn ei-btn--primary ei-btn--sm" onClick={handleImportApply}>
                  Apply
                </button>
                <button className="ei-btn ei-btn--secondary ei-btn--sm" onClick={() => { setShowImport(false); setImportError(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ei-theme-editor__footer">
          <div className="ei-theme-editor__footer-left">
            <button className="ei-btn ei-btn--secondary ei-btn--sm" onClick={handleExport}>
              📤 Export
            </button>
            {!showImport && (
              <button className="ei-btn ei-btn--secondary ei-btn--sm" onClick={() => setShowImport(true)}>
                📥 Import
              </button>
            )}
          </div>
          <div className="ei-theme-editor__footer-right">
            <button className="ei-btn ei-btn--secondary" onClick={handleClose}>Cancel</button>
            <button className="ei-btn ei-btn--primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
