"use client";

import { FileText } from "lucide-react";
import { workspaceUrl } from "@/lib/workspaceBrowser";
import { toPreviewResource, type PreviewResource } from "@/lib/chatResourcePreview";
import type { ChatTurnArtifact } from "@/lib/chatTurnArtifacts";

export default function ChatArtifactCards({ artifacts, onPreviewResource }: {
  artifacts?: ChatTurnArtifact[];
  onPreviewResource?: (resource: PreviewResource) => void;
}) {
  const documents = artifacts?.filter(file => /\.(?:pdf|docx?|dotx?|xlsx?|xltx?|xlsb)$/i.test(file.filename));
  if (!documents?.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {documents.map(file => {
        const url = workspaceUrl(file.url);
        const resource = toPreviewResource("url", file.url);
        const content = <>
          <FileText aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="break-all">{file.filename}</span>
        </>;
        const actionClass = "flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded p-2 text-left text-sm hover:bg-muted";
        return (
          <li key={file.id} className="flex max-w-full items-end rounded-md border">
            {resource && onPreviewResource ? (
              <button type="button" className={actionClass} onClick={() => onPreviewResource(resource)}>{content}</button>
            ) : (
              <a className={actionClass} href={url} target="_blank" rel="noopener noreferrer" download={resource ? undefined : file.filename.split("/").pop()}>{content}</a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
