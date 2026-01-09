import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputAreaProps {
  onSubmit: (text: string) => void;
  hint?: string;
  disabled?: boolean;
  maxLines?: number;
  clearTrigger?: number;
  onHasTextChange?: (hasText: boolean) => void;
}

interface CursorPosition {
  line: number;
  col: number;
}

export function InputArea({ 
  onSubmit, 
  hint, 
  disabled = false,
  maxLines = 10,
  clearTrigger = 0,
  onHasTextChange
}: InputAreaProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 0, col: 0 });
  const [lastClearTrigger, setLastClearTrigger] = useState(0);

  React.useEffect(() => {
    if (clearTrigger !== lastClearTrigger && clearTrigger > 0) {
      setLines([""]);
      setCursor({ line: 0, col: 0 });
      setLastClearTrigger(clearTrigger);
    }
  }, [clearTrigger, lastClearTrigger]);

  const hasText = lines.some(l => l.length > 0);
  React.useEffect(() => {
    onHasTextChange?.(hasText);
  }, [hasText, onHasTextChange]);

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      const fullText = lines.join("\n").trim();
      if (fullText) {
        onSubmit(fullText);
        setLines([""]);
        setCursor({ line: 0, col: 0 });
      }
      return;
    }

    if (key.ctrl && input === "j") {
      if (lines.length < maxLines) {
        setLines(prev => {
          const currentLine = prev[cursor.line];
          const beforeCursor = currentLine.slice(0, cursor.col);
          const afterCursor = currentLine.slice(cursor.col);
          const newLines = [
            ...prev.slice(0, cursor.line),
            beforeCursor,
            afterCursor,
            ...prev.slice(cursor.line + 1)
          ];
          return newLines;
        });
        setCursor(prev => ({ line: prev.line + 1, col: 0 }));
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor.col > 0) {
        setLines(prev => {
          const newLines = [...prev];
          const line = newLines[cursor.line];
          newLines[cursor.line] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
          return newLines;
        });
        setCursor(prev => ({ ...prev, col: prev.col - 1 }));
      } else if (cursor.line > 0) {
        const prevLineLen = lines[cursor.line - 1].length;
        setLines(prev => {
          const newLines = [...prev];
          newLines[cursor.line - 1] = prev[cursor.line - 1] + prev[cursor.line];
          newLines.splice(cursor.line, 1);
          return newLines;
        });
        setCursor({ line: cursor.line - 1, col: prevLineLen });
      }
      return;
    }

    if (key.upArrow) {
      if (cursor.line > 0) {
        setCursor(prev => ({
          line: prev.line - 1,
          col: Math.min(prev.col, lines[prev.line - 1].length)
        }));
      }
      return;
    }

    if (key.downArrow) {
      if (cursor.line < lines.length - 1) {
        setCursor(prev => ({
          line: prev.line + 1,
          col: Math.min(prev.col, lines[prev.line + 1].length)
        }));
      }
      return;
    }

    if (key.leftArrow) {
      if (cursor.col > 0) {
        setCursor(prev => ({ ...prev, col: prev.col - 1 }));
      } else if (cursor.line > 0) {
        setCursor({ line: cursor.line - 1, col: lines[cursor.line - 1].length });
      }
      return;
    }

    if (key.rightArrow) {
      if (cursor.col < lines[cursor.line].length) {
        setCursor(prev => ({ ...prev, col: prev.col + 1 }));
      } else if (cursor.line < lines.length - 1) {
        setCursor({ line: cursor.line + 1, col: 0 });
      }
      return;
    }

    if (key.ctrl && input === "c") {
      return;
    }

    if (key.ctrl && input === "u") {
      setLines([""]);
      setCursor({ line: 0, col: 0 });
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setLines(prev => {
        const newLines = [...prev];
        const line = newLines[cursor.line];
        newLines[cursor.line] = line.slice(0, cursor.col) + input + line.slice(cursor.col);
        return newLines;
      });
      setCursor(prev => ({ ...prev, col: prev.col + input.length }));
    }
  });

  const lineCount = lines.length;
  const showLineIndicator = lineCount > 1;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={disabled ? "gray" : "cyan"}
      paddingX={1}
    >
      {lines.map((line, lineIdx) => (
        <Box key={lineIdx} flexDirection="row">
          {lineIdx === 0 ? (
            <Text color={disabled ? "gray" : "cyan"}>&gt; </Text>
          ) : (
            <Text color={disabled ? "gray" : "cyan"}>  </Text>
          )}
          <Text dimColor={disabled}>
            {lineIdx === cursor.line && !disabled ? (
              <>
                {line.slice(0, cursor.col)}
                <Text inverse>{line[cursor.col] ?? " "}</Text>
                {line.slice(cursor.col + 1)}
              </>
            ) : (
              line || (lineIdx === 0 ? "" : "")
            )}
          </Text>
        </Box>
      ))}
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          {showLineIndicator && (
            <Text dimColor>[{lineCount} lines | Ctrl+J: new line]</Text>
          )}
        </Box>
        {hint && (
          <Text dimColor>[{hint}]</Text>
        )}
      </Box>
    </Box>
  );
}
