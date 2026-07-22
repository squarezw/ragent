"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Bell, RefreshCw } from "lucide-react";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default function HeaderActions() {
  const tc = useTranslations("common");
  return (
    <div className="flex items-center gap-4">
      <Button variant="outline" size="icon" className="h-8 w-8">
        <Bell className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      <LocaleSwitcher />
    </div>
  );
}
