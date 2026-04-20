import { useState, useRef, useEffect } from 'react';
import { useOverlayClose } from '../../hooks/useOverlayClose';
import type { Fact, Topic, Person, Quote } from '../../../../src/core/types.js';

interface SearchResults {
  facts: Fact[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
}

export interface KnowledgeSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => Promise<SearchResults>;
}

function truncate(text: string, max = 300): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

export function KnowledgeSearchModal({
  isOpen,
  onClose,
  onSearch,
}: KnowledgeSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults(null);
      setLoading(false);
      previousActiveElement.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await onSearch(query.trim());
        setResults(data);
      } catch {
        setResults({ facts: [], topics: [], people: [], quotes: [] });
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, onSearch]);

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen) return null;

  const hasResults =
    results &&
    (results.people.length > 0 ||
      results.topics.length > 0 ||
      results.facts.length > 0 ||
      results.quotes.length > 0);

  const renderContent = () => {
    if (!query.trim()) {
      return (
        <div className="ei-knowledge-search-modal__placeholder">
          Ask Ei anything about what it knows: people, topics, facts, moments.
        </div>
      );
    }

    if (loading) {
      return <div className="ei-knowledge-search-modal__loading">Searching…</div>;
    }

    if (!hasResults) {
      return (
        <div className="ei-knowledge-search-modal__placeholder">
          Nothing found for &lsquo;{query}&rsquo; — try different words.
        </div>
      );
    }

    return (
      <>
        {results!.people.length > 0 && (
          <div>
            <div className="ei-knowledge-search-modal__section-header">👤 People</div>
            {results!.people.map(p => (
              <div key={p.id} className="ei-knowledge-search-modal__result-card">
                <div className="ei-knowledge-search-modal__result-name">{p.name}</div>
                {p.description && (
                  <div className="ei-knowledge-search-modal__result-body">{truncate(p.description)}</div>
                )}
                {p.relationship && (
                  <div className="ei-knowledge-search-modal__result-meta">{p.relationship}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {results!.topics.length > 0 && (
          <div>
            <div className="ei-knowledge-search-modal__section-header">📌 Topics</div>
            {results!.topics.map(t => (
              <div key={t.id} className="ei-knowledge-search-modal__result-card">
                <div className="ei-knowledge-search-modal__result-name">{t.name}</div>
                {t.description && (
                  <div className="ei-knowledge-search-modal__result-body">{truncate(t.description)}</div>
                )}
                {t.category && (
                  <div className="ei-knowledge-search-modal__result-meta">{t.category}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {results!.facts.length > 0 && (
          <div>
            <div className="ei-knowledge-search-modal__section-header">📋 Facts</div>
            {results!.facts.map(f => (
              <div key={f.id} className="ei-knowledge-search-modal__result-card">
                <div className="ei-knowledge-search-modal__result-name">{f.name}</div>
                {f.description && (
                  <div className="ei-knowledge-search-modal__result-body">{truncate(f.description)}</div>
                )}
                {f.validated_date && (
                  <div className="ei-knowledge-search-modal__result-meta">
                    Validated {formatDate(f.validated_date)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {results!.quotes.length > 0 && (
          <div>
            <div className="ei-knowledge-search-modal__section-header">💬 Quotes</div>
            {results!.quotes.map(q => (
              <div key={q.id} className="ei-knowledge-search-modal__result-card">
                <div className="ei-knowledge-search-modal__result-body">{truncate(q.text)}</div>
                <div className="ei-knowledge-search-modal__result-meta">
                  {q.speaker}{q.timestamp ? ` · ${formatDate(q.timestamp)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="ei-modal-overlay" {...overlayProps}>
      <div className="ei-data-search-modal">
        <div className="ei-data-search-modal__header">
          <h2 className="ei-data-search-modal__title">What does Ei know about…</h2>
          <button
            className="ei-data-search-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="ei-data-search-modal__search">
          <input
            ref={inputRef}
            type="text"
            className="ei-data-search-modal__input"
            placeholder="Type to search Ei's memory…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="ei-data-search-modal__results">
          {renderContent()}
        </div>

        <div className="ei-data-search-modal__hint">Esc to close</div>
      </div>
    </div>
  );
}
