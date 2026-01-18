import blessed from 'blessed';
import type { Message, MessageState } from '../types.js';

function getMessageColor(role: "human" | "system", state: MessageState | undefined): string {
  if (state === "processing" || state === "queued") {
    return "gray-fg";
  }
  if (state === "failed") {
    return "red-fg";
  }
  return role === "human" ? "yellow-fg" : "green-fg";
}

function parseMarkdownToBlessedTags(text: string): string {
  let result = text;
  
  // Parse code blocks FIRST: ```code``` -> formatted block
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, language, code) => {
    const lang = language ? `{gray-fg}[${language}]{/gray-fg}\n` : '{gray-fg}[code]{/gray-fg}\n';
    const formattedCode = code.trim().split('\n').map((line: string) => `  {cyan-fg}${line}{/cyan-fg}`).join('\n');
    return `\n${lang}${formattedCode}\n`;
  });
  
  // Parse inline code AFTER code blocks: `code` -> {cyan-fg}{inverse}code{/inverse}{/cyan-fg}
  result = result.replace(/`([^`]+)`/g, '{cyan-fg}{inverse}$1{/inverse}{/cyan-fg}');
  
  // Parse bold: **text** -> {bold}text{/bold}
  result = result.replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}');
  
  // Parse italic underscore: _text_ -> {underline}text{/underline}
  result = result.replace(/(?<!\w)_([^_]+)_/g, '{underline}$1{/underline}');
  
  // Parse italic asterisk: *text* -> {underline}text{/underline}
  result = result.replace(/\*([^*]+)\*/g, '{underline}$1{/underline}');
  
  // Parse strikethrough: ~~text~~ -> {strikethrough}text{/strikethrough}
  result = result.replace(/~~([^~]+)~~/g, '{strikethrough}$1{/strikethrough}');
  
  return result;
}

export class ChatRenderer {
  render(
    chatHistory: blessed.Widgets.BoxElement,
    messages: Message[],
    activePersona: string
  ) {
    // Use blessed's native text handling with proper color formatting and markdown parsing
    const chatText = messages.map(msg => {
      const time = new Date(msg.timestamp).toLocaleTimeString([], { 
        hour: 'numeric', 
        minute: '2-digit' 
      });
      const name = msg.role === 'human' ? 'You' : activePersona.charAt(0).toUpperCase() + activePersona.slice(1);
      const nameColor = getMessageColor(msg.role, msg.state);
      
      // State indicators with colors
      let stateIndicator = '';
      if (msg.state === 'processing') stateIndicator = ' {gray-fg}[processing]{/gray-fg}';
      else if (msg.state === 'queued') stateIndicator = ' {gray-fg}[queued]{/gray-fg}';
      else if (msg.state === 'failed') stateIndicator = ' {red-fg}[failed]{/red-fg}';
      
      // Parse markdown in message content
      const parsedContent = parseMarkdownToBlessedTags(msg.content);
      
      // Format with blessed color tags
      return `{gray-fg}[${time}]{/gray-fg} {${nameColor}}${name}:{/${nameColor}}${stateIndicator} ${parsedContent}`;
    }).join('\n\n');
    
    chatHistory.setContent(chatText);
  }
}