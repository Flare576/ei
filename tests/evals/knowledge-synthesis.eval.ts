/**
 * Eval: Knowledge Synthesis — Zeus's Boulder Emporium
 *
 * Tests the synthesis prompt across two suites:
 *
 * Suite A — Initial call. Varies data richness. Asserts:
 *   - Sparse data → model should call find_memory
 *   - Rich + complete → no tool calls needed, good synthesis
 *   - Rich with message_id gaps → observe (does it call fetch_message? how many?)
 *
 * Suite B — Post-tool call. Message history includes an injected tool result.
 *   Asserts: no further tool calls, synthesis uses the returned data.
 *
 * The domain is entirely fictional: Zeus's Boulder Emporium, a specialty retailer
 * of mythological punishment equipment. All catalog data is invented and canonical —
 * any hallucination (e.g. products, people, or specs not in the fixtures) is
 * immediately detectable.
 *
 * Run with:
 *   npm run test:evals -- knowledge-synthesis
 */

import { buildSynthesisPrompt } from "../../src/prompts/synthesis/index.js";
import type { EnrichedTopic, EnrichedPerson } from "../../src/prompts/synthesis/index.js";
import type { Fact, Topic, Person, Quote } from "../../src/core/types.js";
import { runEval, printSummary } from "./runner.js";

// =============================================================================
// ZEUS'S BOULDER EMPORIUM — Canonical Product Catalog (source of truth)
//
// Never sent in full to any eval. Subsets are carved out per test case.
// If the model mentions anything not in the subset it was given, it hallucinated.
// =============================================================================

// ---------------------------------------------------------------------------
// FACTS — ground-truth product specs and company data
// ---------------------------------------------------------------------------

const FACT_SISYPHEAN_CLASSIC_WEIGHT: Fact = {
  id: "fact-sc-weight",
  name: "Sisyphean Classic weight",
  description: "The Sisyphean Classic (SKU: ZBE-SC-001) weighs 2.4 metric tons. Standard hill grade: 34 degrees.",
  sentiment: 0.5,
  last_updated: "2026-01-15T00:00:00Z",
  validated_date: "2026-01-15T00:00:00Z",
};

const FACT_SISYPHEAN_CLASSIC_MATERIAL: Fact = {
  id: "fact-sc-material",
  name: "Sisyphean Classic material",
  description: "The Sisyphean Classic is cast from Olympian granite — a proprietary igneous blend sourced exclusively from Mount Othrys quarries. Density: 2.8 g/cm³.",
  sentiment: 0.6,
  last_updated: "2026-01-15T00:00:00Z",
  validated_date: "2026-01-15T00:00:00Z",
};

const FACT_TANTALUS_LITE_WEIGHT: Fact = {
  id: "fact-tl-weight",
  name: "Tantalus Lite weight",
  description: "The Tantalus Lite (SKU: ZBE-TL-002) weighs 890 kg. Designed for lighter punishment loads or entry-level eternal suffering.",
  sentiment: 0.4,
  last_updated: "2026-01-20T00:00:00Z",
  validated_date: "2026-01-20T00:00:00Z",
};

const FACT_OBSIDIAN_COLD_ISSUE: Fact = {
  id: "fact-obs-cold",
  name: "Obsidian line cold-weather defect",
  description: "The Obsidian Pro (SKU: ZBE-OP-004) and Obsidian Lite (SKU: ZBE-OL-005) are known to develop micro-fractures in sub-zero temperatures. Zeus issued a recall advisory in Q4 2025. Replacement program active through Q2 2026.",
  sentiment: -0.8,
  last_updated: "2026-03-01T00:00:00Z",
  validated_date: "2026-03-01T00:00:00Z",
};

