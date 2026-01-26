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

function addEmojiSpacing(text: string): string {
  return text.replace(/([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu, '$1 ');
}

function parseMarkdownToBlessedTags(text: string): string {
  let result = text;
  
  result = addEmojiSpacing(result);
  
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, language, code) => {
    const lang = language ? `{gray-fg}[${language}]{/gray-fg}\n` : '{gray-fg}[code]{/gray-fg}\n';
    const formattedCode = code.trim().split('\n').map((line: string) => `  {cyan-fg}${line}{/cyan-fg}`).join('\n');
    return `\n${lang}${formattedCode}\n`;
  });
  
  result = result.replace(/`([^`]+)`/g, '{cyan-fg}{inverse}$1{/inverse}{/cyan-fg}');
  
  result = result.replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}');
  
  result = result.replace(/(?<!\w)_([^_]+)_/g, '{underline}$1{/underline}');
  
  result = result.replace(/\*([^*]+)\*/g, '{underline}$1{/underline}');
  
  result = result.replace(/~~([^~]+)~~/g, '{strikethrough}$1{/strikethrough}');
  
  return result;
}

export class ChatRenderer {
  render(
    chatHistory: blessed.Widgets.BoxElement,
    messages: Message[],
    activePersona: string
  ) {
    const chatText = messages.map(msg => {
      if (msg.content === '[CONTEXT_CLEARED]') {
        return '{cyan-fg}{bold}--- New Conversation ---{/bold}{/cyan-fg}';
      }
      
      const time = new Date(msg.timestamp).toLocaleTimeString([], { 
        hour: 'numeric', 
        minute: '2-digit' 
      });
      const name = msg.role === 'human' ? 'You' : activePersona.charAt(0).toUpperCase() + activePersona.slice(1);
      const nameColor = getMessageColor(msg.role, msg.state);
      
      let stateIndicator = '';
      if (msg.state === 'processing') stateIndicator = ' {gray-fg}[processing]{/gray-fg}';
      else if (msg.state === 'queued') stateIndicator = ' {gray-fg}[queued]{/gray-fg}';
      else if (msg.state === 'failed') stateIndicator = ' {red-fg}[failed]{/red-fg}';
      
      const parsedContent = parseMarkdownToBlessedTags(msg.content);
      
      return `{gray-fg}[${time}]{/gray-fg} {${nameColor}}${name}:{/${nameColor}}${stateIndicator} ${parsedContent}`;
    }).join('\n\n');
    
    chatHistory.setContent(chatText);
  }
}