import type { Quote } from "../../../src/core/types.js";

export function insertQuoteMarkers(content: string, quotes: Quote[]): string {
  const validQuotes = quotes
    .filter(q => q.end !== null && q.end !== undefined)
    .sort((a, b) => b.end! - a.end!);
  
  let result = content;
  for (const quote of validQuotes) {
    let insertPos = quote.end!;
    if (insertPos >= 0 && insertPos <= result.length) {
      while (insertPos > 0 && (result[insertPos - 1] === '\n' || result[insertPos - 1] === ' ')) {
        insertPos--;
      }
      result = result.slice(0, insertPos) + "\u207a" + result.slice(insertPos);
    }
  }
  return result;
}
