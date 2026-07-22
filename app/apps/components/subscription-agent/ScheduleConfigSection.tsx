"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduleSettings } from "@/types/subscription-agent";

interface ScheduleConfigSectionProps {
  schedule: ScheduleSettings;
  onChange: (schedule: ScheduleSettings) => void;
}

// Generate hour options (00-23)
const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));

// Generate minute options (00, 15, 30, 45)
const minutes = ["00", "15", "30", "45"];

export function ScheduleConfigSection({ schedule, onChange }: ScheduleConfigSectionProps) {
  const t = useTranslations("apps");

  const [hour, minute] = (schedule.time || "10:00").split(":");

  const handleTimeChange = (newHour: string, newMinute: string) => {
    onChange({
      ...schedule,
      time: `${newHour}:${newMinute}`,
    });
  };

  return (
    <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
      <Label className="text-sm font-semibold">{t("scheduleConfig")}</Label>

      {/* Enable/Disable Switch */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label htmlFor="schedule-enabled" className="text-sm font-medium cursor-pointer">
            {t("enableSchedule")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("enableScheduleDesc")}</p>
        </div>
        <Switch
          id="schedule-enabled"
          checked={schedule.enabled}
          onCheckedChange={(checked) =>
            onChange({
              ...schedule,
              enabled: checked,
            })
          }
        />
      </div>

      {/* Time and Report Type Selection - Only show when enabled */}
      {schedule.enabled && (
        <div className="space-y-4 pt-2 border-t">
          {/* Schedule Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("scheduleTime")}</Label>
              <div className="flex items-center gap-2">
                <Select value={hour} onValueChange={(value) => handleTimeChange(value, minute)}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hours.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={minute} onValueChange={(value) => handleTimeChange(hour, value)}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {minutes.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Report Type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("reportType")}</Label>
              <Select
                value={schedule.report_type}
                onValueChange={(value: "daily" | "weekly") =>
                  onChange({
                    ...schedule,
                    report_type: value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t("dailyReport")}</SelectItem>
                  <SelectItem value="weekly">{t("weeklyReport")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Timezone - Read only */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("timezone")}:</span>
            <span className="font-medium">{schedule.timezone || "Asia/Shanghai"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
