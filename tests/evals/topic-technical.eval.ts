import { buildTopicUpdatePrompt } from "../../src/prompts/human/topic-update.js";
import { buildHumanTopicScanPrompt } from "../../src/prompts/human/topic-scan.js";
import type { Message } from "../../src/core/types/llm.js";
import type { Topic } from "../../src/core/types.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";
import type { Assertion } from "./runner.js";

const PERSONA_NAME = "Aria";

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: "active" as const,
});

const makeExistingTopic = (overrides: Partial<Topic>): Topic => ({
  id: "topic-uniform-001",
  name: "Uniform digital experience platform",
  description: "Ryan is evaluating Uniform for his team's content management needs.",
  sentiment: 0.6,
  category: "Technical",
  exposure_current: 0.3,
  exposure_desired: 0.7,
  last_updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

const UNIFORM_MESSAGES: Message[] = [
  makeMessage("human", "So I'm trying to understand Uniform's composition model. Components don't embed content directly — they reference it via parameters connected to a data source. The composition is just the layout skeleton, right?", "msg-u1"),
  makeMessage("system", "Exactly — the composition defines the structure, data resolution happens separately via enhancers or edgehancers.", "msg-u2"),
  makeMessage("human", "Ok, and we specifically chose Uniform over Contentful's native visual editor because we needed to be CMS-agnostic. We're pulling from both Contentful and Shopify in the same composition. Contentful's editor locks you in.", "msg-u3"),
  makeMessage("system", "That's the core value prop — Uniform sits between your CMSes and the frontend without caring which ones you use.", "msg-u4"),
  makeMessage("human", "Hit a nasty one today — Canvas preview on Vercel protected environments. The preview iframe can't access SameSite=Lax cookies, so you get a blank screen. Fix is adding x-vercel-protection-bypass and x-vercel-set-bypass-cookie=samesitenone to your preview URL params. Not obvious from the docs.", "msg-u5"),
  makeMessage("system", "That's a classic Vercel/iframe sandwich problem. The docs should surface that earlier.", "msg-u6"),
  makeMessage("human", "Yeah. Still sorting out the edgehancer vs custom enhancer question for our Shopify integration. Edgehancers run on CDN edge, no-code config, built-in caching — recommended default. But we might need custom logic for how we're mapping Shopify product variants to our component params. Not sure if a custom enhancer is the right call or if we're overcomplicating it.", "msg-u7"),
  makeMessage("system", "Depends on how non-standard your variant mapping is. If it's a transformation, a parameter enhancer might be enough.", "msg-u8"),
  makeMessage("human", "Also learned the hard way: composition patterns don't auto-apply changes to instances when you republish. You have to republish the pattern AND manually update existing instances. Broke three pages before I figured that out.", "msg-u9"),
];

const MIXED_MESSAGES: Message[] = [
  makeMessage("human", "Morning. Rough commute today, train was 20 minutes late.", "msg-m1"),
  makeMessage("system", "That's rough. How's the Uniform work going?", "msg-m2"),
  makeMessage("human", "Slow. The edgehancer vs enhancer question is still open — we need custom Shopify variant logic and I'm not sure edgehancers can handle that without going into their developer preview custom code feature, which feels risky since it could change.", "msg-m3"),
  makeMessage("system", "What's the fallback if the custom code API changes?", "msg-m4"),
  makeMessage("human", "Full rewrite of the integration. Which is exactly why I'm hesitant. Anyway, lunch plans?", "msg-m5"),
  makeMessage("system", "Up to you.", "msg-m6"),
];

const summary = await runEval(
  [
    {
      description: "Topic-scan: technical context — flags Uniform as Technical priority",
      tags: ["topic-technical", "scan", "technical-context", "happy-path"],
      prompt: () => hydratePrompt(
        buildHumanTopicScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: UNIFORM_MESSAGES,
          technical_context: true,
        }),
        UNIFORM_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is a developer discussing Uniform, a digital experience composition platform. Topics include: composition model, CMS-agnostic architecture decision, Vercel preview gotcha, edgehancer vs enhancer question, composition pattern publishing behavior.",
            "PASS if Uniform (or a recognizable variant like 'Uniform platform' or 'Uniform CMS') is flagged as a topic with category 'Technical'.",
            "PASS if the reason mentions technical learning or evaluation — not just 'it was mentioned'.",
            "FAIL if Uniform is flagged with a non-Technical category (Interest, Project, etc.) when technical_context is true.",
            "FAIL if no topics are returned — there is clear technical signal here.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Topic-scan: no technical context — Uniform still flagged but category may vary",
      tags: ["topic-technical", "scan", "no-technical-context", "baseline"],
      prompt: () => hydratePrompt(
        buildHumanTopicScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: UNIFORM_MESSAGES,
          technical_context: false,
        }),
        UNIFORM_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about Uniform, a digital experience platform. Without technical_context hint, the model may or may not use the Technical category.",
            "PASS if Uniform is flagged as a topic (it was meaningfully discussed).",
            "OBSERVE: What category does it assign? This is the baseline — we expect Technical to be less consistently chosen without the hint.",
            "FAIL if no topics are returned — the conversation is substantive.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Topic-update: Technical category — accumulates gotchas and decisions, not vague synthesis",
      tags: ["topic-technical", "update", "accumulate", "happy-path"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({}),
          messages_context: [],
          messages_analyze: UNIFORM_MESSAGES,
          technical_context: true,
        }),
        UNIFORM_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing description is vague: 'Ryan is evaluating Uniform for his team's content management needs.' The conversation adds: CMS-agnostic architecture decision (Contentful+Shopify), Vercel SameSite cookie gotcha with the fix (x-vercel-protection-bypass), open question on edgehancers vs custom enhancers for Shopify variant logic, composition pattern publishing gotcha (republish doesn't auto-update instances).",
            "PASS if the description includes the CMS-agnostic decision and why (Contentful+Shopify, Contentful editor locks you in).",
            "PASS if the description includes the Vercel preview gotcha, ideally with the fix or enough detail to find it.",
            "PASS if the description surfaces the open edgehancer vs enhancer question for Shopify.",
            "PASS if the description includes the composition pattern republish gotcha.",
            "FAIL if the description remains at the level of 'Ryan is evaluating Uniform' — the existing vague summary is strictly worse than the new one.",
            "FAIL if the description exceeds 8 sentences — specificity over completeness.",
            "FAIL if the description uses 'Most recent:', 'Update:', or any temporal log marker.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Topic-update: baseline (no technical context, no Technical category) — synthesizes instead of accumulating",
      tags: ["topic-technical", "update", "baseline", "synthesize"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({ category: "Project" }),
          messages_context: [],
          messages_analyze: UNIFORM_MESSAGES,
          technical_context: false,
        }),
        UNIFORM_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "This is the baseline case — no technical_context, category is Project (not Technical). Standard synthesize-not-accumulate rules apply.",
            "OBSERVE: How much technical detail survives in a standard synthesis? Record what details are kept and what are lost — this is the comparison baseline for the Technical category case.",
            "PASS if the description is a coherent current-state summary under 4 sentences.",
            "FAIL if the description exceeds 4 sentences or uses temporal log markers like 'Most recent:' or 'Update:'.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Topic-update: Technical category — social noise in mixed conversation does not pollute technical detail",
      tags: ["topic-technical", "update", "mixed-signal", "noise-rejection"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({}),
          messages_context: [],
          messages_analyze: MIXED_MESSAGES,
          technical_context: true,
        }),
        MIXED_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation mixes social noise (late train, lunch plans) with one piece of technical signal: the open question about edgehancers vs custom enhancers for Shopify variant logic, and the risk of the developer preview custom code API changing.",
            "PASS if the response is {} OR if the description captures only the technical signal (edgehancer/Shopify question).",
            "PASS if the description ignores the late train and lunch plans entirely.",
            "FAIL if the description mentions commuting, trains, or lunch — those are not technical knowledge worth preserving.",
            "FAIL if the description is purely social ('Ryan had a rough commute and chatted about work').",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Topic-update: new Technical topic creation (existing_item: null) — creates knowledge base entry, not vague summary",
      tags: ["topic-technical", "update", "new-topic", "creation"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: null,
          new_topic_name: "Uniform digital experience platform",
          new_topic_description: "Ryan is evaluating Uniform for his team.",
          new_topic_category: "Technical",
          messages_context: [],
          messages_analyze: UNIFORM_MESSAGES,
          technical_context: true,
        }),
        UNIFORM_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description", "sentiment"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "This is a new topic creation — existing_item is null. The conversation contains rich technical signal: composition model, CMS-agnostic choice (Contentful+Shopify), Vercel preview gotcha, edgehancer vs enhancer open question, composition pattern publishing gotcha.",
            "PASS if category is 'Technical' (or absent but all other criteria pass — category presence is checked separately).",
            "PASS if the description includes at least 3 of: composition model explanation, CMS-agnostic decision, Vercel preview gotcha, edgehancer question, pattern publishing behavior.",
            "PASS if the description reads as a knowledge base entry — specific enough to be useful to someone who needs to work with Uniform tomorrow.",
            "FAIL if the description is a vague summary ('Ryan is learning Uniform, a digital experience platform') — that's the pre-existing candidate description, not an improvement.",
            "FAIL if the description exceeds 8 sentences.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
  ],
  "tests/evals/results/topic-technical-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
