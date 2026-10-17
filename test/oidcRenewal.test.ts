import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const env = { OIDC_ENABLED: 'true', NODE_ENV: 'production', JWT_SECRET: 'renewal-fixture-secret' };
const settings = { redirectUri: 'https://app.example/api/auth/oidc/callback', transactionKey: 'a'.repeat(64) };
const requestId = 'd'.repeat(32);
function load(file: string, mocks: any = {}): any {
 const module = { exports: {} as any };
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file, import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
  module,exports:module.exports,process:{env},URL,URLSearchParams,Date,Buffer,console,
  require:(id:string)=>id in mocks ? mocks[id] : id.startsWith('@/lib/') ? load('lib/'+id.slice(6)+'.ts',mocks) : id==='./oidcPolicy' ? load('lib/oidcPolicy.ts',mocks) : id==='./localLogout' ? load('lib/localLogout.ts',mocks) : require(id)
 });return module.exports;
}
const policy = load('lib/oidcPolicy.ts');
function response(){const r:any={code:200,headers:{}};r.setHeader=(k:string,v:any)=>r.headers[k]=v;r.getHeader=(k:string)=>r.headers[k];r.status=(s:number)=>{r.code=s;return r};r.end=(b:any)=>{r.body=b;return r};r.json=r.end;r.redirect=(s:number,u:string)=>{r.code=s;r.url=u;return r};return r;}
function transaction(renewal:any={mode:'silent',expectedUserId:7,requestId},state='state') {
 return policy.sealTransaction({state,nonce:'nonce',verifier:'pkce',createdAt:Math.floor(Date.now()/1000),returnTo:'/chat',logoutMarker:'',...(renewal?{renewal}:{})},settings.transactionKey);
}
function message(res:any) {
 let actual:any, origin='',closed=false;
 const target={postMessage:(m:any,o:string)=>{actual=m;origin=o}};
 const script=/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(res.body)?.[1];assert.ok(script);
 vm.runInNewContext(script!,{window:{parent:target,opener:target,close:()=>{closed=true}}});
 assert.equal(origin,'https://app.example');assert.equal(actual.requestId,requestId);assert.equal(actual.type,'ragent:session-renewal');
 assert.match(res.headers['Content-Security-Policy'],/frame-ancestors 'self'/);assert.equal(res.headers['X-Frame-Options'],'SAMEORIGIN');
 return {actual,closed};
}
test('renewal start validates origin and inputs; chooses separate cookie and refuses signed-out sessions',async()=>{
 for(const scenario of ['silent','popup','signed-out','cross-site','bad-input']) {
  const calls:any[]=[];const res=response();
  const handler=load('pages/api/auth/oidc/start.ts',{'@/lib/oidcClient':{...policy,readOidcSettings:()=>settings,startOidc:async(...args:any[])=>{calls.push(args);return{cookie:'encrypted',redirectTo:'https://issuer.example/auth'}}}}).default;
  await handler({method:'GET',headers:{'sec-fetch-site':scenario==='cross-site'?'cross-site':'same-origin'},cookies:scenario==='signed-out'?{ragent_signed_out:'new-generation'}:{},query:{mode:scenario==='popup'?'popup':'silent',expectedUserId:'7',requestId:scenario==='bad-input'?'bad':requestId}},res);
  if(scenario==='silent'||scenario==='popup') {
   assert.equal(res.code,303);assert.match(res.headers['Set-Cookie'],/^ragent_oidc_renewal_tx=/);
   assert.equal(calls[0][4].mode,scenario);assert.equal(calls[0][4].expectedUserId,7);
  } else { assert.equal(calls.length,0);assert.ok(res.code>=400);assert.equal(res.headers['Set-Cookie'],undefined); }
 }
});
test('verified same-account renewal issues only bounded application cookie and safe channel message',async()=>{
 for(const mode of ['silent','popup']) {
  const cookie=transaction({mode,expectedUserId:7,requestId});const res=response();
  const handler=callback();
  await handler({method:'GET',headers:{},cookies:{ragent_oidc_renewal_tx:cookie},url:'/api/auth/oidc/callback?code=fixture&state=state'},res);
  assert.equal(res.code,200);const m=message(res);assert.equal(m.actual.ok,true);assert.equal(m.closed,mode==='popup');
  const headers=res.headers['Set-Cookie'];const auth=headers.find((h:string)=>h.startsWith('ragent_token='));assert.ok(auth);
  const token=auth.split(';')[0].slice('ragent_token='.length);const claims=jwt.verify(token,env.JWT_SECRET);assert.equal(claims.userId,7);assert.ok(claims.exp-claims.iat<=120);
  assert.ok(!res.body.includes(token));assert.ok(!headers.some((h:string)=>h.startsWith('ragent_signed_out=')||h.startsWith('ragent_oidc_tx=')));
 }
});
function callback(opts:any={}) {
 return load('pages/api/auth/oidc/callback.ts',{
  '@/lib/oidcClient':{...policy,readOidcSettings:()=>settings,completeOidc:async(_s:any,_q:any,cookie:string)=>{
   if(opts.badProof)throw Error('invalid proof');const t=policy.openTransaction(cookie,settings.transactionKey);return{sub:'verified-sub',ttl:120,returnTo:t.returnTo,...(t.renewal?{renewal:t.renewal}:{})};
  }},'@/lib/db':{default:{query:async()=>({rows:[{id:opts.otherAccount?8:7,status:opts.disabled?'disabled':'active'}]})}},
  '@/lib/env':{requireEnv:()=>env.JWT_SECRET},jsonwebtoken:{...jwt,default:jwt}
 }).default;
}
test('renewal cannot switch accounts, revive logout, accept disabled account or invalid proof',async()=>{
 for(const scenario of ['otherAccount','disabled','badProof','signed-out']) {
  const res=response();const cookies:any={ragent_oidc_renewal_tx:transaction()};if(scenario==='signed-out')cookies.ragent_signed_out='later-logout';
  await callback({[scenario]:true})({method:'GET',headers:{},cookies,url:'/api/auth/oidc/callback?code=fixture&state=state'},res);
  assert.equal(res.code,401);const m=message(res);assert.equal(m.actual.ok,false);
  if(scenario==='otherAccount')assert.equal(m.actual.errorCode,'ACCOUNT_CHANGED');
  if(scenario==='signed-out')assert.equal(m.actual.errorCode,'SIGNED_OUT');
  assert.ok(!(res.headers['Set-Cookie']||[]).some((h:string)=>h.startsWith('ragent_token=')||h.startsWith('ragent_signed_out=')));
 }
});
test('unmatched stale iframe callback does not consume an independent interactive transaction',async()=>{
 const cookies={ragent_oidc_renewal_tx:transaction(),ragent_oidc_tx:transaction(null,'interactive-state')};
 const stale=response();await callback()({method:'GET',headers:{},cookies,url:'/callback?state=unknown&code=fixture'},stale);
 assert.equal(stale.code,400);assert.equal(stale.headers['Set-Cookie'],undefined);
 const interactive=response();await callback()({method:'GET',headers:{},cookies,url:'/callback?state=interactive-state&code=fixture'},interactive);
 assert.equal(interactive.code,303);assert.equal(interactive.url,'/chat');
 assert.ok(!interactive.headers['Set-Cookie'].some((h:string)=>h.startsWith('ragent_oidc_renewal_tx=')));
});
test('malformed sealed renewal context is rejected before any token exchange',()=>{
 for(const renewal of [{mode:'silent',expectedUserId:-1,requestId},{mode:'silent',expectedUserId:7,requestId:'bad'},{mode:'invalid',expectedUserId:7,requestId}])
  assert.throws(()=>policy.openTransaction(transaction(renewal),settings.transactionKey));
});
