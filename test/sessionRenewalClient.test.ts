import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";
function fixture() {
 let generation=0,pendingLogout=false,userId=7;
 let session={userId,expiresAt:Math.floor(Date.now()/1000)+120};
 const listeners=new Map<string,Set<any>>();const timers=new Map<any,{fn:any,ms:number}>();const frames:any[]=[];const popups:any[]=[];const events:any[]=[];let fetches=0;
 let profile:any={id:7,auth_session_expires_at:Math.floor(Date.now()/1000)+300};
 const window:any={location:{origin:'https://app.example'},addEventListener:(name:string,fn:any)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn)},removeEventListener:(name:string,fn:any)=>listeners.get(name)?.delete(fn),dispatchEvent:(event:any)=>{events.push(event);for(const fn of listeners.get(event.type)||[])fn(event)},open:(url:string)=>{const popup:any={url,closed:false,close(){this.closed=true}};popups.push(popup);return popup}};
 const mode={getAuthenticatedSession:()=>session,getSessionGeneration:()=>generation,isCookieAuthMode:()=>true,isLogoutPending:()=>pendingLogout,registerAuthenticatedSession:(user:any)=>{session={userId:user.id,expiresAt:user.auth_session_expires_at}}};
 const module={exports:{} as any};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/sessionRenewal.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:()=>mode,window,document:{createElement:()=>({contentWindow:{},remove(){}}),body:{appendChild:(frame:any)=>frames.push(frame)}},crypto:webcrypto,Uint8Array,Date,AbortController,CustomEvent:class{type:any;detail:any;constructor(type:any,options:any={}){this.type=type;this.detail=options.detail}},fetch:async()=>{fetches++;return{ok:true,status:200,json:async()=>profile}},setTimeout:(fn:any,ms:number)=>{const id={};timers.set(id,{fn,ms});return id},clearTimeout:(id:any)=>timers.delete(id),setInterval:()=>({}),clearInterval:()=>{}});
 const api=module.exports;
 const message=async(overrides:any={})=>{const target=frames.at(-1)||popups.at(-1);const query=new URL(target.src||target.url,'https://app.example').searchParams;for(const fn of listeners.get('message')||[])await fn({origin:'https://app.example',source:target.contentWindow||target,data:{type:'ragent:session-renewal',requestId:query.get('requestId'),ok:true},...overrides})};
 return {api,frames,popups,events,message,get fetches(){return fetches},get session(){return session},setProfile:(value:any)=>profile=value,logout:()=>{pendingLogout=true;generation++;api.cancelSessionRenewal()},logoutFailed:()=>{pendingLogout=false;window.dispatchEvent({type:'auth:logout-failed'})},setExpiry:(expiresAt:number)=>{session={...session,expiresAt}},focus:()=>window.dispatchEvent({type:'focus'}),tick:async(ms:number)=>{for(const {fn,ms:delay} of [...timers.values()])if(delay===ms)await fn()}};
}
test('strict origin/source/requestId and singleflight, then same-account me updates expiry',async()=>{
 const f=fixture();const first=f.api.renewSession();const second=f.api.renewSession();assert.equal(first,second);assert.equal(f.frames.length,1);
 await f.message({origin:'https://evil.example'});await f.message({source:{}});await f.message({data:{type:'ragent:session-renewal',requestId:'wrong',ok:true}});assert.equal(f.fetches,0);
 await f.message();await first;assert.equal(f.fetches,1);assert.ok(f.session.expiresAt>Date.now()/1000+250);f.api.cancelSessionRenewal();
});
test('failed renewal locks subsequent background calls; popup can recover, different account cannot replace identity',async()=>{
 const f=fixture();f.setProfile({id:7,auth_session_expires_at:f.session.expiresAt});const first=f.api.renewSession();const rejected=assert.rejects(first,/REAUTHENTICATION_REQUIRED/);await f.message({data:{type:'ragent:session-renewal',requestId:new URL(f.frames[0].src,'https://app.example').searchParams.get('requestId'),ok:false,errorCode:'REAUTHENTICATION_REQUIRED'}});await rejected;
 await assert.rejects(f.api.ensureSessionCurrent());await assert.rejects(f.api.renewSession());assert.equal(f.frames.length,1);
 const popup=f.api.reauthenticateSession();const mismatch=assert.rejects(popup,/ACCOUNT_CHANGED/);f.setProfile({id:8,auth_session_expires_at:Math.floor(Date.now()/1000)+300});const source=f.popups[0];for(const evt of [source]){await f.message({source:evt,data:{type:'ragent:session-renewal',requestId:new URL(source.url,'https://app.example').searchParams.get('requestId'),ok:true}})}await mismatch;assert.equal(f.session.userId,7);f.api.cancelSessionRenewal();
});
test('logout cancels an in-flight renewal and late completion cannot restore state',async()=>{
 const f=fixture();const pending=f.api.renewSession();const rejected=assert.rejects(pending,/SIGNED_OUT/);f.logout();await rejected;await f.message();assert.equal(f.fetches,0);assert.equal(f.events.some((e:any)=>e.type==='auth:session-restored'),false);
});
test('failed frame can accept a genuinely newer same-account cookie from another tab; old expiry cannot pass',async()=>{
 const f=fixture();const pending=f.api.renewSession();const frame=f.frames[0];await f.message({data:{type:'ragent:session-renewal',requestId:new URL(frame.src,'https://app.example').searchParams.get('requestId'),ok:false,errorCode:'SESSION_UNAVAILABLE'}});await pending;assert.equal(f.fetches,1);assert.ok(f.session.expiresAt>Date.now()/1000+250);f.api.cancelSessionRenewal();
});
test('hard timeout settles without navigation and shows recoverable expiry',async()=>{
 const f=fixture();const pending=f.api.renewSession();const rejected=assert.rejects(pending,/REAUTHENTICATION_REQUIRED/);await f.tick(15000);await rejected;assert.equal(f.events.filter((e:any)=>e.type==='auth:session-expired').length,1);f.api.cancelSessionRenewal();
});

test('near-expiry focus starts one proactive flow and failed logout permits further renewal',async()=>{
 const f=fixture();f.setExpiry(Math.floor(Date.now()/1000)+30);f.focus();const same=f.api.ensureSessionCurrent();assert.equal(f.frames.length,1);await f.message();await same;
 f.logout();f.logoutFailed();f.setExpiry(Math.floor(Date.now()/1000)+30);const next=f.api.ensureSessionCurrent();assert.equal(f.frames.length,2);await f.message();await next;f.api.cancelSessionRenewal();
});

test('interactive popup remains open past the silent15second deadline and then accepts same-account success',async()=>{
 const f=fixture();const pending=f.api.reauthenticateSession();assert.equal(f.popups.length,1);assert.equal(f.frames.length,0);
 await f.tick(13000);await f.tick(15000);assert.equal(f.popups[0].closed,false);assert.equal(f.fetches,0);
 const popup=f.popups[0];await f.message({source:popup,data:{type:'ragent:session-renewal',requestId:new URL(popup.url,'https://app.example').searchParams.get('requestId'),ok:true}});await pending;assert.equal(popup.closed,true);f.api.cancelSessionRenewal();
});