const FACT_PROMETHEUS_DELUXE_BACKORDER: Fact = {
  id: "fact-pd-backorder",
  name: "Prometheus Deluxe backorder status",
  description: "The Prometheus Deluxe (SKU: ZBE-PD-007) is backordered through Q3 2026 due to Titan labor disputes at the Mount Ida fabrication facility.",
  sentiment: -0.5,
  last_updated: "2026-04-01T00:00:00Z",
  validated_date: "2026-04-01T00:00:00Z",
};

const FACT_COMPANY_FOUNDED: Fact = {
  id: "fact-company-founded",
  name: "Zeus's Boulder Emporium founding",
  description: "Zeus's Boulder Emporium was founded in 847 BCE by Zeus Thunderson as a side venture to the main lightning bolt business. Headquarters: Mount Olympus Commerce District, Suite 12.",
  sentiment: 0.7,
  last_updated: "2026-01-01T00:00:00Z",
  validated_date: "2026-01-01T00:00:00Z",
};

const FACT_SLA: Fact = {
  id: "fact-sla",
  name: "Zeus's Boulder Emporium delivery SLA",
  description: "Standard delivery SLA: 3–5 Olympian business days for in-stock items. Expedited delivery (Hermes Express) available for +40% surcharge. Underworld delivery adds 7–10 days.",
  sentiment: 0.5,
  last_updated: "2026-02-01T00:00:00Z",
  validated_date: "2026-02-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// TOPICS — areas of ongoing concern, interest, or discussion
// ---------------------------------------------------------------------------

const TOPIC_OBSIDIAN_RECALL: Topic = {
  id: "topic-obsidian-recall",
  name: "Obsidian line recall and customer relations",
  category: "Concern",
  description: "The Q4 2025 recall of the Obsidian Pro and Obsidian Lite has created significant customer relations pressure. Several Tartarus-tier clients have threatened to switch to competitor Hades Heavy Industries. The replacement program is running behind schedule — Dana from Fulfillment says they're 6 weeks out on replacement units.",
  sentiment: -0.7,
  exposure_current: 0.8,
  exposure_desired: 0.3,
  last_updated: "2026-04-10T00:00:00Z",
};

const TOPIC_SISYPHEAN_REDESIGN: Topic = {
  id: "topic-sisyphean-redesign",
  name: "Sisyphean Classic v2 redesign",
  category: "Project",
  description: "Engineering is exploring a v2 Sisyphean Classic with an ergonomic grip depression on the push surface. Internal codename: 'Project Uphill'. Target launch Q1 2027. Marcus Webb from sales is pushing for a lighter variant (1.8t) for the residential punishment market.",
  sentiment: 0.6,
  exposure_current: 0.5,
  exposure_desired: 0.7,
  last_updated: "2026-03-15T00:00:00Z",
};

const TOPIC_COMPETITOR_THREAT: Topic = {
  id: "topic-competitor-threat",
  name: "Hades Heavy Industries competitive threat",
  category: "Concern",
  description: "Hades Heavy Industries launched their 'Inferno Series' in March 2026 at a 15% lower price point. Their basalt composite boulders have comparable density but unknown long-term durability. Several of our key accounts have requested competitive pricing reviews.",
  sentiment: -0.6,
  exposure_current: 0.6,
  exposure_desired: 0.4,
  last_updated: "2026-04-05T00:00:00Z",
};

const TOPIC_PROMETHEUS_DELAY: Topic = {
  id: "topic-prometheus-delay",
  name: "Prometheus Deluxe supply chain delays",
  category: "Concern",
  description: "The Titan labor dispute at Mount Ida has cascaded into a 6-month backorder on the Prometheus Deluxe. This is our highest-margin SKU. Finance is projecting a 12% revenue shortfall in Q2 if the dispute isn't resolved. Hephaestus has been brought in as a fabrication consultant.",
  sentiment: -0.8,
  exposure_current: 0.7,
  exposure_desired: 0.2,
  last_updated: "2026-04-08T00:00:00Z",
};

const TOPIC_RESIDENTIAL_MARKET: Topic = {
  id: "topic-residential-market",
  name: "Residential punishment market expansion",
  category: "Goal",
  description: "Marketing has identified a growing residential market — minor deities and demigods seeking home punishment setups. The Tantalus Lite is our current entry point but lacks curb appeal. Project Uphill's lighter variant may address this. Marcus Webb is leading the GTM strategy.",
  sentiment: 0.7,
  exposure_current: 0.3,
  exposure_desired: 0.8,
  last_updated: "2026-03-20T00:00:00Z",
};

// ---------------------------------------------------------------------------
// PEOPLE
// ---------------------------------------------------------------------------

const PERSON_DANA: Person = {
  id: "person-dana",
  name: "Dana Reyes",
  description: "Dana runs the Fulfillment division and has been with ZBE for 11 years. She's the one who caught the Obsidian cold-weather issue during a routine audit of Tartarus client complaints. Her team is currently 6 weeks behind on Obsidian replacement units due to the Olympian granite shortage. She has a famously low tolerance for unrealistic delivery promises from sales.",
  relationship: "Head of Fulfillment, direct operational contact",
  sentiment: 0.7,
  exposure_current: 0.6,
  exposure_desired: 0.5,
  last_updated: "2026-04-10T00:00:00Z",
};

const PERSON_MARCUS: Person = {
  id: "person-marcus",
  name: "Marcus Webb",
  description: "Marcus is the Regional Sales Director for the Underworld territory. He owns the Tartarus-tier accounts and has been managing the competitive pressure from Hades Heavy Industries. He's the internal champion for the residential market expansion and Project Uphill's lighter variant. He tends to overpromise on delivery dates, which causes friction with Dana.",
  relationship: "Regional Sales Director (Underworld), key internal stakeholder",
  sentiment: 0.5,
  exposure_current: 0.5,
  exposure_desired: 0.4,
  last_updated: "2026-04-08T00:00:00Z",
};

const PERSON_HEPHAESTUS: Person = {
  id: "person-hephaestus",
  name: "Hephaestus",
  description: "Hephaestus was brought in as a fabrication consultant to assess alternatives to the Mount Ida facility. He's proposed a temporary production line at his Lemnos forge but requires a 90-day setup lead time and insists on a minimum order of 500 units. His rates are significantly above market.",
  relationship: "External fabrication consultant, engaged Q2 2026",
  sentiment: 0.3,
  exposure_current: 0.3,
  exposure_desired: 0.2,
  last_updated: "2026-04-09T00:00:00Z",
};

// ---------------------------------------------------------------------------
// QUOTES — verbatim captures with message_id references
// ---------------------------------------------------------------------------

const QUOTE_DANA_OBSIDIAN: Quote = {
  id: "quote-dana-obsidian",
  message_id: "msg-meeting-apr-7",
  data_item_ids: ["topic-obsidian-recall", "person-dana"],
  persona_groups: [],
  text: "We're not shipping replacement Obsidians until we have the units in hand. I don't care what Marcus told the Tartarus account.",
  speaker: "Dana Reyes",
  channel: "Q2 Operations Review",
  timestamp: "2026-04-07T14:30:00Z",
  start: null,
  end: null,
  created_at: "2026-04-07T15:00:00Z",
  created_by: "extraction",
};

const QUOTE_MARCUS_UPHILL: Quote = {
  id: "quote-marcus-uphill",
  message_id: "msg-slack-mar-22",
  data_item_ids: ["topic-sisyphean-redesign", "person-marcus", "topic-residential-market"],
  persona_groups: [],
  text: "If we can get Project Uphill to 1.8t, I can close three residential accounts by end of Q2. The residential demigods don't need full Titan-grade.",
  speaker: "Marcus Webb",
  channel: "Slack #product-planning",
  timestamp: "2026-03-22T09:15:00Z",
  start: null,
  end: null,
  created_at: "2026-03-22T09:30:00Z",
  created_by: "extraction",
};

const QUOTE_SUPPLY_CHAIN_CRISIS: Quote = {
  id: "quote-supply-chain",
  message_id: "msg-email-apr-8",
  data_item_ids: ["topic-prometheus-delay", "person-hephaestus"],
  persona_groups: [],
  text: "Hephaestus is our best option but he wants 500 minimum and 90 days setup. That's not a bridge, that's a cliff.",
  speaker: "human",
  channel: "Email thread: Prometheus Deluxe alternatives",
  timestamp: "2026-04-08T11:00:00Z",
  start: null,
  end: null,
  created_at: "2026-04-08T11:05:00Z",
  created_by: "extraction",
};

const QUOTE_COMPETITOR: Quote = {
  id: "quote-competitor",
  message_id: "msg-meeting-apr-5",
  data_item_ids: ["topic-competitor-threat"],
  persona_groups: [],
  text: "The Inferno Series basalt composite looks good in their marketing but nobody's seen what it does after 500 years of continuous use. We're Olympian granite. That's the pitch.",
  speaker: "human",
  channel: "Sales strategy meeting",
  timestamp: "2026-04-05T10:00:00Z",
  start: null,
  end: null,
  created_at: "2026-04-05T10:15:00Z",
  created_by: "extraction",
};

// =============================================================================
// TOOL DEFINITIONS — passed to the model along with the synthesis prompt
// =============================================================================

const FIND_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "find_memory",
    description: "Search Ei's persistent knowledge base — facts, topics, people, and quotes. Use when the provided data has gaps and you need more context to write a complete document.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        types: { type: "array", items: { type: "string", enum: ["fact", "topic", "person", "quote"] } },
        limit: { type: "number", description: "Max results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
};

const FETCH_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "fetch_memory",
    description: "Retrieve the full record for a specific memory item by ID. Use after find_memory to get complete details for a specific item.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ID of the memory record to retrieve" },
      },
      required: ["id"],
    },
  },
};

