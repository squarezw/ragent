"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Returns a time-based greeting based on the current hour.
 * Morning: 5:00 - 11:59
 * Afternoon: 12:00 - 17:59
 * Evening: 18:00 - 4:59
 */
export function useTimeGreeting() {
  const t = useTranslations("chat");

  const greeting = useMemo(() => {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) {
      return t("greetingMorning");
    } else if (hour >= 12 && hour < 18) {
      return t("greetingAfternoon");
    } else {
      return t("greetingEvening");
    }
  }, [t]);

  return greeting;
}
