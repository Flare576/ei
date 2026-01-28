import type { DataItemBase } from "../../core/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

export interface EiValidationPromptData {
  validation_type: "cross_persona";
  item_name: string;
  data_type: "fact" | "trait" | "topic" | "person";
  context: string;
  source_persona: string;
  current_item?: DataItemBase;
  proposed_item: DataItemBase;
}

export interface EiValidationResult {
  decision: "accept" | "modify" | "reject";
  reason: string;
  modified_item?: DataItemBase;
}
