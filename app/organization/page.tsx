"use client";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Plus, Building2, Users, Settings, Trash2, Edit, Network, Wallet } from "lucide-react";
import TenantRechargeDialog from "./components/TenantRechargeDialog";
import { useCreditAccounts } from "@/hooks/useBilling";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import axios from "@/lib/axios";
import DeptSelect from "@/components/DeptSelect";
import OrgChart from "@/components/OrgChart";
import { toast } from "sonner";

interface Tenant {
  id: number;
  name: string;
  code: string;
  status: string;
  max_users: number;
  created_at: string;
}

interface Dept {
  id: number;
  tenant_id: number;
  parent_id: number | null;
  name: string;
  code: string;
  level: number;
  path: string;
  status: string;
  created_at: string;
  parent_name?: string;
  children?: Dept[];
}

export default function OrganizationPage() {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  const { user, loading: userLoading } = useCurrentUser();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [rechargeTenant, setRechargeTenant] = useState<Tenant | null>(null);

  // 余额由后端从流水现算；前端只显示，不做任何加减 —— 两边各算一次，
  // 迟早有一次算得不一样，而不一样的那个数是钱。
  const { accounts, recharge } = useCreditAccounts();
  const balanceOf = (tenantId: number) =>
    accounts.find((a) => a.tenant_id === tenantId)?.balance ?? 0;
  const [depts, setDepts] = useState<Dept[]>([]);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showCreateDept, setShowCreateDept] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  // 表单状态
  const [tenantForm, setTenantForm] = useState({
    name: "",
    code: "",
    max_users: 100,
  });

  const [deptForm, setDeptForm] = useState({
    name: "",
    code: "",
    parent_id: null as number | null,
  });

  // 新增子部门状态
  const [showCreateSubDept, setShowCreateSubDept] = useState(false);
  const [parentDept, setParentDept] = useState<Dept | null>(null);
  const [subDeptForm, setSubDeptForm] = useState({
    name: "",
    code: "",
    parent_id: null as number | null,
  });

  // 编辑部门状态
  const [showEditDept, setShowEditDept] = useState(false);
  const [editingDept, setEditingDept] = useState<Dept | null>(null);
  const [editDeptForm, setEditDeptForm] = useState({
    name: "",
    code: "",
    parent_id: null as number | null,
    status: "active",
  });

  // 编辑租户状态
  const [showEditTenant, setShowEditTenant] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editTenantForm, setEditTenantForm] = useState({
    name: "",
    code: "",
    max_users: 100,
    status: "active",
  });

  // 组织架构图状态
  const [showOrgChart, setShowOrgChart] = useState(false);

  // 检查用户权限
  const isSuperAdmin = user?.isSuperAdmin || false;
  const isTenantAdmin = user?.isTenantAdmin || false;
  const canManageOrg = user?.canManageOrg || false;

  useEffect(() => {
    if (!user) return;

    // 只有有组织管理权限的用户才能访问
    if (!canManageOrg) {
      return;
    }

    fetchData();
  }, [user]);

  // 当选中租户变化时，重新获取部门信息
  useEffect(() => {
    if (selectedTenant) {
      fetchDepts(selectedTenant.id);
    }
  }, [selectedTenant]);

  const fetchDepts = async (tenantId: number) => {
    try {
      const deptRes = await axios.get(`/api/organization/depts?tenant_id=${tenantId}`);
      setDepts(deptRes.data.depts || []);
    } catch (error) {
      console.error(t("fetchDeptFailed"), error);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);

      // 获取租户信息
      if (isSuperAdmin) {
        const tenantRes = await axios.get("/api/organization/tenants");
        const tenantsList = tenantRes.data.tenants || [];
        setTenants(tenantsList);

        // 如果只有一个租户且没有选中租户，自动选择第一个
        if (tenantsList.length === 1 && !selectedTenant) {
          const firstTenant = tenantsList[0];
          setSelectedTenant(firstTenant);
          // 立即获取该租户的部门数据
          await fetchDepts(firstTenant.id);
        }
      } else if (isTenantAdmin && user?.tenant_id) {
        // 租户管理员只能看到自己的租户
        const tenantRes = await axios.get(`/api/organization/tenants/${user.tenant_id}`);
        const tenant = tenantRes.data.tenant;
        setTenants([tenant]);
        setSelectedTenant(tenant);
        // 立即获取该租户的部门数据
        await fetchDepts(tenant.id);
      }
    } catch (error) {
      console.error(t("fetchOrgFailed"), error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async () => {
    try {
      await axios.post("/api/organization/tenants", tenantForm);
      setShowCreateTenant(false);
      setTenantForm({ name: "", code: "", max_users: 100 });
      // 重新获取租户列表
      fetchData();
    } catch (error) {
      console.error(t("createTenantFailed"), error);
    }
  };

  const handleCreateDept = async () => {
    if (!selectedTenant) return;

    try {
      await axios.post("/api/organization/depts", {
        ...deptForm,
        tenant_id: selectedTenant.id,
      });
      setShowCreateDept(false);
      setDeptForm({ name: "", code: "", parent_id: null });
      // 重新获取部门列表
      fetchDepts(selectedTenant.id);
    } catch (error) {
      console.error(t("createDeptFailed"), error);
    }
  };

  const handleCreateSubDept = (dept: Dept) => {
    setParentDept(dept);
    setSubDeptForm({
      name: "",
      code: "",
      parent_id: dept.id,
    });
    setShowCreateSubDept(true);
  };

  const handleSubmitSubDept = async () => {
    if (!selectedTenant || !parentDept) return;

    try {
      await axios.post("/api/organization/depts", {
        ...subDeptForm,
        tenant_id: selectedTenant.id,
      });
      setShowCreateSubDept(false);
      setParentDept(null);
      setSubDeptForm({ name: "", code: "", parent_id: null });
      // 重新获取部门列表
      fetchDepts(selectedTenant.id);
    } catch (error) {
      console.error(t("createSubDeptFailed"), error);
    }
  };

  const handleTenantSelect = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    // 不需要手动调用 fetchData，useEffect 会监听 selectedTenant 变化
  };

  const handleEditTenant = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setEditTenantForm({
      name: tenant.name,
      code: tenant.code,
      max_users: tenant.max_users,
      status: tenant.status,
    });
    setShowEditTenant(true);
  };

  const handleUpdateTenant = async () => {
    if (!editingTenant) return;

    try {
      await axios.put("/api/organization/tenants", {
        id: editingTenant.id,
        ...editTenantForm,
      });
      setShowEditTenant(false);
      setEditingTenant(null);
      setEditTenantForm({ name: "", code: "", max_users: 100, status: "active" });
      // 重新获取租户列表
      fetchData();
    } catch (error) {
      console.error(t("updateTenantFailed"), error);
    }
  };

  const handleDeleteTenant = async (tenant: Tenant) => {
    if (!confirm(t("deleteTenantConfirm", { name: tenant.name }).replace(/\\n/g, "\n"))) {
      return;
    }

    try {
      await axios.delete(`/api/organization/tenants/${tenant.id}`);
      toast.success(t("tenantDeleteSuccess"));
      // 如果删除的是当前选中的租户，清除选中状态
      if (selectedTenant?.id === tenant.id) {
        setSelectedTenant(null);
        setDepts([]);
      }
      // 重新获取租户列表
      fetchData();
    } catch (error: any) {
      console.error(t("tenantDeleteFailed"), error);
      // 显式显示错误消息，确保用户能看到
      const errorMessage =
        error?.response?.data?.error || error?.message || t("tenantDeleteFailed");
      toast.error(errorMessage);
    }
  };

  const handleEditDept = (dept: Dept) => {
    setEditingDept(dept);
    setEditDeptForm({
      name: dept.name,
      code: dept.code,
      parent_id: dept.parent_id,
      status: dept.status,
    });
    setShowEditDept(true);
  };

  const handleUpdateDept = async () => {
    if (!editingDept) return;

    try {
      await axios.put("/api/organization/depts", {
        id: editingDept.id,
        ...editDeptForm,
      });
      setShowEditDept(false);
      setEditingDept(null);
      setEditDeptForm({ name: "", code: "", parent_id: null, status: "active" });
      // 重新获取部门列表
      if (selectedTenant) {
        fetchDepts(selectedTenant.id);
      }
    } catch (error) {
      console.error(t("updateDeptFailed"), error);
    }
  };

  const handleDeleteDept = async (deptId: number) => {
    if (!confirm(t("deleteDeptConfirm"))) {
      return;
    }

    try {
      await axios.delete(`/api/organization/depts?id=${deptId}`);
      // 重新获取部门列表
      if (selectedTenant) {
        fetchDepts(selectedTenant.id);
      }
    } catch (error) {
      console.error(t("deleteDeptFailed"), error);
    }
  };

  // 构建部门树状结构
  const buildDeptTree = (depts: Dept[]) => {
    const deptMap = new Map();
    const rootDepts: Dept[] = [];

    depts.forEach((dept) => {
      deptMap.set(dept.id, { ...dept, children: [] });
    });

    depts.forEach((dept) => {
      if (dept.parent_id) {
        const parent = deptMap.get(dept.parent_id);
        if (parent) {
          parent.children.push(deptMap.get(dept.id));
        }
      } else {
        rootDepts.push(deptMap.get(dept.id));
      }
    });

    return rootDepts;
  };

  const renderDeptTree = (depts: Dept[], level = 0) => {
    return depts.map((dept) => (
      <div key={dept.id} style={{ marginLeft: level * 20 }}>
        <div className="flex items-center justify-between p-2 border rounded mb-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span>{dept.name}</span>
            <Badge variant="outline">{dept.code}</Badge>
            {dept.status === "active" ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                {t("active")}
              </Badge>
            ) : (
              <Badge className="bg-muted text-muted-foreground">{t("inactive")}</Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => handleCreateSubDept(dept)}>
              <Plus className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleEditDept(dept)}>
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => handleDeleteDept(dept.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        {dept.children && dept.children.length > 0 && renderDeptTree(dept.children, level + 1)}
      </div>
    ));
  };

  // 权限检查
  if (!user) {
    return <div className="text-center text-destructive text-xl mt-20">{t("pleaseLogin")}</div>;
  }

  if (!canManageOrg) {
    return <div className="text-center text-destructive text-xl mt-20">{t("noPermission")}</div>;
  }

  if (loading) {
    return <div className="text-center text-muted-foreground text-xl mt-20">{tc("loading")}</div>;
  }

  return (
    <div className="space-y-6">
      {/* 编辑部门对话框 */}
      <Sheet open={showEditDept} onOpenChange={setShowEditDept}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("editDept")}</SheetTitle>
            <SheetDescription>{t("modifyDeptInfo")}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label htmlFor="edit-dept-name">{t("deptName")}</Label>
              <Input
                id="edit-dept-name"
                value={editDeptForm.name}
                onChange={(e) => setEditDeptForm({ ...editDeptForm, name: e.target.value })}
                placeholder={t("deptNamePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="edit-dept-code">{t("deptCode")}</Label>
              <Input
                id="edit-dept-code"
                value={editDeptForm.code}
                onChange={(e) => setEditDeptForm({ ...editDeptForm, code: e.target.value })}
                placeholder={t("deptCodePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="edit-dept-parent">{t("parentDept")}</Label>
              <DeptSelect
                depts={depts}
                value={editDeptForm.parent_id}
                onChange={(parentId) => setEditDeptForm({ ...editDeptForm, parent_id: parentId })}
                placeholder={t("noParentTopLevel")}
                excludeDeptId={editingDept?.id}
              />
            </div>
            <div>
              <Label htmlFor="edit-dept-status">{t("status")}</Label>
              <select
                id="edit-dept-status"
                className="w-full p-2 border rounded"
                value={editDeptForm.status}
                onChange={(e) => setEditDeptForm({ ...editDeptForm, status: e.target.value })}
              >
                <option value="active">{t("active")}</option>
                <option value="inactive">{t("inactive")}</option>
              </select>
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowEditDept(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleUpdateDept}>{tc("update")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 编辑租户对话框 */}
      <Sheet open={showEditTenant} onOpenChange={setShowEditTenant}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("editTenant")}</SheetTitle>
            <SheetDescription>{t("modifyTenantInfo")}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label htmlFor="edit-tenant-name">{t("tenantName")}</Label>
              <Input
                id="edit-tenant-name"
                value={editTenantForm.name}
                onChange={(e) => setEditTenantForm({ ...editTenantForm, name: e.target.value })}
                placeholder={t("tenantNamePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="edit-tenant-code">{t("tenantCode")}</Label>
              <Input
                id="edit-tenant-code"
                value={editTenantForm.code}
                onChange={(e) => setEditTenantForm({ ...editTenantForm, code: e.target.value })}
                placeholder={t("tenantCodePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="edit-tenant-max-users">{t("maxUsers")}</Label>
              <Input
                id="edit-tenant-max-users"
                type="number"
                value={editTenantForm.max_users}
                onChange={(e) =>
                  setEditTenantForm({ ...editTenantForm, max_users: parseInt(e.target.value) })
                }
              />
            </div>
            <div>
              <Label htmlFor="edit-tenant-status">{t("status")}</Label>
              <select
                id="edit-tenant-status"
                className="w-full p-2 border rounded"
                value={editTenantForm.status}
                onChange={(e) => setEditTenantForm({ ...editTenantForm, status: e.target.value })}
              >
                <option value="active">{t("active")}</option>
                <option value="inactive">{t("inactive")}</option>
              </select>
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowEditTenant(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleUpdateTenant}>{tc("update")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 新增子部门对话框 */}
      <Sheet open={showCreateSubDept} onOpenChange={setShowCreateSubDept}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("createSubDept")}</SheetTitle>
            <SheetDescription>
              {t("createSubDeptDesc", { name: parentDept?.name || "" })}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label htmlFor="sub-dept-name">{t("deptName")}</Label>
              <Input
                id="sub-dept-name"
                value={subDeptForm.name}
                onChange={(e) => setSubDeptForm({ ...subDeptForm, name: e.target.value })}
                placeholder={t("deptNamePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="sub-dept-code">{t("deptCode")}</Label>
              <Input
                id="sub-dept-code"
                value={subDeptForm.code}
                onChange={(e) => setSubDeptForm({ ...subDeptForm, code: e.target.value })}
                placeholder={t("deptCodePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="sub-dept-parent">{t("parentDept")}</Label>
              <DeptSelect
                depts={depts}
                value={subDeptForm.parent_id}
                onChange={(parentId) => setSubDeptForm({ ...subDeptForm, parent_id: parentId })}
                placeholder={parentDept?.name || t("selectParentDept")}
                excludeDeptId={parentDept?.id}
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowCreateSubDept(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSubmitSubDept}>{tc("create")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 租户列表（仅超管可见） */}
      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("tenants")}</CardTitle>
                <CardDescription>{t("manageTenants")}</CardDescription>
              </div>
              <Sheet open={showCreateTenant} onOpenChange={setShowCreateTenant}>
                <SheetTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("createTenant")}
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>{t("createTenantTitle")}</SheetTitle>
                    <SheetDescription>{t("createTenantDesc")}</SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4 mt-6">
                    <div>
                      <Label htmlFor="tenant-name">{t("tenantName")}</Label>
                      <Input
                        id="tenant-name"
                        value={tenantForm.name}
                        onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                        placeholder={t("tenantNamePlaceholder")}
                      />
                    </div>
                    <div>
                      <Label htmlFor="tenant-code">{t("tenantCode")}</Label>
                      <Input
                        id="tenant-code"
                        value={tenantForm.code}
                        onChange={(e) => setTenantForm({ ...tenantForm, code: e.target.value })}
                        placeholder={t("tenantCodePlaceholder")}
                      />
                    </div>
                    <div>
                      <Label htmlFor="tenant-max-users">{t("maxUsers")}</Label>
                      <Input
                        id="tenant-max-users"
                        type="number"
                        value={tenantForm.max_users}
                        onChange={(e) =>
                          setTenantForm({ ...tenantForm, max_users: parseInt(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <SheetFooter className="mt-6">
                    <Button variant="outline" onClick={() => setShowCreateTenant(false)}>
                      {tc("cancel")}
                    </Button>
                    <Button onClick={handleCreateTenant}>{tc("create")}</Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {tenants.map((tenant) => (
                <div
                  key={tenant.id}
                  className={`flex items-center justify-between p-4 border rounded ${
                    selectedTenant?.id === tenant.id ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer flex-1"
                    onClick={() => handleTenantSelect(tenant)}
                  >
                    <Building2 className="h-5 w-5" />
                    <div>
                      <h3 className="font-medium">{tenant.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t("codeLabel", { code: tenant.code })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {t("maxUsersLabel", { count: tenant.max_users })}
                    </Badge>
                    {tenant.status === "active" ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {t("active")}
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground">{t("inactive")}</Badge>
                    )}
                    <Badge variant="secondary" title={t("balanceTooltip")}>
                      {t("balanceLabel", { balance: balanceOf(tenant.id) })}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRechargeTenant(tenant);
                      }}
                    >
                      <Wallet className="mr-1 h-3 w-3" />
                      {t("recharge")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditTenant(tenant);
                      }}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTenant(tenant);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 部门管理 */}
      {(selectedTenant ||
        (isTenantAdmin && user?.tenant_id) ||
        (isSuperAdmin && tenants.length > 0)) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("departments")}</CardTitle>
                <CardDescription>
                  {selectedTenant
                    ? t("deptStructure", { name: selectedTenant.name })
                    : isSuperAdmin && tenants.length === 1
                      ? t("deptStructure", { name: tenants[0].name })
                      : t("currentTenantStructure")}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {selectedTenant && (
                  <Sheet open={showCreateDept} onOpenChange={setShowCreateDept}>
                    <SheetTrigger asChild>
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        {t("createDept")}
                      </Button>
                    </SheetTrigger>
                    <SheetContent>
                      <SheetHeader>
                        <SheetTitle>{t("createDeptTitle")}</SheetTitle>
                        <SheetDescription>
                          {t("createDeptDesc", { name: selectedTenant.name })}
                        </SheetDescription>
                      </SheetHeader>
                      <div className="space-y-4 mt-6">
                        <div>
                          <Label htmlFor="dept-name">{t("deptName")}</Label>
                          <Input
                            id="dept-name"
                            value={deptForm.name}
                            onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                            placeholder={t("deptNamePlaceholder")}
                          />
                        </div>
                        <div>
                          <Label htmlFor="dept-code">{t("deptCode")}</Label>
                          <Input
                            id="dept-code"
                            value={deptForm.code}
                            onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                            placeholder={t("deptCodePlaceholder")}
                          />
                        </div>
                        <div>
                          <Label htmlFor="dept-parent">{t("parentDept")}</Label>
                          <DeptSelect
                            depts={depts}
                            value={deptForm.parent_id}
                            onChange={(parentId) =>
                              setDeptForm({ ...deptForm, parent_id: parentId })
                            }
                            placeholder={t("noParentTopLevel")}
                          />
                        </div>
                      </div>
                      <SheetFooter className="mt-6">
                        <Button variant="outline" onClick={() => setShowCreateDept(false)}>
                          {tc("cancel")}
                        </Button>
                        <Button onClick={handleCreateDept}>{tc("create")}</Button>
                      </SheetFooter>
                    </SheetContent>
                  </Sheet>
                )}
                {selectedTenant && (
                  <Button variant="outline" onClick={() => setShowOrgChart(true)}>
                    <Network className="mr-2 h-4 w-4" />
                    {t("orgChart")}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {depts.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
                <p>{t("noDeptYet")}</p>
              </div>
            ) : (
              <div className="space-y-2">{renderDeptTree(buildDeptTree(depts))}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 组织架构图 */}
      {showOrgChart && selectedTenant && (
        <OrgChart depts={depts} tenant={selectedTenant} onClose={() => setShowOrgChart(false)} />
      )}

      {/* 充值（仅超管；按钮本就只在超管区块里，后端另有 403 兜底） */}
      <TenantRechargeDialog
        open={rechargeTenant !== null}
        onOpenChange={(o) => !o && setRechargeTenant(null)}
        tenant={rechargeTenant}
        balance={rechargeTenant ? balanceOf(rechargeTenant.id) : null}
        onRecharge={recharge}
      />
    </div>
  );
}
