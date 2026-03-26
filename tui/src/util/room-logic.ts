export function checkAllPersonasResponded(
  personaIds: string[],
  judgePersonaId: string | undefined,
  respondedIds: Set<string>
): boolean {
  const nonJudgeIds = personaIds.filter(id => id !== judgePersonaId);
  return nonJudgeIds.length > 0 && nonJudgeIds.every(id => respondedIds.has(id));
}
