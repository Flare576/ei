import type { HumanEntity, Fact, Trait, Topic, Person } from "../types.js";

export function createDefaultHumanEntity(): HumanEntity {
  return {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
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
      this.human.last_updated = new Date().toISOString();
      return true;
    }
    return false;
  }
}
