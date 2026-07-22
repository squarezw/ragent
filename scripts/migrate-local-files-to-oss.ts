/**
 * Migration script: Upload local files to OSS and update database URLs.
 *
 * Migrates:
 * 1. SOP images (public/sop-images/) → sop_detail.image_url
 * 2. System logos (public/uploads/) → system_settings.platform_logo
 *
 * Usage:
 *   # 试运行: 只扫描, 不上传不改库, 看看有多少需要迁移
 *   npx tsx scripts/migrate-local-files-to-oss.ts --dry-run
 *
 *   # 测试运行: 只迁移前 5 个, 上传到 OSS 并更新 DB, 输出验证信息
 *   npx tsx scripts/migrate-local-files-to-oss.ts --limit 5
 *
 *   # 正式运行: 迁移全部
 *   npx tsx scripts/migrate-local-files-to-oss.ts
 *
 * Requires env vars: DATABASE_URL, OSS_SERVICE_URL, OSS_API_KEY
 */

import fs from "fs";
import path from "path";
import { RagentOssClient } from "ragent-oss";
import pg from "pg";

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0; // 0 = unlimited

if (DRY_RUN) {
  console.log("🔍 DRY RUN mode — will scan only, no uploads, no DB changes\n");
} else if (LIMIT > 0) {
  console.log(`🧪 TEST mode — will migrate at most ${LIMIT} files, then stop\n`);
} else {
  console.log("🚀 FULL migration mode\n");
}

// ── Env ───────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const OSS_SERVICE_URL = process.env.OSS_SERVICE_URL;
const OSS_API_KEY = process.env.OSS_API_KEY;

if (!DATABASE_URL || !OSS_SERVICE_URL || !OSS_API_KEY) {
  console.error("Missing required env vars: DATABASE_URL, OSS_SERVICE_URL, OSS_API_KEY");
  process.exit(1);
}

const ossClient = new RagentOssClient({
  baseUrl: OSS_SERVICE_URL,
  apiKey: OSS_API_KEY,
});

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// The base URL for manual verification (user can override)
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Resolve a DB URL to a local filesystem path. Returns null if unrecognized. */
function resolveLocalPath(dbUrl: string): string | null {
  if (dbUrl.startsWith("/sop-images/")) {
    return path.join(process.cwd(), "public", dbUrl);
  }
  if (dbUrl.startsWith("/uploads/")) {
    return path.join(process.cwd(), "public", dbUrl);
  }
  if (dbUrl.startsWith("/api/uploads/")) {
    return path.join(process.cwd(), "public", "uploads", dbUrl.replace("/api/uploads/", ""));
  }
  return null;
}

interface MigrationResult {
  id: number;
  oldUrl: string;
  newUrl: string;
  objectKey: string;
  fileSize: number;
}

async function uploadLocalFileToOss(
  localPath: string,
  category: string
): Promise<{ objectKey: string; newUrl: string } | null> {
  if (!fs.existsSync(localPath)) {
    console.warn(`    ⚠ File not found: ${localPath}`);
    return null;
  }

  const filename = path.basename(localPath);
  const ext = path.extname(filename);
  const contentType = getMimeType(ext);
  const buffer = fs.readFileSync(localPath);

  const objectKey = await ossClient.upload({
    filename,
    content: buffer,
    contentType,
    category,
  });

  return { objectKey, newUrl: `/api/oss/${objectKey}` };
}

// ── SOP images ────────────────────────────────────────────

