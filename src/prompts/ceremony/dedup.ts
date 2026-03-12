import type { DedupPromptData } from "./types.js";

// =============================================================================
// DEDUP CURATOR — Merge duplicate entities with data preservation
// =============================================================================

/**
 * The Dedup Curator receives clusters of potentially duplicate entities and
 * curates them into consolidated records. This is a ONE-PHASE operation (unlike
 * rewrite's two-phase scan+rewrite), because we've already deterministically
 * identified candidates via embedding similarity (0.90+ cosine).
 * 
 * Pattern borrowed from rewrite.ts ceremony with Flare's "lose NO data" philosophy.
 */
export function buildDedupPrompt(data: DedupPromptData): { system: string; user: string } {
  const typeLabel = data.itemType.charAt(0).toUpperCase() + data.itemType.slice(1);
  
  const system = `You are acting as the curator for a user's internal database. You have been given a cluster of ${typeLabel} records that our system believes may be duplicates (based on semantic similarity >= 0.90).

**YOUR PRIME DIRECTIVE IS TO LOSE _NO_ DATA.**

Your secondary directive is to ORGANIZE IT into small, non-repetitive components. The user NEEDS the data, but the data is used by AI agents, so duplication limits usefulness—agents waste tokens re-reading the same information under different names.

You have access to a tool called \`read_memory\` which will query the user's internal system for additional context if needed. Use it to verify relationships, check for related records, or gather more information before making merge decisions.

Your task:
1. **Identify true duplicates**: Examine each record. Are these genuinely the same thing with different wording, or are they distinct but related concepts?
2. **Merge where appropriate**: For TRUE duplicates, consolidate all unique information into ONE canonical record. Pick the best "name" (most descriptive, most commonly used). Merge all descriptions—every unique detail must be preserved.
3. **Keep distinct concepts separate**: Similar ≠ duplicate. "Software Engineering" and "Software Architecture" may be related but are NOT the same. "Job at Company X" and "Profession: Software Engineer" are related but distinct. Do NOT merge these.
4. **Track what was merged**: For removed records, indicate which record absorbed their data (via "replaced_by" field).
5. **Add new records if needed**: If consolidating reveals a MISSING intermediate concept (e.g., merging "Python Developer" and "Backend Engineer" reveals we're missing "Software Engineering" as a parent topic), create it.

The format of your final output should be:
{
  "update": [
    /* Full ${typeLabel} record payloads with all fields preserved */
    /* MUST include "id", "type", "name", "description" */
    /* Include sentiment, strength, confidence, category, relationship, etc. where applicable */
  ],
  "remove": [
    {"to_be_removed": "uuid-of-duplicate", "replaced_by": "uuid-of-canonical-record"},
    /* "replaced_by" is the ID of the record that absorbed this duplicate's data */
  ],
  "add": [
    /* Brand-new records (NO "id" field—system assigns one) */
    /* Only create if merging reveals a MISSING concept */
  ]
}

Return raw JSON. No markdown fencing, no commentary, no explanation. Just the JSON object.

Record format for "${typeLabel}" (based on type):

${buildRecordFormatExamples(data.itemType)}

Rules:
- Do NOT invent information. Only redistribute what exists in the cluster.
- Descriptions should be concise—ideally under 300 characters, never over 500.
- Preserve all numeric values (sentiment, strength, confidence, exposure, etc.) from source records. When merging, take the HIGHER value for strength/confidence, AVERAGE for sentiment.
- Every removed record MUST have "replaced_by" pointing to the canonical record that absorbed its data.
- The "update" array should contain AT LEAST ONE record (the canonical/merged one), even if all others are removed.
- If records are NOT duplicates (just similar), return them ALL in "update" unchanged, with empty "remove" and "add" arrays.
- Use \`read_memory\` to check for related records or gather context before making irreversible merge decisions.`;

  const user = JSON.stringify({
    cluster: data.cluster.map(stripEmbedding),
    cluster_type: data.itemType,
    similarity_range: data.similarityRange,
  }, null, 2);

  return { system, user };
}

// =============================================================================
// Helpers
// =============================================================================

/** Strip embedding arrays from items before putting them in prompts—they're huge and useless to the LLM. */
function stripEmbedding<T extends { embedding?: unknown }>(item: T): Omit<T, "embedding"> {
  const { embedding: _, ...rest } = item;
  return rest as Omit<T, "embedding">;
}

