import pool from "./db";

// company_code → oa_userid
const COMPANY_OA_USERID: Record<string, string> = {
  ZSH: "6",
  ZFZ: "5",
};

// Parse ZN_TENANT_MAPPING env: "zsh-1:zfz-2" → Map<tenantId, companyCode>
function parseTenantMapping(): Map<number, string> {
  const raw = process.env.ZN_TENANT_MAPPING;
  const map = new Map<number, string>();
  if (!raw) return map;

  for (const segment of raw.split(":")) {
    const dashIdx = segment.lastIndexOf("-");
    if (dashIdx <= 0) continue;

    const code = segment.slice(0, dashIdx).toUpperCase();
    const id = Number(segment.slice(dashIdx + 1));
    if (Number.isNaN(id)) continue;

    map.set(id, code);
  }
  return map;
}

const tenantToCompany = parseTenantMapping();

export function getCompanyCodeByTenantId(tenantId: number): string | undefined {
  return tenantToCompany.get(tenantId);
}

export function getTenantIdByCompanyCode(companyCode: string): number | undefined {
  for (const [tenantId, code] of Array.from(tenantToCompany)) {
    if (code === companyCode) return tenantId;
  }
  return undefined;
}

// Parse ZN_KB_DATASET_MAP env: "zsh-<uuid>:zfz-<uuid>" → Map<companyCode, datasetId>
function parseKbDatasetMap(): Map<string, string> {
  const raw = process.env.ZN_KB_DATASET_MAP;
  const map = new Map<string, string>();
  if (!raw) return map;

  for (const segment of raw.split(":")) {
    const dashIdx = segment.indexOf("-");
    if (dashIdx <= 0) continue;

    const code = segment.slice(0, dashIdx).toUpperCase();
    const datasetId = segment.slice(dashIdx + 1);
    if (!datasetId) continue;

    map.set(code, datasetId);
  }
  return map;
}

const companyToDataset = parseKbDatasetMap();

export function getDatasetIdByCompanyCode(companyCode: string): string | undefined {
  return companyToDataset.get(companyCode.toUpperCase());
}

export function getOaUserIdByTenantId(tenantId: number): string | undefined {
  const code = tenantToCompany.get(tenantId);
  return code ? COMPANY_OA_USERID[code] : undefined;
}

export async function getUserTenantId(userId: number): Promise<number | null> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT tenant_id FROM users WHERE id = $1", [userId]);
    return result.rows[0]?.tenant_id ?? null;
  } finally {
    client.release();
  }
}
