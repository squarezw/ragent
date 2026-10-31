import { Building2, Globe, Lock, Users } from "lucide-react";

/** 资源共享范围图标，与知识库保持一致。 */
export default function VisibilityIcon({ visibility }: { visibility: string }) {
  const Icon = visibility === "private" ? Lock
    : visibility === "dept" ? Users
    : visibility === "tenant" ? Building2
    : visibility === "public" ? Globe
    : Users;
  return <Icon className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />;
}