function buildRecordFormatExamples(itemType: string): string {
  // Each entity type has different required fields and semantic meanings.
  // Examples show both "existing" (with id) and "new" (without id) formats.
  // When merging: HIGHER strength/confidence, AVERAGE sentiment, MAX exposure_desired.
  
  switch (itemType) {
    case "fact":
      return buildFactExamples();
    case "trait":
      return buildTraitExamples();
    case "topic":
      return buildTopicExamples();
    case "person":
      return buildPersonExamples();
    default:
      return "/* Unknown type */";
  }
}

function buildFactExamples(): string {
  return `EXISTING FACT (being updated/merged):
{
  "id": "uuid-of-canonical-record",  // REQUIRED for updates
  "type": "fact",                     // REQUIRED
  "name": "Owns a 2019 Toyota Camry", // REQUIRED - descriptive, concise
  "description": "Silver sedan, purchased in March 2019. Primary commute vehicle. Has 45k miles as of Jan 2024.", // REQUIRED - ALL unique details from duplicates
  "sentiment": 0.2,                    // -1.0 to 1.0, emotional valence (average when merging)
  "validated": "by_human",            // "unknown" | "by_ei" | "by_human" | "ai_generated" (keep highest trust level)
  "validated_date": "2024-01-15T10:30:00Z", // ISO timestamp (most recent)
  "last_updated": "2024-03-11T12:00:00Z",   // ISO timestamp (set to now)
  "learned_by": "persona-uuid-123",  // OPTIONAL - UUID of persona that learned this (preserve from source)
  "last_changed_by": "persona-uuid-456", // OPTIONAL - UUID of persona that last updated (your current context)
  "persona_groups": ["group1", "group2"] // OPTIONAL - visibility groups (union of all sources)
}

NEW FACT (creating missing concept):
{
  "type": "fact",                     // REQUIRED (NO "id" field for new records)
  "name": "Lives in Seattle",         // REQUIRED
  "description": "Resides in the Capitol Hill neighborhood. Has lived there since 2018.", // REQUIRED - concise (<300 chars ideal)
  "sentiment": 0.0,                    // -1.0 to 1.0 (neutral default for facts)
  "validated": "unknown",             // Default for new records
  "validated_date": ""                // Empty string for unvalidated
}

GOOD vs BAD descriptions:
✅ GOOD: "Works as a Senior Software Engineer at Microsoft. Started in 2020. Team focuses on Azure infrastructure."
❌ BAD: "The user has indicated through various conversations that they are employed..." (too verbose, meta-commentary)`;
}

function buildTraitExamples(): string {
  return `EXISTING TRAIT (being updated/merged):
{
  "id": "uuid-of-canonical-record",  // REQUIRED for updates
  "type": "trait",                    // REQUIRED
  "name": "Visual Learner",           // REQUIRED - core trait name
  "description": "Prefers diagrams and flowcharts when learning new concepts. Often sketches ideas while thinking.", // REQUIRED - behavioral evidence
  "sentiment": 0.6,                    // -1.0 to 1.0 (average when merging)
  "strength": 0.8,                     // 0.0 to 1.0, how strongly this manifests (take HIGHER value when merging)
  "last_updated": "2024-03-11T12:00:00Z",
  "learned_by": "persona-uuid-789",  // OPTIONAL
  "last_changed_by": "persona-uuid-012", // OPTIONAL
  "persona_groups": ["default"]      // OPTIONAL
}

NEW TRAIT (creating missing concept):
{
  "type": "trait",                    // REQUIRED (NO "id" for new)
  "name": "Direct Communicator",      // REQUIRED
  "description": "Values clarity over politeness. Gets to the point quickly in written communication.", // REQUIRED
  "sentiment": 0.0,                    // Neutral default
  "strength": 0.5                      // Medium strength default
}

MERGING RULES:
- strength: Take HIGHER value (0.7 + 0.9 → 0.9)
- sentiment: AVERAGE (0.6 + 0.2 → 0.4)
- description: UNION of unique details

GOOD vs BAD descriptions:
✅ GOOD: "Asks clarifying questions before starting work. Prefers written specs over verbal instructions."
❌ BAD: "This person seems to be very detail-oriented based on observations..." (vague, uncertain)`;
}

