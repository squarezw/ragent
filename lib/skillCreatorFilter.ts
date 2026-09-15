import type { Skill } from "@/types/skill";

export type CreatorFilterValue = number | null;

export interface SkillCreator {
  userId: number;
  name: string;
}

export function getSkillCreators(skills: Skill[]): SkillCreator[] {
  const creators = new Map<number, SkillCreator>();

  for (const skill of skills) {
    if (skill.user_id == null || !skill.author || creators.has(skill.user_id)) continue;
    creators.set(skill.user_id, { userId: skill.user_id, name: skill.author });
  }

  return [...creators.values()];
}

export function filterSkillsByCreator(
  skills: Skill[],
  creatorId: CreatorFilterValue
): Skill[] {
  if (creatorId == null) return skills;
  return skills.filter((skill) => skill.user_id === creatorId);
}
