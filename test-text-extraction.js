// Simple test for text extraction function

// Simulate the extractReadableText function
function extractReadableText(rawOutput) {
  if (!rawOutput) {
    return '';
  }

  let cleanText = rawOutput;

  // Remove ANSI escape sequences - comprehensive patterns
  // CSI sequences: ESC[ followed by parameters and final byte
  cleanText = cleanText.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  
  // OSC sequences: ESC] followed by data and terminated by BEL or ESC\
  cleanText = cleanText.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
  
  // Simple escape sequences: ESC followed by single character
  cleanText = cleanText.replace(/\x1b[a-zA-Z0-9]/g, '');
  
  // DCS sequences: ESC P ... ESC \
  cleanText = cleanText.replace(/\x1bP[^\x1b]*\x1b\\/g, '');
  
  // APC sequences: ESC _ ... ESC \
  cleanText = cleanText.replace(/\x1b_[^\x1b]*\x1b\\/g, '');
  
  // PM sequences: ESC ^ ... ESC \
  cleanText = cleanText.replace(/\x1b\^[^\x1b]*\x1b\\/g, '');

  // Remove remaining escape sequences that might not match above patterns
  cleanText = cleanText.replace(/\x1b./g, '');

  // Remove cursor positioning sequences that might appear as text
  // These often appear as patterns like "-1;2H", "?25h", etc.
  cleanText = cleanText.replace(/-?\d+;\d+H/g, '');
  cleanText = cleanText.replace(/\?\d+[lh]/g, '');
  cleanText = cleanText.replace(/\?\d+/g, '');

  // Remove blessed box-drawing characters more precisely
  // Look for long sequences of box-drawing characters (5+ in a row)
  // This preserves legitimate text while removing UI elements
  cleanText = cleanText.replace(/[qkxjlmtuvwn]{5,}/g, ' ');
  
  // Remove short sequences of box-drawing chars that are clearly UI (2-4 chars surrounded by spaces or line boundaries)
  cleanText = cleanText.replace(/(\s|^)[qkxjlmtuvwn]{2,4}(\s|$)/g, ' ');
  
  // Remove isolated single box-drawing characters surrounded by spaces
  cleanText = cleanText.replace(/(\s)[qkxjlmtuvwn](\s)/g, '$1$2');

  // Remove control characters (except newlines and tabs)
  cleanText = cleanText.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // Clean up excessive whitespace but preserve line structure
  cleanText = cleanText.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
  cleanText = cleanText.replace(/\n\s*\n\s*\n/g, '\n\n'); // Multiple newlines to double newline
  
  // Remove leading/trailing whitespace from each line while preserving line breaks
  cleanText = cleanText.split('\n').map(line => line.trim()).join('\n');
  
  // Remove empty lines at start and end
  cleanText = cleanText.replace(/^\n+/, '').replace(/\n+$/, '');

  return cleanText;
}

// Test with sample blessed output
const sampleOutput = `I - Emotional Intelligenceqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxbeta|[ei]xmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjlqChat:eiqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx[7:03 AM]You:Starting very slow background processing operation.`;

console.log('=== TEXT EXTRACTION TEST ===');
console.log('Original output:');
console.log(JSON.stringify(sampleOutput));
console.log('\nCleaned text:');
const cleanText = extractReadableText(sampleOutput);
console.log(JSON.stringify(cleanText));
console.log('\nReadable format:');
console.log(cleanText);
console.log('\nLooking for: "Starting very slow background processing"');
console.log('Contains text:', cleanText.includes('Starting very slow background processing'));
console.log('Contains "operation":', cleanText.includes('operation'));
console.log('Contains "Emotional Intelligence":', cleanText.includes('Emotional Intelligence'));