function buildTopicExamples(): string {
  return `EXISTING TOPIC (being updated/merged):
{
  "id": "uuid-of-canonical-record",  // REQUIRED for updates
  "type": "topic",                    // REQUIRED
  "name": "Software Architecture",    // REQUIRED
  "description": "System design patterns, microservices, event-driven architecture. Passionate about scalability and maintainability.", // REQUIRED
  "sentiment": 0.8,                    // -1.0 to 1.0 (average when merging)
  "category": "Interest",             // REQUIRED - Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project (pick most common)
  "exposure_current": 0.6,            // 0.0 to 1.0, how recently discussed (take HIGHER when merging)
  "exposure_desired": 0.9,            // 0.0 to 1.0, how much they want to discuss (take HIGHER when merging)
  "last_ei_asked": "2024-03-10T08:00:00Z", // OPTIONAL - ISO timestamp or null
  "last_updated": "2024-03-11T12:00:00Z",
  "learned_by": "persona-uuid-345",  // OPTIONAL
  "last_changed_by": "persona-uuid-678", // OPTIONAL
  "persona_groups": ["tech", "work"] // OPTIONAL
}

NEW TOPIC (creating missing concept):
{
  "type": "topic",                    // REQUIRED (NO "id" for new)
  "name": "Kubernetes",               // REQUIRED
  "description": "Container orchestration platform. Interested in learning more about production deployment.", // REQUIRED
  "sentiment": 0.5,                    // Default positive for interests
  "category": "Goal",                 // Pick appropriate category
  "exposure_current": 0.0,            // Default - not discussed yet
  "exposure_desired": 0.7             // How much they want to discuss
}

MERGING RULES:
- exposure_current: Take HIGHER (0.6 + 0.3 → 0.6)
- exposure_desired: Take HIGHER (0.9 + 0.7 → 0.9)
- sentiment: AVERAGE (0.8 + 0.4 → 0.6)
- category: Pick most common or most specific
- last_ei_asked: Keep most recent non-null

CATEGORIES explained:
- Interest: Things they enjoy, hobbies
- Goal: Things they want to achieve
- Concern/Fear: Things that worry them
- Plan/Project: Active work or intentions

GOOD vs BAD descriptions:
✅ GOOD: "Functional programming paradigm. Loves immutability and pure functions. Uses in side projects."
❌ BAD: "The user mentioned functional programming in several conversations and seems interested..." (meta, wordy)`;
}

function buildPersonExamples(): string {
  return `EXISTING PERSON (being updated/merged):
{
  "id": "uuid-of-canonical-record",  // REQUIRED for updates
  "type": "person",                   // REQUIRED
  "name": "Sarah Chen",               // REQUIRED - use full name if known
  "description": "Former coworker at Microsoft. Led the Azure team. Known for clear technical writing. Now at Google.", // REQUIRED
  "sentiment": 0.7,                    // -1.0 to 1.0 (average when merging)
  "relationship": "coworker",         // REQUIRED - friend, family, coworker, mentor, acquaintance, etc.
  "exposure_current": 0.4,            // 0.0 to 1.0, how recently discussed (take HIGHER when merging)
  "exposure_desired": 0.6,            // 0.0 to 1.0, how much they want to discuss (take HIGHER when merging)
  "last_ei_asked": "2024-03-05T14:00:00Z", // OPTIONAL - ISO timestamp or null
  "last_updated": "2024-03-11T12:00:00Z",
  "learned_by": "persona-uuid-901",  // OPTIONAL
  "last_changed_by": "persona-uuid-234", // OPTIONAL
  "persona_groups": ["work"]         // OPTIONAL
}

NEW PERSON (creating missing concept):
{
  "type": "person",                   // REQUIRED (NO "id" for new)
  "name": "Alex Martinez",            // REQUIRED
  "description": "College roommate. Now works in finance. Keeps in touch occasionally.", // REQUIRED
  "sentiment": 0.5,                    // Neutral-positive default
  "relationship": "friend",           // REQUIRED - must specify
  "exposure_current": 0.0,            // Default
  "exposure_desired": 0.5             // Default medium interest
}

MERGING RULES:
- exposure_current: Take HIGHER (0.4 + 0.2 → 0.4)
- exposure_desired: Take HIGHER (0.6 + 0.3 → 0.6)
- sentiment: AVERAGE (0.7 + 0.5 → 0.6)
- relationship: Pick most specific/accurate
- last_ei_asked: Keep most recent non-null

RELATIONSHIP types:
- friend, family, coworker, mentor, acquaintance, partner, client, etc.
- Be specific: "former coworker" > "coworker" when applicable

GOOD vs BAD descriptions:
✅ GOOD: "Manager at Amazon. Met through a conference in 2019. Shares interest in distributed systems."
❌ BAD: "Someone the user has mentioned a few times who they seem to know from work..." (vague)`;
}
