import { notFound } from "next/navigation";
import IdentityLogin from "./IdentityLogin";
export const dynamic = "force-dynamic";
export default async function IdentityLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string | string[] }>;
}) {
  const { uid } = await searchParams;
  if (typeof uid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) notFound();
  return (
    <IdentityLogin
      uid={uid}
      siteConfig={{
        icpNumber: process.env.ICP_NUMBER?.trim() ?? "",
        icpBeianUrl: "https://beian.miit.gov.cn/",
      }}
    />
  );
}
