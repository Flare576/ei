import React from "react";
import { Box, Text } from "ink";

export interface PersonaInfo {
  name: string;
  aliases: string[];
}

interface PersonaListProps {
  personas: PersonaInfo[];
  active: string;
  onSelect?: (name: string) => void;
}

export function PersonaList({ personas, active }: PersonaListProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      width={16}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Personas</Text>
      </Box>
      {personas.map((p) => (
        <Box key={p.name}>
          <Text color={p.name === active ? "green" : undefined}>
            {p.name === active ? "> " : "  "}
            {p.name}
          </Text>
        </Box>
      ))}
      {personas.length === 0 && (
        <Text dimColor>(none)</Text>
      )}
    </Box>
  );
}
