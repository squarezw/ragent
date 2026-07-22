import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, locales, type Locale } from "./config";
import fs from "fs";
import path from "path";

/**
 * Load all namespace files for a given locale
 * This function dynamically loads all JSON files from messages/{locale}/ directory
 * and merges them into a single messages object
 */
async function loadNamespaceMessages(locale: Locale) {
  const messagesDir = path.join(process.cwd(), "messages", locale);

  // Check if the namespace directory exists
  if (!fs.existsSync(messagesDir)) {
    throw new Error(
      `Namespace directory not found: ${messagesDir}. Please ensure messages/${locale}/ exists with namespace JSON files.`
    );
  }

  const messages: Record<string, any> = {};

  // Read all JSON files in the namespace directory
  const files = fs.readdirSync(messagesDir).filter((file) => file.endsWith(".json"));

  if (files.length === 0) {
    throw new Error(
      `No translation files found in ${messagesDir}. Please add namespace JSON files.`
    );
  }

  for (const file of files) {
    const namespace = file.replace(".json", "");
    const filePath = path.join(messagesDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    messages[namespace] = JSON.parse(content);
  }

  return messages;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("locale")?.value as Locale | undefined;
  const locale = localeCookie && locales.includes(localeCookie) ? localeCookie : defaultLocale;

  return {
    locale,
    messages: await loadNamespaceMessages(locale),
  };
});
