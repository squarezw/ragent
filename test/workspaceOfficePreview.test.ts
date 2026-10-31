import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const { workspacePreviewSource } = await import(new URL("../lib/workspacePreviewSource.ts", import.meta.url).href);
function harness(allowed = true, payload?: any) {
  const calls: any[] = [];
  const tokens: any[] = [];
  const module={exports:{} as any};
  const route=payload ? "file" : "create-link";
  const source=fs.readFileSync(`pages/api/file-preview/${route}.ts`,"utf8");
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
    module,exports:module.exports,URL,Buffer,console,process:{env:{WORKSPACE_TENANT_ENABLED:"true",PREVIEW_TOKEN_SECRET:"offline-test",FILE_PREVIEW_BASE_URL:"http://preview.internal:3000",KKFILEVIEW_BASE_URL:"http://office.invalid"}},
    require(name:string){
      if(name==="axios")return {__esModule:true,default:{get:async(url:any,options:any)=>{
        calls.push({url,options});if(!allowed)throw Error("denied");
        return {status:200,headers:{"content-type":"application/octet-stream"},data:{destroy(){},pipe(){}}};
      }}};
      if(name==="jsonwebtoken")return {__esModule:true,default:{sign:(value:any)=>{tokens.push(value);return "test-capability";},verify:()=>payload}};
      if(name==="@/lib/workspacePreviewSource")return {workspacePreviewSource};
      if(name==="@/lib/auth")return {requireAuth:()=>true,getUserIdFromRequest:()=>3,getTokenFromRequest:()=>"test-actor"};
      if(name==="@/lib/workspaceTenant")return {requireWorkspaceTenant:async()=>({enabled:true,tenantId:6,actorUserId:3})};
      if(name==="@/lib/workspaceFiles")return {workspaceCanReadObject:async()=>allowed};
      if(name==="@/lib/db")return {__esModule:true,default:{query:async()=>({rows:allowed?[{id:1,filename:"file.docx"}]:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}})}};
      if(name==="@/lib/ossClient")return {};
      if(name==="path")return {__esModule:true,default:{extname:(value:string)=>value.includes(".docx")?".docx":""}};
      throw Error(name);
    },
  });
  const res:any={statusCode:200,setHeader(){},status(code:number){this.statusCode=code;return this;},json(value:any){this.body=value;return this;}};
  return {handler:module.exports.default,res,calls,tokens};
}
test("Skill and process Office previews probe exact source with actor and fixed tenant before issuing capability",async()=>{
  for(const source of ["/api/v1/skills/17/asset-content?path=demo.xlsx&stage=published","/api/v1/process-management/process-documents/doc-123/file"]){
    const h=harness();await h.handler({method:"POST",headers:{host:"127.0.0.1:3000"},body:{fileUrl:`http://127.0.0.1:3000${source}`}},h.res);
    assert.equal(h.res.statusCode,200);assert.equal(h.calls[0].url,`http://preview.internal:3000${source}`);
    assert.equal(h.calls[0].options.headers["X-Workspace-Tenant-ID"],"6");
    assert.equal(h.calls[0].options.maxRedirects,0);
    assert.equal(h.tokens[0].fileUrl,source);assert.equal(h.tokens[0].operationTenantId,6);
    const denied=harness(false);await denied.handler({method:"POST",headers:{host:"127.0.0.1:3000"},body:{fileUrl:source}},denied.res);
    assert.equal(denied.res.statusCode,404);assert.equal(denied.tokens.length,0);
  }
});
test("knowledge fallback is bound to authorized file rather than supplied URL",async()=>{
  const h=harness();await h.handler({method:"POST",headers:{host:"127.0.0.1:3000"},body:{fileId:"1",fileUrl:"https://evil.invalid/file.docx"}},h.res);
  assert.equal(h.tokens[0].fileUrl,"/api/uploads/file.docx?file_id=1");assert.equal(h.calls.length,0);
});
test("Office callback fixes tenant on downstream fetch and refuses arbitrary signed targets",async()=>{
  const payload={fileUrl:"/api/v1/skills/17/asset-content?path=x.docx&workspace_tenant_id=99",operationTenantId:6,userId:3,sourceAuthHeader:"Bearer test-actor"};
  const h=harness(true,payload);await h.handler({method:"GET",headers:{},query:{token:"test"},url:"/api/file-preview/file.docx"},h.res);
  const url=new URL(h.calls[0].url);assert.equal(url.origin,"http://preview.internal:3000");assert.equal(url.searchParams.get("workspace_tenant_id"),"6");
  assert.equal(h.calls[0].options.headers["X-Workspace-Tenant-ID"],"6");assert.equal(h.calls[0].options.maxRedirects,0);
  const bad=harness(true,{...payload,fileUrl:"https://evil.invalid/api/oss/x.docx"});await bad.handler({method:"GET",headers:{},query:{token:"test"}},bad.res);
  assert.equal(bad.res.statusCode,403);assert.equal(bad.calls.length,0);
});
