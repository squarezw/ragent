import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
function harness(superadmin=true,active=true,pending=true,actorActive=true) {
 const calls: string[]=[];let connects=0;
 const client={release(){},async query(sql:string,_params?:any[]){calls.push(sql);
  if(sql.includes("FROM tenant"))return {rows:active?[{id:6}]:[]};
  if(sql.includes("FOR UPDATE"))return {rows:pending?[{id:7}]:[]};
  return {rows:[]};}};
 const module={exports:{} as any};
 const source=fs.readFileSync(new URL("../pages/api/organization/pending-users.ts",import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,URL,require(name:string){
  if(name==="@/lib/auth")return {getUserIdFromRequest:()=>2};
  if(name==="@/lib/permissions")return {isSuperAdmin:async()=>superadmin};
  if(name==="@/lib/pendingTenant")return {PENDING_TENANT_SQL:"u.tenant_id IS NULL AND u.status='active'"};
  if(name==="@/lib/db")return {__esModule:true,default:{query:async()=>({rows:actorActive?[{id:2}]:[]}),connect:async()=>{connects++;return client;}}};
  throw Error(name);
 }});
 const res:any={statusCode:200,setHeader(){},status(s:number){this.statusCode=s;return this;},json(d:any){this.data=d;return this;},end(){return this;}};
 const req:any={method:"POST",headers:{host:"localhost:3000"},query:{},body:{user_id:7,tenant_id:6}};
 return {handler:module.exports.default,res,req,calls,connects:()=>connects};
}
test("organization pending-user management requires real super-admin authority",async()=>{
 const h=harness(false);await h.handler(h.req,h.res);assert.equal(h.res.statusCode,403);assert.equal(h.connects(),0);
});
test("assignment validates active tenant and locks still-pending user before update",async()=>{
 const h=harness();await h.handler(h.req,h.res);assert.equal(h.res.statusCode,200);
 assert.equal(h.calls[0],"BEGIN");assert.match(h.calls[1],/status='active' FOR SHARE/);assert.match(h.calls[2],/FOR UPDATE/);
 assert.match(h.calls[3],/tenant_id=\$1,dept_id=NULL/);assert.equal(h.calls[4],"COMMIT");
 assert.ok(h.calls.every(sql=>!sql.includes("user_roles")));
});
test("inactive destination and concurrently assigned users never get overwritten",async()=>{
 for(const [active,pending,status] of [[false,true,400],[true,false,409]] as const){
  const h=harness(true,active,pending);await h.handler(h.req,h.res);assert.equal(h.res.statusCode,status);
  assert.equal(h.calls.at(-1),"ROLLBACK");assert.ok(h.calls.every(sql=>!sql.startsWith("UPDATE")));
 }
});
test("browser cross-origin assignment is rejected before a transaction",async()=>{
 const h=harness();h.req.headers.origin="https://other.example";await h.handler(h.req,h.res);
 assert.equal(h.res.statusCode,403);assert.equal(h.calls.length,0);
});

test("a disabled super administrator cannot assign users",async()=>{
 const h=harness(true,true,true,false);await h.handler(h.req,h.res);
 assert.equal(h.res.statusCode,401);assert.equal(h.connects(),0);assert.equal(h.calls.length,0);
});
