import { useState, useCallback, useMemo } from 'react';
import type { RoomEntity, RoomMessage, PersonaSummary } from '../../../../src/core/types';
import { ContextStatus } from '../../../../src/core/types';
import { MarkdownContent } from '../Chat/MarkdownContent';

interface FFAContextViewProps {
  room: RoomEntity;
  allMessages: RoomMessage[];
  personas: PersonaSummary[];
  humanName: string;
  defaultContextWindowMs?: number;
  onUpdateRoom: (updates: Partial<RoomEntity>) => Promise<void>;
  onDeleteMessages: (messageIds: string[]) => Promise<void>;
  onSetMessageContextStatus: (messageId: string, status: ContextStatus) => Promise<void>;
}

const STATUS_CYCLE: Record<ContextStatus, ContextStatus> = {
  [ContextStatus.Default]: ContextStatus.Always,
  [ContextStatus.Always]: ContextStatus.Never,
  [ContextStatus.Never]: ContextStatus.Default,
};

const STATUS_LABEL: Record<ContextStatus, string> = {
  [ContextStatus.Default]: 'Default',
  [ContextStatus.Always]: 'Always',
  [ContextStatus.Never]: 'Never',
};

const STATUS_CLASS: Record<ContextStatus, string> = {
  [ContextStatus.Default]: 'ei-ffa-context__status--default',
  [ContextStatus.Always]: 'ei-ffa-context__status--always',
  [ContextStatus.Never]: 'ei-ffa-context__status--never',
};

