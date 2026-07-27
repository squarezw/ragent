"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Plus, Search, X } from "lucide-react";
import {
  addRequiresName,
  filterToolOptions,
  filterWorkflowOptions,
  groupToolOptions,
  removeRequiresName,
  resolveToolSelection,
  resolveWorkflowSelection,
  toggleRequiresName,
  type RequiresSelectionEntry,
} from "@/lib/skillRequires";
import type { RequiresToolOption, RequiresWorkflowOption } from "@/types/skill";

interface PickerOption {
  value: string;
  label: string;
  description: string | null;
  /** 停用的 workflow kind：可选但会导致 skill 不注入 */
  disabled: boolean;
}

interface PickerGroup {
  key: string;
  label: string;
  options: PickerOption[];
}

interface RequiresPickerProps {
  id: string;
  label: string;
  help: string;
  selected: string[];
  entries: RequiresSelectionEntry[];
  buildGroups: (query: string) => PickerGroup[];
  optionCount: number;
  onChange: (next: string[]) => void;
}

function RequiresPicker({
  id,
  label,
  help,
  selected,
  entries,
  buildGroups,
  optionCount,
  onChange,
}: RequiresPickerProps) {
  const t = useTranslations("skills");
  const [query, setQuery] = useState("");

  const groups = useMemo(() => buildGroups(query), [buildGroups, query]);
  const trimmed = query.trim();
  const alreadyAnOption = groups.some((group) =>
    group.options.some((option) => option.value === trimmed)
  );
  // 后端允许先写 skill 再上线工具，所以选项外的名字必须能加进来
  const canAddCustom = trimmed.length > 0 && !alreadyAnOption && !selected.includes(trimmed);

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-search`}>{label}</Label>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("requiresNoneSelected")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {entries.map((entry) => (
            <li key={entry.name}>
              <Badge
                variant="outline"
                className={
                  entry.known
                    ? entry.disabled
                      ? "gap-1 border-amber-300 text-amber-700 dark:text-amber-400"
                      : "gap-1"
                    : "gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                }
                title={
                  entry.known
                    ? entry.disabled
                      ? t("requiresDisabledHint")
                      : entry.displayName || entry.name
                    : t("requiresUnknownName")
                }
              >
                {(!entry.known || entry.disabled) && (
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                <span className="font-mono text-xs break-all">{entry.name}</span>
                {entry.displayName && entry.displayName !== entry.name && (
                  <span className="text-muted-foreground">· {entry.displayName}</span>
                )}
                <button
                  type="button"
                  className="ml-0.5 rounded-sm hover:bg-muted"
                  aria-label={`${t("requiresRemove")} ${entry.name}`}
                  onClick={() => onChange(removeRequiresName(selected, entry.name))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id={`${id}-search`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("requiresSearchPlaceholder")}
          className="pl-8"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAddCustom) {
              e.preventDefault();
              onChange(addRequiresName(selected, trimmed));
              setQuery("");
            }
          }}
        />
      </div>

      {optionCount === 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("requiresOptionsUnavailable")}
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
          {groups.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t("requiresNoMatch")}</p>
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
                  {group.label}
                </p>
                <ul>
                  {group.options.map((option) => {
                    const checkboxId = `${id}-${group.key}-${option.value}`;
                    return (
                      <li key={option.value}>
                        <label
                          htmlFor={checkboxId}
                          className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                        >
                          <Checkbox
                            id={checkboxId}
                            className="mt-0.5"
                            checked={selected.includes(option.value)}
                            onCheckedChange={() =>
                              onChange(toggleRequiresName(selected, option.value))
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium break-all">{option.label}</span>
                              {option.disabled && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 text-amber-700 dark:text-amber-400"
                                >
                                  {t("requiresDisabledBadge")}
                                </Badge>
                              )}
                            </span>
                            {/* 写进 requires 的是 name，不是展示名——两者都得看得见 */}
                            <span className="block font-mono text-xs text-muted-foreground break-all">
                              {option.value}
                            </span>
                            {option.disabled ? (
                              <span className="block text-xs text-amber-700 dark:text-amber-400">
                                {t("requiresDisabledHint")}
                              </span>
                            ) : (
                              option.description && (
                                <span className="block text-xs text-muted-foreground line-clamp-2">
                                  {option.description}
                                </span>
                              )
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      )}

      {canAddCustom && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            onChange(addRequiresName(selected, trimmed));
            setQuery("");
          }}
        >
          <Plus className="h-4 w-4 mr-2 shrink-0" />
          <span className="truncate">{t("requiresAddCustom", { name: trimmed })}</span>
        </Button>
      )}

      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export function RequiresToolsSelector({
  options,
  selected,
  onChange,
}: {
  options: RequiresToolOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("skills");

  const groupLabel = useCallback(
    (toolType: string) => {
      if (toolType === "mcp") return t("groupMcpTools");
      if (toolType === "native") return t("groupNativeTools");
      return t("groupOtherTools");
    },
    [t]
  );

  const buildGroups = useCallback(
    (query: string): PickerGroup[] =>
      groupToolOptions(filterToolOptions(options, query)).map((group) => ({
        key: group.toolType,
        label: groupLabel(group.toolType),
        options: group.items.map((item) => ({
          value: item.name,
          label: item.display_name,
          description: item.description || item.category,
          disabled: false,
        })),
      })),
    [options, groupLabel]
  );

  return (
    <RequiresPicker
      id="skill-requires-tools"
      label={t("requiresTools")}
      help={t("requiresToolsHelp")}
      selected={selected}
      entries={resolveToolSelection(selected, options)}
      buildGroups={buildGroups}
      optionCount={options.length}
      onChange={onChange}
    />
  );
}

export function RequiresWorkflowsSelector({
  options,
  selected,
  onChange,
}: {
  options: RequiresWorkflowOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("skills");

  const buildGroups = useCallback(
    (query: string): PickerGroup[] => {
      const items = filterWorkflowOptions(options, query);
      if (items.length === 0) return [];
      return [
        {
          key: "workflow",
          label: t("groupWorkflows"),
          options: items.map((item) => ({
            value: item.kind,
            label: item.display_name || item.kind,
            description: item.description,
            disabled: !item.is_enabled,
          })),
        },
      ];
    },
    [options, t]
  );

  return (
    <RequiresPicker
      id="skill-requires-workflows"
      label={t("requiresWorkflows")}
      help={t("requiresWorkflowsHelp")}
      selected={selected}
      entries={resolveWorkflowSelection(selected, options)}
      buildGroups={buildGroups}
      optionCount={options.length}
      onChange={onChange}
    />
  );
}
