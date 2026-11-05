import { redirect } from "next/navigation";

// Platform settings now live in the single System Settings page (super admins
// see the platform-wide sections there). Keep old links working.
export default function PlatformSettingsRedirect() {
  redirect("/system-settings");
}
