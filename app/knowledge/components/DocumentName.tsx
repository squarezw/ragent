import { useLayoutEffect, useRef, useState } from "react";

// Keep grapheme clusters intact for CJK, combining accents and emoji filenames.
const graphemes = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function fitDocumentName(name: string, width: number, measure: (value: string) => number) {
  if (measure(name) <= width) return name;
  const parts = graphemes ? Array.from(graphemes.segment(name), part => part.segment) : Array.from(name);
  if (parts.length < 3) return name;

  let low = 2;
  let high = parts.length - 1;
  let best = parts[0] + "..." + parts[parts.length - 1];
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const candidate = parts.slice(0, Math.ceil(keep / 2)).join("") + "..." +
      parts.slice(-Math.floor(keep / 2)).join("");
    if (measure(candidate) <= width) {
      best = candidate;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  return best;
}

export function DocumentName({ name }: { name: string }) {
  const slot = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(name);
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const update = () => {
      const style = getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setVisible(fitDocumentName(name, element.clientWidth, text => context.measureText(text).width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    document.fonts.addEventListener("loadingdone", update);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [name]);
  return (
    <span ref={slot} className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-medium" title={name}>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">{visible}</span>
    </span>
  );
}
