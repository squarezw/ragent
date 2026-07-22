#!/usr/bin/env node
/**
 * Check for missing i18n translation keys between locales AND in code usage
 * Prevents IntlError: MISSING_MESSAGE errors at runtime
 *
 * Usage:
 *   node scripts/check-missing-translations.js          # Normal output
 *   node scripts/check-missing-translations.js --json   # JSON output
 *   node scripts/check-missing-translations.js --verbose # Show all namespaces
 */

const fs = require("fs");
const path = require("path");

const MESSAGES_DIR = path.join(__dirname, "../messages");
const PROJECT_ROOT = path.join(__dirname, "..");
const LOCALES = ["en", "zh-CN"];
const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const SKIP_DIRS = ["node_modules", ".next", "dist", ".git"];

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const verbose = args.includes("--verbose");

/**
 * Recursively extract all keys from an object
 */
function extractKeys(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...extractKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Load all keys from a namespace file for a given locale
 */
function loadNamespaceKeys(locale, namespace) {
  const filePath = path.join(MESSAGES_DIR, locale, `${namespace}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return new Set(extractKeys(content));
  } catch (error) {
    console.error(`Error parsing ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Get all namespaces from all locales
 */
function getAllNamespaces() {
  const namespaces = new Set();
  for (const locale of LOCALES) {
    const localeDir = path.join(MESSAGES_DIR, locale);
    if (!fs.existsSync(localeDir)) continue;
    const files = fs.readdirSync(localeDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      namespaces.add(file.replace(".json", ""));
    }
  }
  return Array.from(namespaces).sort();
}

/**
 * Scan code files for translation key usage with smart variable tracking
 * Returns: Map<namespace, Set<key>>
 */
function scanCodeForUsedKeys() {
  const usedKeys = new Map(); // namespace -> Set of keys

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");

    // Track variable -> namespace mapping
    // Pattern: const t = useTranslations("namespace")
    // Pattern: const { t } = useTranslations("namespace") - not common
    // Pattern: const tApps = useTranslations("apps")
    const varToNamespace = new Map();

    // Find all useTranslations/getTranslations declarations
    // Match: const t = useTranslations("common")
    // Match: const tWorkflow = useTranslations("workflow")
    // Match: const t = await getTranslations("common")
    const declPattern =
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*["']([^"']+)["']\s*\)/g;
    let match;

    while ((match = declPattern.exec(content)) !== null) {
      const varName = match[1];
      const namespace = match[2];
      varToNamespace.set(varName, namespace);
    }

    if (varToNamespace.size === 0) return;

    // For each variable, find its usage: varName("key") or varName('key')
    for (const [varName, namespace] of varToNamespace) {
      // Escape special regex characters in variable name (though usually just letters)
      const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match varName("key") or varName('key') - be careful not to match other function calls
      const keyPattern = new RegExp(`\\b${escapedVar}\\s*\\(\\s*["']([^"']+)["']`, "g");

      while ((match = keyPattern.exec(content)) !== null) {
        const key = match[1];
        if (!usedKeys.has(namespace)) {
          usedKeys.set(namespace, new Set());
        }
        usedKeys.get(namespace).add(key);
      }
    }
  }

  function scanDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        scanFile(fullPath);
      }
    }
  }

  scanDirectory(PROJECT_ROOT);
  return usedKeys;
}

/**
 * Compare keys between locales for a namespace
 */
function compareNamespace(namespace) {
  const keysByLocale = {};
  for (const locale of LOCALES) {
    keysByLocale[locale] = loadNamespaceKeys(locale, namespace);
  }

  const result = {
    namespace,
    missing: {},
    filesMissing: [],
  };

  for (const locale of LOCALES) {
    if (keysByLocale[locale] === null) {
      result.filesMissing.push(locale);
    }
  }

  for (const locale of LOCALES) {
    if (keysByLocale[locale] === null) continue;
    result.missing[locale] = [];

    for (const otherLocale of LOCALES) {
      if (otherLocale === locale) continue;
      if (keysByLocale[otherLocale] === null) continue;

      for (const key of keysByLocale[otherLocale]) {
        if (!keysByLocale[locale].has(key)) {
          result.missing[locale].push(key);
        }
      }
    }
    result.missing[locale] = [...new Set(result.missing[locale])].sort();
  }

  return result;
}

