import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
function harness() {
  const calls: any[] = [];
  const source = fs.readFileSync("pages/api/knowledge/vectorize-unsegmented-files.ts", "utf8") + "\nexport const audit = { enqueueFiles, takeNextBatch, submitBatch };";
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, {
    module,exports:module.exports,process:{env:{}},console,setTimeout:()=>0,
    require(name: string) {
      if(name==="axios")return {default:{post:async(...args:any[])=>{calls.push(args);return {status:200};}},__esModule:true};
      if(name==="@/lib/workspaceTenant")return {workspaceHeaders:()=>({})};
      if(name==="@/lib/workspaceKnowledge")return {withKnowledgeWorkspace:(handler:any)=>handler};
      if(name==="@/lib/knowledgeVectorizationConfig")return {SEGMENT_ALL_BATCH_SIZE:3,SEGMENT_ALL_MAX_CONCURRENT_BATCHES:1};
      if(name==="@/lib/db")return {default:{},__esModule:true};
      if(name==="@/lib/auth")return {};
      throw Error(name);
    },
  });
  return {api:module.exports.audit,calls};
}
test("background vectorization batches never combine the same admin's different workspaces", async()=>{
  const h=harness();
  h.api.enqueueFiles([{fileId:"1",authHeader:"Bearer test",tenantId:"2"},{fileId:"2",authHeader:"Bearer test",tenantId:"3"},{fileId:"3",authHeader:"Bearer test",tenantId:"2"}]);
  const batch=h.api.takeNextBatch(3);
  assert.deepEqual(Array.from(batch,(item:any)=>item.fileId),["1","3"]);
  assert.equal(h.api.takeNextBatch(3)[0].fileId,"2");
  await h.api.submitBatch(["1","3"],"Bearer test","2");
  assert.equal(h.calls[0][2].headers["X-Workspace-Tenant-ID"],"2");
  assert.equal(h.calls[0][2].headers.Authorization,"Bearer test");
});
