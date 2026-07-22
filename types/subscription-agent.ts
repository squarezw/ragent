export interface Feed {
  id: string;
  platform: "youtube" | "twitter";
  source_url: string;
  rsshub_route: string;
  status: "active" | "inactive" | "error";
  subscribed_at: string;
  last_fetch_at: string | null;
  last_fetch_status: "success" | "fail" | null;
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  summary: string | null;
  author: string | null;
  published_at: string;
  fetched_at: string;
}

export interface Summary {
  id: string;
  type: "daily" | "weekly";
  status: "pending" | "processing" | "completed" | "failed";
  period_start: string;
  period_end: string;
  platform_filter: "all" | "youtube" | "twitter";
  item_count: number;
  summary_text?: string;
  highlights?: Array<{
    platform: string;
    title: string;
    link: string;
    summary: string;
  }>;
  llm_model?: string;
  llm_tokens_input?: number;
  llm_tokens_output?: number;
  triggered_by: "scheduled" | "manual";
  created_at: string;
  updated_at?: string;
}

export interface StreamFeedFormItem {
  id: string;
  url: string;
  name: string;
  platform: "youtube" | "twitter";
}

export interface FeedItemsResponse {
  items: FeedItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  query?: {
    from: string | null;
    to: string | null;
  };
  warning?: {
    code: string;
    message: string;
    subscribed_at: string;
    incomplete_range: {
      from: string;
      to: string;
    };
  };
}

export interface SummaryListResponse {
  data: Summary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface GenerateSummaryRequest {
  feedIds?: string[];
  topic?: string;
  webhook_url?: string;
}

export interface GenerateSummaryResponse {
  type: "daily" | "weekly";
  status: "pending";
  summaryId: string;
  feedIds: string[] | null;
  topic: string | null;
  webhookUrl: string | null;
  period: {
    start: string;
    end: string;
  };
  message: string;
}

export interface ScheduleSettings {
  enabled: boolean;
  time: string; // "HH:mm" format, default "10:00"
  timezone: string; // default "Asia/Shanghai"
  report_type: "daily" | "weekly"; // default "daily"
  last_run_date?: string; // "YYYY-MM-DD" last execution date
  last_run_status?: "success" | "failed";
}
