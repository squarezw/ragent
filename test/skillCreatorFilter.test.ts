import assert from "node:assert/strict";
import { test } from "node:test";
import { filterSkillsByCreator, getSkillCreators } from "../lib/skillCreatorFilter.ts";
import type { Skill } from "../types/skill.ts";

function skill(overrides: Partial<Skill>): Skill {
  return {
    id: 1,
    name: "sample-skill",
    display_name: "Sample skill",
    description: "",
    content: "",
    published_content: null,
    requires: null,
    visibility: "private",
    is_active: true,
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

test("getSkillCreators: retains first-seen order and de-duplicates by user ID", () => {
  const creators = getSkillCreators([
    skill({ id: 1, user_id: 11, author: "Alex" }),
    skill({ id: 2, user_id: 22, author: "Alex" }),
    skill({ id: 3, user_id: 11, author: "Alex renamed" }),
  ]);

  assert.deepEqual(creators, [
    { userId: 11, name: "Alex" },
    { userId: 22, name: "Alex" },
  ]);
});

test("getSkillCreators: skips skills without a stable creator ID or display name", () => {
  const creators = getSkillCreators([
    skill({ id: 1, user_id: null, author: "No ID" }),
    skill({ id: 2, user_id: 12, author: null }),
    skill({ id: 3, user_id: 13, author: "Jordan" }),
  ]);

  assert.deepEqual(creators, [{ userId: 13, name: "Jordan" }]);
});

test("filterSkillsByCreator: matches only the selected stable user ID", () => {
  const skills = [
    skill({ id: 1, user_id: 11, author: "Alex" }),
    skill({ id: 2, user_id: 22, author: "Alex" }),
    skill({ id: 3, user_id: 11, author: "Alex" }),
  ];

  assert.deepEqual(
    filterSkillsByCreator(skills, 11).map(({ id }) => id),
    [1, 3]
  );
});

test("filterSkillsByCreator: clearing the selection returns the existing list", () => {
  const skills = [skill({ id: 1, user_id: 11 }), skill({ id: 2, user_id: 22 })];

  assert.strictEqual(filterSkillsByCreator(skills, null), skills);
});
