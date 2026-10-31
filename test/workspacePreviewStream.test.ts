import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {test} from "node:test";
import jwt from "jsonwebtoken";
import ts from "typescript";
function harness(){
 let upstream:any;let pipes=0;
 const source=fs.readFileSync(new URL("../pages/api/file-preview/stream.ts",import.meta.url),"utf8");
 const module={exports:{} as any};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module,exports:module.exports,process:{env:{WORKSPACE_TENANT_ENABLED:"true",PREVIEW_TOKEN_SECRET:"preview-test"}},console,require(name:string){
  if(name==="jsonwebtoken")return jwt;
  if(name==="axios")return {get:async(_url:string,options:any)=>{upstream=options;return {data:{pipe(){pipes++;}}};}};
  if(name==="@/lib/auth")return {getTokenFromRequest:()=>"actor-test-token"};
  if(name==="@/lib/ossClient")return {ossClient:{sign(){throw Error("unexpected OSS signing");}}};
  if(name==="@/lib/workspaceTenant")return {requireWorkspaceTenant:async()=>({enabled:true,tenantId:6,actorUserId:2})};
  if(name==="@/lib/workspaceFiles")return {workspaceCanReadObject:async()=>true};
  if(name==="@/lib/db")return {__esModule:true,default:{query:async()=>({rows:[{id:"file"}]})}};
  throw Error(name);
 }});
 const res:any={code:200,headers:{},setHeader(k:string,v:string){this.headers[k]=v;},status(n:number){this.code=n;return this;},json(value:any){this.data=value;return this;}};
 return {handler:module.exports.default,res,upstream:()=>upstream,pipes:()=>pipes};
}
test("legacy file preview forwards the validated actor and workspace; replay cannot fetch bytes",async()=>{
 for(const [userId,operationTenantId,status] of [[2,6,200],[3,6,404],[2,7,404]] as const){
  const h=harness();const token=jwt.sign({fileId:"file",userId,operationTenantId,mimetype:"application/pdf"},"preview-test",{expiresIn:"1h"});
  await h.handler({method:"GET",query:{token},headers:{}},h.res);
  assert.equal(h.res.code,status);assert.equal(h.pipes(),status===200?1:0);
  if(status===200){assert.equal(h.upstream().headers.Authorization,"Bearer actor-test-token");assert.equal(h.upstream().headers["X-Workspace-Tenant-ID"],"6");assert.equal(h.res.headers["Cache-Control"],"private, no-store");}
  else assert.equal(h.upstream(),undefined);
 }
});
