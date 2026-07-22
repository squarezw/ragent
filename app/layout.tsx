import "./globals.css";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import ConditionalAuthWrapper from "./components/ConditionalAuthWrapper";
import { FeaturesProvider, type Features } from "./components/FeaturesProvider";
import { isProcessMgmtEnabled } from "@/lib/features";

const siteConfig = {
  icpNumber: process.env.ICP_NUMBER?.trim() ?? "",
  icpBeianUrl: "https://beian.miit.gov.cn/",
} as const;

export type SiteConfig = typeof siteConfig;

// Must be evaluated server-side: PROCESS_MGMT_BASE_URL is a non-public env,
// invisible to client code. The boolean is then serialized through the provider.
function readFeatures(): Features {
  return {
    processManagement: isProcessMgmtEnabled(),
  };
}

export async function generateMetadata() {
  const t = await getTranslations("common");
  return {
    title: t("platformTitle"),
    description: t("platformDescription"),
    generator: "RAgent",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
      <body suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          <FeaturesProvider value={readFeatures()}>
            <ConditionalAuthWrapper siteConfig={siteConfig}>{children}</ConditionalAuthWrapper>
          </FeaturesProvider>
          <Toaster richColors position="bottom-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
