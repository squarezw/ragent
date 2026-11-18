import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";

function harness({status=206, allowed=true, inline=true} = {}) {
  let fetchOptions: any; let signs=0; let pipes=0;
  const module={exports:{} as any};
  const source=fs.readFileSync(new URL("../pages/api/oss/[...key].ts",import.meta.url),"utf8");
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module,exports:module.exports,console,
    fetch:async (_url:string, options:any)=>{fetchOptions=options;return {ok:status>=200&&status<300,status,body:{},headers:new Headers({"content-type":"video/mp4","content-length":"4","content-range":status===416?"bytes */10":"bytes 0-3/10","accept-ranges":"bytes"})};},
    require(name:string) {
      if(name==="node:stream")return {Readable:{fromWeb:()=>({pipe(){pipes++;}})}};
      if(name==="@/lib/auth")return {getUserIdFromRequest:()=>2};
      if(name==="@/lib/ossClient")return {ossClient:{sign:async()=>{signs++;return {url:"https://storage.test/signed"};}}};
      if(name==="@/lib/workspaceFiles")return {requireWorkspaceObject:async(_req:any,res:any)=>{if(!allowed){res.status(404).json({error:"Not found"});return null;}return {tenantId:2};}};
      throw Error(name);
    },
  });
  const res:any={code:200,headers:{},status(n:number){this.code=n;return this;},setHeader(k:string,v:string){this.headers[k.toLowerCase()]=v;},json(data:any){this.data=data;return this;},end(){this.ended=true;return this;},redirect(code:number,url:string){this.code=code;this.location=url;return this;}};
  const req={method:"GET",query:{key:["attachments","clip.mp4"],...(inline?{inline:"1"}:{})},headers:{range:"bytes=0-3","if-range":"etag"}};
  return {handler:module.exports.default,req,res,fetchOptions:()=>fetchOptions,signs:()=>signs,pipes:()=>pipes};
}
test("inline media forwards Range/If-Range and preserves partial-content headers",async()=>{
  const h=harness();await h.handler(h.req,h.res);
  assert.equal(h.res.code,206);assert.equal(h.fetchOptions().headers.Range,"bytes=0-3");assert.equal(h.fetchOptions().headers["If-Range"],"etag");
  assert.equal(h.res.headers["content-range"],"bytes 0-3/10");assert.equal(h.res.headers["content-length"],"4");assert.equal(h.res.headers["accept-ranges"],"bytes");
  assert.equal(h.res.headers["cache-control"],"private, no-store");assert.equal(h.res.headers["content-disposition"],"inline");assert.equal(h.pipes(),1);
});
test("unsatisfiable media ranges remain 416 rather than 502",async()=>{
  const h=harness({status:416});await h.handler(h.req,h.res);
  assert.equal(h.res.code,416);assert.equal(h.res.headers["content-range"],"bytes */10");assert.equal(h.pipes(),0);
});
test("upstream whole-file response remains 200",async()=>{
  const h=harness({status:200});await h.handler(h.req,h.res);assert.equal(h.res.code,200);assert.equal(h.pipes(),1);
});
test("unauthorized workspace requests never sign or fetch media",async()=>{
  const h=harness({allowed:false});await h.handler(h.req,h.res);assert.equal(h.res.code,404);assert.equal(h.signs(),0);assert.equal(h.fetchOptions(),undefined);
});
test("normal downloads keep the existing signed redirect",async()=>{
  const h=harness({inline:false});await h.handler(h.req,h.res);assert.equal(h.res.code,302);assert.equal(h.fetchOptions(),undefined);assert.equal(h.pipes(),0);
});
