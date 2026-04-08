import YAML from "yaml";
import type { Quote } from "../../../src/core/types.js";

interface EditableQuote extends Quote {
  _delete?: boolean;
}

interface EditableQuoteData {
  quotes: EditableQuote[];
}

export function quotesToYAML(quotes: Quote[]): string {
  const data: EditableQuoteData = {
    quotes: quotes.map(q => ({
      ...q,
      _delete: false,
    })),
  };

  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

export interface QuotesYAMLResult {
  quotes: Quote[];
  deletedQuoteIds: string[];
}

export function quotesFromYAML(yamlContent: string): QuotesYAMLResult {
  const data = YAML.parse(yamlContent) as EditableQuoteData;

  const deletedQuoteIds: string[] = [];
  const quotes: Quote[] = [];

  for (const q of data.quotes ?? []) {
    if (q._delete) {
      deletedQuoteIds.push(q.id);
    } else {
      const { _delete, ...quote } = q;
      quotes.push(quote);
    }
  }

  return { quotes, deletedQuoteIds };
}
