"use client";
import { useEffect, useState, useCallback } from "react";
import { useDebounce } from "use-debounce";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Edit, Trash2, Building2, Users, UserX, MessageCircle, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import axios from "@/lib/axios";
import DeptSelect from "@/components/DeptSelect";

interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  tenant_id?: number;
  dept_id?: number;
  status: string;
  created_at: string;
  tenant_name?: string;
  dept_name?: string;
  roles?: string[];
  wechat_id?: string;
}

interface Tenant {
  id: number;
  name: string;
}

interface Dept {
  id: number;
  name: string;
  tenant_id: number;
  tenant_name?: string;
  parent_id?: number | null;
  children?: Dept[];
}

interface WechatAgent {
  agentid: number;
  name: string;
  square_logo_url: string;
  description: string;
}

// 创建空用户对象，根据当前用户权限设置默认值
const createEmptyUser = (currentUser: any, normalUserLabel: string) => {
  const baseUser = {
    id: 0,
    username: "",
    nickname: "",
    email: "",
    role: normalUserLabel,
    password: "",
    tenant_id: null,
    dept_id: null,
    status: "active",
  };

  // 如果是租户管理员，自动设置租户ID
  if (currentUser?.isTenantAdmin) {
    baseUser.tenant_id = currentUser.tenant_id;
  }

  return baseUser;
};

