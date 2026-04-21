import '@xyflow/react/dist/style.css';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import type { RoomMessage, PersonaSummary } from '../../../../src/core/types';
import { MarkdownContent } from '../Chat';

interface CYPTreeViewProps {
  allMessages: RoomMessage[];
  activeNodeId: string;
  activeRoomPath: RoomMessage[];
  personas: PersonaSummary[];
  onSelectBranch: (messageId: string) => void;
  onClose: () => void;
  pendingQueueItems: Array<{ parentMessageId: string; personaId: string }>;
  roomPersonaIds: string[];
}

type NodeState = 'active' | 'activated' | 'explored' | 'pending' | 'initial' | 'masked';

interface CYPNodeData extends Record<string, unknown> {
  message: RoomMessage;
  speakerName: string;
  state: NodeState;
  hasChildren: boolean;
  onSelectBranch: (messageId: string) => void;
  onClose: () => void;
}

type IncompleteFamilies = Set<string>;

interface CYPPlaceholderNodeData extends Record<string, unknown> {
  label: string;
  speakerName: string;
  parentId: string | null;
  isHumanTurn: boolean;
  onSelectBranch: (messageId: string) => void;
  onClose: () => void;
}

const STATE_ICON: Record<NodeState, string> = {
  active: '●',
  activated: '○',
  explored: '·',
  pending: '?',
  initial: '○',
  masked: '🔒',
};

function getNodeState(
  message: RoomMessage,
  activeNodeId: string,
  activePathIds: Set<string>,
  exploredIds: Set<string>,
  incompleteFamilies: IncompleteFamilies,
): NodeState {
  if (message.id === activeNodeId) return 'active';
  if (activePathIds.has(message.id)) return 'activated';
  if (message.parent_id === null) return 'initial';
  if (message.parent_id !== null && incompleteFamilies.has(message.parent_id)) return 'masked';
  if (exploredIds.has(message.id)) return 'explored';
  return 'pending';
}

const NODE_WIDTH = 260;
const NODE_HEIGHT = 80;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const maxY = Math.max(...nodes.map((n) => g.node(n.id)?.y ?? 0), 1);
  const layoutedNodes = nodes.map((node) => {
    const nodeData = g.node(node.id);
    if (!nodeData) return node;
    const { x, y } = nodeData;
    const depthZIndex = Math.round((1 - y / maxY) * 100);
    return {
      ...node,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      zIndex: Math.max(node.zIndex ?? 1, depthZIndex),
    };
  });

  return { nodes: layoutedNodes, edges };
}

function ScrollableContent({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: WheelEvent) => { e.stopPropagation(); };
    el.addEventListener('wheel', stop, { passive: true });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  return (
    <div ref={ref} className="ei-cyp-node__full-content">
      {content ? <MarkdownContent content={content} /> : '(no content)'}
    </div>
  );
}

