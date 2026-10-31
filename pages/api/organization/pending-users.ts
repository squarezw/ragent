import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { PENDING_TENANT_SQL } from "@/lib/pendingTenant";
import pool from "@/lib/db";

/** Explicit organization-only exception, never a workspace bypass for ordinary users. */
export default async function handler(req: NextApiRequest,res: NextApiResponse) {
  res.setHeader("Cache-Control","private, no-store");
  const actor=getUserIdFromRequest(req);
  if(!actor) return res.status(401).json({error:"UNAUTHORIZED"});
  if(!(await isSuperAdmin(actor))) return res.status(403).json({error:"FORBIDDEN"});
  const actorState=await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'",[actor]);
  if(!actorState.rows.length) return res.status(401).json({error:"UNAUTHORIZED"});
  if(req.method!=="GET" && req.method!=="POST") {res.setHeader("Allow","GET, POST");return res.status(405).end();}
  const client=await pool.connect();
  let transaction=false;
  try {
    if(req.method==="GET") {
      const search=typeof req.query.search==="string" ? req.query.search.trim().slice(0,100) : "";
      const page=Math.max(1,Math.min(100000,Number(req.query.page)||1));
      const result=await client.query(`SELECT u.id,u.username,u.nickname,u.phone,u.email,u.created_at,
        COUNT(*) OVER()::int AS total FROM users u WHERE ${PENDING_TENANT_SQL}
        AND ($1::text='' OR u.username ILIKE '%'||$1||'%' OR u.nickname ILIKE '%'||$1||'%')
        ORDER BY u.id LIMIT 50 OFFSET $2`,[search,(Math.floor(page)-1)*50]);
      return res.json({users:result.rows.map(({total,...user})=>user),total:result.rows[0]?.total??0,page:Math.floor(page)});
    }
    const origin=req.headers.origin;
    if(origin && new URL(origin).host!==req.headers.host) return res.status(403).json({error:"ORIGIN_FORBIDDEN"});
    const userId=Number(req.body?.user_id),tenantId=Number(req.body?.tenant_id);
    if(!Number.isSafeInteger(userId)||userId<=0||!Number.isSafeInteger(tenantId)||tenantId<=0)
      return res.status(400).json({error:"INVALID_ASSIGNMENT"});
    await client.query("BEGIN");transaction=true;
    const tenant=await client.query("SELECT id FROM tenant WHERE id=$1 AND status='active' FOR SHARE",[tenantId]);
    if(!tenant.rows.length) {await client.query("ROLLBACK");transaction=false;return res.status(400).json({error:"TENANT_UNAVAILABLE"});}
    const pending=await client.query(`SELECT u.id FROM users u WHERE u.id=$1 AND ${PENDING_TENANT_SQL} FOR UPDATE`,[userId]);
    if(!pending.rows.length) {await client.query("ROLLBACK");transaction=false;return res.status(409).json({error:"USER_NO_LONGER_PENDING"});}
    await client.query("UPDATE users SET tenant_id=$1,dept_id=NULL,updated_at=NOW() WHERE id=$2",[tenantId,userId]);
    await client.query("COMMIT");transaction=false;
    return res.json({success:true});
  } catch {if(transaction) await client.query("ROLLBACK");return res.status(500).json({error:"ASSIGNMENT_FAILED"});}
  finally {client.release();}
}
