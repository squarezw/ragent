#!/usr/bin/env node
/**
 * Check for missing i18n keys by scanning usage in code
 * Usage: node scripts/check-i18n-keys.js
 */

const fs = require("fs");
const path = require("path");

const MESSAGES_DIR = path.join(__dirname, "../messages");
const PROJECT_ROOT = path.join(__dirname, "..");
const LOCALES = ["en", "zh-CN"];

/**
 * Load all translation keys for a locale
 */
function loadAllKeys(locale) {
  const messagesDir = path.join(MESSAGES_DIR, locale);
  const allKeys = new Set();

  if (!fs.existsSync(messagesDir)) {
    return allKeys;
  }

  const files = fs.readdirSync(messagesDir).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    const namespace = file.replace(".json", "");
    const filePath = path.join(messagesDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));

    for (const key of Object.keys(content)) {
      allKeys.add(`${namespace}.${key}`);
    }
  }

  return allKeys;
}

/**
 * Find all translation key usage in code
 */
function findUsedKeys() {
  const usedKeys = new Set();
  const pattern = /t\(["']([^"']+)["']/g;
  const fileExtensions = [".tsx", ".ts", ".jsx", ".js"];

  function scanDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules and .next
      if (entry.name === "node_modules" || entry.name === ".next") {
        continue;
      }

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (fileExtensions.some((ext) => entry.name.endsWith(ext))) {
        const content = fs.readFileSync(fullPath, "utf8");

        // Find namespace from useTranslations calls
        const namespaceMatches = content.matchAll(/useTranslations\(["']([^"']+)["']\)/g);
        const getTranslationMatches = content.matchAll(/getTranslations\(["']([^"']+)["']\)/g);

        const namespaces = new Set();
        for (const match of namespaceMatches) {
          namespaces.add(match[1]);
        }
        for (const match of getTranslationMatches) {
          namespaces.add(match[1]);
        }

        // Find t() calls
        const keyMatches = content.matchAll(pattern);
        for (const match of keyMatches) {
          const key = match[1];
          // Add key with each found namespace
          for (const namespace of namespaces) {
            usedKeys.add(`${namespace}.${key}`);
          }
        }
      }
    }
  }

  scanDirectory(PROJECT_ROOT);
  return usedKeys;
}

/**
 * Main execution
 */
function main() {
  console.log("🔍 Checking i18n key usage...\n");

  // Load all available keys
  console.log("📚 Loading translation keys...");
  const keysByLocale = {};
  for (const locale of LOCALES) {
    keysByLocale[locale] = loadAllKeys(locale);
    console.log(`   ${locale}: ${keysByLocale[locale].size} keys`);
  }

  // Find used keys in code
  console.log("\n🔎 Scanning code for key usage...");
  const usedKeys = findUsedKeys();
  console.log(`   Found ${usedKeys.size} unique key references\n`);

  // Check for missing keys
  console.log("=".repeat(60));
  let hasIssues = false;

  for (const locale of LOCALES) {
    const availableKeys = keysByLocale[locale];
    const missingKeys = [];

    for (const key of usedKeys) {
      if (!availableKeys.has(key)) {
        missingKeys.push(key);
      }
    }

    if (missingKeys.length > 0) {
      hasIssues = true;
      console.log(`\n❌ Missing keys in ${locale}:`);
      for (const key of missingKeys.sort()) {
        console.log(`   - ${key}`);
      }
    } else {
      console.log(`\n✅ ${locale}: All used keys are defined`);
    }
  }

  // Compare locales for consistency
  console.log("\n" + "=".repeat(60));
  console.log("\n🔄 Checking locale consistency...\n");

  const [locale1, locale2] = LOCALES;
  const keys1 = keysByLocale[locale1];
  const keys2 = keysByLocale[locale2];

  const onlyIn1 = [...keys1].filter((key) => !keys2.has(key));
  const onlyIn2 = [...keys2].filter((key) => !keys1.has(key));

  if (onlyIn1.length > 0) {
    hasIssues = true;
    console.log(`⚠️  Keys only in ${locale1}:`);
    for (const key of onlyIn1.sort().slice(0, 10)) {
      console.log(`   - ${key}`);
    }
    if (onlyIn1.length > 10) {
      console.log(`   ... and ${onlyIn1.length - 10} more`);
    }
    console.log();
  }

  if (onlyIn2.length > 0) {
    hasIssues = true;
    console.log(`⚠️  Keys only in ${locale2}:`);
    for (const key of onlyIn2.sort().slice(0, 10)) {
      console.log(`   - ${key}`);
    }
    if (onlyIn2.length > 10) {
      console.log(`   ... and ${onlyIn2.length - 10} more`);
    }
    console.log();
  }

  if (!hasIssues) {
    console.log("✅ All locales are consistent!");
  }

  console.log("\n" + "=".repeat(60));
  console.log(hasIssues ? "\n❌ Issues found. Please fix missing keys." : "\n✅ No issues found!");

  process.exit(hasIssues ? 1 : 0);
}

main();
