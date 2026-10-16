"use client";
import { LoginPage } from "@/components/login-page";
import type { SiteConfig } from "@/app/layout";
export default function IdentityLogin({
  uid,
  siteConfig,
}: {
  uid: string;
  siteConfig: SiteConfig;
}) {
  return (
    <LoginPage
      interactionUid={uid}
      siteConfig={siteConfig}
      onLogin={() => {
        throw Error("Central identity must finish issuer interaction");
      }}
    />
  );
}
