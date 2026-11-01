export interface PackageWarning {
  code: string;
  message: string;
  confirmation_required: boolean;
}
export interface ReplacementCounts {
  added: number;
  modified: number;
  unchanged: number;
  removed: number;
  total_files: number;
  total_bytes: number;
}
export interface PackageReplacementPreview {
  skill_id: number;
  package_sha256: string;
  expected_version: string;
  validation_token: string;
  expires_at: string;
  can_apply: boolean;
  warnings: PackageWarning[];
  files: {
    path: string;
    kind: string;
    size: number;
    sha256: string;
    change: "added" | "modified" | "unchanged";
  }[];
  removed_paths: string[];
  counts: ReplacementCounts;
  preserved_fields: string[];
  published_unchanged: boolean;
}
export function canReplacePackage(
  preview: PackageReplacementPreview | null,
  acknowledged: string[],
  confirmed: boolean,
  now = Date.now()
): boolean {
  return (
    !!preview &&
    preview.can_apply === true &&
    preview.published_unchanged === true &&
    !!preview.validation_token &&
    !!preview.expected_version &&
    !!preview.package_sha256 &&
    Date.parse(preview.expires_at) > now &&
    confirmed &&
    preview.warnings.every(
      (warning) => !warning.confirmation_required || acknowledged.includes(warning.code)
    )
  );
}

/** Skip only a redundant save of an already persisted changed draft; never infer this from its flag alone. */
export function canPublishSavedPackage(
  payload: unknown,
  skill: unknown,
  otherDirty: boolean
): boolean {
  if (otherDirty || !payload || typeof payload !== "object" || !skill || typeof skill !== "object")
    return false;
  const p = payload as Record<string, unknown>,
    s = skill as Record<string, unknown>;
  if (s.has_unpublished_changes !== true) return false;
  const writable = [
    "name",
    "display_name",
    "description",
    "content",
    "requires",
    "visibility",
    "is_active",
    "owner_tenant_id",
    "owner_dept_id",
  ];
  if (Object.keys(p).some((key) => !writable.includes(key))) return false;
  for (const key of ["name", "display_name", "description", "content", "visibility"])
    if (p[key] !== (s[key] ?? "")) return false;
  const requires = (value: unknown) => {
    const r = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return { ...r, tools: r.tools ?? [] };
  };
  const canonical = (value: unknown): string =>
    JSON.stringify(
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value
    );
  if (canonical(requires(p.requires)) !== canonical(requires(s.requires))) return false;
  return ["is_active", "owner_tenant_id", "owner_dept_id"].every(
    (key) => !(key in p) || p[key] === s[key]
  );
}