const FETCH_MESSAGE_TOOL = {
  type: "function",
  function: {
    name: "fetch_message",
    description: "Retrieve the original conversation context around a quote's message_id. Use when you want to understand more about the circumstances of a quote.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The message_id from a quote" },
        before: { type: "number", description: "Number of preceding messages to include (default 0)" },
        after: { type: "number", description: "Number of following messages to include (default 0)" },
      },
      required: ["id"],
    },
  },
};

const ALL_TOOLS = [FIND_MEMORY_TOOL, FETCH_MEMORY_TOOL, FETCH_MESSAGE_TOOL];

// =============================================================================
// FIXTURE HELPERS
// =============================================================================

function enrichedTopic(topic: Topic, quotes: Quote[] = []): EnrichedTopic {
  return { topic, quotes };
}

function enrichedPerson(person: Person, quotes: Quote[] = []): EnrichedPerson {
  return { person, quotes };
}

// ---------------------------------------------------------------------------
// Simulated find_memory result for Suite B cases
// ---------------------------------------------------------------------------

const FIND_MEMORY_RESULT_OBSIDIAN = JSON.stringify({
  facts: [
    {
      id: "fact-obs-cold",
      name: "Obsidian line cold-weather defect",
      description: "The Obsidian Pro (SKU: ZBE-OP-004) and Obsidian Lite (SKU: ZBE-OL-005) develop micro-fractures in sub-zero temperatures. Recall advisory Q4 2025. Replacement program active through Q2 2026.",
    },
  ],
  topics: [
    {
      id: "topic-obsidian-recall",
      name: "Obsidian line recall and customer relations",
      category: "Concern",
      description: "Significant customer relations pressure. Tartarus-tier clients threatening to switch to Hades Heavy Industries. Replacement program running 6 weeks behind schedule.",
    },
  ],
  people: [
    {
      id: "person-dana",
      name: "Dana Reyes",
      relationship: "Head of Fulfillment, direct operational contact",
      description: "Dana runs Fulfillment. Caught the Obsidian cold-weather issue. Her team is 6 weeks behind on replacements.",
    },
  ],
  quotes: [
    {
      id: "quote-dana-obsidian",
      message_id: "msg-meeting-apr-7",
      text: "We're not shipping replacement Obsidians until we have the units in hand. I don't care what Marcus told the Tartarus account.",
      speaker: "Dana Reyes",
      channel: "Q2 Operations Review",
    },
  ],
});

