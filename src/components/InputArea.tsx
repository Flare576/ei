import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputAreaProps {
  onSubmit: (text: string) => void;
  hint?: string;
}

export function InputArea({ onSubmit, hint }: InputAreaProps): React.ReactElement {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue("");
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    // Ctrl+C is handled by Ink's default behavior
    if (key.ctrl && input === "c") {
      return;
    }

    // Ctrl+U clears the line
    if (key.ctrl && input === "u") {
      setValue("");
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box flexGrow={1}>
        <Text color="cyan">&gt; </Text>
        <Text>{value}</Text>
        <Text color="gray">_</Text>
      </Box>
      {hint && (
        <Box marginLeft={2}>
          <Text dimColor>[{hint}]</Text>
        </Box>
      )}
    </Box>
  );
}
