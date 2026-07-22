import React from "react";
import { Handle, Position } from "reactflow";

interface BaseNodeProps {
  title: string;
  children: React.ReactNode;
  handles?: {
    source?: boolean;
    target?: boolean;
    refTarget?: boolean;
    refSource?: boolean;
  };
  minWidth?: number;
}

export default function BaseNode({
  title,
  children,
  handles = { source: true, target: true },
  minWidth = 120,
}: BaseNodeProps) {
  return (
    <div
      className="rounded-lg shadow-sm bg-card p-2 border-2 border text-left relative hover:shadow-md hover:border-primary transition-all cursor-pointer"
      style={{ minWidth: `${minWidth}px`, maxWidth: `${minWidth + 20}px` }}
    >
      <div className="font-medium text-[10px] mb-1 select-none text-foreground">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>

      {handles.source && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
        />
      )}
      {handles.target && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!w-3 !h-3 !bg-green-500 !border-2 !border-white"
        />
      )}
      {handles.refTarget && (
        <Handle
          type="target"
          position={Position.Top}
          id="ref-in"
          style={{ left: "50%" }}
          className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white"
        />
      )}
      {handles.refSource && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="ref-out"
          style={{ left: "50%" }}
          className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white"
        />
      )}
    </div>
  );
}
