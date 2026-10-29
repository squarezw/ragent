/** Handle only file-bearing paste events; ordinary text stays with the browser. */
export function pasteChatAttachments(
  event: {
    clipboardData: Pick<DataTransfer, "files" | "items" | "getData">;
    currentTarget: Pick<
      HTMLTextAreaElement,
      "value" | "selectionStart" | "selectionEnd" | "setRangeText"
    >;
    preventDefault: () => void;
  },
  onFiles: (files: File[]) => void,
  onTextChange: (value: string) => void
): boolean {
  // Browsers may expose the same files in both collections. Never combine them.
  let files = Array.from(event.clipboardData.files);
  if (files.length === 0) {
    files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }
  if (files.length === 0) return false;

  event.preventDefault();
  // Preventing the file paste also suppresses text. Preserve mixed clipboard
  // text at the current selection without allowing the browser to insert twice.
  const text = event.clipboardData.getData("text/plain");
  if (text) {
    event.currentTarget.setRangeText(
      text,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd,
      "end"
    );
    onTextChange(event.currentTarget.value);
  }
  onFiles(files);
  return true;
}
