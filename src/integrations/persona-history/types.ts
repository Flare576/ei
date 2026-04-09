export interface PersonaHistorySettings {
  integration?: boolean;
  extraction_model?: string;
  start_date?: string;      // ISO date string "YYYY-MM-DD", defaults to earliest message found
  last_queued_date?: string; // ISO date of last day fully queued — resume point if interrupted
  complete?: boolean;       // Set true when all days have been queued; prevents re-runs
}
