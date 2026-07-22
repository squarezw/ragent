"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Users, Building2, Globe, Lock } from "lucide-react";

interface VisibilitySelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function VisibilitySelect({
  value,
  onChange,
  disabled = false,
  className = "",
}: VisibilitySelectProps) {
  const t = useTranslations("common");

  const visibilityOptions = [
    {
      value: "private",
      label: t("private"),
      description: t("privateDesc"),
      icon: Lock,
      color: "bg-muted text-foreground",
    },
    {
      value: "dept",
      label: t("deptShare"),
      description: t("deptShareDesc"),
      icon: Users,
      color: "bg-blue-100 text-blue-800",
    },
    {
      value: "tenant",
      label: t("tenantShare"),
      description: t("tenantShareDesc"),
      icon: Building2,
      color: "bg-purple-100 text-purple-800",
    },
    {
      value: "public",
      label: t("public"),
      description: t("publicDesc"),
      icon: Globe,
      color: "bg-green-100 text-green-800",
    },
  ];

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="text-sm font-medium">{t("visibilityScope")}</label>
      <div className="grid grid-cols-2 gap-2">
        {visibilityOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`
                p-3 border rounded-lg text-left transition-all
                ${isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-border"}
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className="h-4 w-4" />
                <span className="font-medium">{option.label}</span>
                {isSelected && <Badge className="ml-auto text-xs">{t("current")}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{option.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
