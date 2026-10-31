interface SkillOwner {
  visibility?: string | null;
  owner_tenant_name?: string | null;
  owner_dept_name?: string | null;
}

/** 展示真实归属；只有部门共享以部门为主，其他范围展示所属组织。 */
export function getSkillOwnerLabel(skill: SkillOwner): { label: string | null; title: string | null } {
  const tenant = skill.owner_tenant_name || null;
  const department = skill.visibility === "dept" ? skill.owner_dept_name || null : null;
  return {
    label: department || tenant,
    title: [tenant, department].filter(Boolean).join(" / ") || null,
  };
}
