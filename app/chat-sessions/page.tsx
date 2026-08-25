"use client";

import { useState, useEffect, useDeferredValue } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Filter,
  User,
  MessageSquare,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileText,
  FileType,
  FileSpreadsheet,
  X,
  Download,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { useTranslations, useLocale } from "next-intl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import type { TurnUsage } from "@/types/token-usage";

interface Session {
  id: number;
  createdAt: string;
  updatedAt: string;
  userId: number;
  summary: string;
  datasetIds?: string[];
  appId?: number;
  app?: {
    id?: number;
    name?: string;
  };
  user: {
    nickname: string;
    username: string;
    email: string;
  };
  dept: {
    name: string;
    code: string;
  };
  stats: {
    detailCount: number;
    avgDuration: number;
    goodVotes: number;
    badVotes: number;
    unansweredQuestions: number;
  };
}

interface SessionDetail {
  id: number;
  sessionId: number;
  question: string;
  answer: string;
  submittedAt: string;
  answeredAt: string;
  durationMs: number;
  feedback: string;
  voteGood: boolean;
  voteBad: boolean;
  references?: any[];
  segmentsIds?: number[];
  segmentSimilarities?: number[];
  usage?: TurnUsage;
}

interface SessionWithDetails extends Session {
  details: SessionDetail[];
  datasets?: Array<{ id: string; name: string }>;
}

interface Filters {
  users: Array<{
    id: number;
    nickname: string;
    username: string;
    email: string;
    deptName: string;
  }>;
  depts: Array<{
    id: number;
    name: string;
    code: string;
    level: number;
    path: string;
  }>;
  tenants: Array<{
    id: number;
    name: string;
    code: string;
    status: string;
  }>;
  stats: {
    totalSessions: number;
    totalUsers: number;
    avgDuration: number;
    totalGoodVotes: number;
    totalBadVotes: number;
    totalUnansweredQuestions: number;
  };
}

