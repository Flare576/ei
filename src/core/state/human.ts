import type { HumanEntity, Fact, Topic, Person, Quote, DataItemBase } from "../types.js";
import { computeRewriteLengthFloor } from "../utils/rewrite-floor.js";

export function createDefaultHumanEntity(): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    settings: {
      ceremony: {
        time: "09:00",
      },
      opencode: {
        integration: false,
        polling_interval_ms: 60000,
      },
    },
  };
}

/**
 * The one place that decides what `rewrite_length_floor` becomes on a
 * topic_upsert/person_upsert call (ADR-032, amended). The ADR's original
 * absent/`null`/number vocabulary assumed a caller could construct an
 * object with the field genuinely absent, as a reliable third state
 * distinct from present-with-a-stale-value. Neither real call-site shape
 * supports that: a caller updating an existing record builds its object
 * via `{...current, ...changes}` (extraction, ReWrite, heartbeat, dedup,
 * the merge-patch candidate resolvers), so the field is never genuinely
 * absent there — it always carries whatever was already stored, unless
 * explicitly overwritten. A caller CREATING a brand-new record (no prior
 * state to spread over) genuinely has no key at all, but the same handler
 * function builds both shapes in different branches, so reading
 * `incoming.rewrite_length_floor` still can't be trusted uniformly.
 * `floorOverride` is the caller's one honest channel instead: `null` to
 * clear (extraction, when an existing floor is reached/exceeded), a
 * number to set explicitly (ReWrite, or extraction preserving its
 * shrink-under-floor case), or omit it entirely and let this function
 * decide from state.
 *
 * Absent an override, a genuinely changed description gets a fresh floor
 * computed from its new length (new record, or an edit — manual or
 * extraction's own, when there is no existing floor to grow past — that
 * actually touched the content; Alternative D in ADR-032 was rejected for
 * exactly the failure mode of never recomputing). An unrelated-field
 * write (heartbeat's `last_ei_asked`, a dedup merge that didn't touch
 * description) leaves the stored floor exactly as it was.
 */
function resolveRewriteLengthFloor(
  existing: DataItemBase | undefined,
  incoming: DataItemBase,
  override?: number | null
): number | undefined {
  if (override === null) return undefined;
  if (typeof override === "number") return override;
  if (!existing || existing.description !== incoming.description) {
    return computeRewriteLengthFloor(incoming.description.length);
  }
  return existing.rewrite_length_floor;
}

export class HumanState {
  private human: HumanEntity = createDefaultHumanEntity();

  load(entity: HumanEntity): void {
    this.human = entity;
  }

  get(): HumanEntity {
    return this.human;
  }

  set(entity: HumanEntity): void {
    this.human = entity;
    this.human.last_updated = new Date().toISOString();
  }

  fact_upsert(fact: Fact): void {
    const idx = this.human.facts.findIndex((f) => f.id === fact.id);
    fact.last_updated = new Date().toISOString();
    if (idx >= 0) {
      this.human.facts[idx] = fact;
    } else {
      this.human.facts.push(fact);
    }
    this.human.last_updated = new Date().toISOString();
  }

  fact_remove(id: string): boolean {
    const idx = this.human.facts.findIndex((f) => f.id === id);
    if (idx >= 0) {
      this.human.facts.splice(idx, 1);
      // Clean up quote references
      this.human.quotes.forEach((q) => {
        q.data_item_ids = q.data_item_ids.filter((itemId) => itemId !== id);
      });
      this.human.last_updated = new Date().toISOString();
      return true;
    }
    return false;
  }


  topic_upsert(topic: Topic, floorOverride?: number | null): void {
    const idx = this.human.topics.findIndex((t) => t.id === topic.id);
    topic.rewrite_length_floor = resolveRewriteLengthFloor(idx >= 0 ? this.human.topics[idx] : undefined, topic, floorOverride);
    topic.last_updated = new Date().toISOString();
    if (idx >= 0) {
      this.human.topics[idx] = topic;
    } else {
      this.human.topics.push(topic);
    }
    this.human.last_updated = new Date().toISOString();
  }

  topic_remove(id: string): boolean {
    const idx = this.human.topics.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.human.topics.splice(idx, 1);
      // Clean up quote references
      this.human.quotes.forEach((q) => {
        q.data_item_ids = q.data_item_ids.filter((itemId) => itemId !== id);
      });
      this.human.last_updated = new Date().toISOString();
      return true;
    }
    return false;
  }

  person_upsert(person: Person, floorOverride?: number | null): void {
    const identifiers = person.identifiers ?? [];
    person = { ...person, identifiers };
    const primary = identifiers.find(i => i.is_primary) ?? identifiers[0];
    if (primary) {
      person = { ...person, name: primary.value };
    }
    const idx = this.human.people.findIndex((p) => p.id === person.id);
    person.rewrite_length_floor = resolveRewriteLengthFloor(idx >= 0 ? this.human.people[idx] : undefined, person, floorOverride);
    person.last_updated = new Date().toISOString();
    if (idx >= 0) {
      this.human.people[idx] = person;
    } else {
      this.human.people.push(person);
    }
    this.human.last_updated = new Date().toISOString();
  }

   person_remove(id: string): boolean {
     const idx = this.human.people.findIndex((p) => p.id === id);
     if (idx >= 0) {
       this.human.people.splice(idx, 1);
       // Clean up quote references
       this.human.quotes.forEach((q) => {
         q.data_item_ids = q.data_item_ids.filter((itemId) => itemId !== id);
       });
       this.human.last_updated = new Date().toISOString();
       return true;
     }
     return false;
   }

   quote_upsert(quote: Quote): void {
     const idx = this.human.quotes.findIndex((q) => q.id === quote.id);
     if (idx >= 0) {
       this.human.quotes[idx] = quote;
     } else {
       this.human.quotes.push(quote);
     }
     this.human.last_updated = new Date().toISOString();
   }

   quote_add(quote: Quote): void {
     if (!quote.created_at) {
       quote.created_at = new Date().toISOString();
     }
     this.human.quotes.push(quote);
     this.human.last_updated = new Date().toISOString();
   }

   quote_update(id: string, updates: Partial<Quote>): boolean {
     const idx = this.human.quotes.findIndex((q) => q.id === id);
     if (idx >= 0) {
       this.human.quotes[idx] = { ...this.human.quotes[idx], ...updates };
       this.human.last_updated = new Date().toISOString();
       return true;
     }
     return false;
   }

   quote_remove(id: string): boolean {
     const idx = this.human.quotes.findIndex((q) => q.id === id);
     if (idx >= 0) {
       this.human.quotes.splice(idx, 1);
       this.human.last_updated = new Date().toISOString();
       return true;
     }
     return false;
   }

   quote_getForMessage(messageId: string): Quote[] {
     return this.human.quotes.filter((q) => q.message_id === messageId);
   }

   quote_getForDataItem(dataItemId: string): Quote[] {
     return this.human.quotes.filter((q) => q.data_item_ids.includes(dataItemId));
   }
}
