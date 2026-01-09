import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface PersonaInfo {
  name: string;
  aliases: string[];
  short_description?: string;
  long_description?: string;
}

export interface PersonaStatusInfo {
  unreadCount: number;
  isProcessing: boolean;
  heartbeatIn: number;
}

interface PersonaListProps {
  personas: PersonaInfo[];
  active: string;
  onSelect?: (name: string) => void;
  focused?: boolean;
  highlightedIndex?: number;
  personaStatus?: Map<string, PersonaStatusInfo>;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) return "soon";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h${remainingMins}m` : `${hours}h`;
}

export function PersonaList({ 
  personas, 
  active, 
  focused = false,
  highlightedIndex = 0,
  personaStatus
}: PersonaListProps): React.ReactElement {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    const hasProcessing = personaStatus && 
      Array.from(personaStatus.values()).some(s => s.isProcessing);
    
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [personaStatus]);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? "cyan" : "gray"}
      paddingX={1}
      width={24}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Personas</Text>
        {focused && <Text dimColor> (j/k)</Text>}
      </Box>
      {personas.map((p, idx) => {
        const isActive = p.name === active;
        const isHighlighted = focused && idx === highlightedIndex;
        const status = personaStatus?.get(p.name);
        const unread = status?.unreadCount || 0;
        const isProcessing = status?.isProcessing || false;
        const heartbeatIn = status?.heartbeatIn || 0;

        return (
          <Box key={p.name} flexDirection="column" marginBottom={isActive ? 1 : 0}>
            <Box>
              <Text 
                color={isActive ? "green" : undefined}
                inverse={isHighlighted}
              >
                {isActive ? "> " : "  "}
                {p.name}
                {unread > 0 && <Text bold color="yellow">* </Text>}
              </Text>
              <Box flexGrow={1} />
              {isProcessing ? (
                <Text color="cyan">{SPINNER_FRAMES[spinnerFrame]}</Text>
              ) : (
                <>
                  {unread > 0 && <Text color="yellow">{unread} </Text>}
                  {heartbeatIn > 0 && <Text dimColor>{formatTimeRemaining(heartbeatIn)}</Text>}
                </>
              )}
            </Box>
            {isActive && p.short_description && (
              <Text dimColor wrap="truncate">  {p.short_description}</Text>
            )}
          </Box>
        );
      })}
      {personas.length === 0 && (
        <Text dimColor>(none)</Text>
      )}
    </Box>
  );
}
