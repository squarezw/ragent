const SUBSCRIPTION_AGENT_API_URL = process.env.SUBSCRIPTION_AGENT_API_URL;
const SUBSCRIPTION_AGENT_API_KEY = process.env.SUBSCRIPTION_AGENT_API_KEY;

export interface GenerateSummaryParams {
  feedIds?: string[];
  topic?: string;
  webhook_url?: string;
}

/**
 * Generate daily summary (calls external Subscription Agent service)
 */
export async function generateDailySummary(params: GenerateSummaryParams) {
  if (!SUBSCRIPTION_AGENT_API_URL || !SUBSCRIPTION_AGENT_API_KEY) {
    throw new Error("Subscription Agent service is not configured");
  }

  const response = await fetch(`${SUBSCRIPTION_AGENT_API_URL}/api/summaries/generate/today`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUBSCRIPTION_AGENT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

/**
 * Generate weekly summary (calls external Subscription Agent service)
 */
export async function generateWeeklySummary(params: GenerateSummaryParams) {
  if (!SUBSCRIPTION_AGENT_API_URL || !SUBSCRIPTION_AGENT_API_KEY) {
    throw new Error("Subscription Agent service is not configured");
  }

  const response = await fetch(`${SUBSCRIPTION_AGENT_API_URL}/api/summaries/generate/week`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUBSCRIPTION_AGENT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}
