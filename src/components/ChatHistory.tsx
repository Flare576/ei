import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import type { Message, MessageState } from "../types.js";
import { parseMarkdownInline } from "../markdown.js";

interface ChatHistoryProps {
  messages: Message[];
  persona: string;
  scrollOffset?: number;
  onScrollInfo?: (info: { canScrollUp: boolean; canScrollDown: boolean; hiddenAbove: number }) => void;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getRoleName(role: "human" | "system", persona: string): string {
  if (role === "human") return "You";
  return persona.charAt(0).toUpperCase() + persona.slice(1);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner(): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>;
}

function getStateIndicator(state: MessageState | undefined): React.ReactElement | null {
  switch (state) {
    case "processing":
      return <Spinner />;
    case "queued":
      return <Text dimColor>[queued] </Text>;
    case "failed":
      return <Text color="red">[failed] </Text>;
    default:
      return null;
  }
}

function getMessageColor(role: "human" | "system", state: MessageState | undefined): string | undefined {
  if (state === "processing" || state === "queued") {
    return "gray";
  }
  if (state === "failed") {
    return "red";
  }
  return role === "human" ? "yellow" : "green";
}

function wrapTextToLines(text: string, width: number): string[] {
  if (width <= 0) return [text];
  
  const inputLines = text.split('\n');
  const result: string[] = [];
  
  for (const inputLine of inputLines) {
    if (inputLine.length === 0) {
      result.push('');
      continue;
    }
    
    if (inputLine.length <= width) {
      result.push(inputLine);
      continue;
    }
    
    const words = inputLine.split(' ');
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= width) {
        currentLine += ' ' + word;
      } else {
        result.push(currentLine);
        currentLine = word;
      }
    }
    
    if (currentLine.length > 0) {
      result.push(currentLine);
    }
  }
  
  return result.length > 0 ? result : [''];
}

interface DisplayLine {
  key: string;
  prefix: React.ReactElement | null;
  content: string;
  contentColor: string | undefined;
  isGrayed: boolean;
}

function messageToDisplayLines(
  msg: Message,
  msgIndex: number,
  persona: string,
  availableWidth: number
): DisplayLine[] {
  const time = formatTime(msg.timestamp);
  const name = getRoleName(msg.role, persona);
  const nameColor = getMessageColor(msg.role, msg.state);
  const isGrayed = msg.state === "processing" || msg.state === "queued";
  const isFailed = msg.state === "failed";
  
  const prefixText = `[${time}] ${name}: `;
  const prefixWidth = prefixText.length;
  const contentWidth = Math.max(10, availableWidth - prefixWidth);
  
  const wrappedLines = wrapTextToLines(msg.content, contentWidth);
  
  return wrappedLines.map((lineContent, lineIdx) => ({
    key: `msg-${msgIndex}-line-${lineIdx}`,
    prefix: lineIdx === 0 ? (
      <>
        <Text dimColor>[{time}] </Text>
        <Text color={nameColor}>{name}: </Text>
      </>
    ) : (
      <Text>{' '.repeat(prefixWidth)}</Text>
    ),
    content: lineContent,
    contentColor: isFailed ? "red" : nameColor,
    isGrayed
  }));
}

export function ChatHistory({ messages, persona, scrollOffset = 0, onScrollInfo }: ChatHistoryProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;
  const terminalWidth = stdout?.columns ?? 80;
  
  const reservedLines = 11;
  const availableLines = Math.max(3, terminalHeight - reservedLines);
  const availableWidth = Math.max(20, terminalWidth - 4);
  
  const allDisplayLines: DisplayLine[] = [];
  messages.forEach((msg, idx) => {
    allDisplayLines.push(...messageToDisplayLines(msg, idx, persona, availableWidth));
  });
  
  const totalLines = allDisplayLines.length;
  const maxOffset = Math.max(0, totalLines - availableLines);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  
  const endLine = totalLines - clampedOffset;
  const startLine = Math.max(0, endLine - availableLines);
  const visibleLines = allDisplayLines.slice(startLine, endLine);
  
  const hiddenAbove = startLine;
  const hiddenBelow = totalLines - endLine;

  useEffect(() => {
    if (onScrollInfo) {
      onScrollInfo({
        canScrollUp: hiddenAbove > 0,
        canScrollDown: hiddenBelow > 0,
        hiddenAbove
      });
    }
  }, [hiddenAbove, hiddenBelow, onScrollInfo]);

  const boxHeight = availableLines + 4;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      height={boxHeight}
      overflow="hidden"
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Chat: {persona}</Text>
        {hiddenAbove > 0 && (
          <Text dimColor> ↑{hiddenAbove}</Text>
        )}
        {hiddenBelow > 0 && (
          <Text dimColor> ↓{hiddenBelow}</Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.length === 0 ? (
          <Text dimColor>(no messages yet)</Text>
        ) : (
          visibleLines.map((line) => {
            const isFailed = line.contentColor === "red";
            return (
              <Text key={line.key} wrap="truncate-end">
                {line.prefix}
                {line.isGrayed ? (
                  <Text dimColor>{line.content}</Text>
                ) : isFailed ? (
                  <Text color="red">{line.content}</Text>
                ) : (
                  parseMarkdownInline(line.content).map((node, i) =>
                    typeof node === "string" ? <Text key={i}>{node}</Text> : React.cloneElement(node, { key: i })
                  )
                )}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}
