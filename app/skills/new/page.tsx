"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import SkillEditor from "../components/SkillEditor";
import type { SkillPayload } from "@/hooks/useSkills";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";

export default function NewSkillPage() {
  const router = useRouter();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { user, loading: userLoading } = useCurrentUser();
  const [saving, setSaving] = useState(false);

  const createSkill = async (payload: SkillPayload) => {
    const res = await axios.post("/api/v1/skills", payload);
    return res.data;
  };

  const handleSaveDraft = async (payload: SkillPayload) => {
    try {
      setSaving(true);
      const skill = await createSkill(payload);
      toast.success(t("createSuccess"));
      router.push(skill?.id ? `/skills/${skill.id}` : "/skills");
    } catch (error) {
      console.error("Create skill error:", error);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (payload: SkillPayload) => {
    try {
      setSaving(true);
      const skill = await createSkill(payload);
      if (skill?.id) {
        await axios.post(`/api/v1/skills/${skill.id}/publish`);
        toast.success(t("publishSuccess"));
        router.push(`/skills/${skill.id}`);
      } else {
        router.push("/skills");
      }
    } catch (error) {
      console.error("Create+publish skill error:", error);
    } finally {
      setSaving(false);
    }
  };

  if (userLoading || !user) {
    return <div className="flex items-center justify-center h-64">{tc("loading")}</div>;
  }

  if (!checkSuperAdmin(user) && !checkTenantAdmin(user)) {
    return <div className="flex items-center justify-center h-64">{t("noPermission")}</div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <SkillEditor
        skill={null}
        saving={saving}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
        onCancel={() => router.push("/skills")}
      />
    </div>
  );
}
