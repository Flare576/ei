import { LLMRequestType, LLMPriority, LLMNextStep } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { buildPersonMigrationPrompt } from "../../prompts/ceremony/index.js";

export function queuePersonMigration(state: StateManager): void {
  const human = state.getHuman();

  if (human.settings?.people_migration_complete) {
    console.log("[PersonMigration] Migration complete flag set — skipping");
    return;
  }

  const unmigrated = human.people.filter(p => !p.identifiers || p.identifiers.length === 0);

  if (unmigrated.length === 0) {
    console.log("[PersonMigration] All Person records have identifiers — marking migration complete");
    state.setHuman({
      ...human,
      settings: {
        ...human.settings,
        people_migration_complete: true,
      },
    });
    return;
  }

  console.log(`[PersonMigration] Queuing migration for ${unmigrated.length} Person record(s)`);

  const rewriteModel = human.settings?.rewrite_model;

  for (const person of unmigrated) {
    const prompt = buildPersonMigrationPrompt({
      person: {
        name: person.name,
        description: person.description,
        relationship: person.relationship,
      },
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandlePersonIdentifierMigration,
      ...(rewriteModel ? { model: rewriteModel } : {}),
      data: {
        person_id: person.id,
        ceremony_progress: 1,
      },
    });
  }

  console.log(`[PersonMigration] Queued ${unmigrated.length} migration request(s)`);
}
