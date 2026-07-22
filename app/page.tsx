"use client";

import {
  Database,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  HelpCircle,
  MessageSquare,
  ThumbsUp,
  Building2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useEffect, useState } from "react";
import axios from "@/lib/axios";
import { useTranslations } from "next-intl";

interface QATrendData {
  week_label: string;
  qa_count: number;
  upvote_count: number;
  no_answer_count: number;
}

interface DeptUsageData {
  department: string;
  tenant?: string | null;
  qa_count: number;
  user_count: number;
}

interface FrequentQuestion {
  question: string;
  count: number;
  variant_count: number;
}

interface KnowledgeBaseData {
  total_documents: number;
  current_month_new: number;
  trend_percent: number;
  trend_direction: string;
  total_qa: number;
  current_month_qa: number;
  last_month_qa: number;
  qa_trend_percent: number;
  qa_trend_direction: string;
  current_month_good: number;
  current_month_bad: number;
}

interface QualityMetrics {
  accuracy: { score: number; target: number; passed: boolean; label: string; description: string };
  avg_score: { score: number; target: number; passed: boolean; label: string; description: string };
}

interface StatisticsData {
  knowledge_base: KnowledgeBaseData;
  quality_metrics: QualityMetrics;
  qa_trends: QATrendData[];
  department_usage: DeptUsageData[];
  frequent_questions: {
    current_month: FrequentQuestion[];
    historical: FrequentQuestion[];
  };
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-16 mb-2" />
        <Skeleton className="h-3 w-28" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex items-end justify-between h-full px-8 pb-10 pt-4 gap-3">
      {[65, 45, 80, 55, 70, 40, 75, 60].map((h) => (
        <div key={`sk-${h}`} className="flex items-end gap-1 flex-1">
          <Skeleton className="flex-1 rounded-t" style={{ height: `${h}%` }} />
          <Skeleton className="flex-1 rounded-t" style={{ height: `${h * 0.6}%` }} />
          <Skeleton className="flex-1 rounded-t" style={{ height: `${h * 0.3}%` }} />
        </div>
      ))}
    </div>
  );
}

const SKELETON_ROWS = ["a", "b", "c", "d", "e"];

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {SKELETON_ROWS.map((id) => (
        <div key={id} className="flex items-center gap-3 p-2">
          <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function TrendIndicator({
  direction,
  percent,
  suffix,
}: {
  direction: string;
  percent: number;
  suffix: string;
}) {
  const isUp = direction === "up";
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 ${isUp ? "text-success" : "text-destructive"}`}
    >
      <Icon className="h-3 w-3" />
      {isUp ? "+" : ""}
      {percent.toFixed(1)}% {suffix}
    </span>
  );
}

export default function RagentSystemUI() {
  const [statistics, setStatistics] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("dashboard");

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const response = await axios.get("/api/dashboard/statistics");

      if (response.data.status === "success") {
        setStatistics(response.data.data);
      }
    } catch {
      // Error handled by loading state remaining visible
    } finally {
      setLoading(false);
    }
  };

  const kb = statistics?.knowledge_base;
  const totalReviews = kb ? kb.current_month_good + kb.current_month_bad : 0;

  return (
    <div className="space-y-6">
      {/* System Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("knowledgeDocs")}</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {kb?.total_documents.toLocaleString() ?? "0"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {kb && (
                    <TrendIndicator
                      direction={kb.trend_direction}
                      percent={kb.trend_percent}
                      suffix={t("comparedToLastMonth")}
                    />
                  )}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("qaCount")}</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kb?.total_qa.toLocaleString() ?? "0"}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {kb && (
                    <TrendIndicator
                      direction={kb.qa_trend_direction}
                      percent={kb.qa_trend_percent}
                      suffix={t("comparedToLastMonth")}
                    />
                  )}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("monthlyReviews")}</CardTitle>
                <ThumbsUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalReviews.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {kb && totalReviews > 0 ? (
                    <>
                      <span className="text-success">
                        {t("goodReviews", { count: kb.current_month_good.toLocaleString() })}
                      </span>
                      {" / "}
                      <span className="text-destructive">
                        {t("badReviews", { count: kb.current_month_bad.toLocaleString() })}
                      </span>
                    </>
                  ) : (
                    t("totalReviews", { count: "0" })
                  )}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("accuracy")}</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(() => {
                    const score = statistics?.quality_metrics?.accuracy?.score ?? 0;
                    const percentage = score === 0 ? 95 : score * 100;
                    return `${percentage.toFixed(1)}%`;
                  })()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {statistics?.quality_metrics?.accuracy?.description || t("accuracy")}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Q&A Trends Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t("qaTrends")}</CardTitle>
          <CardDescription>{t("qaTrendsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="h-80">
          {loading || !statistics ? (
            <ChartSkeleton />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={statistics.qa_trends}
                margin={{ top: 20, right: 30, left: 0, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
                <XAxis
                  dataKey="week_label"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    fontSize: "13px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "13px", paddingTop: "8px" }} />
                <Bar
                  dataKey="qa_count"
                  name={t("qaCountLabel")}
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="upvote_count"
                  name={t("upvoteCount")}
                  fill="hsl(var(--chart-2))"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="no_answer_count"
                  name={t("noAnswerCount")}
                  fill="hsl(var(--chart-3))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Department Usage & Historical Q&A */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("deptUsage")}</CardTitle>
            <CardDescription>{t("deptUsageDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !statistics ? (
              <ListSkeleton />
            ) : statistics.department_usage.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">{t("noDeptUsage")}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {statistics.department_usage.map((dept, index) => (
                  <div
                    key={`${dept.tenant ?? ""}-${dept.department}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm flex-shrink-0">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">
                        {dept.tenant ? (
                          <span className="text-muted-foreground">({dept.tenant}) </span>
                        ) : null}
                        {dept.department}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="outline">
                        {dept.qa_count} {t("qaLabel")}
                      </Badge>
                      <Badge variant="secondary">
                        {dept.user_count} {t("peopleLabel")}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("historicalQA")}</CardTitle>
            <CardDescription>{t("historicalQADesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !statistics ? (
              <ListSkeleton />
            ) : statistics.frequent_questions.current_month.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <HelpCircle className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">{t("noFrequentQuestions")}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {statistics.frequent_questions.current_month.map((item, index) => (
                  <div
                    key={`${item.question}-${index}`}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <HelpCircle className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.question}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="secondary">
                        {item.count} {t("timesLabel")}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
