"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import { useTranslations } from "next-intl";

import axios from "@/lib/axios";

function ErrorLogCard() {
  const t = useTranslations("monitoring");
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    axios.get("/api/logs/error").then((res) => setLines(res.data.lines || []));
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("serverErrorLog")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-64 bg-background text-green-400 text-xs p-2 rounded">
          {lines.length === 0 ? t("noErrorLog") : lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </CardContent>
    </Card>
  );
}

// 系统状态数据类型定义
interface SystemStatus {
  cpu: {
    usage_percent: number;
  };
  memory: {
    total: number;
    used: number;
    available: number;
    percent: number;
  };
  gpu:
    | {
        id: number;
        name: string;
        memory_total: number;
        memory_used: number;
        memory_free: number;
        memory_percent: number;
        gpu_percent: number;
        temperature: number;
      }[]
    | null;
}

interface LicenseStatus {
  status: "valid" | "grace" | "expired" | "error";
  customer?: string;
  license_id?: string;
  expires_at?: string;
  days_remaining?: number;
}

const LICENSE_WARNING_THRESHOLD_DAYS = 7;

export default function MonitoringPage() {
  const t = useTranslations("monitoring");
  const tc = useTranslations("common");
  const { user, loading: userLoading } = useCurrentUser();
  const [vectorDbSizeBytes, setVectorDbSizeBytes] = useState<number | null>(null);
  const [entityCount, setEntityCount] = useState<number | null>(null);
  const [relationCount, setRelationCount] = useState<number | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemStatusLoading, setSystemStatusLoading] = useState(true);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    axios.get("/api/monitoring/vector-entity-count").then((res) => {
      setVectorDbSizeBytes(res.data.vectorDbSizeBytes);
      setEntityCount(res.data.entityCount);
      setRelationCount(res.data.relationCount);
    });

    axios
      .get("/api/monitoring/license-status")
      .then((res) => setLicenseStatus(res.data))
      .catch(() => setLicenseStatus({ status: "error" }));

    axios
      .get("/api/monitoring/system-status")
      .then((res) => {
        setSystemStatus(res.data.data);
        setSystemStatusLoading(false);
      })
      .catch((error) => {
        console.error("Failed to fetch system status:", error);
        setSystemStatusLoading(false);
      });
  }, []);

  function formatBytes(bytes: number | null) {
    if (bytes === null) return tc("loading");
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    if (bytes < 1024 * 1024 * 1024) return Math.round(bytes / 1024 / 1024) + " MB";
    return Math.round(bytes / 1024 / 1024 / 1024) + " GB";
  }

  function getStatusText(percent: number) {
    if (percent < 50) {
      return { color: "text-success", bgColor: "bg-success/10", text: t("statusNormal") };
    } else if (percent < 80) {
      return { color: "text-warning", bgColor: "bg-warning/10", text: t("statusHigh") };
    } else {
      return {
        color: "text-destructive",
        bgColor: "bg-destructive/10",
        text: t("statusAlert"),
      };
    }
  }

  function getLicenseBadge(lic: LicenseStatus | null) {
    if (lic === null) {
      return {
        className: "bg-muted text-muted-foreground",
        label: tc("loading"),
        warn: false,
      };
    }
    if (lic.status === "error") {
      return {
        className: "bg-muted text-muted-foreground",
        label: t("licenseStatusUnknown"),
        warn: false,
      };
    }
    if (lic.status === "expired") {
      return {
        className: "bg-destructive/10 text-destructive border border-destructive/30",
        label: t("licenseStatusExpired"),
        warn: true,
      };
    }
    if (lic.status === "grace") {
      return {
        className: "bg-destructive/10 text-destructive border border-destructive/30",
        label: t("licenseStatusGrace"),
        warn: true,
      };
    }
    // valid
    if ((lic.days_remaining ?? Infinity) <= LICENSE_WARNING_THRESHOLD_DAYS) {
      return {
        className: "bg-destructive/10 text-destructive border border-destructive/30",
        label: t("licenseStatusExpiringSoon"),
        warn: true,
      };
    }
    return {
      className: "bg-green-100 text-green-800",
      label: t("licenseStatusValid"),
      warn: false,
    };
  }

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">{tc("loading")}</span>
      </div>
    );
  }

  if (!user) return null;
  if (!checkSuperAdmin(user)) {
    return <div className="text-center text-destructive text-xl mt-20">{tc("noPermission")}</div>;
  }
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Badge variant="outline" className="text-success">
          <CheckCircle className="mr-1 h-3 w-3" />
          {t("systemNormal")}
        </Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("cpuUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            {systemStatusLoading ? (
              <div className="text-2xl font-bold">{tc("loading")}</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div
                    className={`text-2xl font-bold ${systemStatus?.cpu?.usage_percent ? getStatusText(systemStatus.cpu.usage_percent).color : "text-muted-foreground"}`}
                  >
                    {systemStatus?.cpu?.usage_percent?.toFixed(1) || "0"}%
                  </div>
                  {systemStatus?.cpu?.usage_percent && (
                    <Badge
                      className={`${getStatusText(systemStatus.cpu.usage_percent).bgColor} ${getStatusText(systemStatus.cpu.usage_percent).color} border-0`}
                    >
                      {getStatusText(systemStatus.cpu.usage_percent).text}
                    </Badge>
                  )}
                </div>
                <Progress value={systemStatus?.cpu?.usage_percent || 0} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {systemStatus?.cpu?.usage_percent
                    ? getStatusText(systemStatus.cpu.usage_percent).text
                    : t("normalRange")}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("memoryUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            {systemStatusLoading ? (
              <div className="text-2xl font-bold">{tc("loading")}</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div
                    className={`text-2xl font-bold ${systemStatus?.memory?.percent ? getStatusText(systemStatus.memory.percent).color : "text-muted-foreground"}`}
                  >
                    {systemStatus?.memory?.percent?.toFixed(1) || "0"}%
                  </div>
                  {systemStatus?.memory?.percent && (
                    <Badge
                      className={`${getStatusText(systemStatus.memory.percent).bgColor} ${getStatusText(systemStatus.memory.percent).color} border-0`}
                    >
                      {getStatusText(systemStatus.memory.percent).text}
                    </Badge>
                  )}
                </div>
                <Progress value={systemStatus?.memory?.percent || 0} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {systemStatus?.memory?.used && systemStatus?.memory?.total
                    ? `${systemStatus.memory.used.toFixed(1)}GB / ${systemStatus.memory.total}GB`
                    : t("normalRange")}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("gpuUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            {systemStatusLoading ? (
              <div className="text-2xl font-bold">{tc("loading")}</div>
            ) : systemStatus?.gpu && systemStatus.gpu.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <div
                    className={`text-2xl font-bold ${systemStatus.gpu[0].gpu_percent ? getStatusText(systemStatus.gpu[0].gpu_percent).color : "text-muted-foreground"}`}
                  >
                    {systemStatus.gpu[0].gpu_percent?.toFixed(1) || "0"}%
                  </div>
                  {systemStatus.gpu[0].gpu_percent && (
                    <Badge
                      className={`${getStatusText(systemStatus.gpu[0].gpu_percent).bgColor} ${getStatusText(systemStatus.gpu[0].gpu_percent).color} border-0`}
                    >
                      {getStatusText(systemStatus.gpu[0].gpu_percent).text}
                    </Badge>
                  )}
                </div>
                <Progress value={systemStatus.gpu[0].gpu_percent || 0} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {systemStatus.gpu[0].memory_percent && systemStatus.gpu[0].memory_total
                    ? `${systemStatus.gpu[0].memory_used.toFixed(1)}GB / ${systemStatus.gpu[0].memory_total}GB`
                    : t("gpuRunning")}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-2xl font-bold text-muted-foreground">N/A</div>
                  <Badge className="bg-muted text-muted-foreground border-0">{t("noDevice")}</Badge>
                </div>
                <Progress value={0} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">{t("noGpuDevice")}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("serviceStatus")}</CardTitle>
          <CardDescription>{t("serviceStatusDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span>{t("vectorDatabase")}</span>
                <Badge className="bg-green-100 text-green-800">{t("statusNormal")}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">&nbsp;&nbsp;{t("totalSize")}:</span>
                <Badge className="bg-muted text-foreground">{formatBytes(vectorDbSizeBytes)}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("knowledgeGraph")}</span>
                <Badge className="bg-green-100 text-green-800">{t("statusNormal")}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  &nbsp;&nbsp;{t("entityCount")}:
                </span>
                {entityCount === null ? (
                  <Badge className="bg-muted text-foreground">{tc("loading")}</Badge>
                ) : (
                  <Badge className="bg-blue-100 text-blue-800">
                    {entityCount.toLocaleString()}
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  &nbsp;&nbsp;{t("relationCount")}:
                </span>
                {relationCount === null ? (
                  <Badge className="bg-muted text-foreground">{tc("loading")}</Badge>
                ) : (
                  <Badge className="bg-purple-100 text-purple-800">
                    {relationCount.toLocaleString()}
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span>{t("rpaEngine")}</span>
                <Badge className="bg-green-100 text-green-800">{t("statusNormal")}</Badge>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span>{t("apiGateway")}</span>
                <Badge className="bg-green-100 text-green-800">{t("statusNormal")}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("messageQueue")}</span>
                <Badge className="bg-yellow-100 text-yellow-800">{t("statusWarning")}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("dataBackup")}</span>
                <Badge className="bg-green-100 text-green-800">{t("statusNormal")}</Badge>
              </div>
              {(() => {
                const badge = getLicenseBadge(licenseStatus);
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={badge.warn ? "text-destructive font-medium" : ""}>
                        {t("license")}
                      </span>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </div>
                    {licenseStatus?.expires_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          &nbsp;&nbsp;{t("licenseExpiresAt")}:
                        </span>
                        <Badge className="bg-muted text-foreground">
                          {licenseStatus.expires_at.slice(0, 10)}
                        </Badge>
                      </div>
                    )}
                    {typeof licenseStatus?.days_remaining === "number" && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          &nbsp;&nbsp;{t("licenseDaysRemaining")}:
                        </span>
                        <Badge
                          className={
                            badge.warn
                              ? "bg-destructive/10 text-destructive border border-destructive/30"
                              : "bg-muted text-foreground"
                          }
                        >
                          {licenseStatus.days_remaining} {t("licenseDaysSuffix")}
                        </Badge>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      <ErrorLogCard />
    </div>
  );
}