export default function ChatSessionsPage() {
  const t = useTranslations("chatSessions");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  const isTenantAdmin = checkTenantAdmin(user);
  const isDeptAdmin = user?.isDeptAdmin || false;
  const isPriv = isSuperAdmin || isTenantAdmin || isDeptAdmin;
  const statsGridCols = isPriv ? "md:grid-cols-5" : "md:grid-cols-4";
  const filterGridCols = isPriv ? "md:grid-cols-7" : "md:grid-cols-5";
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<SessionWithDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [segments, setSegments] = useState<{ [key: number]: any[] }>({});
  const [segmentsLoading, setSegmentsLoading] = useState<{
    [key: number]: boolean;
  }>({});
  const [referencesDialogOpen, setReferencesDialogOpen] = useState(false);
  const [currentDetailIndex, setCurrentDetailIndex] = useState<number>(-1);
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [referencesSearchQuery, setReferencesSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(referencesSearchQuery);

  // 筛选条件
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [selectedDeptId, setSelectedDeptId] = useState<string>("all");
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<string>("all"); // 'all', 'good', 'bad'
  const [filterExpanded, setFilterExpanded] = useState(false); // 筛选条件展开状态

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalSessions, setTotalSessions] = useState(0);

  // 获取筛选选项
  const fetchFilters = async (tenantId?: string) => {
    try {
      const params: Record<string, string> = {};
      if (tenantId && tenantId !== "all") {
        params.tenantId = tenantId;
      }
      const response = await axios.get("/api/chat/sessions/filters", {
        params,
      });
      setFilters(response.data);
    } catch (error) {
      console.error("Error fetching filters:", error);
    }
  };

  // 获取会话列表
  const fetchSessions = async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: page.toString(),
        limit: "20",
      };

      if (searchTerm) params.search = searchTerm;
      if (selectedUserId && selectedUserId !== "all") params.userId = selectedUserId;
      if (selectedDeptId && selectedDeptId !== "all") params.deptId = selectedDeptId;
      if (selectedTenantId && selectedTenantId !== "all") params.tenantId = selectedTenantId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (feedbackFilter && feedbackFilter !== "all") params.feedback = feedbackFilter;

      const response = await axios.get("/api/chat/sessions", { params });
      setSessions(response.data.sessions);
      setTotalPages(response.data.pagination.totalPages);
      setTotalSessions(response.data.pagination.total);
      setCurrentPage(page);
    } catch (error) {
      console.error("Error fetching sessions:", error);
    } finally {
      setLoading(false);
    }
  };

  // 获取会话详情
  const fetchSessionDetails = async (sessionId: number) => {
    setDetailLoading(true);
    try {
      const response = await axios.get(`/api/chat/sessions/${sessionId}/details`);
      setSelectedSession(response.data);
    } catch (error) {
      console.error("Error fetching session details:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  // 格式化持续时间
  const formatDuration = (ms: number) => {
    if (!ms) return "-";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}${t("hours")}${minutes % 60}${t("minutes")}`;
    } else if (minutes > 0) {
      return `${minutes}${t("minutes")}${seconds % 60}${t("seconds")}`;
    } else {
      return `${seconds}${t("seconds")}`;
    }
  };

  // 格式化创建时间（简化显示）
  const formatCreateTime = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), {
      addSuffix: true,
      locale: locale === "en" ? enUS : zhCN,
    });
  };

  // 格式化反馈状态
  const getFeedbackBadge = (detail: SessionDetail) => {
    if (detail.voteGood) {
      return (
        <Badge variant="default" className="bg-success/10 text-success">
          <ThumbsUp className="w-3 h-3 mr-1" />
          {t("positive")}
        </Badge>
      );
    } else if (detail.voteBad) {
      return (
        <Badge variant="destructive">
          <ThumbsDown className="w-3 h-3 mr-1" />
          {t("negative")}
        </Badge>
      );
    }
    return <Badge variant="secondary">{t("noFeedback")}</Badge>;
  };

  // 根据文件类型获取图标
  function getFileIcon(mimetype?: string) {
    if (mimetype?.includes("pdf")) {
      return <FileType className="w-4 h-4 text-destructive" />;
    } else if (
      mimetype?.includes("csv") ||
      mimetype?.includes("excel") ||
      mimetype?.includes("spreadsheet")
    ) {
      return <FileSpreadsheet className="w-4 h-4 text-success" />;
    } else {
      return <FileText className="w-4 h-4 text-info" />;
    }
  }

  // 获取segments数据
  const fetchSegments = async (segmentIds: number[], detailIndex: number) => {
    if (!segmentIds || segmentIds.length === 0) return;

    setSegmentsLoading((prev) => ({ ...prev, [detailIndex]: true }));
    try {
      const response = await axios.post("/api/knowledge/segments/by-ids", {
        segment_ids: segmentIds,
      });
      setSegments((prev) => ({
        ...prev,
        [detailIndex]: response.data.segments,
      }));
    } catch (error) {
      console.error("Error fetching segments:", error);
    } finally {
      setSegmentsLoading((prev) => ({ ...prev, [detailIndex]: false }));
    }
  };

  // 打开引用弹窗
  const openReferencesDialog = async (detailIndex: number, segmentIds: number[]) => {
    setCurrentDetailIndex(detailIndex);
    setReferencesDialogOpen(true);

    // 如果还没有加载过数据，则加载
    if (!segments[detailIndex]) {
      await fetchSegments(segmentIds, detailIndex);
    }
  };

  useEffect(() => {
    fetchFilters();
  }, []);

  // 处理租户选择变化
  const handleTenantChange = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    // 重置用户和部门选择
    setSelectedUserId("all");
    setSelectedDeptId("all");
    // 重新获取过滤选项（根据选中的租户）
    fetchFilters(tenantId);
  };

  useEffect(() => {
    fetchSessions(1);
  }, [
    searchTerm,
    selectedUserId,
    selectedDeptId,
    selectedTenantId,
    startDate,
    endDate,
    feedbackFilter,
  ]);

  const handleSearch = () => {
    fetchSessions(1);
  };

  const handleReset = () => {
    setSearchTerm("");
    setSelectedUserId("all");
    setSelectedDeptId("all");
    setSelectedTenantId("all");
    setStartDate("");
    setEndDate("");
    setFeedbackFilter("all");
    fetchSessions(1);
  };

  const handleFeedbackFilter = (type: "good" | "bad") => {
    setFeedbackFilter(type);
    setCurrentPage(1);
  };

  // 导出Excel
  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();

      if (searchTerm) params.append("search", searchTerm);
      if (selectedUserId && selectedUserId !== "all") params.append("userId", selectedUserId);
      if (selectedDeptId && selectedDeptId !== "all") params.append("deptId", selectedDeptId);
      if (selectedTenantId && selectedTenantId !== "all")
        params.append("tenantId", selectedTenantId);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (feedbackFilter && feedbackFilter !== "all") params.append("feedback", feedbackFilter);

      const response = await axios.get(`/api/chat/sessions/export?${params}`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // 从响应头获取文件名
      const contentDisposition = response.headers["content-disposition"];
      let filename = t("exportFilename");
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename="(.+)"/);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }

      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t("exportSuccess"));
    } catch (error) {
      console.error("Failed to export Excel:", error);
      toast.error(t("exportFailed"));
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => fetchSessions(currentPage)} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          {t("refresh")}
        </Button>
      </div>

      {/* 统计卡片 */}
      {filters && (
        <div className={`grid grid-cols-1 ${statsGridCols} gap-4`}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("totalSessions")}</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filters.stats.totalSessions}</div>
            </CardContent>
          </Card>
          {isPriv && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("participatingUsers")}</CardTitle>
                <User className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{filters.stats.totalUsers}</div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("unansweredQuestions")}</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {filters.stats.totalUnansweredQuestions || 0}
              </div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${
              feedbackFilter === "good" ? "ring-2 ring-success bg-success/5" : ""
            }`}
            onClick={() => handleFeedbackFilter("good")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("positiveVotes")}</CardTitle>
              <ThumbsUp className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{filters.stats.totalGoodVotes}</div>
              {feedbackFilter === "good" && (
                <p className="text-xs text-success mt-1">{t("viewPositiveSessions")}</p>
              )}
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${
              feedbackFilter === "bad" ? "ring-2 ring-destructive bg-destructive/5" : ""
            }`}
            onClick={() => handleFeedbackFilter("bad")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("negativeVotes")}</CardTitle>
              <ThumbsDown className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {filters.stats.totalBadVotes}
              </div>
              {feedbackFilter === "bad" && (
                <p className="text-xs text-destructive mt-1">{t("viewNegativeSessions")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 筛选条件 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <Filter className="w-4 h-4 mr-2" />
              <span className="text-lg font-medium">{t("filterConditions")}</span>
            </div>
            <div className="flex items-center gap-2">
              {feedbackFilter !== "all" && (
                <>
                  <Badge
                    variant={feedbackFilter === "good" ? "default" : "destructive"}
                    className="bg-opacity-20"
                  >
                    {feedbackFilter === "good" ? (
                      <>
                        <ThumbsUp className="w-3 h-3 mr-1" />
                        {t("positiveFilter")}
                      </>
                    ) : (
                      <>
                        <ThumbsDown className="w-3 h-3 mr-1" />
                        {t("negativeFilter")}
                      </>
                    )}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFeedbackFilter("all")}
                    className="h-6 px-2 text-xs"
                  >
                    {t("clear")}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilterExpanded(!filterExpanded)}
                className="h-8 w-8 p-0"
              >
                {filterExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        {filterExpanded && (
          <CardContent>
            <div className={`grid grid-cols-1 ${filterGridCols} gap-4`}>
              <div className="md:col-span-2">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("searchPlaceholder")}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              {isSuperAdmin && filters?.tenants && filters.tenants.length > 0 && (
                <div>
                  <Select value={selectedTenantId} onValueChange={handleTenantChange}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectTenant")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allTenants")}</SelectItem>
                      {filters.tenants.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id.toString()}>
                          {tenant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isPriv && (
                <div>
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectUser")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allUsers")}</SelectItem>
                      {filters?.users.map((user) => (
                        <SelectItem key={user.id} value={user.id.toString()}>
                          {user.nickname || user.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(isSuperAdmin || isTenantAdmin) && (
                <div>
                  <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectDept")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allDepts")}</SelectItem>
                      {filters?.depts.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id.toString()}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Input
                  type="date"
                  placeholder={t("startDate")}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Input
                  type="date"
                  placeholder={t("endDate")}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleSearch} size="sm">
                <Search className="w-4 h-4 mr-2" />
                {t("search")}
              </Button>
              <Button onClick={handleReset} variant="outline" size="sm">
                {t("reset")}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 会话列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("sessionList")}</CardTitle>
              <CardDescription>{t("totalRecords", { count: totalSessions })}</CardDescription>
            </div>
            <Button onClick={handleExportExcel} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              {t("exportExcel")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[250px]" />
                    <Skeleton className="h-4 w-[200px]" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sessionId")}</TableHead>
                  <TableHead>{t("user")}</TableHead>
                  <TableHead>{t("department")}</TableHead>
                  <TableHead>{t("appName")}</TableHead>
                  <TableHead>{t("createdAt")}</TableHead>
                  <TableHead>{t("sessionSummary")}</TableHead>
                  <TableHead>{t("dialogCount")}</TableHead>
                  <TableHead>{t("avgDuration")}</TableHead>
                  <TableHead>{t("feedback")}</TableHead>
                  <TableHead>{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">#{session.id}</TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {session.user.nickname || session.user.username}
                      </div>
                    </TableCell>
                    <TableCell>
                      {session.dept.name ? (
                        <Badge variant="outline">{session.dept.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{session.app?.name || t("app")}</span>
                    </TableCell>
                    <TableCell>{formatCreateTime(session.createdAt)}</TableCell>
                    <TableCell>
                      <div className="max-w-xs">
                        {session.summary ? (
                          <div
                            className="text-sm text-muted-foreground truncate"
                            title={session.summary}
                          >
                            {session.summary}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">{t("noSummary")}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{session.stats.detailCount}</TableCell>
                    <TableCell>{formatDuration(session.stats.avgDuration)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {session.stats.goodVotes > 0 && (
                          <Badge variant="default" className="bg-success/10 text-success">
                            <ThumbsUp className="w-3 h-3 mr-1" />
                            {session.stats.goodVotes}
                          </Badge>
                        )}
                        {session.stats.badVotes > 0 && (
                          <Badge variant="destructive">
                            <ThumbsDown className="w-3 h-3 mr-1" />
                            {session.stats.badVotes}
                          </Badge>
                        )}
                        {session.stats.goodVotes === 0 && session.stats.badVotes === 0 && (
                          <span className="text-muted-foreground text-sm">{t("noFeedback")}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchSessionDetails(session.id)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            {t("details")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>
                              {t("sessionDetails")} - #{session.id}
                            </DialogTitle>
                            <DialogDescription>
                              {t("userLabel")}: {session.user.nickname || session.user.username} |{" "}
                              {t("deptLabel")}: {session.dept.name || t("notAssigned")} |{" "}
                              {t("createdAt")}:{" "}
                              {format(new Date(session.createdAt), "yyyy-MM-dd HH:mm:ss", {
                                locale: locale === "en" ? enUS : zhCN,
                              })}
                            </DialogDescription>
                          </DialogHeader>
                          {detailLoading ? (
                            <div className="space-y-4">
                              {[...Array(3)].map((_, i) => (
                                <div key={i} className="space-y-2">
                                  <Skeleton className="h-4 w-full" />
                                  <Skeleton className="h-4 w-3/4" />
                                </div>
                              ))}
                            </div>
                          ) : selectedSession ? (
                            <Tabs defaultValue="details" className="w-full">
                              <TabsList>
                                <TabsTrigger value="details">{t("dialogDetails")}</TabsTrigger>
                                <TabsTrigger value="summary">{t("sessionSummaryTab")}</TabsTrigger>
                              </TabsList>
                              <TabsContent value="details" className="space-y-4">
                                {selectedSession.details.map((detail, index) => (
                                  <Card key={detail.id}>
                                    <CardHeader className="pb-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Badge variant="outline">#{index + 1}</Badge>
                                          <span className="text-sm text-muted-foreground">
                                            {format(new Date(detail.submittedAt), "HH:mm:ss", {
                                              locale: zhCN,
                                            })}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {getFeedbackBadge(detail)}
                                          {detail.durationMs && (
                                            <Badge variant="secondary">
                                              <Clock className="w-3 h-3 mr-1" />
                                              {formatDuration(detail.durationMs)}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                      <div>
                                        <div className="text-sm font-medium text-muted-foreground mb-1">
                                          {t("question")}:
                                        </div>
                                        <div className="p-3 bg-muted rounded-md">
                                          <MarkdownRenderer content={detail.question} />
                                        </div>
                                      </div>
                                      {detail.answer && (
                                        <div>
                                          <div className="text-sm font-medium text-muted-foreground mb-1">
                                            {t("answer")}:
                                          </div>
                                          <div className="p-3 bg-muted rounded-md">
                                            <MarkdownRenderer content={detail.answer} />
                                          </div>

                                          {/* 参考文件和引用显示 */}
                                          <ReferencesDisplay
                                            detailIndex={index}
                                            references={detail.references}
                                            segmentIds={detail.segmentsIds}
                                            segmentSimilarities={detail.segmentSimilarities}
                                            segmentsLoading={segmentsLoading}
                                            onOpenReferencesDialog={openReferencesDialog}
                                            onPreviewFile={setPreviewFile}
                                          />
                                          {detail.usage && (
                                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                              <span>
                                                {t("tokenInputLabel")}:{" "}
                                                {(detail.usage.promptTokens ?? 0).toLocaleString()}
                                              </span>
                                              <span>
                                                {t("tokenOutputLabel")}:{" "}
                                                {(
                                                  detail.usage.completionTokens ?? 0
                                                ).toLocaleString()}
                                              </span>
                                              <span className="font-medium">
                                                {t("tokenTotalLabel")}:{" "}
                                                {(detail.usage.totalTokens ?? 0).toLocaleString()}
                                              </span>
                                              {detail.usage.llmCalls ? (
                                                <span>
                                                  {t("tokenCallsLabel", {
                                                    count: detail.usage.llmCalls,
                                                  })}
                                                </span>
                                              ) : null}
                                              {detail.usage.cacheReadTokens ? (
                                                <span className="text-emerald-600">
                                                  {t("tokenCachedLabel")}:{" "}
                                                  {detail.usage.cacheReadTokens.toLocaleString()}
                                                </span>
                                              ) : null}
                                              {detail.usage.modelName ? (
                                                <span className="font-mono">
                                                  {detail.usage.modelName}
                                                </span>
                                              ) : null}
                                              {detail.usage.partial ? (
                                                <span className="text-amber-600">
                                                  {t("tokenPartialLabel")}
                                                </span>
                                              ) : null}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {detail.feedback && (
                                        <div>
                                          <div className="text-sm font-medium text-muted-foreground mb-1">
                                            {t("feedbackContent")}:
                                          </div>
                                          <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md text-destructive">
                                            {detail.feedback}
                                          </div>
                                        </div>
                                      )}
                                    </CardContent>
                                  </Card>
                                ))}
                              </TabsContent>
                              <TabsContent value="summary">
                                <Card>
                                  <CardHeader>
                                    <CardTitle>{t("sessionSummaryTab")}</CardTitle>
                                  </CardHeader>
                                  <CardContent className="space-y-4">
                                    {selectedSession.summary ? (
                                      <div className="p-4 bg-muted rounded-md">
                                        <MarkdownRenderer content={selectedSession.summary} />
                                      </div>
                                    ) : (
                                      <div className="text-center text-muted-foreground py-8">
                                        {t("noSessionSummary")}
                                      </div>
                                    )}
                                    {selectedSession.datasets &&
                                      selectedSession.datasets.length > 0 && (
                                        <div>
                                          <div className="text-sm font-medium text-muted-foreground mb-2">
                                            {t("usedKnowledgeBases")}:
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            {selectedSession.datasets.map((dataset) => (
                                              <Badge
                                                key={dataset.id}
                                                variant="outline"
                                                className="text-sm"
                                              >
                                                {dataset.name}
                                              </Badge>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                  </CardContent>
                                </Card>
                              </TabsContent>
                            </Tabs>
                          ) : (
                            <div className="text-center text-muted-foreground py-8">
                              {t("loadingContent")}
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                {t("page", { current: currentPage, total: totalPages })}
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchSessions(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t("prevPage")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchSessions(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  {t("nextPage")}
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 引用内容弹窗 */}
      <RadixDialog.Root
        open={referencesDialogOpen}
        onOpenChange={(open) => {
          setReferencesDialogOpen(open);
          if (!open) {
            setReferencesSearchQuery("");
          }
        }}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-4xl max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-lg flex flex-col">
            <div className="flex items-center justify-between p-6 border-b gap-4">
              <RadixDialog.Title className="text-lg font-semibold text-foreground flex-shrink-0">
                {t("referenceContent")}
              </RadixDialog.Title>
              <div
                className="w-48 relative"
                style={{
                  margin: "0 20px 0 auto",
                }}
              >
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={tc("search")}
                  value={referencesSearchQuery}
                  onChange={(e) => setReferencesSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                {referencesSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setReferencesSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">{tc("close")}</span>
                </button>
              </RadixDialog.Close>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {currentDetailIndex >= 0 && segments[currentDetailIndex] ? (
                segments[currentDetailIndex].map((segment, index) => {
                  const similarity =
                    selectedSession?.details[currentDetailIndex]?.segmentSimilarities?.[index];
                  const similarityPercentage = similarity ? Math.round(similarity * 100) : 0;

                  return (
                    <Card key={segment.id} className="p-4 bg-muted border-gray-200">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-success text-sm font-bold">{index + 1}</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-4 h-4 rounded bg-muted flex items-center justify-center">
                              {getFileIcon(segment.mimetype)}
                            </div>
                            <span className="text-sm text-muted-foreground font-medium">
                              {segment.originalname}
                            </span>
                            {similarity !== undefined && (
                              <Badge variant="secondary" className="ml-auto">
                                {t("similarity")}: {similarityPercentage}%
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-foreground leading-relaxed bg-card p-3 rounded border">
                            <MarkdownRenderer
                              content={segment.segment_text}
                              highlightText={deferredSearchQuery}
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })
              ) : segmentsLoading[currentDetailIndex] ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="w-4 h-4 border border-border border-t-primary rounded-full animate-spin"></div>
                    <span>{t("loadingReferenceContent")}</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  {t("noReferenceContent")}
                </div>
              )}
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <FilePreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(v) => !v && setPreviewFile(null)}
      />
    </div>
  );
}

// 引用展示组件
function ReferencesDisplay({
  detailIndex,
  references,
  segmentIds,
  segmentSimilarities,
  segmentsLoading,
  onOpenReferencesDialog,
  onPreviewFile,
}: {
  detailIndex: number;
  references?: any[];
  segmentIds?: number[];
  segmentSimilarities?: number[];
  segmentsLoading: { [key: number]: boolean };
  onOpenReferencesDialog: (detailIndex: number, segmentIds: number[]) => void;
  onPreviewFile: (file: any) => void;
}) {
  const t = useTranslations("chatSessions");
  if (!references && !segmentIds) return null;

  const refs = references || [];
  const isLoading = segmentsLoading[detailIndex];

  // 根据文件类型获取图标
  const getFileIcon = (mimetype?: string) => {
    if (mimetype?.includes("pdf")) {
      return <FileType className="w-4 h-4 text-destructive" />;
    } else if (
      mimetype?.includes("csv") ||
      mimetype?.includes("excel") ||
      mimetype?.includes("spreadsheet")
    ) {
      return <FileSpreadsheet className="w-4 h-4 text-success" />;
    } else {
      return <FileText className="w-4 h-4 text-info" />;
    }
  };

  return (
    <div className="text-sm mt-3 mb-3">
      {/* 参考资料行 */}
      {refs.length > 0 && (
        <div className="mb-2">
          <div className="text-muted-foreground mb-2 flex items-center">
            {t("referenceLabel")}:
            <div className="flex-1 h-px bg-muted ml-2" style={{ width: "30%" }}></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {refs.map((refObj, index) => (
              <div
                key={index}
                className="flex items-center bg-muted border border-gray-200 rounded-lg overflow-hidden"
              >
                <div className="w-5 h-full bg-muted flex items-center justify-center flex-shrink-0">
                  <span className="text-muted-foreground text-xs font-medium">{index + 1}</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1">
                  <div className="w-4 h-4 flex items-center justify-center">
                    {getFileIcon(refObj.mimetype)}
                  </div>
                  {refObj.path && (
                    <button
                      className="text-foreground text-left text-sm leading-relaxed hover:text-primary transition-colors"
                      type="button"
                      onClick={() =>
                        onPreviewFile({
                          id: refObj.id?.toString(),
                          filename: refObj.path.split("/").pop(),
                          originalname: refObj.originalname,
                          mimetype: refObj.mimetype || "",
                          path: refObj.path,
                        })
                      }
                    >
                      {refObj.originalname}
                    </button>
                  )}
                  {!refObj.path && (
                    <span className="text-foreground text-sm">{refObj.originalname}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 引用按钮行 */}
      {segmentIds && segmentIds.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 px-3 py-1 rounded-full border border-primary-200 bg-primary-50 text-primary hover:bg-primary-100 transition-colors text-sm"
            onClick={() => onOpenReferencesDialog(detailIndex, segmentIds)}
            disabled={isLoading}
          >
            {isLoading && (
              <div className="w-3 h-3 border border-primary-300 border-t-primary rounded-full animate-spin"></div>
            )}
            <span>{t("citationCount", { count: segmentIds.length })}</span>
          </button>
        </div>
      )}
    </div>
  );
}
