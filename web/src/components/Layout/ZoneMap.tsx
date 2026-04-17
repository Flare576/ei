import { useState } from 'react';
import '../../styles/zone-map.css';

interface ZoneMapProps {
  defaultOpenIndex?: number;
}

interface Zone {
  id: string;
  header: string;
  summary: string;
  content: React.ReactNode;
}

const zones: Zone[] = [
  {
    id: 'zone-left-panel',
    header: '◧ Left Panel',
    summary: 'Your personas and rooms',
    content: (
      <ul className="ei-zone-map__list">
        <li>Click any persona to open a conversation</li>
        <li><code>+</code> creates a new persona — give them a name and personality</li>
        <li>Hover a persona to <strong>edit</strong> (pencil), <strong>pause</strong>, <strong>archive</strong>, or <strong>delete</strong></li>
        <li>
          The <strong>Rooms</strong> tab gives you multi-persona conversations in three modes:
          <ul className="ei-zone-map__sublist">
            <li><strong>Free For All (FFA)</strong> — everyone responds to every message</li>
            <li><strong>Choose Your Path (CYP)</strong> — the conversation branches; you pick which path continues</li>
            <li><strong>Messages Against Persona (MAP)</strong> — everyone submits a response; a Judge persona picks the winner</li>
          </ul>
        </li>
      </ul>
    ),
  },
  {
    id: 'zone-top-right-menu',
    header: '☰ Top-Right Menu',
    summary: 'Your settings and personal data',
    content: (
      <ul className="ei-zone-map__list">
        <li><strong>My Data</strong> — everything Ei has learned about you: facts, topics, people in your life, and quotes worth keeping. You can view, edit, or delete anything here.</li>
        <li><strong>Settings</strong> — add or manage LLM providers, set a default model, pick a theme, configure sync, and set up tool integrations (Tavily web search, Spotify)</li>
        <li><strong>Sync &amp; Exit</strong> — saves your data and syncs to your configured device if sync is enabled</li>
      </ul>
    ),
  },
  {
    id: 'zone-chat-tools',
    header: '✦ Chat Tools',
    summary: 'Context, memory, and image tools',
    content: (
      <ul className="ei-zone-map__list">
        <li><strong>✦ (diamond)</strong> — Start a fresh context boundary. The AI only sees messages after this point — older history stays saved but isn't sent. Press again to clear the boundary.</li>
        <li><strong>💡 (bulb)</strong> — Extract what the AI has learned about you from this conversation. Facts, topics, people — all get pulled out and added to your profile.</li>
        <li><strong>🖼️ (image, in toolbar)</strong> — Select messages to synthesize into an image prompt</li>
        <li><strong>✂️ (scissors, on your messages)</strong> — Capture a quote from that message directly to your memory</li>
        <li><strong>🖼️ (image, on your messages)</strong> — Generate an image from that specific message</li>
      </ul>
    ),
  },
];

export function ZoneMap({ defaultOpenIndex }: ZoneMapProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(
    defaultOpenIndex !== undefined ? defaultOpenIndex : null
  );

  function handleToggle(index: number) {
    setOpenIndex(prev => (prev === index ? null : index));
  }

  return (
    <div className="ei-zone-map">
      {zones.map((zone, index) => {
        const isOpen = openIndex === index;
        const panelId = `${zone.id}-panel`;
        const buttonId = `${zone.id}-button`;

        return (
          <div key={zone.id} className={`ei-zone-map__zone${isOpen ? ' ei-zone-map__zone--open' : ''}`}>
            <button
              id={buttonId}
              className="ei-zone-map__header"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => handleToggle(index)}
            >
              <span className="ei-zone-map__header-text">
                <span className="ei-zone-map__title">{zone.header}</span>
                {!isOpen && (
                  <span className="ei-zone-map__summary">{zone.summary}</span>
                )}
              </span>
              <span className={`ei-zone-map__chevron${isOpen ? ' ei-zone-map__chevron--open' : ''}`} aria-hidden="true">
                ›
              </span>
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="ei-zone-map__panel"
            >
              <div className="ei-zone-map__panel-inner">
                {zone.content}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
