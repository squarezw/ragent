import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
function harness() {
  const calls: any[] = [];
  const source=fs.readFileSync("lib/automation/actions.ts","utf8")+"\nexport { executeEmailAction };";
  const module={exports:{} as any};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
    module,exports:module.exports,process:{env:{JWT_SECRET:"offline-test",EXTERNAL_API_BASE_URL:"http://backend.invalid"}},
    fetch:async(url:any,init:any)=>{calls.push({url,init});return {ok:true,text:async()=>"{}"};},
    require(name:string){
      if(name==="jsonwebtoken")return {default:{sign:()=>"offline-token"},__esModule:true};
      if(name==="@/lib/workspaceTenant")return {workspaceEnabled:()=>true,WORKSPACE_HEADER:"X-Workspace-Tenant-ID"};
      if(name==="@/lib/automation/store")return {};
      throw Error(name);
    },
  });return {api:module.exports,calls};
}
test("automation follow-up mail uses persisted run tenant, missing snapshot cannot send",async()=>{
  const h=harness();
  await h.api.executeEmailAction({userId:1,run:{id:2,tenant_id:6},action:{config:{to:"test@example.invalid"}}});
  assert.equal(h.calls[0].init.headers["X-Workspace-Tenant-ID"],"6");
  await assert.rejects(h.api.executeEmailAction({userId:1,run:{id:3},action:{config:{to:"test@example.invalid"}}}),/TENANT_SNAPSHOT_REQUIRED/);
  assert.equal(h.calls.length,1);
});