async function migrateSopImages(): Promise<MigrationResult[]> {
  console.log("=== SOP images (sop_detail.image_url) ===\n");

  const result = await pool.query(
    "SELECT id, image_url FROM sop_detail WHERE image_url IS NOT NULL AND image_url != '' ORDER BY id"
  );

  // Categorize
  const alreadyMigrated = result.rows.filter((r) => r.image_url.startsWith("/api/oss/"));
  const toMigrate = result.rows.filter((r) => !r.image_url.startsWith("/api/oss/"));

  console.log(`  Total with images:  ${result.rows.length}`);
  console.log(`  Already migrated:   ${alreadyMigrated.length}`);
  console.log(`  Need migration:     ${toMigrate.length}`);

  // Check local file existence
  let fileFound = 0;
  let fileMissing = 0;
  for (const row of toMigrate) {
    const localPath = resolveLocalPath(row.image_url);
    if (!localPath) {
      fileMissing++;
      continue;
    }
    if (fs.existsSync(localPath)) {
      fileFound++;
    } else {
      fileMissing++;
    }
  }
  console.log(`  Local file found:   ${fileFound}`);
  console.log(`  Local file missing: ${fileMissing}`);

  if (DRY_RUN) {
    // Show sample of what would be migrated
    const sample = toMigrate.slice(0, 10);
    if (sample.length > 0) {
      console.log(`\n  Sample (first ${sample.length}):`);
      for (const row of sample) {
        const localPath = resolveLocalPath(row.image_url);
        const exists = localPath && fs.existsSync(localPath);
        const size = exists ? formatBytes(fs.statSync(localPath!).size) : "—";
        console.log(`    id=${row.id}  ${row.image_url}  [${exists ? size : "MISSING"}]`);
      }
    }
    return [];
  }

  // Real migration
  const actualLimit = LIMIT > 0 ? Math.min(LIMIT, toMigrate.length) : toMigrate.length;
  const batch = toMigrate.slice(0, actualLimit);
  console.log(`\n  Migrating ${batch.length} of ${toMigrate.length}...\n`);

  const results: MigrationResult[] = [];
  let failed = 0;

  for (const row of batch) {
    const { id, image_url } = row;
    const localPath = resolveLocalPath(image_url);

    if (!localPath) {
      console.warn(`    ⚠ id=${id}: unrecognized URL format: ${image_url}`);
      failed++;
      continue;
    }

    try {
      const uploaded = await uploadLocalFileToOss(localPath, "sop-images");
      if (!uploaded) {
        failed++;
        continue;
      }

      await pool.query("UPDATE sop_detail SET image_url = $1 WHERE id = $2", [uploaded.newUrl, id]);

      const fileSize = fs.statSync(localPath).size;
      results.push({
        id,
        oldUrl: image_url,
        newUrl: uploaded.newUrl,
        objectKey: uploaded.objectKey,
        fileSize,
      });
      console.log(`    ✓ id=${id}  ${image_url} → ${uploaded.newUrl}`);
    } catch (error: any) {
      console.error(`    ✗ id=${id}  ${image_url}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n  Done: ${results.length} migrated, ${failed} failed`);
  return results;
}

// ── System logos ──────────────────────────────────────────

async function migrateSystemLogos(): Promise<MigrationResult[]> {
  console.log("\n=== System logos (system_settings.platform_logo) ===\n");

  const colCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'system_settings' AND column_name = 'platform_logo'
  `);

  if (colCheck.rows.length === 0) {
    console.log("  No platform_logo column found, skipping");
    return [];
  }

  const result = await pool.query(
    "SELECT id, platform_logo FROM system_settings WHERE platform_logo IS NOT NULL AND platform_logo != '' ORDER BY id"
  );

  const alreadyMigrated = result.rows.filter((r) => r.platform_logo.startsWith("/api/oss/"));
  const toMigrate = result.rows.filter((r) => !r.platform_logo.startsWith("/api/oss/"));

  console.log(`  Total with logos:   ${result.rows.length}`);
  console.log(`  Already migrated:   ${alreadyMigrated.length}`);
  console.log(`  Need migration:     ${toMigrate.length}`);

  if (DRY_RUN) {
    for (const row of toMigrate) {
      const localPath = resolveLocalPath(row.platform_logo);
      const exists = localPath && fs.existsSync(localPath);
      const size = exists ? formatBytes(fs.statSync(localPath!).size) : "—";
      console.log(`    id=${row.id}  ${row.platform_logo}  [${exists ? size : "MISSING"}]`);
    }
    return [];
  }

  const actualLimit = LIMIT > 0 ? Math.min(LIMIT, toMigrate.length) : toMigrate.length;
  const batch = toMigrate.slice(0, actualLimit);
  console.log(`\n  Migrating ${batch.length} of ${toMigrate.length}...\n`);

  const results: MigrationResult[] = [];
  let failed = 0;

  for (const row of batch) {
    const { id, platform_logo } = row;
    const localPath = resolveLocalPath(platform_logo);

    if (!localPath) {
      console.warn(`    ⚠ id=${id}: unrecognized URL format: ${platform_logo}`);
      failed++;
      continue;
    }

    try {
      const uploaded = await uploadLocalFileToOss(localPath, "system");
      if (!uploaded) {
        failed++;
        continue;
      }

      await pool.query("UPDATE system_settings SET platform_logo = $1 WHERE id = $2", [
        uploaded.newUrl,
        id,
      ]);

      const fileSize = fs.statSync(localPath).size;
      results.push({
        id,
        oldUrl: platform_logo,
        newUrl: uploaded.newUrl,
        objectKey: uploaded.objectKey,
        fileSize,
      });
      console.log(`    ✓ id=${id}  ${platform_logo} → ${uploaded.newUrl}`);
    } catch (error: any) {
      console.error(`    ✗ id=${id}  ${platform_logo}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n  Done: ${results.length} migrated, ${failed} failed`);
  return results;
}

// ── Verification output ──────────────────────────────────

function printVerificationTable(results: MigrationResult[]) {
  if (results.length === 0) return;

  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log("│           Manual verification checklist              │");
  console.log("└─────────────────────────────────────────────────────┘\n");
  console.log("Open these URLs in a browser to verify the images load correctly:\n");

  for (const r of results) {
    console.log(`  [id=${r.id}] ${formatBytes(r.fileSize)}`);
    console.log(`    OLD: ${APP_BASE_URL}${r.oldUrl}`);
    console.log(`    NEW: ${APP_BASE_URL}${r.newUrl}`);
    console.log("");
  }

  console.log("Verify that each NEW URL shows the same image as the OLD URL.");
  console.log("If everything looks good, run without --limit to migrate all files:");
  console.log("\n  npx tsx scripts/migrate-local-files-to-oss.ts\n");
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log(`OSS service: ${OSS_SERVICE_URL}`);
  console.log(`App base URL: ${APP_BASE_URL}  (override with APP_BASE_URL env var)\n`);

  // Verify OSS connectivity
  try {
    const health = await ossClient.health();
    console.log(`OSS health: ${health.status} (storage: ${health.storage})\n`);
  } catch (error: any) {
    console.error(`Cannot connect to OSS service: ${error.message}`);
    process.exit(1);
  }

  const sopResults = await migrateSopImages();
  const logoResults = await migrateSystemLogos();

  const allResults = [...sopResults, ...logoResults];

  if (!DRY_RUN && allResults.length > 0) {
    printVerificationTable(allResults);
  }

  if (DRY_RUN) {
    console.log("\n✅ Dry run complete. No changes were made.");
    console.log("To test with a small batch:\n");
    console.log("  npx tsx scripts/migrate-local-files-to-oss.ts --limit 5\n");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
