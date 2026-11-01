/** Same PostgreSQL advisory namespace as service tenant-transfer transactions. */
export interface AppFenceClient {
  query(text: string, values?: any[]): Promise<any>;
}
export async function lockAppTenant(
  client: AppFenceClient,
  appId: number,
  tenantId: number | null
) {
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("INVALID_APP_ID");
  await client.query("SELECT pg_advisory_xact_lock_shared(72815, $1::integer)", [appId]);
  const result = await client.query("SELECT owner_tenant_id FROM apps WHERE id=$1", [appId]);
  if (result.rows.length !== 1 || result.rows[0].owner_tenant_id !== tenantId)
    throw new Error("APP_TENANT_CHANGED");
}
export async function withAppTenantFence<T>(
  pool: { connect(): Promise<AppFenceClient & { release(): void }> },
  appId: number,
  tenantId: number | null,
  work: (client: AppFenceClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockAppTenant(client, appId, tenantId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