interface DeleteConfirmData {
  humanMsg: RoomMessage;
  children: RoomMessage[];
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getMessageText(msg: RoomMessage): string {
  return msg.content ?? msg.silence_reason ?? '';
}

function collectDescendants(msgId: string, allMessages: RoomMessage[]): RoomMessage[] {
  const result: RoomMessage[] = [];
  const queue = allMessages.filter((m) => m.parent_id === msgId);
  while (queue.length > 0) {
    const next = queue.shift()!;
    result.push(next);
    allMessages.filter((m) => m.parent_id === next.id).forEach((m) => queue.push(m));
  }
  return result;
}

export function FFAContextView({
  room,
  allMessages,
  personas,
  humanName,
  defaultContextWindowMs,
  onUpdateRoom,
  onDeleteMessages,
  onSetMessageContextStatus,
}: FFAContextViewProps) {
  const [pendingDelete, setPendingDelete] = useState<DeleteConfirmData | null>(null);
  const [contextHoursInput, setContextHoursInput] = useState<string>(
    String(Math.round((room.context_window_ms ?? defaultContextWindowMs ?? 28800000) / 3600000))
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const personaMap = useMemo(() => {
    const m = new Map<string, string>();
    personas.forEach((p) => m.set(p.id, p.display_name));
    return m;
  }, [personas]);

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const msg of allMessages) {
      counts.set(msg.id, collectDescendants(msg.id, allMessages).length);
    }
    return counts;
  }, [allMessages]);

  const getSpeakerName = useCallback(
    (msg: RoomMessage): string => {
      if (msg.role === 'human') return humanName;
      if (msg.persona_id) return personaMap.get(msg.persona_id) ?? msg.persona_id.slice(0, 8);
      return 'Unknown';
    },
    [humanName, personaMap]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleStatusCycle = useCallback(
    async (e: React.MouseEvent, msg: RoomMessage) => {
      e.stopPropagation();
      const next = STATUS_CYCLE[msg.context_status];
      await onSetMessageContextStatus(msg.id, next);
    },
    [onSetMessageContextStatus]
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, msg: RoomMessage) => {
      e.stopPropagation();
      if (msg.role === 'human') {
        const children = collectDescendants(msg.id, allMessages);
        setPendingDelete({ humanMsg: msg, children });
      } else {
        void onDeleteMessages([msg.id]);
      }
    },
    [allMessages, onDeleteMessages]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const ids = [pendingDelete.humanMsg.id, ...pendingDelete.children.map((c) => c.id)];
    await onDeleteMessages(ids);
    setPendingDelete(null);
  }, [pendingDelete, onDeleteMessages]);

  const handleContextHoursChange = useCallback(
    async (raw: string) => {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return;
      const clamped = Math.max(1, Math.min(168, n));
      await onUpdateRoom({ context_window_ms: clamped * 3600000 });
    },
    [onUpdateRoom]
  );

  const handleClearBoundary = useCallback(async () => {
    await onUpdateRoom({ context_boundary: undefined });
  }, [onUpdateRoom]);

  const effectiveHours = Math.round((room.context_window_ms ?? defaultContextWindowMs ?? 28800000) / 3600000);

  return (
    <div className="ei-ffa-context">
      <div className="ei-ffa-context__table-wrapper">
        <table className="ei-ffa-context__table">
          <thead>
            <tr>
              <th className="ei-ffa-context__th ei-ffa-context__th--who">Who</th>
              <th className="ei-ffa-context__th ei-ffa-context__th--when">When</th>
              <th className="ei-ffa-context__th ei-ffa-context__th--what">What</th>
              <th className="ei-ffa-context__th ei-ffa-context__th--status">Status</th>
              <th className="ei-ffa-context__th ei-ffa-context__th--delete" aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {allMessages.length === 0 && (
              <tr>
                <td colSpan={5} className="ei-ffa-context__empty">
                  No messages yet.
                </td>
              </tr>
            )}
            {allMessages.map((msg) => {
              const isExpanded = expandedRows.has(msg.id);
              const text = getMessageText(msg);
              const count = childCounts.get(msg.id) ?? 0;
              const isRoot = msg.parent_id === null;

              return (
                <tr
                  key={msg.id}
                  className={`ei-ffa-context__row${isExpanded ? ' ei-ffa-context__row--expanded' : ''}`}
                  onClick={() => toggleExpand(msg.id)}
                >
                  <td className="ei-ffa-context__td ei-ffa-context__td--who">
                    <span
                      className={`ei-ffa-context__speaker ${
                        msg.role === 'human'
                          ? 'ei-ffa-context__speaker--human'
                          : 'ei-ffa-context__speaker--persona'
                      }`}
                    >
                      {getSpeakerName(msg)}
                    </span>
                  </td>
                  <td className="ei-ffa-context__td ei-ffa-context__td--when">
                    {formatTimestamp(msg.timestamp)}
                  </td>
                  <td className="ei-ffa-context__td ei-ffa-context__td--what">
                    <div className={isExpanded ? 'ei-ffa-context__what--expanded' : 'ei-ffa-context__what--collapsed'}>
                      <MarkdownContent content={text} />
                    </div>
                    <span className="ei-ffa-context__expand-hint">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </td>
                  <td className="ei-ffa-context__td ei-ffa-context__td--status">
                    <button
                      className={`ei-ffa-context__status-btn ${STATUS_CLASS[msg.context_status]}`}
                      onClick={(e) => handleStatusCycle(e, msg)}
                      title={`Click to cycle: Default → Always → Never (current: ${STATUS_LABEL[msg.context_status]})`}
                    >
                      {STATUS_LABEL[msg.context_status]}
                    </button>
                  </td>
                  <td className="ei-ffa-context__td ei-ffa-context__td--delete">
                    {!isRoot && <button
                      className="ei-ffa-context__delete-btn"
                      onClick={(e) => handleDeleteClick(e, msg)}
                      aria-label={`Delete message from ${getSpeakerName(msg)}`}
                      title="Delete"
                    >
                      🗑{msg.role === 'human' && count > 0 && (
                        <span className="ei-ffa-context__delete-count">×{count}</span>
                      )}
                    </button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ei-ffa-context__footer">
        <div className="ei-ffa-context__window-control">
          <label htmlFor="ffa-context-hours" className="ei-ffa-context__label">
            Context window
          </label>
          <div className="ei-ffa-context__hours-row">
            <input
              id="ffa-context-hours"
              type="number"
              min={1}
              max={168}
              className="ei-ffa-context__hours-input"
              value={contextHoursInput}
              onChange={(e) => setContextHoursInput(e.target.value)}
              onBlur={() => handleContextHoursChange(contextHoursInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleContextHoursChange(contextHoursInput);
              }}
            />
            <span className="ei-ffa-context__hours-unit">hours</span>
            {room.context_window_ms == null && (
              <span className="ei-ffa-context__hours-default">
                (default: {effectiveHours}h)
              </span>
            )}
          </div>
        </div>

        {room.context_boundary && (
          <div className="ei-ffa-context__boundary">
            <span className="ei-ffa-context__boundary-label">
              Boundary set: {formatTimestamp(room.context_boundary)}
            </span>
            <button
              className="ei-ffa-context__boundary-clear ei-btn ei-btn--sm ei-btn--ghost"
              onClick={handleClearBoundary}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {pendingDelete && (
        <div className="ei-ffa-context__confirm-overlay">
          <div className="ei-ffa-context__confirm">
            <h3 className="ei-ffa-context__confirm-title">
              Delete {1 + pendingDelete.children.length} message
              {pendingDelete.children.length > 0 ? 's' : ''}?
            </h3>
            <table className="ei-ffa-context__confirm-table">
              <tbody>
                <tr className="ei-ffa-context__confirm-row">
                  <td className="ei-ffa-context__confirm-speaker">
                    <span className="ei-ffa-context__speaker--human">{humanName}</span>
                  </td>
                  <td className="ei-ffa-context__confirm-preview">
                    {getMessageText(pendingDelete.humanMsg)}
                  </td>
                  <td className="ei-ffa-context__confirm-status">
                    <span className={STATUS_CLASS[pendingDelete.humanMsg.context_status]}>
                      {STATUS_LABEL[pendingDelete.humanMsg.context_status]}
                    </span>
                  </td>
                </tr>
                {pendingDelete.children.map((child) => (
                  <tr key={child.id} className="ei-ffa-context__confirm-row">
                    <td className="ei-ffa-context__confirm-speaker">
                      <span className="ei-ffa-context__speaker--persona">
                        {getSpeakerName(child)}
                      </span>
                    </td>
                    <td className="ei-ffa-context__confirm-preview">
                      {getMessageText(child)}
                    </td>
                    <td className="ei-ffa-context__confirm-status">
                      <span className={STATUS_CLASS[child.context_status]}>
                        {STATUS_LABEL[child.context_status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ei-ffa-context__confirm-tip">
              Tip: Mark as <strong>Never</strong> to hide from context without deleting.
            </p>
            <div className="ei-ffa-context__confirm-actions">
              <button
                className="ei-btn ei-btn--ghost"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                className="ei-btn ei-btn--danger"
                onClick={handleConfirmDelete}
              >
                Delete {1 + pendingDelete.children.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
