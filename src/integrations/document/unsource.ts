import type { StateManager } from "../../core/state-manager.js";

export interface UnsourcePreview {
  sourceTag: string;
  toDelete: {
    facts: Array<{ id: string; name: string }>;
    topics: Array<{ id: string; name: string }>;
    people: Array<{ id: string; name: string }>;
    quotes: Array<{ id: string; text: string }>;
  };
  toStrip: {
    facts: Array<{ id: string; name: string }>;
    topics: Array<{ id: string; name: string }>;
    people: Array<{ id: string; name: string }>;
  };
}

export interface UnsourceResult {
  sourceTag: string;
  deleted: { facts: number; topics: number; people: number; quotes: number };
  stripped: { facts: number; topics: number; people: number };
}

export function previewUnsource(sourceTag: string, stateManager: StateManager): UnsourcePreview {
  const human = stateManager.getHuman();

  const preview: UnsourcePreview = {
    sourceTag,
    toDelete: { facts: [], topics: [], people: [], quotes: [] },
    toStrip: { facts: [], topics: [], people: [] },
  };

  for (const fact of human.facts) {
    if (!fact.sources?.includes(sourceTag)) continue;
    const remainingSources = fact.sources.filter(s => s !== sourceTag);
    const nonEmmettPersonas = (fact.interested_personas ?? []).filter(id => id !== "emmet");
    if (remainingSources.length === 0 && nonEmmettPersonas.length === 0) {
      preview.toDelete.facts.push({ id: fact.id, name: fact.name });
    } else {
      preview.toStrip.facts.push({ id: fact.id, name: fact.name });
    }
  }

  for (const topic of human.topics) {
    if (!topic.sources?.includes(sourceTag)) continue;
    const remainingSources = topic.sources.filter(s => s !== sourceTag);
    const nonEmmettPersonas = (topic.interested_personas ?? []).filter(id => id !== "emmet");
    if (remainingSources.length === 0 && nonEmmettPersonas.length === 0) {
      preview.toDelete.topics.push({ id: topic.id, name: topic.name });
    } else {
      preview.toStrip.topics.push({ id: topic.id, name: topic.name });
    }
  }

  for (const person of human.people) {
    if (!person.sources?.includes(sourceTag)) continue;
    const remainingSources = person.sources.filter(s => s !== sourceTag);
    const nonEmmettPersonas = (person.interested_personas ?? []).filter(id => id !== "emmet");
    if (remainingSources.length === 0 && nonEmmettPersonas.length === 0) {
      preview.toDelete.people.push({ id: person.id, name: person.name });
    } else {
      preview.toStrip.people.push({ id: person.id, name: person.name });
    }
  }

  const emmettMessages = stateManager.messages_get("emmet");
  const sourceMessageIds = new Set(
    emmettMessages
      .filter(m => m.source_tag === sourceTag)
      .map(m => m.id)
  );

  for (const quote of human.quotes) {
    if (quote.message_id && sourceMessageIds.has(quote.message_id)) {
      preview.toDelete.quotes.push({ id: quote.id, text: quote.text });
    }
  }

  return preview;
}

export async function executeUnsource(
  preview: UnsourcePreview,
  stateManager: StateManager
): Promise<UnsourceResult> {
  const result: UnsourceResult = {
    sourceTag: preview.sourceTag,
    deleted: { facts: 0, topics: 0, people: 0, quotes: 0 },
    stripped: { facts: 0, topics: 0, people: 0 },
  };

  for (const q of preview.toDelete.quotes) {
    stateManager.human_quote_remove(q.id);
    result.deleted.quotes++;
  }

  for (const f of preview.toDelete.facts) {
    stateManager.human_fact_remove(f.id);
    result.deleted.facts++;
  }

  for (const t of preview.toDelete.topics) {
    stateManager.human_topic_remove(t.id);
    result.deleted.topics++;
  }

  for (const p of preview.toDelete.people) {
    stateManager.human_person_remove(p.id);
    result.deleted.people++;
  }

  if (
    preview.toStrip.facts.length > 0 ||
    preview.toStrip.topics.length > 0 ||
    preview.toStrip.people.length > 0
  ) {
    const human = stateManager.getHuman();
    const stripIds = new Set([
      ...preview.toStrip.facts.map(f => f.id),
      ...preview.toStrip.topics.map(t => t.id),
      ...preview.toStrip.people.map(p => p.id),
    ]);

    for (const fact of human.facts) {
      if (stripIds.has(fact.id) && fact.sources) {
        fact.sources = fact.sources.filter(s => s !== preview.sourceTag);
        result.stripped.facts++;
      }
    }
    for (const topic of human.topics) {
      if (stripIds.has(topic.id) && topic.sources) {
        topic.sources = topic.sources.filter(s => s !== preview.sourceTag);
        result.stripped.topics++;
      }
    }
    for (const person of human.people) {
      if (stripIds.has(person.id) && person.sources) {
        person.sources = person.sources.filter(s => s !== preview.sourceTag);
        result.stripped.people++;
      }
    }

    stateManager.setHuman(human);
  }

  const sourceMessageIds = stateManager.messages_get("emmet")
    .filter(m => m.source_tag === preview.sourceTag)
    .map(m => m.id);
  if (sourceMessageIds.length > 0) {
    stateManager.messages_remove("emmet", sourceMessageIds);
  }

  const filename = preview.sourceTag.startsWith("import:document:")
    ? preview.sourceTag.slice("import:document:".length)
    : preview.sourceTag;

  const human = stateManager.getHuman();
  if (human.settings?.document?.processed_documents) {
    delete human.settings.document.processed_documents[filename];
    stateManager.setHuman(human);
  }

  if (preview.sourceTag.startsWith("generate:document:")) {
    const slug = preview.sourceTag.slice("generate:document:".length);
    const human2 = stateManager.getHuman();
    if (human2.settings?.document?.generated_documents) {
      delete human2.settings.document.generated_documents[slug];
      stateManager.setHuman(human2);
    }
  }

  return result;
}
