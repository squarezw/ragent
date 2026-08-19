/**
 * 把「拖入的文件夹」与「拖入的 zip」归一成同一种文件树。
 *
 * 两种入口在这里合流，后端因此只认一种输入。分成两条路的代价是具体的：
 * 一边支持的边界情形另一边没有，最后长出「zip 能导、目录不能」这类
 * 只在其中一侧出现、又看不出为什么的 bug。
 */
import JSZip from "jszip";

export interface BundleFile {
  /** 相对路径，POSIX 分隔符。zip 与目录都规整到这一种形态 */
  path: string;
  size: number;
  bytes: Uint8Array;
}

/** 与后端 SKILL_ASSETS_MAX_TOTAL_BYTES 同值 —— 早点拦住，省一次 100MB 的往返 */
export const BUNDLE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** 单个文件上限，与后端 ASSET_MAX_BYTES 同值 */
export const BUNDLE_MAX_FILE_BYTES = 20 * 1024 * 1024;

export function isZipFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed";
}

/**
 * 从 zip 解出文件树。
 *
 * 目录项与 macOS 压缩时塞进来的 `__MACOSX/` 一并丢弃 —— 后者是资源分叉，
 * 不是 skill 的内容，留着会让用户在树里看到一堆莫名其妙的 `._xxx`。
 */
export async function readZip(file: File): Promise<BundleFile[]> {
  const zip = await JSZip.loadAsync(file);
  const out: BundleFile[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const path = normalizePath(entry.name);
    if (!path || path.startsWith("__MACOSX/")) continue;
    const bytes = await entry.async("uint8array");
    out.push({ path, size: bytes.byteLength, bytes });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 从 <input webkitdirectory> 或拖入的文件夹读出文件树。
 *
 * 相对路径优先取 `webkitRelativePath`：`file.name` 只有基名，拿它当路径会把
 * `scripts/run.py` 和 `references/run.py` 压成同一个 key。
 */
export async function readFileList(files: FileList | File[]): Promise<BundleFile[]> {
  const out: BundleFile[] = [];
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = normalizePath(rel && rel.length > 0 ? rel : f.name);
    if (!path || path.startsWith("__MACOSX/")) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    out.push({ path, size: bytes.byteLength, bytes });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 单个 .md 文件（不含 zip）。纯文档 skill 是常见形态。 */
export function isMarkdownFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".md") || file.type === "text/markdown";
}

/** 拖放事件里可能是文件夹（DataTransferItem），也可能是若干文件、一个 zip 或一个 .md。 */
export async function readDataTransfer(dt: DataTransfer): Promise<BundleFile[]> {
  const items = Array.from(dt.items || []);
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];

  // 只拖了一个 zip：走解压路径
  if (entries.length === 1 && entries[0].isFile && dt.files[0] && isZipFile(dt.files[0])) {
    return readZip(dt.files[0]);
  }

  // 只拖了一个 .md：当作 SKILL.md，**不管它原来叫什么名字**。
  //
  // 用户手上那个文件很可能叫 skill-x.md 或 SKILL(1).md —— 从别处另存下来时
  // 改了名。按原名传，后端会报"根目录缺少 SKILL.md"，而那个文件明明就在眼前，
  // 报错指向了错误的位置。单文件导入时文件名不携带信息，内容才是。
  if (entries.length === 1 && dt.files.length === 1 && isMarkdownFile(dt.files[0])) {
    const f = dt.files[0];
    const bytes = new Uint8Array(await f.arrayBuffer());
    return [{ path: "SKILL.md", size: bytes.byteLength, bytes }];
  }

  if (entries.length > 0 && entries.some((e) => e.isDirectory)) {
    const out: BundleFile[] = [];
    for (const entry of entries) {
      await walkEntry(entry, "", out);
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  return readFileList(dt.files);
}

/** 递归读目录项。File System Entry API 是回调式的，包一层 Promise。 */
async function walkEntry(entry: FileSystemEntry, prefix: string, out: BundleFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (path.split("/").some((seg) => seg === "__MACOSX")) return;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject));
    const bytes = new Uint8Array(await file.arrayBuffer());
    out.push({ path: normalizePath(path), size: bytes.byteLength, bytes });
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries 一次最多返回 100 项，必须反复读到空为止 ——
    // 只读一次会在超过 100 个文件的目录上静默丢文件，而且丢的正是排在后面的。
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject));
      for (const child of batch) {
        await walkEntry(child, path, out);
      }
    } while (batch.length > 0);
  }
}

/** 统一成 POSIX 相对路径：去掉开头的 ./ 与 /，反斜杠转正斜杠。 */
export function normalizePath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .trim();
}

/** 上传前的本地体检 —— 拦住不值得往返一次的情况。 */
export function precheck(files: BundleFile[]): string | null {
  if (files.length === 0) return "没有读到任何文件";

  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > BUNDLE_MAX_TOTAL_BYTES) {
    return `整包 ${(total / 1024 / 1024).toFixed(1)}MB 超过上限 ${
      BUNDLE_MAX_TOTAL_BYTES / 1024 / 1024}MB`;
  }
  return null;
}

/** 转成后端要的 base64 载荷。 */
export function toPayload(files: BundleFile[]): { files: { path: string; content_base64: string }[] } {
  return {
    files: files.map((f) => ({ path: f.path, content_base64: toBase64(f.bytes) })),
  };
}

/**
 * Uint8Array → base64。
 *
 * 分块喂给 String.fromCharCode：整包 apply 会在大文件上抛
 * "Maximum call stack size exceeded" —— 而且小文件测不出来，
 * 偏偏在用户导入一个真实规模的 skill 时才炸。
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
