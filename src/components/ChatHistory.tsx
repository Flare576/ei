import React from "react";
import { Box, Text, useStdout } from "ink";
import type { Message } from "../types.js";

interface ChatHistoryProps {
  messages: Message[];
  persona: string;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getRoleName(role: "human" | "system", persona: string): string {
  if (role === "human") return "You";
  return persona.charAt(0).toUpperCase() + persona.slice(1);
}

export function ChatHistory({ messages, persona }: ChatHistoryProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;
  
  const headerLines = 2;
  const inputAreaLines = 3;
  const statusBarLines = 2;
  const chatBorderLines = 2;
  const appHeaderLines = 2;
  const reservedLines = headerLines + inputAreaLines + statusBarLines + chatBorderLines + appHeaderLines;
  
  const availableLines = Math.max(3, terminalHeight - reservedLines);
  const visibleMessages = messages.slice(-availableLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Chat: {persona}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.length === 0 ? (
          <Text dimColor>(no messages yet)</Text>
        ) : (
          visibleMessages.map((msg, idx) => (
            <Text key={idx} wrap="wrap">
              <Text dimColor>[{formatTime(msg.timestamp)}] </Text>
              <Text color={msg.role === "human" ? "yellow" : "green"}>
                {getRoleName(msg.role, persona)}:{" "}
              </Text>
              <Text>{msg.content}</Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
