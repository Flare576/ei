import { useState, useCallback, useMemo } from 'react';
import type { RoomEntity, RoomMessage, PersonaSummary } from '../../../../src/core/types';
import { ContextStatus } from '../../../../src/core/types';
import { MarkdownContent } from '../Chat/MarkdownContent';
import '../../styles/room-overview.css';

interface MAPScoreViewProps {
  room: RoomEntity;
  allMessages: RoomMessage[];
  personas: PersonaSummary[];
  humanName: string;
  judgePersonaId: string;
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

interface RoundRow {
  roundNum: number;
  humanMsg: RoomMessage;
  winnerMsg: RoomMessage | null;
  verdictMsg: RoomMessage | null;
  inProgress: boolean;
}


export function MAPScoreView({ room, allMessages, personas, humanName, judgePersonaId, onSetMessageContextStatus }: MAPScoreViewProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
      await onSetMessageContextStatus(msg.id, STATUS_CYCLE[msg.context_status]);
    },
    [onSetMessageContextStatus]
  );

  const personaMap = useMemo(() => {
    const m = new Map<string, string>();
    personas.forEach((p) => m.set(p.id, p.display_name));
    return m;
  }, [personas]);

  const activePath = useMemo((): RoomMessage[] => {
    if (!room.active_node_id) return [];
    const byId = new Map<string, RoomMessage>();
    allMessages.forEach((m) => byId.set(m.id, m));

    const chain: RoomMessage[] = [];
    let cur: RoomMessage | undefined = byId.get(room.active_node_id);
    while (cur) {
      chain.push(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    chain.reverse();
    return chain;
  }, [room.active_node_id, allMessages]);

  const { rounds, scoreMap } = useMemo(() => {
    if (activePath.length === 0) return { rounds: [], scoreMap: new Map<string, number>() };

    const byId = new Map<string, RoomMessage>();
    allMessages.forEach((m) => byId.set(m.id, m));

    // Verdicts are siblings of winners — same parent_id as the winner, not children of it.
    // Index by parent_id so we can look up the verdict for any given winner in O(1).
    const verdictByParentId = new Map<string, RoomMessage>();
    allMessages
      .filter((m) => m.persona_id === judgePersonaId && m.silence_reason != null)
      .forEach((v) => { if (v.parent_id) verdictByParentId.set(v.parent_id, v); });

    const runningScore = new Map<string, number>();
    const rows: RoundRow[] = [];

    const seedMsg = activePath[0];
    rows.push({ roundNum: 0, humanMsg: seedMsg, winnerMsg: null, verdictMsg: null, inProgress: false });

    // Active path: human → winner-1 → winner-2 → ...
    // Each non-judge persona message on the path is a round winner.
    // The prompt that started that round is the winner's parent (previous winner or seed human).
    let roundNum = 0;
    for (const msg of activePath) {
      if (msg.role !== 'persona' || msg.persona_id === judgePersonaId) continue;

      roundNum++;
      const humanMsg = msg.parent_id ? (byId.get(msg.parent_id) ?? seedMsg) : seedMsg;
      const verdictMsg = msg.parent_id ? (verdictByParentId.get(msg.parent_id) ?? null) : null;

      if (msg.persona_id) {
        runningScore.set(msg.persona_id, (runningScore.get(msg.persona_id) ?? 0) + 1);
      }

      rows.push({ roundNum, humanMsg, winnerMsg: msg, verdictMsg, inProgress: false });
    }

    const activeMsg = byId.get(room.active_node_id ?? '');
    if (activeMsg?.role === 'persona' && !activeMsg.content && !activeMsg.silence_reason) {
      roundNum++;
      const humanMsg = activeMsg.parent_id ? (byId.get(activeMsg.parent_id) ?? seedMsg) : seedMsg;
      rows.push({ roundNum, humanMsg, winnerMsg: null, verdictMsg: null, inProgress: true });
    }

    return { rounds: rows, scoreMap: new Map<string, number>(runningScore) };
  }, [activePath, allMessages, judgePersonaId, room.active_node_id]);

  const runningTotals = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();
    const running = new Map<string, number>();

    rounds.forEach((row) => {
      if (row.winnerMsg?.persona_id) {
        const pid = row.winnerMsg.persona_id;
        running.set(pid, (running.get(pid) ?? 0) + 1);
      }
      totals.set(row.humanMsg.id, new Map(running));
    });
    return totals;
  }, [rounds]);

  const scoreFooter = useMemo(() => {
    const entries: Array<{ name: string; score: number }> = [];

    personas
      .filter((p) => p.id !== judgePersonaId && !p.is_archived && room.persona_ids.includes(p.id))
      .forEach((p) => {
        entries.push({ name: p.display_name, score: scoreMap.get(p.id) ?? 0 });
      });

    entries.push({ name: humanName, score: scoreMap.get('human') ?? 0 });
    entries.sort((a, b) => b.score - a.score);
    return entries;
  }, [personas, judgePersonaId, humanName, scoreMap]);

  const judgeName = useMemo(
    () => personaMap.get(judgePersonaId) ?? judgePersonaId.slice(0, 8),
    [personaMap, judgePersonaId]
  );

  const completedRounds = rounds.filter((r) => r.roundNum > 0 && !r.inProgress).length;

  return (
    <div className="ei-map-score">
      <div className="ei-map-score__table-wrapper">
        <table className="ei-map-score__table">
          <thead>
            <tr>
              <th className="ei-map-score__th ei-map-score__th--round">Round</th>
              <th className="ei-map-score__th ei-map-score__th--winner">Winner</th>
              <th className="ei-map-score__th ei-map-score__th--message">Message</th>
              <th className="ei-map-score__th ei-map-score__th--verdict">Verdict</th>
              <th className="ei-map-score__th ei-map-score__th--status">Status</th>
            </tr>
          </thead>
          <tbody>
            {rounds.length === 0 && (
              <tr>
                <td colSpan={4} className="ei-map-score__empty">
                  No messages yet.
                </td>
              </tr>
            )}
            {rounds.map((row) => {
              const rowKey = row.winnerMsg ? row.winnerMsg.id : `seed-${row.humanMsg.id}`;
              const isMsgExpanded = expandedRows.has(`msg-${rowKey}`);
              const isVerdictExpanded = expandedRows.has(`verdict-${rowKey}`);
              const msgText = row.winnerMsg
                ? (row.winnerMsg.content ?? '')
                : (row.humanMsg.content ?? '');
              const verdictText = row.verdictMsg?.silence_reason ?? '';
              const runningNow = runningTotals.get(row.humanMsg.id);
              const winnerPersonaId = row.winnerMsg?.persona_id;
              const winnerName = winnerPersonaId ? personaMap.get(winnerPersonaId) ?? winnerPersonaId.slice(0, 8) : null;
              const winnerCount = winnerPersonaId ? (runningNow?.get(winnerPersonaId) ?? 0) : 0;

              const isSeed = row.roundNum === 0;
              const isInProgress = row.inProgress;

              return (
                <tr
                  key={rowKey}
                  className={[
                    'ei-map-score__row',
                    isSeed ? 'ei-map-score__row--seed' : '',
                    isInProgress ? 'ei-map-score__row--in-progress' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="ei-map-score__td ei-map-score__td--round">
                    {isSeed ? '—' : row.roundNum}
                  </td>

                  <td className="ei-map-score__td ei-map-score__td--winner">
                    {isSeed ? (
                      <span className="ei-map-score__winner--none">—</span>
                    ) : isInProgress ? (
                      <span className="ei-map-score__winner--progress">In progress</span>
                    ) : winnerName ? (
                      <span className="ei-map-score__winner--name">
                        {winnerName}{' '}
                        <span className="ei-map-score__winner--count">({winnerCount})</span>
                      </span>
                    ) : (
                      <span className="ei-map-score__winner--none">—</span>
                    )}
                  </td>

                  <td
                    className="ei-map-score__td ei-map-score__td--message"
                    onClick={() => toggleExpand(`msg-${rowKey}`)}
                  >
                    <div className={isMsgExpanded ? 'ei-map-score__content--expanded' : 'ei-map-score__content--collapsed'}>
                      <MarkdownContent content={msgText} />
                    </div>
                    <span className="ei-map-score__expand-hint">{isMsgExpanded ? '▲' : '▼'}</span>
                  </td>

                  <td
                    className="ei-map-score__td ei-map-score__td--verdict"
                    onClick={verdictText ? () => toggleExpand(`verdict-${rowKey}`) : undefined}
                  >
                    {isSeed ? (
                      <span className="ei-map-score__verdict--initial">(initial)</span>
                    ) : isInProgress ? null : verdictText ? (
                      <>
                        <div className={isVerdictExpanded ? 'ei-map-score__content--expanded' : 'ei-map-score__content--collapsed'}>
                          <MarkdownContent content={verdictText} />
                        </div>
                        <span className="ei-map-score__expand-hint">{isVerdictExpanded ? '▲' : '▼'}</span>
                      </>
                    ) : null}
                  </td>

                  <td className="ei-map-score__td ei-map-score__td--status">
                    {row.winnerMsg && (
                      <button
                        className={`ei-ffa-context__status-btn ${STATUS_CLASS[row.winnerMsg.context_status]}`}
                        onClick={(e) => handleStatusCycle(e, row.winnerMsg!)}
                        title={`Click to cycle: Default → Always → Never (current: ${STATUS_LABEL[row.winnerMsg.context_status]})`}
                      >
                        {STATUS_LABEL[row.winnerMsg.context_status]}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ei-map-score__footer">
        {completedRounds === 0 ? (
          <span className="ei-map-score__footer-empty">No rounds completed yet.</span>
        ) : (
          <span className="ei-map-score__footer-score">
            <strong>Score:</strong>{' '}
            {scoreFooter.map((entry, i) => (
              <span key={entry.name}>
                {i > 0 && <span className="ei-map-score__footer-sep"> — </span>}
                <span className="ei-map-score__footer-name">{entry.name}</span>{' '}
                <span className="ei-map-score__footer-val">{entry.score}</span>
              </span>
            ))}
            <span className="ei-map-score__footer-judge"> — (Judge: {judgeName}, not counted)</span>
          </span>
        )}
      </div>
    </div>
  );
}
