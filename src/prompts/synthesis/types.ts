/**
 * Synthesis Prompt Types
 */

import type { Fact, Topic, Person, Quote } from "../../core/types.js";

export interface SynthesisPromptData {
  subject: string;
  facts: Fact[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
}
