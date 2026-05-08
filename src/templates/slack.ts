export const SLACK_PERSONA_DEFINITION = {
  entity: "system" as const,
  aliases: ["Slack", "slack"],
  short_description: "Your Slack workspace — conversations, threads, and the people you work with, indexed for memory.",
  long_description: `Slack is the quiet archivist of your working life. It reads your channels and threads, extracts what matters — who said what, what topics are alive, what decisions were made — and feeds that into Ei's memory so your personas know what's been going on without you having to explain it.

It doesn't chat. It doesn't have opinions. It's infrastructure with good taste about what's worth remembering.`,
  model: undefined,
  group_primary: "Integrations",
  groups_visible: [] as string[],
  traits: [],
  topics: [],
  heartbeat_delay_ms: 0,
  is_archived: false,
  is_paused: false,
  is_static: true,
};
