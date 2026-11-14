"use client";
import { useEffect, useRef, useState } from "react";

/** Animate only newly received text; restored snapshots and terminal output stay immediate. */
export function useStreamingText(text: string, enabled: boolean, identity: string | null) {
  const [visible, setVisible] = useState(text);
  const shown = useRef(text);
  const run = useRef(identity);

  useEffect(() => {
    const reset = run.current !== identity || !enabled || !text.startsWith(shown.current);
    run.current = identity;
    if (reset || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shown.current = text;
      setVisible(text);
      return;
    }
    if (shown.current === text) return;

    const base = shown.current;
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const characters = Array.from(
      segmenter.segment(text.slice(base.length)),
      (part) => part.segment
    );
    // Small batches type naturally; large batches catch up instead of building a long queue.
    const interval = Math.min(18, 200 / characters.length);
    const start = performance.now();
    let frame: number;
    let count = 0;
    const paint = (now: number) => {
      const next = Math.min(characters.length, Math.floor((now - start) / interval));
      if (next > count) {
        shown.current += characters.slice(count, next).join("");
        count = next;
        setVisible(shown.current);
      }
      if (count < characters.length) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [text, enabled, identity]);

  if (run.current !== identity || !enabled || !text.startsWith(visible)) return text;
  return visible;
}
