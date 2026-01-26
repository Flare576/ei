export function parseQuotedArgs(input: string): string {
  const trimmed = input.trim();
  
  if (!trimmed) {
    return '';
  }
  
  const firstChar = trimmed[0];
  if (firstChar === '"' || firstChar === "'") {
    const quoteChar = firstChar;
    const closingIdx = trimmed.indexOf(quoteChar, 1);
    
    if (closingIdx === -1) {
      return trimmed.slice(1);
    }
    
    return trimmed.slice(1, closingIdx);
  }
  
  return trimmed.split(/\s+/)[0];
}

export function parseCommandArgs(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  
  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let wasInQuote = false;
  let i = 0;
  
  while (i < trimmed.length) {
    const char = trimmed[i];
    
    if (inQuote) {
      if (char === inQuote) {
        args.push(current);
        current = '';
        inQuote = null;
        wasInQuote = true;
      } else {
        current += char;
      }
      i++;
    } else {
      if (char === '"' || char === "'") {
        inQuote = char;
        wasInQuote = false;
        i++;
      } else if (/\s/.test(char)) {
        if (current && !wasInQuote) {
          args.push(current);
          current = '';
        }
        wasInQuote = false;
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }
  
  if (current || inQuote) {
    args.push(current);
  }
  
  return args;
}
