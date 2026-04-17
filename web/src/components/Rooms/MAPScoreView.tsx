import { useState, useCallback, useMemo } from 'react';
import type { RoomEntity, RoomMessage, PersonaSummary } from '../../../../src/core/types';
import { MarkdownContent } from '../Chat/MarkdownContent';
import '../../styles/room-overview.css';

interface MAPScoreViewProps {
  room: RoomEntity;
  allMessages: RoomMessage[];
  personas: PersonaSummary[];
  humanName: string;
  judgePersonaId: string;
}

interface RoundRow {
  roundNum: number;
  humanMsg: RoomMessage;
  winnerMsg: RoomMessage | null;
  verdictMsg: RoomMessage | null;
  inProgress: boolean;
}

function truncate(text: string, len = 80): string {
  if (text.length <= len) return text;
  return text.slice(0, len) + '…';
}

export function MAPScoreView({ room, allMessages, personas, humanName, judgePersonaId }: MAPScoreViewProps) {
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
    const humanMsgs = activePath.filter((m) => m.role === 'human');
    const winnerMsgs = activePath.filter(
      (m) =>
        m.role === 'persona' &&
        m.persona_id !== judgePersonaId &&
        m.verbal_response != null
    );
    const verdictMsgs = activePath.filter(
      (m) => m.persona_id === judgePersonaId && m.silence_reason != null
    );

    const verdictByParent = new Map<string | null, RoomMessage>();
    verdictMsgs.forEach((v) => verdictByParent.set(v.parent_id, v));

    const runningScore = new Map<string, number>();
    const rows: RoundRow[] = [];

    humanMsgs.forEach((humanMsg, idx) => {
      if (idx === 0) {
        rows.push({
          roundNum: 0,
          humanMsg,
          winnerMsg: null,
          verdictMsg: null,
          inProgress: false,
        });
        return;
      }

      const humanIdx = activePath.indexOf(humanMsg);
      const winnerMsg =
        winnerMsgs.find((w) => activePath.indexOf(w) === humanIdx + 1) ?? null;

      const sourceForVerdict = winnerMsg ?? humanMsg;
      const verdictMsg = verdictByParent.get(sourceForVerdict.id) ?? null;

      const inProgress = winnerMsg === null;

      if (winnerMsg?.persona_id) {
        const pid = winnerMsg.persona_id;
        runningScore.set(pid, (runningScore.get(pid) ?? 0) + 1);
      }

      rows.push({
        roundNum: idx,
        humanMsg,
        winnerMsg,
        verdictMsg,
        inProgress,
      });
    });

    return { rounds: rows, scoreMap: new Map<string, number>(runningScore) };
  }, [activePath, judgePersonaId]);

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
      .filter((p) => p.id !== judgePersonaId)
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
              const msgId = row.humanMsg.id;
              const isMsgExpanded = expandedRows.has(`msg-${msgId}`);
              const isVerdictExpanded = expandedRows.has(`verdict-${msgId}`);
              const msgText = row.humanMsg.content ?? row.humanMsg.verbal_response ?? '';
              const verdictText = row.verdictMsg?.silence_reason ?? '';
              const runningNow = runningTotals.get(msgId);
              const winnerPersonaId = row.winnerMsg?.persona_id;
              const winnerName = winnerPersonaId ? personaMap.get(winnerPersonaId) ?? winnerPersonaId.slice(0, 8) : null;
              const winnerCount = winnerPersonaId ? (runningNow?.get(winnerPersonaId) ?? 0) : 0;

              const isSeed = row.roundNum === 0;
              const isInProgress = row.inProgress;

              return (
                <tr
                  key={msgId}
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
                    onClick={() => toggleExpand(`msg-${msgId}`)}
                  >
                    {isMsgExpanded ? (
                      <div className="ei-map-score__content--expanded">
                        <MarkdownContent content={msgText} />
                      </div>
                    ) : (
                      <div className="ei-map-score__content--collapsed">
                        {truncate(msgText)}
                      </div>
                    )}
                    <span className="ei-map-score__expand-hint">{isMsgExpanded ? '▲' : '▼'}</span>
                  </td>

                  <td
                    className="ei-map-score__td ei-map-score__td--verdict"
                    onClick={verdictText ? () => toggleExpand(`verdict-${msgId}`) : undefined}
                  >
                    {isSeed ? (
                      <span className="ei-map-score__verdict--initial">(initial)</span>
                    ) : isInProgress ? null : verdictText ? (
                      <>
                        {isVerdictExpanded ? (
                          <div className="ei-map-score__content--expanded">
                            <MarkdownContent content={verdictText} />
                          </div>
                        ) : (
                          <div className="ei-map-score__content--collapsed">
                            {truncate(verdictText)}
                          </div>
                        )}
                        <span className="ei-map-score__expand-hint">
                          {isVerdictExpanded ? '▲' : '▼'}
                        </span>
                      </>
                    ) : null}
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
