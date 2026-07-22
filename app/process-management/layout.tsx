import { redirect } from "next/navigation";
import { isProcessMgmtEnabled } from "@/lib/features";

// Prefetch OnlyOffice's ~4 MB api.js in the background so first-open of the
// editor is fast. Kept in the layout (not the page) so it triggers on any
// process-management subroute.
export default function ProcessManagementLayout({ children }: { children: React.ReactNode }) {
  if (!isProcessMgmtEnabled()) {
    redirect("/");
  }

  const onlyofficeUrl = (
    process.env.ONLYOFFICE_URL || "http://localhost:8443"
  ).replace(/\/+$/, "");

  return (
    <>
      <link
        rel="prefetch"
        href={`${onlyofficeUrl}/web-apps/apps/api/documents/api.js`}
        as="script"
      />
      {children}
    </>
  );
}
