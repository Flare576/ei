import React from "react";
import { Text } from "ink";

type MarkdownNode = React.ReactElement | string;

interface ParseState {
  result: MarkdownNode[];
  remaining: string;
}

function parseInlineCode(text: string): ParseState {
  const match = text.match(/^`([^`]+)`/);
  if (match) {
    return {
      result: [<Text key={`code-${match[1]}`} color="cyan" inverse>{match[1]}</Text>],
      remaining: text.slice(match[0].length)
    };
  }
  return { result: [], remaining: text };
}

function parseBold(text: string): ParseState {
  const match = text.match(/^\*\*([^*]+)\*\*/);
  if (match) {
    return {
      result: [<Text key={`bold-${match[1]}`} bold>{match[1]}</Text>],
      remaining: text.slice(match[0].length)
    };
  }
  return { result: [], remaining: text };
}

function parseItalicUnderscore(text: string): ParseState {
  const match = text.match(/^_([^_]+)_/);
  if (match) {
    if (match.index !== undefined && match.index > 0) {
      const prevChar = text[match.index - 1];
      if (/\w/.test(prevChar)) {
        return { result: [], remaining: text };
      }
    }
    return {
      result: [<Text key={`italic-u-${match[1]}`} dimColor>{match[1]}</Text>],
      remaining: text.slice(match[0].length)
    };
  }
  return { result: [], remaining: text };
}

function parseItalicAsterisk(text: string): ParseState {
  const match = text.match(/^\*([^*]+)\*/);
  if (match) {
    return {
      result: [<Text key={`italic-a-${match[1]}`} dimColor>{match[1]}</Text>],
      remaining: text.slice(match[0].length)
    };
  }
  return { result: [], remaining: text };
}

function parseStrikethrough(text: string): ParseState {
  const match = text.match(/^~~([^~]+)~~/);
  if (match) {
    return {
      result: [<Text key={`strike-${match[1]}`} strikethrough>{match[1]}</Text>],
      remaining: text.slice(match[0].length)
    };
  }
  return { result: [], remaining: text };
}

export function parseMarkdownInline(text: string): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  let remaining = text;
  let plainText = "";
  let keyCounter = 0;

  while (remaining.length > 0) {
    let parsed: ParseState = { result: [], remaining };

    if (remaining.startsWith("`")) {
      parsed = parseInlineCode(remaining);
    } else if (remaining.startsWith("**")) {
      parsed = parseBold(remaining);
    } else if (remaining.startsWith("~~")) {
      parsed = parseStrikethrough(remaining);
    } else if (remaining.startsWith("_")) {
      parsed = parseItalicUnderscore(remaining);
    } else if (remaining.startsWith("*")) {
      parsed = parseItalicAsterisk(remaining);
    }

    if (parsed.result.length > 0) {
      if (plainText) {
        result.push(plainText);
        plainText = "";
      }
      result.push(...parsed.result);
      remaining = parsed.remaining;
    } else {
      plainText += remaining[0];
      remaining = remaining.slice(1);
    }
    keyCounter++;
  }

  if (plainText) {
    result.push(plainText);
  }

  return result;
}

interface CodeBlock {
  language: string;
  code: string;
}

interface ParsedContent {
  type: "text" | "codeblock";
  content: string;
  language?: string;
}

export function parseMarkdownBlocks(text: string): ParsedContent[] {
  const result: ParsedContent[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({
        type: "text",
        content: text.slice(lastIndex, match.index)
      });
    }

    result.push({
      type: "codeblock",
      content: match[2].trim(),
      language: match[1] || undefined
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push({
      type: "text",
      content: text.slice(lastIndex)
    });
  }

  if (result.length === 0) {
    result.push({ type: "text", content: text });
  }

  return result;
}

export function renderMarkdown(text: string): React.ReactElement {
  const blocks = parseMarkdownBlocks(text);
  
  return (
    <>
      {blocks.map((block, idx) => {
        if (block.type === "codeblock") {
          return (
            <Text key={`block-${idx}`}>
              {"\n"}
              <Text color="gray">{block.language ? `[${block.language}]` : "[code]"}</Text>
              {"\n"}
              <Text color="cyan" dimColor>
                {block.content.split("\n").map((line, lineIdx) => (
                  <React.Fragment key={lineIdx}>
                    {"  "}{line}{"\n"}
                  </React.Fragment>
                ))}
              </Text>
            </Text>
          );
        } else {
          const inlineNodes = parseMarkdownInline(block.content);
          return (
            <React.Fragment key={`inline-${idx}`}>
              {inlineNodes.map((node, nodeIdx) => 
                typeof node === "string" 
                  ? <Text key={nodeIdx}>{node}</Text>
                  : React.cloneElement(node, { key: `node-${idx}-${nodeIdx}` })
              )}
            </React.Fragment>
          );
        }
      })}
    </>
  );
}