/**
 * Check if keys used in code exist in all locales
 */
function checkCodeUsage(usedKeys) {
  const missingInCode = [];

  for (const [namespace, keys] of usedKeys) {
    const keysByLocale = {};
    for (const locale of LOCALES) {
      keysByLocale[locale] = loadNamespaceKeys(locale, namespace);
    }

    for (const key of keys) {
      const missingIn = [];
      for (const locale of LOCALES) {
        if (keysByLocale[locale] === null || !keysByLocale[locale].has(key)) {
          missingIn.push(locale);
        }
      }

      if (missingIn.length > 0) {
        missingInCode.push({ namespace, key, missingIn });
      }
    }
  }

  return missingInCode;
}

/**
 * Main execution
 */
function main() {
  const namespaces = getAllNamespaces();
  const results = [];
  let totalMissing = 0;
  const missingByLocale = {};

  for (const locale of LOCALES) {
    missingByLocale[locale] = 0;
  }

  // Phase 1: Compare all namespaces between locales
  for (const namespace of namespaces) {
    const result = compareNamespace(namespace);
    results.push(result);

    for (const locale of LOCALES) {
      if (result.missing[locale]) {
        missingByLocale[locale] += result.missing[locale].length;
        totalMissing += result.missing[locale].length;
      }
    }
    totalMissing += result.filesMissing.length * 10;
  }

  // Phase 2: Scan code for used keys and check if they exist
  const usedKeys = scanCodeForUsedKeys();
  const missingInCode = checkCodeUsage(usedKeys);

  // Output results
  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          totalMissing: totalMissing + missingInCode.length,
          missingByLocale,
          namespaces: results,
          missingInCode,
        },
        null,
        2
      )
    );
  } else {
    printReport(results, missingInCode, totalMissing, missingByLocale);
  }

  const hasIssues = totalMissing > 0 || missingInCode.length > 0;
  process.exit(hasIssues ? 1 : 0);
}

/**
 * Print formatted report
 */
function printReport(results, missingInCode, totalMissing, missingByLocale) {
  console.log("=".repeat(60));
  console.log("  i18n Translation Keys Check");
  console.log("=".repeat(60));

  // Part 1: Locale comparison
  let hasLocaleIssues = false;
  console.log("\n  [Locale Comparison]");

  for (const result of results) {
    const hasIssues =
      result.filesMissing.length > 0 || Object.values(result.missing).some((arr) => arr.length > 0);

    if (!hasIssues) {
      if (verbose) {
        console.log(`    [${result.namespace}] OK`);
      }
      continue;
    }

    hasLocaleIssues = true;
    console.log(`\n    [${result.namespace}]`);

    if (result.filesMissing.length > 0) {
      console.log(`       FILE MISSING: ${result.filesMissing.join(", ")}`);
    }

    for (const locale of LOCALES) {
      const missing = result.missing[locale] || [];
      if (missing.length > 0) {
        console.log(`       Missing in ${locale} (${missing.length}):`);
        for (const key of missing) {
          console.log(`         - ${key}`);
        }
      }
    }
  }

  if (!hasLocaleIssues) {
    console.log("    All locales are synchronized!");
  }

  // Part 2: Code usage check
  console.log("\n  [Code Usage Check]");

  if (missingInCode.length === 0) {
    console.log("    All keys used in code exist in translations!");
  } else {
    console.log(`    Found ${missingInCode.length} keys used in code but missing:\n`);

    const byNamespace = {};
    for (const item of missingInCode) {
      if (!byNamespace[item.namespace]) {
        byNamespace[item.namespace] = [];
      }
      byNamespace[item.namespace].push(item);
    }

    for (const [namespace, items] of Object.entries(byNamespace)) {
      console.log(`    [${namespace}]`);
      for (const item of items) {
        console.log(`       - "${item.key}" missing in: ${item.missingIn.join(", ")}`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  const totalIssues = totalMissing + missingInCode.length;
  if (totalIssues === 0) {
    console.log("  All translations are complete!");
  } else {
    console.log(`  Summary: ${totalIssues} issue(s) found`);
    if (totalMissing > 0) {
      console.log(`    - Locale sync issues: ${totalMissing}`);
    }
    if (missingInCode.length > 0) {
      console.log(`    - Missing keys in code: ${missingInCode.length}`);
    }
  }
  console.log("=".repeat(60));
}

main();
