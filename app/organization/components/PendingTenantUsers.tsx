"use client";
import { useEffect,useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card,CardHeader,CardTitle,CardContent } from "@/components/ui/card";
import { Dialog,DialogContent,DialogHeader,DialogTitle } from "@/components/ui/dialog";

type PendingUser={id:number;username:string;nickname?:string;created_at:string};
type Tenant={id:number;name:string;code:string;status:string};
export default function PendingTenantUsers({tenants}:{tenants:Tenant[]}) {
 const t=useTranslations("organization");
 const [users,setUsers]=useState<PendingUser[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [selected,setSelected]=useState<PendingUser|null>(null),[search,setSearch]=useState("");
 const load=async()=>{setLoading(true);setError(false);try{const {data}=await axios.get("/api/organization/pending-users",{params:{page}});setUsers(data.users);setTotal(data.total);}catch{setUsers([]);setError(true);}finally{setLoading(false);}};
 useEffect(()=>{void load();},[page]);
 const assign=async(tenant:Tenant)=>{if(!selected||busy)return;setBusy(true);try{
   await axios.post("/api/organization/pending-users",{user_id:selected.id,tenant_id:tenant.id});
   setSelected(null);toast.success(t("pendingAssigned"));await load();
   window.dispatchEvent(new Event("pending-tenant-users-changed"));
 }catch{toast.error(t("pendingAssignFailed"));}finally{setBusy(false);}};
 return <Card id="pending-users"><CardHeader><CardTitle>{t("pendingUsersTitle")} ({total})</CardTitle></CardHeader><CardContent>
   {loading?<p role="status">{t("pendingLoading")}</p>:error?<Button onClick={()=>void load()}>{t("pendingRetry")}</Button>:users.length===0?<p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>:
   <div className="divide-y">{users.map(user=><div key={user.id} className="flex items-center justify-between gap-4 py-3">
    <div><p className="font-medium">{user.nickname||user.username}</p><p className="text-xs text-muted-foreground">{user.username}</p></div>
    <Button size="sm" onClick={()=>{setSearch("");setSelected(user);}}>{t("pendingAssign")}</Button>
   </div>)}</div>}
   {total>50&&<div className="flex justify-end gap-2 pt-4"><Button disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>{t("pendingPrevious")}</Button><Button disabled={page*50>=total||loading} onClick={()=>setPage(p=>p+1)}>{t("pendingNext")}</Button></div>}
   <Dialog open={!!selected} onOpenChange={open=>{if(!open&&!busy)setSelected(null);}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t("pendingChooseTenant")}</DialogTitle></DialogHeader>
    <Input aria-label={t("pendingSearchTenant")} placeholder={t("pendingSearchTenant")} value={search} onChange={e=>setSearch(e.target.value)} />
    <div className="max-h-80 overflow-auto space-y-2">{tenants.filter(x=>x.status==="active"&&`${x.name} ${x.code}`.toLowerCase().includes(search.toLowerCase())).map(tenant=><Button key={tenant.id} variant="outline" className="w-full justify-between" disabled={busy} onClick={()=>void assign(tenant)}><span>{tenant.name}</span><span className="text-muted-foreground">{tenant.code}</span></Button>)}</div>
   </DialogContent></Dialog>
 </CardContent></Card>;
}
