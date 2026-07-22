import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import {
  SEGMENT_ALL_BATCH_SIZE,
  SEGMENT_ALL_MAX_CONCURRENT_BATCHES,
} from "@/lib/knowledgeVectorizationConfig";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
const SUBMITTED_TTL_MS = 5 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = 5000;
const BATCH_STATUS_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RUNNING_FILES = SEGMENT_ALL_BATCH_SIZE * SEGMENT_ALL_MAX_CONCURRENT_BATCHES;

type QueueItem = {
  fileId: string;
  authHeader?: string;
};

type CandidateRow = {
  id: number;
};

const queue: QueueItem[] = [];
const queuedFileIds = new Set<string>();
const runningFileIds = new Set<string>();
const submittedFileIds = new Set<string>();
let isDraining = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildHeaders(authHeader?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authHeader) {
    headers.Authorization = authHeader;
  }

  return headers;
}

function isKnownInMemory(fileId: string) {
  return queuedFileIds.has(fileId) || runningFileIds.has(fileId) || submittedFileIds.has(fileId);
}

function rememberSubmitted(fileIds: string[]) {
  fileIds.forEach((fileId) => {
    submittedFileIds.add(fileId);
  });

  setTimeout(() => {
    fileIds.forEach((fileId) => {
      submittedFileIds.delete(fileId);
    });
  }, SUBMITTED_TTL_MS);
}

function forgetSubmitted(fileIds: string[]) {
  fileIds.forEach((fileId) => {
    submittedFileIds.delete(fileId);
  });
}

async function submitBatch(fileIds: string[], authHeader?: string) {
  fileIds.forEach((fileId) => {
    queuedFileIds.delete(fileId);
    runningFileIds.add(fileId);
  });

  await axios.post(
    `${EXTERNAL_API_BASE_URL}/api/v1/files/embed`,
    {
      file_ids: fileIds,
      force: false,
    },
    {
      timeout: 120000,
      headers: buildHeaders(authHeader),
    }
  );
  rememberSubmitted(fileIds);
}