export default function UserPage() {
  const t = useTranslations("user");
  const tc = useTranslations("common");
  const { user, loading: userLoading } = useCurrentUser();
  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(() => createEmptyUser(user, t("normalUser")));
  const [error, setError] = useState("");
  const [showWechatDialog, setShowWechatDialog] = useState(false);
  const [wechatForm, setWechatForm] = useState({ content: "", agentid: "" });
  const [wechatUser, setWechatUser] = useState<User | null>(null);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [wechatAgents, setWechatAgents] = useState<WechatAgent[]>([]);
  const [loadingWechatAgents, setLoadingWechatAgents] = useState(false);
  const [filterTenantId, setFilterTenantId] = useState<number | null>(null);
  const [filterDeptId, setFilterDeptId] = useState<number | null>(null);
  const [searchUsername, setSearchUsername] = useState<string>("");
  const [debouncedSearchUsername] = useDebounce(searchUsername, 500);

  // 检查用户权限
  const isSuperAdmin = user?.isSuperAdmin || false;
  const isTenantAdmin = user?.isTenantAdmin || false;
  const isDeptAdmin = user?.isDeptAdmin || false;
  const canManageUsers = isSuperAdmin || isTenantAdmin || isDeptAdmin;

  // 只有超级管理员可以删除用户
  const canDeleteUsers = isSuperAdmin;

  // 超级管理员可以编辑所有字段，其他管理员可以编辑部分字段（如身份）
  const canEditUserDetails = isSuperAdmin || isTenantAdmin || isDeptAdmin;

  // 检查当前用户是否可以修改目标用户的身份
  const canModifyUserRole = (targetUser: User, newRole: string) => {
    if (isSuperAdmin) return true; // 超级管理员可以修改任何用户的身份

    // 当前用户的角色名称数组
    const currentUserRoleNames =
      user?.roles?.map((role: any) => (typeof role === "string" ? role : role.name)) || [];
    const targetUserRoles = targetUser.roles || [];

    // 如果是修改自己的身份
    if (targetUser.id === user?.id) {
      // 部门管理员不能修改自己的身份
      if (currentUserRoleNames.includes(t("deptAdmin"))) {
        return false;
      }
      // 租户管理员可以修改自己的身份
      if (currentUserRoleNames.includes(t("tenantAdmin"))) {
        const isNewRoleValid = newRole === t("tenantAdmin") || newRole === t("deptAdmin");
        return isNewRoleValid;
      }
      return false;
    }

    // 部门管理员只能修改普通用户为部门管理员
    if (currentUserRoleNames.includes(t("deptAdmin"))) {
      const isTargetNormalUser = targetUserRoles.includes(t("normalUser"));
      const isNewRoleDeptAdmin = newRole === t("deptAdmin");
      return isTargetNormalUser && isNewRoleDeptAdmin;
    }

    // 租户管理员可以修改部门管理员或普通用户为租户管理员或部门管理员
    if (currentUserRoleNames.includes(t("tenantAdmin"))) {
      const isTargetLowerRole =
        targetUserRoles.includes(t("deptAdmin")) || targetUserRoles.includes(t("normalUser"));
      const isNewRoleValid = newRole === t("tenantAdmin") || newRole === t("deptAdmin");
      return isTargetLowerRole && isNewRoleValid;
    }

    return false;
  };

  // 获取当前用户可以分配给其他用户的角色选项
  const getAvailableRoles = (targetUser: User) => {
    if (isSuperAdmin) {
      return [t("normalUser"), t("deptAdmin"), t("tenantAdmin"), t("superAdmin")];
    }

    // 当前用户的角色名称数组
    const currentUserRoleNames =
      user?.roles?.map((role: any) => (typeof role === "string" ? role : role.name)) || [];

    // 目标用户的角色名称数组
    const targetUserRoleNames = targetUser.roles || [];

    // 部门管理员不能修改自己的身份
    if (targetUser.id === user?.id && currentUserRoleNames.includes(t("deptAdmin"))) {
      return [];
    }

    // 租户管理员可以修改自己的身份
    if (targetUser.id === user?.id && currentUserRoleNames.includes(t("tenantAdmin"))) {
      return [t("tenantAdmin"), t("deptAdmin")];
    }

    // 部门管理员只能将普通用户提升为部门管理员
    if (currentUserRoleNames.includes(t("deptAdmin"))) {
      if (targetUserRoleNames.includes(t("normalUser"))) {
        return [t("deptAdmin")];
      }
      return [];
    }

    // 租户管理员可以修改部门管理员或普通用户
    if (currentUserRoleNames.includes(t("tenantAdmin"))) {
      if (
        targetUserRoleNames.includes(t("deptAdmin")) ||
        targetUserRoleNames.includes(t("normalUser"))
      ) {
        return [t("deptAdmin"), t("tenantAdmin")];
      }
      return [];
    }

    return [];
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTenantId !== null) {
        params.append("tenant_id", filterTenantId.toString());
      }
      if (filterDeptId !== null) {
        params.append("dept_id", filterDeptId.toString());
      }
      if (debouncedSearchUsername.trim()) {
        params.append("username", debouncedSearchUsername.trim());
      }
      const url = params.toString() ? `/api/user/list?${params.toString()}` : "/api/user/list";
      const res = await axios.get(url);
      setUsers(res.data.users || []);
    } catch (error) {
      console.error("获取用户列表失败:", error);
    } finally {
      setLoading(false);
    }
  }, [filterTenantId, filterDeptId, debouncedSearchUsername]);

  const fetchTenants = useCallback(async () => {
    try {
      const res = await axios.get("/api/organization/tenants");
      console.log("租户数据:", res.data);
      setTenants(res.data.tenants || []);
    } catch (error) {
      console.error("获取租户列表失败:", error);
    }
  }, []);

  const fetchDepts = useCallback(async () => {
    try {
      let url = "/api/organization/depts";

      // 根据用户权限决定获取哪些部门
      if (user?.isSuperAdmin) {
        // 超级管理员可以获取所有部门
        url = "/api/organization/depts";
      } else if (user?.isTenantAdmin && user?.tenant_id) {
        // 租户管理员只能获取自己租户的部门
        url = `/api/organization/depts?tenant_id=${user.tenant_id}`;
      } else if (user?.isDeptAdmin && user?.tenant_id) {
        // 部门管理员可以获取自己管理的部门（包括子部门）
        url = `/api/organization/depts?tenant_id=${user.tenant_id}`;
      }

      const res = await axios.get(url);
      console.log("部门数据:", res.data);
      setDepts(res.data.depts || []);
    } catch (error) {
      console.error("获取部门列表失败:", error);
    }
  }, [user?.isSuperAdmin, user?.isTenantAdmin, user?.isDeptAdmin, user?.tenant_id]);

  useEffect(() => {
    if (user) {
      fetchUsers();

      // 根据用户权限获取相应的数据
      if (user.isSuperAdmin) {
        fetchTenants();
        fetchDepts();
      } else if (user.isTenantAdmin || user.isDeptAdmin) {
        // 租户管理员和部门管理员也需要获取部门数据
        fetchDepts();
      }
    }
  }, [user, fetchUsers, fetchTenants, fetchDepts]);

  const handleOpenAdd = () => {
    setForm(createEmptyUser(user, t("normalUser")));
    setEditing(false);
    setShowDialog(true);
    setError("");
  };

  const handleOpenEdit = (user: User) => {
    setForm({ ...user, role: user.roles?.[0] || t("normalUser"), password: "" });
    setEditing(true);
    setShowDialog(true);
    setError("");
  };

  const loadWechatAgents = async () => {
    try {
      setLoadingWechatAgents(true);
      const response = await axios.get("/api/v1/wechat/agents");
      const agents = response.data.agents || [];
      setWechatAgents(agents);
    } catch (error) {
      console.error("加载微信应用失败:", error);
    } finally {
      setLoadingWechatAgents(false);
    }
  };

  const handleOpenWechatDialog = (user: User) => {
    setWechatUser(user);
    setWechatForm({ content: "", agentid: "" });
    setShowWechatDialog(true);
    loadWechatAgents();
  };

  const handleSendWechatMessage = async () => {
    if (!wechatUser?.wechat_id || !wechatForm.content.trim()) {
      setError(t("enterMessageContent"));
      return;
    }

    if (!wechatForm.agentid) {
      setError(t("pleaseSelectApp"));
      return;
    }

    setWechatLoading(true);
    try {
      await axios.post("/api/wechat/send", {
        touser: wechatUser.wechat_id,
        msgtype: "text",
        agentid: wechatForm.agentid,
        text: {
          content: wechatForm.content,
        },
      });

      setShowWechatDialog(false);
      setWechatForm({ content: "", agentid: "" });
      setWechatUser(null);
      // 可以添加成功提示
    } catch (error: any) {
      console.error("发送微信消息失败:", error);
      setError(error.response?.data?.message || t("sendFailed"));
    } finally {
      setWechatLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    setLoading(true);
    try {
      await axios.delete("/api/user/delete", {
        data: { id },
      });
      fetchUsers();
    } catch (error) {
      console.error("删除用户失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setLoading(true);

    try {
      let payload: any;

      if (!editing) {
        // 新增用户：所有管理员都可以创建用户，显示完整表单
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!form.username || !form.email || !form.role || !form.password) {
          setError(t("requiredFields"));
          return;
        }
        if (!emailRegex.test(form.email)) {
          setError(t("invalidEmail"));
          return;
        }

        payload = { ...form };
      } else {
        // 编辑用户：根据权限限制
        if (isSuperAdmin) {
          // 超级管理员可以编辑所有字段
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!form.username || !form.email || !form.role) {
            setError(t("requiredFields"));
            return;
          }
          if (!emailRegex.test(form.email)) {
            setError(t("invalidEmail"));
            return;
          }

          payload = { ...form };
          if (!payload.password) {
            delete payload.password;
          }
        } else if (isTenantAdmin || isDeptAdmin) {
          // 租户管理员和部门管理员可以编辑部分字段（昵称、邮箱、身份、状态）
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!form.email || !form.role) {
            setError(t("requiredFields"));
            return;
          }
          if (!emailRegex.test(form.email)) {
            setError(t("invalidEmail"));
            return;
          }

          // 检查身份修改权限
          const currentUser = users.find((u) => u.id === form.id);
          if (currentUser && !canModifyUserRole(currentUser, form.role)) {
            setError(t("cannotModifyRole"));
            return;
          }

          // 管理员不能修改用户名，只能修改其他字段
          payload = {
            id: form.id,
            nickname: form.nickname,
            email: form.email,
            role: form.role,
            status: form.status,
            ...(form.password && { password: form.password }),
            // 租户管理员可以修改部门信息
            ...(user?.isTenantAdmin && { dept_id: form.dept_id }),
          };
        } else {
          // 普通用户只能修改自己的状态
          payload = {
            id: form.id,
            status: form.status,
          };
        }
      }

      if (editing) {
        await axios.put("/api/user/update", payload);
      } else {
        await axios.post("/api/user/create", payload);
      }

      setShowDialog(false);
      fetchUsers();
    } catch (error: any) {
      if (error.response?.status === 409) {
        setError(t("usernameOrEmailExists"));
      } else {
        setError(tc("operationFailed"));
      }
      console.error("用户操作失败:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return !canManageUsers ? (
    <div className="text-center text-red-500 text-xl mt-20">{t("noPermission")}</div>
  ) : (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("userList")}</CardTitle>
            <Button onClick={handleOpenAdd}>
              <Plus className="mr-2 h-4 w-4" />
              {t("addUser")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* 防止浏览器自动填充的假输入框 */}
          <input
            type="text"
            name="prevent_autofill_username"
            autoComplete="off"
            style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <input
            type="password"
            name="prevent_autofill_password"
            autoComplete="off"
            style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
            tabIndex={-1}
            aria-hidden="true"
          />
          {/* 筛选器 */}
          <div className="flex items-center gap-4 mb-4 pb-4 border-b">
            <div className="flex items-center gap-2">
              <label htmlFor="username-search" className="text-sm font-medium">
                {t("username")}:
              </label>
              <Input
                id="username-search"
                placeholder={t("searchUsername")}
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                className="w-[200px]"
                autoComplete="off"
              />
            </div>
            {isSuperAdmin && (
              <div className="flex items-center gap-2">
                <label htmlFor="filter-tenant" className="text-sm font-medium">
                  {t("tenant")}:
                </label>
                <Select
                  value={filterTenantId?.toString() || "all"}
                  onValueChange={(value) => {
                    if (value === "all") {
                      setFilterTenantId(null);
                    } else {
                      setFilterTenantId(parseInt(value, 10));
                    }
                    setFilterDeptId(null); // 切换租户时清空部门筛选
                  }}
                >
                  <SelectTrigger id="filter-tenant" className="w-[200px]">
                    <SelectValue placeholder={t("allTenants")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allTenants")}</SelectItem>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id.toString()}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="filter-dept" className="text-sm font-medium">
                {t("dept")}:
              </label>
              <Select
                value={filterDeptId?.toString() || "all"}
                onValueChange={(value) => {
                  if (value === "all") {
                    setFilterDeptId(null);
                  } else {
                    setFilterDeptId(parseInt(value, 10));
                  }
                }}
                disabled={isSuperAdmin && filterTenantId === null}
              >
                <SelectTrigger id="filter-dept" className="w-[200px]">
                  <SelectValue placeholder={t("allDepts")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allDepts")}</SelectItem>
                  {(() => {
                    let availableDepts = depts;
                    if (isSuperAdmin && filterTenantId !== null) {
                      // 超级管理员选择租户后，只显示该租户的部门
                      availableDepts = depts.filter((dept) => dept.tenant_id === filterTenantId);
                    } else if (isTenantAdmin) {
                      // 租户管理员只显示自己租户的部门
                      availableDepts = depts.filter((dept) => dept.tenant_id === user?.tenant_id);
                    } else if (isDeptAdmin) {
                      // 部门管理员只显示自己租户的部门
                      availableDepts = depts.filter((dept) => dept.tenant_id === user?.tenant_id);
                    }
                    return availableDepts.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id.toString()}>
                        {dept.name}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
            {(filterTenantId !== null ||
              filterDeptId !== null ||
              debouncedSearchUsername.trim()) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilterTenantId(null);
                  setFilterDeptId(null);
                  setSearchUsername("");
                }}
              >
                {t("clearFilter")}
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ID")}</TableHead>
                <TableHead>{t("username")}</TableHead>
                <TableHead>{t("nickname")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                {isSuperAdmin && <TableHead>{t("tenant")}</TableHead>}
                <TableHead>{t("dept")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isSuperAdmin ? 8 : 7}
                    className="text-center text-muted-foreground"
                  >
                    {t("noUsers")}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.id}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={user.status === "inactive" ? "text-gray-400" : ""}>
                          {user.username}
                        </span>
                        {user.status === "inactive" && <UserX className="h-4 w-4 text-gray-400" />}
                      </div>
                    </TableCell>
                    <TableCell className={user.status === "inactive" ? "text-gray-400" : ""}>
                      {user.nickname}
                    </TableCell>
                    <TableCell className={user.status === "inactive" ? "text-gray-400" : ""}>
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={user.roles?.[0] === t("superAdmin") ? "default" : "outline"}
                        >
                          {user.roles?.[0] || t("normalUser")}
                        </Badge>
                      </div>
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        {user.tenant_name ? (
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            <span
                              className={`text-sm ${user.status === "inactive" ? "text-gray-400" : ""}`}
                            >
                              {user.tenant_name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("none")}</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {user.dept_name ? (
                        <div className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          <span
                            className={`text-sm ${user.status === "inactive" ? "text-gray-400" : ""}`}
                          >
                            {user.dept_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t("none")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canEditUserDetails ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenEdit(user)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {isSuperAdmin && user.wechat_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenWechatDialog(user)}
                                title={t("sendWechatMessage")}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {canDeleteUsers && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDelete(user.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        ) : // 普通用户只能看到自己，可以修改自己的状态
                        user.id === user?.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenEdit(user)}
                            >
                              {t("modifyStatus")}
                            </Button>
                            {isSuperAdmin && user.wechat_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenWechatDialog(user)}
                                title={t("sendWechatMessage")}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog.Root open={showDialog} onOpenChange={setShowDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-6 shadow-lg">
            <Dialog.Title className="text-lg font-bold mb-4">
              {editing ? t("editUser") : t("addUser")}
            </Dialog.Title>
            {/* 防止浏览器自动填充的假输入框 */}
            <input
              type="text"
              name="fake_username_field"
              autoComplete="off"
              style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              type="password"
              name="fake_password_field"
              autoComplete="off"
              style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
              tabIndex={-1}
              aria-hidden="true"
            />
            <div className="space-y-4">
              {!editing ? (
                // 新增用户：显示完整表单
                <>
                  <div className="space-y-2">
                    <label htmlFor="new-username" className="block text-sm font-medium">
                      {t("username")} *
                    </label>
                    <Input
                      id="new-username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-nickname" className="block text-sm font-medium">
                      {t("nickname")}
                    </label>
                    <Input
                      id="new-nickname"
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-email" className="block text-sm font-medium">
                      {t("email")} *
                    </label>
                    <Input
                      id="new-email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  {/* 租户选择：只有超级管理员可以修改 */}
                  {isSuperAdmin && (
                    <div className="space-y-2">
                      <label htmlFor="new-tenant" className="block text-sm font-medium">
                        {t("tenant")}
                      </label>
                      <select
                        id="new-tenant"
                        className="w-full border rounded px-2 py-1"
                        value={form.tenant_id || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            tenant_id: e.target.value ? Number(e.target.value) : null,
                            dept_id: null,
                          })
                        }
                      >
                        <option value="">{t("noTenant")}</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 部门选择：超级管理员可以选择任何部门，租户管理员可以选择本租户的部门 */}
                  {(user?.isSuperAdmin || user?.isTenantAdmin) && (
                    <div className="space-y-2">
                      <label htmlFor="new-dept" className="block text-sm font-medium">
                        {t("dept")}
                      </label>
                      <DeptSelect
                        id="new-dept"
                        depts={(() => {
                          if (user?.isSuperAdmin) {
                            // 超级管理员可以选择任何部门
                            return depts.filter(
                              (dept) => !form.tenant_id || dept.tenant_id === form.tenant_id
                            );
                          } else if (user?.isTenantAdmin) {
                            // 租户管理员只能选择自己租户的部门
                            return depts.filter((dept) => dept.tenant_id === user?.tenant_id);
                          }
                          return [];
                        })()}
                        value={form.dept_id}
                        onChange={(deptId) => setForm({ ...form, dept_id: deptId })}
                        disabled={user?.isSuperAdmin ? !form.tenant_id : false}
                        placeholder={t("noDept")}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="new-role" className="block text-sm font-medium">
                      {t("role")} *
                    </label>
                    <select
                      id="new-role"
                      className="w-full border rounded px-2 py-1"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      <option value={t("normalUser")}>{t("normalUser")}</option>
                      <option value={t("deptAdmin")}>{t("deptAdmin")}</option>
                      {isSuperAdmin && <option value={t("tenantAdmin")}>{t("tenantAdmin")}</option>}
                      {isSuperAdmin && <option value={t("superAdmin")}>{t("superAdmin")}</option>}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-password" className="block text-sm font-medium">
                      {t("password")} *
                    </label>
                    <Input
                      id="new-password"
                      type="password"
                      value={form.password || ""}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                </>
              ) : // 编辑用户：根据权限显示不同表单
              isSuperAdmin ? (
                // 超级管理员可以编辑所有字段
                <>
                  <div className="space-y-2">
                    <label htmlFor="edit-username" className="block text-sm font-medium">
                      {t("username")} *
                    </label>
                    <Input
                      id="edit-username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      disabled={editing}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-nickname" className="block text-sm font-medium">
                      {t("nickname")}
                    </label>
                    <Input
                      id="edit-nickname"
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-email" className="block text-sm font-medium">
                      {t("email")} *
                    </label>
                    <Input
                      id="edit-email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-tenant" className="block text-sm font-medium">
                      {t("tenant")} ({t("totalDepts", { count: tenants.length })})
                    </label>
                    <select
                      id="edit-tenant"
                      className="w-full border rounded px-2 py-1"
                      value={form.tenant_id || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tenant_id: e.target.value ? Number(e.target.value) : null,
                          dept_id: null,
                        })
                      }
                    >
                      <option value="">{t("noTenant")}</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-dept" className="block text-sm font-medium">
                      {t("dept")} (
                      {t("totalDepts", {
                        count: depts.filter(
                          (dept) => !form.tenant_id || dept.tenant_id === form.tenant_id
                        ).length,
                      })}
                      )
                    </label>
                    <DeptSelect
                      id="edit-dept"
                      depts={depts.filter(
                        (dept) => !form.tenant_id || dept.tenant_id === form.tenant_id
                      )}
                      value={form.dept_id}
                      onChange={(deptId) => setForm({ ...form, dept_id: deptId })}
                      disabled={!form.tenant_id}
                      placeholder={t("noDept")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-role" className="block text-sm font-medium">
                      {t("role")} *
                    </label>
                    <select
                      id="edit-role"
                      className="w-full border rounded px-2 py-1"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      <option value={"普通用户"}>{t("normalUser")}</option>
                      <option value={"部门管理员"}>{t("deptAdmin")}</option>
                      <option value={"租户管理员"}>{t("tenantAdmin")}</option>
                      <option value={"超级管理员"}>{t("superAdmin")}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-password" className="block text-sm font-medium">
                      {t("newPassword")}
                    </label>
                    <Input
                      id="edit-password"
                      type="password"
                      value={form.password || ""}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-status" className="block text-sm font-medium">
                      {t("status")}
                    </label>
                    <select
                      id="edit-status"
                      className="w-full border rounded px-2 py-1"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                    >
                      <option value="active">{t("active")}</option>
                      <option value="inactive">{t("inactive")}</option>
                    </select>
                  </div>
                </>
              ) : isTenantAdmin || isDeptAdmin ? (
                // 租户管理员和部门管理员可以编辑部分字段
                <>
                  <div className="space-y-2">
                    <label htmlFor="admin-username" className="block text-sm font-medium">
                      {t("username")}
                    </label>
                    <Input id="admin-username" value={form.username} disabled />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="admin-nickname" className="block text-sm font-medium">
                      {t("nickname")}
                    </label>
                    <Input
                      id="admin-nickname"
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="admin-email" className="block text-sm font-medium">
                      {t("email")} *
                    </label>
                    <Input
                      id="admin-email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  {/* 部门选择：租户管理员可以选择本租户的部门 */}
                  {user?.isTenantAdmin && (
                    <div className="space-y-2">
                      <label htmlFor="admin-dept" className="block text-sm font-medium">
                        {t("dept")}
                      </label>
                      <DeptSelect
                        id="admin-dept"
                        depts={depts.filter((dept) => dept.tenant_id === user?.tenant_id)}
                        value={form.dept_id}
                        onChange={(deptId) => setForm({ ...form, dept_id: deptId })}
                        placeholder={t("noDept")}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="admin-role" className="block text-sm font-medium">
                      {t("role")} *
                    </label>
                    <select
                      id="admin-role"
                      className="w-full border rounded px-2 py-1"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      disabled={(() => {
                        // 部门管理员不能修改自己的身份，其他管理员可以
                        if (form.id === user?.id) {
                          return user?.isDeptAdmin || false;
                        }
                        return false;
                      })()}
                    >
                      {(() => {
                        const currentUser = users.find((u) => u.id === form.id);
                        const availableRoles = currentUser ? getAvailableRoles(currentUser) : [];
                        const currentRole = currentUser?.roles?.[0] || t("normalUser");

                        return [
                          <option key="current" value={currentRole}>
                            {currentRole}
                          </option>,
                          ...availableRoles
                            .filter((role) => role !== currentRole)
                            .map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            )),
                        ];
                      })()}
                    </select>
                    {form.id === user?.id && user?.isDeptAdmin && (
                      <p className="text-sm text-muted-foreground">
                        {t("deptAdminCannotModifySelf")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="admin-password" className="block text-sm font-medium">
                      {t("newPassword")}
                    </label>
                    <Input
                      id="admin-password"
                      type="password"
                      value={form.password || ""}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="admin-status" className="block text-sm font-medium">
                      {t("status")}
                    </label>
                    <select
                      id="admin-status"
                      className="w-full border rounded px-2 py-1"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                    >
                      <option value="active">{t("active")}</option>
                      <option value="inactive">{t("inactive")}</option>
                    </select>
                  </div>
                </>
              ) : (
                // 普通用户只能修改状态
                <div className="space-y-2">
                  <label htmlFor="user-status" className="block text-sm font-medium">
                    {t("status")}
                  </label>
                  <select
                    id="user-status"
                    className="w-full border rounded px-2 py-1"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="active">{t("active")}</option>
                    <option value="inactive">{t("inactive")}</option>
                  </select>
                </div>
              )}
              {error && <div className="text-destructive text-sm">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  {tc("cancel")}
                </Button>
                <Button onClick={handleSubmit} disabled={loading}>
                  {editing ? tc("save") : t("addUser")}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 微信发送消息对话框 */}
      <Dialog.Root open={showWechatDialog} onOpenChange={setShowWechatDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-6 shadow-lg">
            <Dialog.Title className="text-lg font-bold mb-4">
              {t("sendWechatTo", { name: wechatUser?.username })}
            </Dialog.Title>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="wechat-agent" className="block text-sm font-medium">
                  {t("wechatApp")} *
                </label>
                {loadingWechatAgents ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("loadingWechatApps")}</span>
                  </div>
                ) : (
                  <Select
                    value={wechatForm.agentid}
                    onValueChange={(value) => {
                      setWechatForm({ ...wechatForm, agentid: value });
                    }}
                  >
                    <SelectTrigger id="wechat-agent">
                      <SelectValue placeholder={t("selectWechatApp")} />
                    </SelectTrigger>
                    <SelectContent>
                      {wechatAgents.map((agent) => (
                        <SelectItem key={agent.agentid} value={agent.agentid.toString()}>
                          {agent.name} (ID: {agent.agentid})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {wechatAgents.length === 0 && !loadingWechatAgents && (
                  <p className="text-xs text-muted-foreground">{t("noWechatApps")}</p>
                )}
              </div>
              <div className="space-y-2">
                <label htmlFor="wechat-content" className="block text-sm font-medium">
                  {t("messageContent")} *
                </label>
                <Textarea
                  id="wechat-content"
                  value={wechatForm.content}
                  onChange={(e) => setWechatForm({ ...wechatForm, content: e.target.value })}
                  placeholder={t("messagePlaceholder")}
                  rows={4}
                />
              </div>
              {error && <div className="text-destructive text-sm">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowWechatDialog(false)}>
                  {tc("cancel")}
                </Button>
                <Button
                  onClick={handleSendWechatMessage}
                  disabled={wechatLoading || !wechatForm.content.trim() || !wechatForm.agentid}
                >
                  {wechatLoading ? t("sending") : t("send")}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
