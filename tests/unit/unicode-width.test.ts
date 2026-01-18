import { describe, it, expect } from 'vitest';
import { getDisplayWidth } from '../../src/blessed/unicode-width.js';

describe('getDisplayWidth', () => {
  it('calculates width for ASCII text', () => {
    expect(getDisplayWidth('hello')).toBe(5);
    expect(getDisplayWidth('a')).toBe(1);
    expect(getDisplayWidth('')).toBe(0);
  });

  it('calculates width for CJK fullwidth characters', () => {
    expect(getDisplayWidth('你好')).toBe(4);
    expect(getDisplayWidth('古')).toBe(2);
  });

  it('calculates width for emoji', () => {
    expect(getDisplayWidth('👋')).toBe(2);
    expect(getDisplayWidth('⚠️')).toBe(2);
    expect(getDisplayWidth('✅')).toBe(2);
    expect(getDisplayWidth('❌')).toBe(2);
  });

  it('calculates width for emoji with variation selectors', () => {
    expect(getDisplayWidth('❤️')).toBe(2);
  });

  it('calculates width for emoji with skin tone modifiers', () => {
    expect(getDisplayWidth('👍🏽')).toBe(2);
  });

  it('calculates width for ZWJ sequences (family emoji)', () => {
    expect(getDisplayWidth('👩‍👩‍👧‍👧')).toBe(2);
  });

  it('calculates width for mixed content', () => {
    expect(getDisplayWidth('Hello 👋 World')).toBe(14);
    expect(getDisplayWidth('Test ✅ 你好')).toBe(12);
  });

  it('handles ANSI escape codes', () => {
    expect(getDisplayWidth('\u001B[1mhello\u001B[22m')).toBe(5);
    expect(getDisplayWidth('\u001B[31m古\u001B[0m')).toBe(2);
  });

  it('handles zero-width characters', () => {
    expect(getDisplayWidth('\u200B')).toBe(0);
  });

  it('handles combining characters', () => {
    expect(getDisplayWidth('e\u0301')).toBe(1);
  });
});