const FIND_MEMORY_CALL_ID = "call-find-memory-001";

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    // -------------------------------------------------------------------------
    // Suite A / Case 1 — SPARSE ("we ain't found shit")
    // System genuinely has almost nothing. One fact, no topics, no people.
    // Not testing tool call behavior — testing what a model does with nothing.
    // Observe only: "summarize this sentence" isn't interesting to assert on,
    // but watching whether models converge on calling tools vs synthesizing
    // thin output is useful longitudinal data.
    // -------------------------------------------------------------------------
    {
      description: "Suite A / Case 1 (sparse): system has almost nothing → observe model behavior with minimal data",
      tags: ["knowledge-synthesis", "suite-a", "sparse", "observe"],
      tools: ALL_TOOLS,
      observe: true as const,
      prompt: () => {
        const { system, user } = buildSynthesisPrompt({
          subject: "the Obsidian product line recall",
          facts: [FACT_OBSIDIAN_COLD_ISSUE],
          topics: [],
          people: [],
          standaloneQuotes: [],
        });
        return { system, user };
      },
    },

    // -------------------------------------------------------------------------
    // Suite A / Case 2 — DANGLING REFERENCE ("TopK missed something")
    // Rich data, but a quote's data_item_ids references topic-competitor-threat
    // which is NOT in the payload. loadedEntityNames is passed so the prompt
    // renders the missing link as "(not loaded)" — a visible signal to the model
    // that a related record exists and can be fetched via fetch_memory.
    // The model should call fetch_memory("topic-competitor-threat") or find_memory
    // to retrieve the missing entity.
    // Observe-only: Gemma-4-26b consistently scores 0 on this (ignores the signal).
    // The mechanism is correct — use Opus or a stronger model to add an assert and gate on it.
    // -------------------------------------------------------------------------
    {
      description: "Suite A / Case 2 (dangling ref): quote link marked (not loaded) in prompt → expect tool call to fetch missing entity",
      tags: ["knowledge-synthesis", "suite-a", "dangling-ref", "tool-call-expected", "known-model-limitation"],
      tools: ALL_TOOLS,
      observe: true as const,
      prompt: () => {
        const quoteWithDanglingRef: Quote = {
          ...QUOTE_DANA_OBSIDIAN,
          data_item_ids: ["topic-obsidian-recall", "topic-competitor-threat"],
        };
        const loadedEntityNames = new Map([
          [FACT_OBSIDIAN_COLD_ISSUE.id, FACT_OBSIDIAN_COLD_ISSUE.name],
          [TOPIC_OBSIDIAN_RECALL.id, TOPIC_OBSIDIAN_RECALL.name],
          [PERSON_DANA.id, PERSON_DANA.name],
        ]);
        const { system, user } = buildSynthesisPrompt({
          subject: "the Obsidian product line recall",
          facts: [FACT_OBSIDIAN_COLD_ISSUE],
          topics: [
            enrichedTopic(TOPIC_OBSIDIAN_RECALL, [quoteWithDanglingRef]),
          ],
          people: [
            enrichedPerson(PERSON_DANA, [quoteWithDanglingRef]),
          ],
          standaloneQuotes: [],
          loadedEntityNames,
        });
        return { system, user };
      },
    },

    // -------------------------------------------------------------------------
    // Suite A / Case 3 — COMPLETE ("this is everything, trust us")
    // All entities referenced anywhere in the payload are fully present.
    // All quotes have message_id: null (nothing to fetch).
    // loadedEntityNames covers every entity in the payload — no links render
    // as "(not loaded)". The model has no gaps to chase.
    // The model should synthesize without calling tools.
    // Marked borderline because Flare was right and models may not believe us.
    // -------------------------------------------------------------------------
    {
      description: "Suite A / Case 3 (complete): all data present, no dangling refs, null message_ids → expect zero tool calls",
      tags: ["knowledge-synthesis", "suite-a", "complete", "no-tool-calls", "borderline"],
      tools: ALL_TOOLS,
      pass_threshold: 0.5,
      prompt: () => {
        const nulledQuoteDana: Quote = { ...QUOTE_DANA_OBSIDIAN, message_id: null, data_item_ids: ["topic-obsidian-recall", "person-dana"] };
        const nulledQuoteMarcus: Quote = { ...QUOTE_MARCUS_UPHILL, message_id: null, data_item_ids: ["topic-sisyphean-redesign", "person-marcus"] };
        const loadedEntityNames = new Map([
          [FACT_OBSIDIAN_COLD_ISSUE.id, FACT_OBSIDIAN_COLD_ISSUE.name],
          [FACT_PROMETHEUS_DELUXE_BACKORDER.id, FACT_PROMETHEUS_DELUXE_BACKORDER.name],
          [FACT_SISYPHEAN_CLASSIC_WEIGHT.id, FACT_SISYPHEAN_CLASSIC_WEIGHT.name],
          [FACT_COMPANY_FOUNDED.id, FACT_COMPANY_FOUNDED.name],
          [TOPIC_OBSIDIAN_RECALL.id, TOPIC_OBSIDIAN_RECALL.name],
          [TOPIC_PROMETHEUS_DELAY.id, TOPIC_PROMETHEUS_DELAY.name],
          [TOPIC_COMPETITOR_THREAT.id, TOPIC_COMPETITOR_THREAT.name],
          [TOPIC_SISYPHEAN_REDESIGN.id, TOPIC_SISYPHEAN_REDESIGN.name],
          [PERSON_DANA.id, PERSON_DANA.name],
          [PERSON_MARCUS.id, PERSON_MARCUS.name],
          [PERSON_HEPHAESTUS.id, PERSON_HEPHAESTUS.name],
        ]);
        const { system, user } = buildSynthesisPrompt({
          subject: "Zeus's Boulder Emporium current situation",
          facts: [
            FACT_OBSIDIAN_COLD_ISSUE,
            FACT_PROMETHEUS_DELUXE_BACKORDER,
            FACT_SISYPHEAN_CLASSIC_WEIGHT,
            FACT_COMPANY_FOUNDED,
          ],
          topics: [
            enrichedTopic(TOPIC_OBSIDIAN_RECALL, [nulledQuoteDana]),
            enrichedTopic(TOPIC_PROMETHEUS_DELAY, []),
            enrichedTopic(TOPIC_COMPETITOR_THREAT, []),
            enrichedTopic(TOPIC_SISYPHEAN_REDESIGN, [nulledQuoteMarcus]),
          ],
          people: [
            enrichedPerson(PERSON_DANA, [nulledQuoteDana]),
            enrichedPerson(PERSON_MARCUS, [nulledQuoteMarcus]),
            enrichedPerson(PERSON_HEPHAESTUS, []),
          ],
          standaloneQuotes: [],
          loadedEntityNames,
        });
        return { system, user };
      },
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
        },
      ],
    },

    // -------------------------------------------------------------------------
    // Suite B / Case 1 — POST TOOL CALL (sparse → find_memory result injected)
    // Tools stripped: B tests synthesis quality after the loop, not loop discipline.
    // The model sees the completed tool exchange in priorMessages and should
    // incorporate it into the document. No tools given = no temptation to re-call.
    // Gemma-4-26b fails this — it bleeds domain knowledge (Zeus, Marcus) into
    // synthesis regardless of what the data says. That's a real failure; keep the
    // assert. Run against Opus to get a green.
    // -------------------------------------------------------------------------
    {
      description: "Suite B / Case 1 (post-tool): sparse initial + find_memory result injected → synthesize from combined data",
      tags: ["knowledge-synthesis", "suite-b", "post-tool"],
      priorMessages: [
        {
          role: "assistant" as const,
          tool_calls: [{
            id: FIND_MEMORY_CALL_ID,
            type: "function",
            function: {
              name: "find_memory",
              arguments: JSON.stringify({ query: "Obsidian product recall" }),
            },
          }],
        },
        {
          role: "tool" as const,
          tool_call_id: FIND_MEMORY_CALL_ID,
          name: "find_memory",
          content: FIND_MEMORY_RESULT_OBSIDIAN,
        },
      ],
      prompt: () => {
        const { system, user } = buildSynthesisPrompt({
          subject: "the Obsidian product line recall",
          facts: [FACT_OBSIDIAN_COLD_ISSUE],
          topics: [],
          people: [],
          standaloneQuotes: [],
        });
        return { system, user };
      },
      assert: [
        {
          type: "llm-judge" as const,
          rubric: [
            "A find_memory call was already made and returned data about: the Obsidian cold-weather defect, the customer relations impact, Dana Reyes (Head of Fulfillment), and a quote from Dana about not shipping replacements.",
            "PASS if the document incorporates data from the tool result — specifically mentions Dana Reyes and/or the replacement program delay and/or the customer relations pressure.",
            "FAIL if the document only uses the initial sparse fact (cold-weather defect) and shows no evidence of using the tool result at all.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The ONLY data sources for this document are: (1) a single fact about the Obsidian cold-weather defect (SKUs ZBE-OP-004 and ZBE-OL-005, Q4 2025 recall, replacement program through Q2 2026), and (2) a find_memory tool result containing: Dana Reyes (Head of Fulfillment, 6-week replacement delay), the Obsidian recall topic (Tartarus-tier clients threatening to switch to Hades Heavy Industries), and Dana's quote about not shipping replacements.",
            "The following named entities are explicitly NOT present in either data source and would be hallucinations: Zeus, Marcus, Marcus Webb, Project Uphill, Sisyphean Classic, Prometheus Deluxe, Hephaestus, or any other named person, product, or project not listed above.",
            "PASS if the document only references entities traceable to the two data sources listed above.",
            "FAIL if the document names any person, product, or company not present in those two data sources — for example Zeus, Marcus Webb, or any product other than Obsidian Pro and Obsidian Lite.",
          ].join(" "),
        },
      ],
    },

    // -------------------------------------------------------------------------
    // Suite B / Case 2 — POST TOOL CALL (rich + complete, empty tool result)
    // Tools stripped. Verifies synthesis quality when the model already has
    // everything it needs and the prior tool result came back empty.
    // -------------------------------------------------------------------------
    {
      description: "Suite B / Case 2 (post-tool, complete): full data + empty tool result → synthesize from provided data",
      tags: ["knowledge-synthesis", "suite-b", "complete"],
      priorMessages: [
        {
          role: "assistant" as const,
          tool_calls: [{
            id: "call-002",
            type: "function",
            function: {
              name: "find_memory",
              arguments: JSON.stringify({ query: "Project Uphill Sisyphean Classic v2" }),
            },
          }],
        },
        {
          role: "tool" as const,
          tool_call_id: "call-002",
          name: "find_memory",
          content: JSON.stringify({ facts: [], topics: [], people: [], quotes: [] }),
        },
      ],
      prompt: () => {
        const { system, user } = buildSynthesisPrompt({
          subject: "Project Uphill and the Sisyphean Classic v2",
          facts: [FACT_SISYPHEAN_CLASSIC_WEIGHT, FACT_SISYPHEAN_CLASSIC_MATERIAL],
          topics: [
            enrichedTopic(TOPIC_SISYPHEAN_REDESIGN, [QUOTE_MARCUS_UPHILL]),
            enrichedTopic(TOPIC_RESIDENTIAL_MARKET, [QUOTE_MARCUS_UPHILL]),
          ],
          people: [
            enrichedPerson(PERSON_MARCUS, [QUOTE_MARCUS_UPHILL]),
          ],
          standaloneQuotes: [],
        });
        return { system, user };
      },
      assert: [
        {
          type: "llm-judge" as const,
          rubric: [
            "The input covers Project Uphill (Sisyphean Classic v2 redesign), the residential market expansion, and Marcus Webb who is driving both. Marcus's description also references 'residential demigods' and 'Dana' in context — these are in scope.",
            "PASS if the document covers the redesign project, the residential market angle, and Marcus Webb's role.",
            "FAIL if any of the three is entirely absent.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The input data explicitly contains the following named entities — all are in scope and NOT hallucinations:",
            "People: Marcus Webb.",
            "Products: Sisyphean Classic (ZBE-SC-001), Tantalus Lite (mentioned in residential market topic).",
            "Projects: Project Uphill, Sisyphean Classic v2.",
            "Companies: Hades Heavy Industries (mentioned in Sisyphean redesign topic description as competitive context).",
            "Locations/materials: Mount Othrys quarries, Olympian granite (in the material fact description).",
            "Concepts: residential punishment market, residential demigods.",
            "Other context in scope: Dana Reyes (referenced in Marcus's description), Tartarus-tier clients.",
            "PASS if the document stays within entities traceable to the provided data (including all entities listed above).",
            "FAIL only if the document invents a clearly new named entity that does not appear anywhere in the provided facts, topics, people, or quotes — for example a new product name, a new person, or a new company with no textual basis in the input.",
          ].join(" "),
        },
      ],
    },

    // -------------------------------------------------------------------------
    // Suite B / Case 3 — THE ETERNAL QUESTION
    // Tools kept. Asks: can we craft a prompt that prevents re-calling tools
    // when the model already has everything it needs?
    // Answer as of 2026-05: No. Today is not that day. Tomorrow isn't looking
    // great either. This is an observe case — data, not a gate.
    // Tags: known-model-limitation, borderline — do not assert, ever.
    // -------------------------------------------------------------------------
    {
      description: "Suite B / Case 3 (eternal question): tools kept after complete data — observe whether model re-calls or synthesizes",
      tags: ["knowledge-synthesis", "suite-b", "observe", "known-model-limitation", "borderline"],
      tools: ALL_TOOLS,
      observe: true as const,
      priorMessages: [
        {
          role: "assistant" as const,
          tool_calls: [{
            id: "call-eternal",
            type: "function",
            function: {
              name: "find_memory",
              arguments: JSON.stringify({ query: "Obsidian recall Hades Heavy Industries" }),
            },
          }],
        },
        {
          role: "tool" as const,
          tool_call_id: "call-eternal",
          name: "find_memory",
          content: FIND_MEMORY_RESULT_OBSIDIAN,
        },
      ],
      prompt: () => {
        const loadedEntityNames = new Map([
          [FACT_OBSIDIAN_COLD_ISSUE.id, FACT_OBSIDIAN_COLD_ISSUE.name],
          [TOPIC_OBSIDIAN_RECALL.id, TOPIC_OBSIDIAN_RECALL.name],
          [PERSON_DANA.id, PERSON_DANA.name],
        ]);
        const { system, user } = buildSynthesisPrompt({
          subject: "the Obsidian product line recall",
          facts: [FACT_OBSIDIAN_COLD_ISSUE],
          topics: [enrichedTopic(TOPIC_OBSIDIAN_RECALL, [QUOTE_DANA_OBSIDIAN])],
          people: [enrichedPerson(PERSON_DANA, [QUOTE_DANA_OBSIDIAN])],
          standaloneQuotes: [],
          loadedEntityNames,
        });
        return { system, user };
      },
    },
  ],
  "tests/evals/results/knowledge-synthesis-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
