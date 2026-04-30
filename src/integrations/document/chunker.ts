import { expandToWordBoundaries } from "../../core/handlers/human-matching.js";

const DEFAULT_CHUNK_CHARS = 6000;
const DEFAULT_OVERLAP_CHARS = 300;

const MARKDOWN_SEPARATORS = ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " ", ""];
const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

function splitOnSeparator(text: string, separator: string): string[] {
  if (separator === "") {
    return text.split("");
  }
  return text.split(separator);
}

function mergeChunks(pieces: string[], separator: string, chunkSize: number): string[] {
  const merged: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? current + separator + piece : piece;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current) merged.push(current);
      current = piece.length <= chunkSize ? piece : piece;
    }
  }
  if (current) merged.push(current);
  return merged;
}

function recursiveSplit(
  text: string,
  separators: string[],
  chunkSize: number
): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const [separator, ...remainingSeparators] = separators;

  if (separator === undefined) {
    return [text];
  }

  const pieces = splitOnSeparator(text, separator);
  const result: string[] = [];

  for (const piece of pieces) {
    if (piece.length <= chunkSize) {
      result.push(piece);
    } else if (remainingSeparators.length > 0) {
      result.push(...recursiveSplit(piece, remainingSeparators, chunkSize));
    } else {
      result.push(piece);
    }
  }

  return mergeChunks(result, separator, chunkSize);
}

function applyOverlap(chunks: string[], overlapChars: number): string[] {
  if (overlapChars <= 0 || chunks.length <= 1) return chunks;

  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = chunks[i - 1];
    const rawStart = Math.max(0, prev.length - overlapChars);
    const { start } = expandToWordBoundaries(prev, rawStart, rawStart);
    const prefix = prev.slice(start);
    return prefix + chunk;
  });
}

export function recursiveCharacterSplit(
  text: string,
  options?: { chunkSize?: number; overlap?: number; isMarkdown?: boolean }
): string[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_CHARS;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP_CHARS;
  const separators = options?.isMarkdown ? MARKDOWN_SEPARATORS : DEFAULT_SEPARATORS;

  const rawChunks = recursiveSplit(text, separators, chunkSize);
  const nonEmpty = rawChunks.filter(c => c.trim().length > 0);
  return applyOverlap(nonEmpty, overlap);
}