async function fetchFileStatus(fileId: string) {
  const result = await pool.query<{ status?: string }>(
    "SELECT status FROM knowledge_files WHERE id = $1",
    [fileId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Failed to fetch file ${fileId} status: file not found`);
  }

  return result.rows[0].status;
}

async function waitForBatchCompletion(fileIds: string[]) {
  const deadline = Date.now() + BATCH_STATUS_TIMEOUT_MS;
  let latestBatchStatuses: Array<{ fileId: string; status?: string }> = [];
  const pendingFileIds = new Set(fileIds);

  while (Date.now() < deadline && pendingFileIds.size > 0) {
    const trackedFileIds = Array.from(pendingFileIds);
    const statuses = await Promise.all(trackedFileIds.map((fileId) => fetchFileStatus(fileId)));
    latestBatchStatuses = trackedFileIds.map((fileId, index) => ({
      fileId,
      status: statuses[index],
    }));
    const runningStatuses = latestBatchStatuses.filter(
      ({ status }) => status === "pending" || status === "processing"
    );
    const completedStatuses = latestBatchStatuses.filter(
      ({ status }) => status !== "pending" && status !== "processing"
    );

    console.info("[Vectorize Unsegmented] Batch status check:", {
      files: latestBatchStatuses,
      runningFiles: runningStatuses,
      completedFiles: completedStatuses,
    });

    if (completedStatuses.length > 0) {
      const completedFileIds = completedStatuses.map(({ fileId }) => fileId);
      completedFileIds.forEach((fileId) => {
        pendingFileIds.delete(fileId);
        runningFileIds.delete(fileId);
      });
      forgetSubmitted(completedFileIds);
      void drainQueue();
    }

    if (pendingFileIds.size === 0) {
      return;
    }

    await sleep(STATUS_POLL_INTERVAL_MS);
  }

  console.warn("[Vectorize Unsegmented] Batch status wait timed out:", {
    fileIds,
    latestStatuses: latestBatchStatuses,
  });
}

function startTrackedBatch(fileIds: string[], authHeader?: string) {
  const submitPromise = submitBatch(fileIds, authHeader);

  void submitPromise
    .then(() => waitForBatchCompletion(fileIds))
    .catch((error: unknown) => {
      console.error("[Vectorize Unsegmented] Batch failed:", error);
    })
    .finally(() => {
      fileIds.forEach((fileId) => {
        runningFileIds.delete(fileId);
      });
      void drainQueue();
    });

  return submitPromise;
}

function enqueueFiles(items: QueueItem[]) {
  let enqueuedCount = 0;

  for (const item of items) {
    if (isKnownInMemory(item.fileId)) {
      continue;
    }

    queue.push(item);
    queuedFileIds.add(item.fileId);
    enqueuedCount += 1;
  }

  return enqueuedCount;
}

function takeNextBatch(maxBatchSize: number) {
  if (maxBatchSize <= 0) {
    return [];
  }

  const first = queue.shift();
  if (!first) {
    return [];
  }

  queuedFileIds.delete(first.fileId);
  const batch = [first];

  // Keep each external request under one auth context.
  for (let i = 0; i < queue.length && batch.length < maxBatchSize; ) {
    if (queue[i].authHeader === first.authHeader) {
      const [item] = queue.splice(i, 1);
      queuedFileIds.delete(item.fileId);
      batch.push(item);
    } else {
      i += 1;
    }
  }

  return batch;
}

async function drainQueue() {
  if (isDraining) {
    return;
  }

  isDraining = true;

  try {
    while (queue.length > 0 && runningFileIds.size < MAX_RUNNING_FILES) {
      const availableSlots = MAX_RUNNING_FILES - runningFileIds.size;
      const batch = takeNextBatch(Math.min(SEGMENT_ALL_BATCH_SIZE, availableSlots));
      if (batch.length === 0) {
        break;
      }

      const fileIds = batch.map((item) => item.fileId);
      const authHeader = batch[0]?.authHeader;

      startTrackedBatch(fileIds, authHeader).catch((error: unknown) => {
        console.error("[Vectorize Unsegmented] Background batch failed:", error);
      });
    }
  } finally {
    isDraining = false;

    if (queue.length > 0 && runningFileIds.size < MAX_RUNNING_FILES) {
      void drainQueue();
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { dataset_id } = req.body;

  if (!dataset_id || typeof dataset_id !== "string") {
    return res.status(400).json({ error: "dataset_id is required" });
  }

  const authHeader =
    typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;

  const client = await pool.connect();
  try {
    const canEditRes = await client.query("SELECT can_edit_dataset($1, $2) as can_edit", [
      userId,
      dataset_id,
    ]);

    if (!canEditRes.rows[0]?.can_edit) {
      return res.status(403).json({ error: "没有权限处理此知识库" });
    }

    const candidatesRes = await client.query<CandidateRow>(
      `
        SELECT id
        FROM knowledge_files
        WHERE dataset_id = $1
          AND status IN ('pending', 'failed')
        ORDER BY upload_time ASC
      `,
      [dataset_id]
    );

    const candidateIds = candidatesRes.rows.map((row) => String(row.id));
    const availableIds = candidateIds.filter((fileId) => !isKnownInMemory(fileId));
    let skippedCount = candidateIds.length - availableIds.length;

    if (availableIds.length === 0) {
      return res.status(200).json({
        started_count: 0,
        queued_count: 0,
        skipped_count: skippedCount,
        total_candidates: candidateIds.length,
      });
    }

    const availableSlots = MAX_RUNNING_FILES - runningFileIds.size;
    const firstBatch =
      availableSlots > 0
        ? availableIds.slice(0, Math.min(SEGMENT_ALL_BATCH_SIZE, availableSlots))
        : [];
    const remainingIds =
      firstBatch.length > 0 ? availableIds.slice(firstBatch.length) : availableIds;

    if (firstBatch.length > 0) {
      await startTrackedBatch(firstBatch, authHeader);
    }

    const queuedCount = enqueueFiles(remainingIds.map((fileId) => ({ fileId, authHeader })));
    skippedCount += remainingIds.length - queuedCount;
    void drainQueue();

    return res.status(200).json({
      started_count: firstBatch.length,
      queued_count: queuedCount,
      skipped_count: skippedCount,
      total_candidates: candidateIds.length,
    });
  } catch (error: unknown) {
    console.error("[Vectorize Unsegmented] Error:", error);

    if (axios.isAxiosError(error)) {
      if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
        return res.status(503).json({
          error: "Vectorization service unavailable",
          message: "Please check if the Python backend service is running.",
        });
      }

      if (error.code === "ETIMEDOUT" || error.message.includes("timeout")) {
        return res.status(504).json({
          error: "Vectorization request timed out",
          message: "The service may be overloaded.",
        });
      }

      if (error.response?.status) {
        const responseData = error.response.data as { message?: string } | undefined;
        return res.status(error.response.status).json({
          error: "Vectorization service error",
          message: responseData?.message || error.message,
        });
      }
    }

    return res.status(500).json({
      error: "Vectorization failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    client.release();
  }
}
