"use client";
import { useEffect, useRef, useState } from "react";

/** Animate only newly received text; restored snapshots and terminal output stay immediate. */
export function useStreamingText(text: string, enabled: boolean, identity: string | null) {
  const [visible, setVisible] = useState(text);
  const shown = useRef(text);
  const run = useRef(identity);

  const target = useRef(text);
  const frame = useRef<number | null>(null);
  const segmenter = useRef<Intl.Segmenter | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => {
    target.current = text;
    const reset = run.current !== identity || !enabled || !text.startsWith(shown.current);
    run.current = identity;
    if (reset || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      shown.current = text;
      setVisible(text);
      return;
    }
    if (shown.current === text || frame.current !== null) return;

    let lastPaint = performance.now();
    let started = lastPaint;
    const paint = (now: number) => {
      const elapsed = now - lastPaint;
      if (elapsed >= 32) {
        const pending = target.current.slice(shown.current.length);
        segmenter.current ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
        // Drain short bursts together and catch up to larger snapshots within a few frames.
        const budget = now - started >= 200 ? pending.length : Math.max(2, Math.floor(elapsed / 16), Math.ceil(pending.length / 5));
        let end = 0;
        for (const part of segmenter.current.segment(pending)) {
          end = part.index + part.segment.length;
          if (end >= budget) break;
        }
        shown.current += pending.slice(0, end);
        setVisible(shown.current);
        if (now - started >= 200) started = now;
        lastPaint = now;
      }
      frame.current = shown.current === target.current ? null : requestAnimationFrame(paint);
    };
    frame.current = requestAnimationFrame(paint);
  }, [text, enabled, identity]);

  if (run.current !== identity || !enabled || !text.startsWith(visible)) return text;
  return visible;
}
