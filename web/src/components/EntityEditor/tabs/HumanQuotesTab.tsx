import { useState, useMemo } from 'react';
import type { Quote } from '../../../../../src/core/types';

interface HumanQuotesTabProps {
  quotes: Quote[];
  dataItems: Array<{ id: string; name: string }>;
  humanDisplayName?: string;
  onEdit: (quote: Quote) => void;
  onDelete: (id: string) => void;
}

export const HumanQuotesTab = ({
  quotes,
  dataItems,
  humanDisplayName,
  onEdit,
  onDelete,
}: HumanQuotesTabProps) => {
  const [searchTerm, setSearchTerm] = useState('');

  const dataItemMap = useMemo(() => {
    const map = new Map<string, string>();
    dataItems.forEach(item => map.set(item.id, item.name));
    return map;
  }, [dataItems]);

  const filteredQuotes = useMemo(() => {
    if (!searchTerm) return quotes;
    const lower = searchTerm.toLowerCase();
    return quotes.filter(q => 
      q.text.toLowerCase().includes(lower) ||
      q.speaker.toLowerCase().includes(lower)
    );
  }, [quotes, searchTerm]);

  const humanLabel = humanDisplayName || 'Human';
  
  const groupedQuotes = useMemo(() => {
    const groups = new Map<string, Quote[]>();
    
    filteredQuotes.forEach(quote => {
      const speaker = quote.speaker === 'human' ? humanLabel : quote.speaker;
      if (!groups.has(speaker)) groups.set(speaker, []);
      groups.get(speaker)!.push(quote);
    });

    const speakerOrder = (name: string): number => {
      if (name === humanLabel) return 0;
      if (name.toLowerCase() === 'ei') return 1;
      return 2;
    };

    return Array.from(groups.entries()).sort(([a], [b]) => {
      const orderA = speakerOrder(a);
      const orderB = speakerOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      return a.localeCompare(b);
    });
  }, [filteredQuotes, humanLabel]);

  const truncateText = (text: string, maxLength: number = 100) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="ei-human-quotes-tab">
      <div className="ei-human-quotes-tab__header">
        <input
          type="text"
          className="ei-human-quotes-tab__search"
          placeholder="Search quotes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {groupedQuotes.length === 0 ? (
        <div className="ei-human-quotes-tab__empty">
          {quotes.length === 0 ? 'No quotes yet' : 'No quotes match your search'}
        </div>
      ) : (
        <div className="ei-human-quotes-tab__groups">
          {groupedQuotes.map(([groupName, groupQuotes]) => (
            <div key={groupName} className="ei-human-quotes-tab__group">
              <h3 className="ei-human-quotes-tab__group-title">{groupName}</h3>
              <div className="ei-human-quotes-tab__cards">
                {groupQuotes.map(quote => (
                  <div key={quote.id} className="ei-human-quotes-tab__card">
                    <div className="ei-human-quotes-tab__card-text">
                      "{truncateText(quote.text)}"
                    </div>
                    {quote.data_item_ids.length > 0 && (
                      <div className="ei-human-quotes-tab__card-tags">
                        {quote.data_item_ids.map((itemId: string) => (
                          <span key={itemId} className="ei-human-quotes-tab__tag">
                            {dataItemMap.get(itemId) || 'Unknown'}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="ei-human-quotes-tab__card-meta">
                      Said: {formatTimestamp(quote.timestamp)}
                    </div>
                    <div className="ei-human-quotes-tab__card-actions">
                      <button
                        className="ei-btn ei-btn--small ei-btn--secondary"
                        onClick={() => onEdit(quote)}
                      >
                        Edit
                      </button>
                      <button
                        className="ei-btn ei-btn--small ei-btn--danger"
                        onClick={() => onDelete(quote.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      
    </div>
  );
};