function CYPNode({ data, selected }: NodeProps<Node<CYPNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const { message, speakerName, state, hasChildren, onSelectBranch, onClose } = data;

  const content = message.content ?? '';
  const preview = content.length > 60 ? content.slice(0, 60) + '…' : content;

  const isActive = state === 'active';
  const isActivated = state === 'activated' || state === 'initial';
  const isInactiveBranch = state === 'explored' || state === 'pending';
  const isMasked = state === 'masked';

  const nodeClass = [
    'ei-cyp-node',
    isActive ? 'ei-cyp-node--active' : '',
    isActivated && !isActive ? 'ei-cyp-node--activated' : '',
    isInactiveBranch ? 'ei-cyp-node--inactive' : '',
    isMasked ? 'ei-cyp-node--masked' : '',
    expanded ? 'ei-cyp-node--expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = useCallback(() => {
    if (!isMasked) setExpanded((prev) => !prev);
  }, [isMasked]);

  const jumpTarget = hasChildren ? message.id : message.parent_id;
  const jumpLabel = hasChildren ? 'Jump here' : 'Jump to parent';

  return (
    <div
      className={nodeClass}
      onClick={handleClick}
      style={expanded || selected ? { opacity: 1 } : undefined}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <span className="ei-cyp-node__state-icon">{STATE_ICON[state]}</span>
      <div className="ei-cyp-node__speaker">{speakerName}</div>
      {isMasked ? (
        <div className="ei-cyp-node__masked-content">[Content hidden]</div>
      ) : expanded ? (
        <>
          <ScrollableContent content={content} />
          {jumpTarget && (
            <div className="ei-cyp-node__actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="ei-btn ei-btn--sm ei-btn--primary"
                onClick={() => { onSelectBranch(jumpTarget); onClose(); }}
              >
                {jumpLabel}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="ei-cyp-node__preview">{preview || '(no content)'}</div>
      )}
    </div>
  );
}

function CYPPlaceholderNode({ data }: NodeProps<Node<CYPPlaceholderNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const { label, speakerName, parentId, isHumanTurn, onSelectBranch, onClose } = data;

  return (
    <div
      className={`ei-cyp-node ei-cyp-node--placeholder${isHumanTurn ? ' ei-cyp-node--human-turn' : ''}${expanded ? ' ei-cyp-node--expanded' : ''}`}
      style={expanded ? { opacity: 1, pointerEvents: 'all', cursor: 'pointer' } : undefined}
      onClick={isHumanTurn ? () => setExpanded((p) => !p) : undefined}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="ei-cyp-node__speaker">{speakerName}</div>
      <div className="ei-cyp-node__placeholder-label">{label}</div>
      {expanded && parentId && (
        <div className="ei-cyp-node__actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="ei-btn ei-btn--sm ei-btn--primary"
            onClick={() => { onSelectBranch(parentId); onClose(); }}
          >
            Jump to parent
          </button>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  cypNode: CYPNode,
  cypPlaceholderNode: CYPPlaceholderNode,
};

export function CYPTreeView({
  allMessages,
  activeNodeId,
  activeRoomPath,
  personas,
  onSelectBranch,
  onClose,
  pendingQueueItems,
  roomPersonaIds,
}: CYPTreeViewProps) {
  const personaMap = useMemo(() => {
    const m = new Map<string, string>();
    personas.forEach((p) => m.set(p.id, p.display_name));
    return m;
  }, [personas]);

  const activePathIds = useMemo(
    () => new Set(activeRoomPath.map((m) => m.id)),
    [activeRoomPath],
  );

  const exploredIds = useMemo(() => {
    const parentIds = new Set<string>();
    allMessages.forEach((m) => {
      if (m.parent_id !== null) parentIds.add(m.parent_id);
    });
    return parentIds;
  }, [allMessages]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const parentCandidates = new Set<string>();
    allMessages.forEach((m) => {
      if (m.parent_id !== null) parentCandidates.add(m.parent_id);
    });
    if (activeNodeId) parentCandidates.add(activeNodeId);

    const incompleteFamilies: IncompleteFamilies = new Set();
    const placeholderEdges: Edge[] = [];
    const placeholderNodes: Node[] = [];

    parentCandidates.forEach((parentId) => {
      const respondedPersonaIds = new Set<string>();
      let humanResponded = false;

      allMessages.forEach((m) => {
        if (m.parent_id !== parentId) return;
        if (m.role === 'human') humanResponded = true;
        else if (m.role === 'persona' && m.persona_id) respondedPersonaIds.add(m.persona_id);
      });

      const queued = pendingQueueItems.filter((q) => q.parentMessageId === parentId);
      const queuedPersonaIds = new Set(queued.map((q) => q.personaId));

      let anyMissing = false;

      const personasHaveResponded = respondedPersonaIds.size > 0;
      if (!humanResponded && personasHaveResponded) {
        anyMissing = true;
        const placeholderId = `placeholder-${parentId}-human`;
        placeholderNodes.push({
          id: placeholderId,
          type: 'cypPlaceholderNode',
          position: { x: 0, y: 0 },
          data: { label: '✏️ Your turn', speakerName: 'You', parentId, isHumanTurn: true, onSelectBranch, onClose } satisfies CYPPlaceholderNodeData,
        });
        placeholderEdges.push({
          id: `e-${parentId}-${placeholderId}`,
          source: parentId,
          target: placeholderId,
          style: { stroke: 'var(--ei-border)', strokeWidth: 1.5, strokeDasharray: '4 3' },
        });
      }

      roomPersonaIds.forEach((personaId) => {
        if (respondedPersonaIds.has(personaId)) return;
        anyMissing = true;
        if (!queuedPersonaIds.has(personaId)) return;

        const placeholderId = `placeholder-${parentId}-${personaId}`;
        placeholderNodes.push({
          id: placeholderId,
          type: 'cypPlaceholderNode',
          position: { x: 0, y: 0 },
          data: { label: '⏳ Waiting...', speakerName: personaMap.get(personaId) ?? personaId.slice(0, 8), parentId, isHumanTurn: false, onSelectBranch, onClose } satisfies CYPPlaceholderNodeData,
        });
        placeholderEdges.push({
          id: `e-${parentId}-${placeholderId}`,
          source: parentId,
          target: placeholderId,
          style: { stroke: 'var(--ei-border)', strokeWidth: 1.5, strokeDasharray: '4 3' },
        });
      });

      if (anyMissing) incompleteFamilies.add(parentId);
    });

    const realNodes: Node[] = allMessages.map((msg) => {
      const state = getNodeState(msg, activeNodeId, activePathIds, exploredIds, incompleteFamilies);
      let speakerName = 'You';
      if (msg.role === 'persona' && msg.persona_id) {
        speakerName = personaMap.get(msg.persona_id) ?? msg.persona_id.slice(0, 8);
      }
      const isOnActivePath = state === 'active' || state === 'activated' || state === 'initial';
      return {
        id: msg.id,
        type: 'cypNode',
        position: { x: 0, y: 0 },
        zIndex: isOnActivePath ? 10 : 1,
        data: { message: msg, speakerName, state, hasChildren: exploredIds.has(msg.id), onSelectBranch, onClose } satisfies CYPNodeData,
      };
    });

    const allEdges: Edge[] = [];
    parentCandidates.forEach((parentId) => {
      allMessages
        .filter((msg) => msg.parent_id === parentId)
        .forEach((msg) => {
          const isActivatedEdge = activePathIds.has(parentId) && activePathIds.has(msg.id);
          allEdges.push({
            id: `e-${parentId}-${msg.id}`,
            source: parentId,
            target: msg.id,
            style: {
              stroke: isActivatedEdge ? 'var(--ei-accent)' : 'var(--ei-border)',
              strokeWidth: isActivatedEdge ? 2 : 1.5,
            },
          });
        });
      placeholderEdges
        .filter((e) => e.source === parentId)
        .forEach((e) => allEdges.push(e));
    });

    return getLayoutedElements([...realNodes, ...placeholderNodes], allEdges);
  }, [allMessages, activeNodeId, activePathIds, exploredIds, personaMap, onSelectBranch, onClose, pendingQueueItems, roomPersonaIds]);

  return (
    <div className="ei-cyp-tree">
      <ReactFlow
        nodes={layoutedNodes}
        edges={layoutedEdges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
