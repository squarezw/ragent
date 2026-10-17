import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const env = { OIDC_ENABLED: "true", OIDC_REDIRECT_URI: "https://app.example/api/auth/oidc/callback", NODE_ENV: "production", JWT_SECRET: "fixture-only" };
function load(file: string, mocks: any = {}, environment: any = env, globals: any = {}): any {
 const module={exports:{} as any};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  module,exports:module.exports,process:{env:environment},URL,URLSearchParams,Date,Headers,console,...globals,
  require:(id:string)=>{
   if(id in mocks)return mocks[id];
   if(['@/lib/localLogout','./localLogout','./lib/localLogout'].includes(id))return load('lib/localLogout.ts',{},environment);
   if(id==='@/lib/oidcPolicy')return {TRANSACTION_COOKIE:'ragent_oidc_tx',TRANSACTION_PATH:'/api/auth/oidc'};
   return require(id);
  }
 });return module.exports;
}
function response(){const r:any={code:200,headers:{},body:undefined};r.setHeader=(k:string,v:any)=>r.headers[k]=v;r.getHeader=(k:string)=>r.headers[k];r.status=(s:number)=>{r.code=s;return r};r.end=()=>r;r.json=(body:any)=>{r.body=body;return r};r.redirect=(s:number,url:string)=>{r.code=s;r.url=url;return r};return r;}
function deferred(){let resolve:any;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function applyCookies(jar:any,res:any){for(const cookie of [res.headers['Set-Cookie']].flat().filter(Boolean)){const [pair]=cookie.split(';');const index=pair.indexOf('=');const key=pair.slice(0,index);if(cookie.includes('Max-Age=0'))delete jar[key];else jar[key]=pair.slice(index+1);}}

test('logout is POST/origin protected; marker is durable HttpOnly, clears session and transaction; legacy is unchanged',()=>{
 for(const [method,origin,status] of [['GET','https://app.example',405],['POST','https://evil.example',403],['POST',undefined,403],['POST','https://app.example',204]]){
  const res=response();load('pages/api/auth/logout.ts').default({method,headers:{origin,host:'app.example'}},res);assert.equal(res.code,status);
  if(status!==204)assert.equal(res.headers['Set-Cookie'],undefined);else{const h=res.headers['Set-Cookie'];assert.ok(h.some((s:string)=>/^ragent_signed_out=[a-f0-9]{32};/.test(s)&&s.includes('HttpOnly')&&s.includes('Secure')&&!s.includes('Max-Age=0')));assert.ok(h.some((s:string)=>s.startsWith('ragent_oidc_tx=;')&&s.includes('Path=/api/auth/oidc')));}
 }
 const res=response();load('pages/api/auth/logout.ts',{}, {...env,OIDC_ENABLED:'false'}).default({method:'POST',headers:{origin:'https://app.example',host:'app.example'}},res);assert.equal(res.code,204);assert.ok(!res.headers['Set-Cookie'].some((s:string)=>s.startsWith('ragent_signed_out=')));
});

test('late real /me response after logout cannot authenticate despite restored JWT; methods exposes marker without URL flag',async()=>{
 const jwt=require('jsonwebtoken');const token=jwt.sign({userId:7},env.JWT_SECRET,{expiresIn:300});const jar:any={ragent_token:token};const pending=deferred();
 const auth=load('lib/auth.ts',{jsonwebtoken:{default:jwt}});
 const me=load('pages/api/user/me.ts',{
  '@/lib/auth':auth,'@/lib/permissions':{getUserPermissions:async()=>({roles:[],permissions:[]})},'@/lib/tenantMapping':{getCompanyCodeByTenantId:()=>null},
  '@/lib/db':{default:{connect:async()=>({query:()=>pending.promise,release:()=>{}})}}
 }).default;
 const inFlight=response();const done=me({cookies:{...jar},headers:{}},inFlight);await new Promise(r=>setImmediate(r));
 const out=response();load('pages/api/auth/logout.ts').default({method:'POST',headers:{origin:'https://app.example'}},out);applyCookies(jar,out);assert.equal(jar.ragent_token,undefined);
 pending.resolve({rows:[{id:7,status:'active',tenant_id:null}]});await done;applyCookies(jar,inFlight);
 assert.equal(inFlight.headers["Set-Cookie"],undefined,"OIDC /me must not rewrite session cookies");
 jar.ragent_token=token; // A stale cookie or another older response is still rejected by the marker.
 assert.equal(auth.getUserIdFromRequest({cookies:jar,headers:{authorization:'Bearer '+token}}),null,'marker still denies it');
 const methods=response();load('pages/api/auth/methods.ts').default({method:'GET',cookies:jar},methods);assert.equal(methods.body.signedOut,true);
 const off=load('lib/auth.ts',{jsonwebtoken:{default:jwt}},{...env,OIDC_ENABLED:'false'});assert.equal(off.getUserIdFromRequest({cookies:jar,headers:{}}),7);
});

test('verified callback removes prior marker only on success; earlier pending callback never deletes later logout marker',async()=>{
 for(const scenario of ['explicit','invalid','disabled','pending-before-logout']){
  const gate=deferred();const jwt=require('jsonwebtoken');const jar:any=scenario==='pending-before-logout'?{}:{ragent_signed_out:'1'};
  const callbacks=load('pages/api/auth/oidc/callback.ts',{
   '@/lib/oidcClient':{readOidcSettings:()=>({}),TRANSACTION_COOKIE:'ragent_oidc_tx',TRANSACTION_PATH:'/api/auth/oidc',completeOidc:async()=>{if(scenario==='invalid')throw Error('invalid');if(scenario==='pending-before-logout')await gate.promise;return{sub:'uuid',ttl:120,returnTo:'/user'}}},
   '@/lib/db':{default:{query:async()=>({rows:[{id:7,status:scenario==='disabled'?'disabled':'active'}]})}},
   '@/lib/env':{requireEnv:()=>env.JWT_SECRET},'@/lib/auth':load('lib/auth.ts',{jsonwebtoken:{default:jwt}}),jsonwebtoken:{default:jwt}
  });const res=response();const done=callbacks.default({method:'GET',cookies:{...jar,ragent_oidc_tx:'encrypted'},url:'/callback?code=fixture'},res);
  if(scenario==='pending-before-logout'){const out=response();load('pages/api/auth/logout.ts').default({method:'POST',headers:{origin:'https://app.example'}},out);applyCookies(jar,out);gate.resolve();}
  await done;applyCookies(jar,res);
  if(scenario==='explicit'){assert.equal(res.code,303);assert.equal(jar.ragent_signed_out,undefined);assert.ok(jar.ragent_token);}else assert.ok(jar.ragent_signed_out);
 }
});

test('in-flight user cache promise cannot repopulate after successful logout; failed logout retains session and reports error',async()=>{
 for(const success of [true,false]){
  const pending=deferred();const toasts:any[]=[];const navigation:any[]=[];const states:any[]=[];let index=0;
  const react={createContext:()=>({Provider:'provider'}),createElement:(_type:any,props:any)=>props,useContext:()=>null,useState:(value:any)=>{const i=index++;states[i]=value;return[value,(next:any)=>states[i]=next]},useEffect:()=>{}};
  const hooks=load('hooks/useCurrentUser.ts',{
   react:{...react,default:react},'@/lib/axios':{default:{get:()=>pending.promise}},'@/lib/authUtils':{clearChatSelectionCache:()=>{},clearSwrCache:()=>{}},sonner:{toast:{error:(s:any)=>toasts.push(s)}},'next-intl':{useTranslations:()=>((s:any)=>s)},'@/lib/browserAuthMode':{setLogoutPending:()=>{}}
  },env,{fetch:async()=>({ok:success}),window:{location:{assign:(s:any)=>navigation.push(s)},dispatchEvent:()=>{}},CustomEvent:class{},localStorage:{removeItem:()=>{}}});
  const old=hooks.getCurrentUser();const rejected=assert.rejects(old,/Session changed/);const provider=hooks.UserProvider({children:null});await provider.value.logout();pending.resolve({data:{id:7}});await rejected;
  if(success){await assert.rejects(hooks.getCurrentUser(),/Session changed/);assert.equal(navigation.length,1);assert.equal(states[0],null);assert.equal(toasts.length,0);}else{assert.equal(navigation.length,0);assert.equal(toasts.length,1);}
 }
});

test('middleware removes both stale bearer and session cookie while preserving non-auth cookies; off mode is untouched',()=>{
 for(const enabled of ['true','false']){
  let headers:any;
  const middleware=load('middleware.ts',{'next/server':{NextResponse:{next:(options:any)=>{headers=options.request.headers;return{cookies:{set:()=>{}}}}}},'./i18n/config':{locales:['en'],defaultLocale:'en'}},{...env,OIDC_ENABLED:enabled});
  middleware.middleware({headers:new Headers({authorization:'Bearer stale',cookie:'ragent_token=stale; ragent_signed_out=1; locale=en'}),cookies:{get:(key:string)=>({value:{ragent_token:'stale',ragent_signed_out:'1',locale:'en'}[key]})},nextUrl:{pathname:'/api/user/me'}});
  assert.equal(headers.get('authorization'),enabled==='true'?null:'Bearer stale');
  assert.equal(headers.get('cookie').includes('ragent_token='),enabled==='false');
  assert.ok(headers.get('cookie').includes('locale=en'));
 }
});

test('legacy /me continues synchronizing Cookie when OIDC is disabled',async()=>{
 const res=response();const handler=load('pages/api/user/me.ts',{
  '@/lib/auth':{getUserIdFromRequest:()=>7,getTokenFromRequest:()=> 'legacy',setAuthCookie:(r:any)=>r.setHeader('Set-Cookie','legacy-cookie')},
  '@/lib/permissions':{getUserPermissions:async()=>({roles:[],permissions:[]})},'@/lib/tenantMapping':{getCompanyCodeByTenantId:()=>null},
  '@/lib/db':{default:{connect:async()=>({query:async()=>({rows:[{id:7,status:'active',tenant_id:null}]}),release:()=>{}})}}
 },{...env,OIDC_ENABLED:'false'}).default;
 await handler({headers:{},cookies:{}},res);assert.equal(res.code,200);assert.equal(res.headers['Set-Cookie'],'legacy-cookie');
});

test('automatic sign-in derives force reauthentication only from logout marker or exact reauth flag',async()=>{
 for(const [cookies,query,expected] of [
  [{},{prompt:'none'},false],
  [{ragent_signed_out:'generation'},{prompt:'none',reauth:'0'},false],
  [{},{reauth:'1',prompt:'none'},true],
  [{},{reauth:['1']},false],
 ]){
  const calls:any[]=[];const res=response();
  const handler=load('pages/api/auth/oidc/start.ts',{'@/lib/oidcClient':{readOidcSettings:()=>({}),startOidc:async(...args:any[])=>{calls.push(args);return{cookie:'encrypted',redirectTo:'https://issuer.example/auth'}},TRANSACTION_COOKIE:'ragent_oidc_tx',TRANSACTION_PATH:'/api/auth/oidc',TRANSACTION_TTL:300}}).default;
  await handler({method:'GET',cookies,query},res);
  assert.equal(res.code,303);assert.equal(calls[0][2],cookies.ragent_signed_out||'');assert.equal(calls[0][3],expected);
  assert.ok(!res.headers['Set-Cookie'].includes('ragent_signed_out='),'start never clears logout state');
 }
});
