import type { HumanEntity, Fact, Trait, Topic, Person, Quote } from "../types.js";

export function createDefaultHumanEntity(): HumanEntity {
  return {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    ceremony_config: {
      enabled: true,
      time: "09:00",
    },
    settings: {
      opencode: {
        integration: false,
        polling_interval_ms: 1800000, // 30 minutes
      },
    },
  };
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

  trait_upsert(trait: Trait): void {
    const idx = this.human.traits.findIndex((t) => t.id === trait.id);
    trait.last_updated = new Date().toISOString();
    if (idx >= 0) {
      this.human.traits[idx] = trait;
    } else {
      this.human.traits.push(trait);
    }
    this.human.last_updated = new Date().toISOString();
  }

  trait_remove(id: string): boolean {
    const idx = this.human.traits.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.human.traits.splice(idx, 1);
      // Clean up quote references
      this.human.quotes.forEach((q) => {
        q.data_item_ids = q.data_item_ids.filter((itemId) => itemId !== id);
      });
      this.human.last_updated = new Date().toISOString();
      return true;
    }
    return false;
  }

  topic_upsert(topic: Topic): void {
    const idx = this.human.topics.findIndex((t) => t.id === topic.id);
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

  person_upsert(person: Person): void {
    const idx = this.human.people.findIndex((p) => p.id === person.id);
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
