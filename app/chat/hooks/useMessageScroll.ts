import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export function useMessageScroll(messages: any[], isStreaming: boolean, streamingMessage: string) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const lastScrollHeightRef = useRef(0);

  // 检查用户是否在底部附近
  const checkIfNearBottom = useCallback(() => {
    if (!messagesContainerRef.current) return false;
    const container = messagesContainerRef.current;
    const threshold = 50;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= threshold;
  }, []);

  // 自动滚动到底部
  const scrollToBottom = useCallback((force = false) => {
    if (messagesContainerRef.current) {
      if (!force && userScrolledAwayRef.current) {
        return;
      }
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  // 监听滚动事件
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isNearBottom = checkIfNearBottom();

      if (isNearBottom) {
        userScrolledAwayRef.current = false;
        isNearBottomRef.current = true;
      } else {
        isNearBottomRef.current = false;
        if (isStreaming) {
          userScrolledAwayRef.current = true;
        }
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    isNearBottomRef.current = checkIfNearBottom();

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [checkIfNearBottom, isStreaming]);

  // 当消息更新时自动滚动
  useLayoutEffect(() => {
    if (!userScrolledAwayRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  // 流式响应时：保持用户滚动位置或自动滚动
  useLayoutEffect(() => {
    if (isStreaming && streamingMessage) {
      const container = messagesContainerRef.current;
      if (!container) return;

      if (!userScrolledAwayRef.current) {
        scrollToBottom();
      }

      lastScrollHeightRef.current = container.scrollHeight;
    }
  }, [streamingMessage, isStreaming, scrollToBottom]);

  // 当流式响应开始时滚动到底部
  useEffect(() => {
    if (isStreaming) {
      userScrolledAwayRef.current = false;
      lastScrollHeightRef.current = messagesContainerRef.current?.scrollHeight || 0;
      scrollToBottom(true);
    }
  }, [isStreaming, scrollToBottom]);

  return {
    messagesContainerRef,
    messagesEndRef,
    scrollToBottom,
  };
}
