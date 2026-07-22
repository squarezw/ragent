import { useState, useCallback } from "react";
import axios from "@/lib/axios";

export interface Segment {
  id: number;
  segment_index: number;
  segment_text: string;
  status: string;
  file_id: number;
  originalname: string;
  filename: string;
  mimetype: string;
  path: string;
}

export const useChatSegments = () => {
  const [segments, setSegments] = useState<{ [key: number]: Segment[] }>({});
  const [segmentsLoading, setSegmentsLoading] = useState<{ [key: number]: boolean }>({});

  // 获取指定消息的段落内容
  const fetchSegments = useCallback(
    async (segmentIds: number[], messageIndex: number) => {
      if (!segmentIds || segmentIds.length === 0) return;

      // 如果已经加载过，直接返回
      if (segments[messageIndex]) return;

      setSegmentsLoading((prev) => ({ ...prev, [messageIndex]: true }));
      try {
        const res = await axios.post("/api/knowledge/segments/by-ids", {
          segment_ids: segmentIds,
        });
        setSegments((prev) => ({ ...prev, [messageIndex]: res.data.segments }));
      } catch (error) {
        console.error("获取引用内容失败:", error);
      } finally {
        setSegmentsLoading((prev) => ({ ...prev, [messageIndex]: false }));
      }
    },
    [segments]
  );

  return {
    segments,
    segmentsLoading,
    fetchSegments,
  };
};
