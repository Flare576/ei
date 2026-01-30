import React, { useState, useMemo } from 'react';

export enum ContextStatus {
  Default = "default",
  Always = "always",
  Never = "never"
}

export interface Message {
  id: string;
  role: "human" | "system";
  content: string;
  timestamp: string;
  read: boolean;
  context_status: ContextStatus;
}

interface ContextWindowTabProps {
  personaName: string;
  messages: Message[];
  contextBoundary?: string;
  contextWindowHours: number;
  onContextStatusChange: (messageId: string, status: ContextStatus) => void;
  onBulkContextStatusChange: (messageIds: string[], status: ContextStatus) => void;
  onContextBoundaryChange: (timestamp: string | null) => void;
}

const MESSAGES_PER_PAGE = 50;

/**
 * Determine if a message should be included in context.
 * Priority: Always > Never > Default (sliding window check).
 */
function isInContext(
  message: Message, 
  contextBoundary?: string, 
  contextWindowHours?: number
): boolean {
  if (message.context_status === ContextStatus.Always) return true;
  if (message.context_status === ContextStatus.Never) return false;
  
  // For 'default': check if within sliding window
  const now = new Date();
  const messageTime = new Date(message.timestamp);
  const windowStart = new Date(now.getTime() - (contextWindowHours || 8) * 60 * 60 * 1000);
  
  if (contextBoundary && messageTime < new Date(contextBoundary)) return false;
  
  return messageTime >= windowStart;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  const time = date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  
  if (diffDays === 0) return time;
  if (diffDays === 1) return `Yest ${time}`;
  if (diffDays < 7) return `${diffDays}d ${time}`;
  
  return `${date.getMonth()+1}/${date.getDate()} ${time}`;
}

