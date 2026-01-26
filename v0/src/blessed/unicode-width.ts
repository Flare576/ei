import stringWidth from 'string-width';

/**
 * Calculate the display width of a string for terminal rendering.
 * 
 * Handles:
 * - Emoji (including ZWJ sequences, variation selectors, skin tones)
 * - East Asian fullwidth characters (CJK)
 * - ANSI escape codes (strips them)
 * - Combining characters
 * - Zero-width characters
 * 
 * @param text - The text to measure
 * @returns The display width in terminal columns
 * 
 * @example
 * getDisplayWidth('hello');     // => 5
 * getDisplayWidth('你好');       // => 4 (2 chars × 2 columns each)
 * getDisplayWidth('👋');        // => 2 (emoji are typically 2 columns)
 * getDisplayWidth('👩‍👩‍👧‍👧');    // => 2 (ZWJ family emoji)
 * getDisplayWidth('❤️');        // => 2 (emoji with variation selector)
 */
export function getDisplayWidth(text: string): number {
  return stringWidth(text, {
    // Don't count ANSI escape codes in width calculation
    countAnsiEscapeCodes: false,
    // Treat ambiguous-width characters as narrow (width 1)
    // This is the most common terminal behavior
    ambiguousIsNarrow: true
  });
}