export const ContextWindowTab = ({
  personaName,
  messages,
  contextBoundary,
  contextWindowHours,
  onContextStatusChange,
  onBulkContextStatusChange,
  onContextBoundaryChange,
}: ContextWindowTabProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [startFilter, setStartFilter] = useState<string>('');
  const [endFilter, setEndFilter] = useState<string>('');
  const [bulkAction, setBulkAction] = useState<ContextStatus | ''>('');
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  const filteredMessages = useMemo(() => {
    let filtered = [...messages].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    if (startFilter) {
      const startDate = new Date(startFilter);
      filtered = filtered.filter(m => new Date(m.timestamp) >= startDate);
    }
    
    if (endFilter) {
      const endDate = new Date(endFilter);
      filtered = filtered.filter(m => new Date(m.timestamp) <= endDate);
    }
    
    return filtered;
  }, [messages, startFilter, endFilter]);

  const totalPages = Math.ceil(filteredMessages.length / MESSAGES_PER_PAGE);
  const startIdx = (currentPage - 1) * MESSAGES_PER_PAGE;
  const endIdx = startIdx + MESSAGES_PER_PAGE;
  const paginatedMessages = filteredMessages.slice(startIdx, endIdx);

  const handleBulkApply = () => {
    if (!bulkAction) return;
    
    const messageIds = filteredMessages.map(m => m.id);
    onBulkContextStatusChange(messageIds, bulkAction as ContextStatus);
    setBulkAction('');
  };

  const handleClearBoundary = () => {
    onContextBoundaryChange(null);
  };

  const handleToggleExpand = (messageId: string) => {
    setExpandedMessageId(expandedMessageId === messageId ? null : messageId);
  };

  return (
    <div className="ei-context-window">
      <div className="ei-context-controls">
        <div className="ei-context-controls__filters">
          <div className="ei-context-controls__filter-group">
            <label className="ei-context-controls__label">After</label>
            <input
              type="datetime-local"
              className="ei-context-controls__datetime"
              value={startFilter}
              onChange={(e) => {
                setStartFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          
          <div className="ei-context-controls__filter-group">
            <label className="ei-context-controls__label">Before</label>
            <input
              type="datetime-local"
              className="ei-context-controls__datetime"
              value={endFilter}
              onChange={(e) => {
                setEndFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          <button
            className="ei-btn ei-btn--secondary ei-btn--sm"
            onClick={() => {
              setStartFilter('');
              setEndFilter('');
              setCurrentPage(1);
            }}
          >
            Clear Filters
          </button>
        </div>

        <div className="ei-context-controls__info">
          <div className="ei-context-controls__stat">
            <span className="ei-context-controls__stat-label">Window:</span>
            <span className="ei-context-controls__stat-value">{contextWindowHours}h</span>
          </div>
          
          {contextBoundary && (
            <div className="ei-context-controls__stat">
              <span className="ei-context-controls__stat-label">Boundary:</span>
              <span className="ei-context-controls__stat-value">
                {formatTimestamp(contextBoundary)}
              </span>
              <button 
                className="ei-context-controls__clear-boundary"
                onClick={handleClearBoundary}
                title="Clear boundary"
              >
                ×
              </button>
            </div>
          )}
        </div>

        <div className="ei-context-controls__bulk">
          <label className="ei-context-controls__label">Bulk set filtered to:</label>
          <select
            className="ei-context-controls__select"
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value as ContextStatus | '')}
          >
            <option value="">--</option>
            <option value={ContextStatus.Default}>Default</option>
            <option value={ContextStatus.Always}>Always</option>
            <option value={ContextStatus.Never}>Never</option>
          </select>
          <button
            className="ei-btn ei-btn--primary ei-btn--sm"
            onClick={handleBulkApply}
            disabled={!bulkAction}
          >
            Apply
          </button>
        </div>
      </div>

      <div className="ei-context-table-wrapper">
        <table className="ei-context-table">
          <thead>
            <tr>
              <th className="ei-context-table__header ei-context-table__header--who">Who</th>
              <th className="ei-context-table__header ei-context-table__header--when">When</th>
              <th className="ei-context-table__header ei-context-table__header--what">What</th>
              <th className="ei-context-table__header ei-context-table__header--status">Status</th>
            </tr>
          </thead>
          <tbody>
            {paginatedMessages.map((message) => {
              const inContext = isInContext(message, contextBoundary, contextWindowHours);
              const isExpanded = expandedMessageId === message.id;
              const rowClass = inContext 
                ? 'ei-context-row--in-context' 
                : 'ei-context-row--out-of-context';

              return (
                <React.Fragment key={message.id}>
                  <tr className={`ei-context-table__row ${rowClass}`}>
                    <td className="ei-context-table__cell ei-context-table__cell--who" title={message.role === 'human' ? 'You' : personaName}>
                      <span className={`ei-context-role ei-context-role--${message.role}`}>
                        {message.role === 'human' ? '👤' : '🤖'}
                      </span>
                    </td>
                    
                    <td className="ei-context-table__cell ei-context-table__cell--when">
                      {formatTimestamp(message.timestamp)}
                    </td>
                    
                    <td 
                      className="ei-context-table__cell ei-context-table__cell--what"
                      onClick={() => handleToggleExpand(message.id)}
                    >
                      {isExpanded ? (
                        <div className="ei-context-message-content ei-context-message-content--expanded">
                          {message.content}
                        </div>
                      ) : (
                        <div className="ei-context-message-preview">
                          {message.content.length > 80 
                            ? `${message.content.substring(0, 80)}...` 
                            : message.content}
                        </div>
                      )}
                    </td>
                    
                    <td className="ei-context-table__cell ei-context-table__cell--status">
                      <select
                        className={`ei-context-status-select ei-context-status-select--${message.context_status}`}
                        value={message.context_status}
                        onChange={(e) => onContextStatusChange(message.id, e.target.value as ContextStatus)}
                      >
                        <option value={ContextStatus.Default}>Default</option>
                        <option value={ContextStatus.Always}>Always</option>
                        <option value={ContextStatus.Never}>Never</option>
                      </select>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ei-context-pagination">
        <div className="ei-context-pagination__info">
          Showing {startIdx + 1}-{Math.min(endIdx, filteredMessages.length)} of {filteredMessages.length} messages
        </div>
        
        <div className="ei-context-pagination__controls">
          <button
            className="ei-btn ei-btn--secondary ei-btn--sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            ← Prev
          </button>
          
          <span className="ei-context-pagination__page">
            Page {currentPage} of {totalPages || 1}
          </span>
          
          <button
            className="ei-btn ei-btn--secondary ei-btn--sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
};
