/**
 * 把后端返回的扁平文件清单折成目录树，供前端渲染。
 *
 * 单独成模块是为了能单测：树的折叠与状态上卷是纯逻辑，混在组件里就只能靠
 * 肉眼看渲染结果，而「某个深层文件出错、但它所在的目录没标红」这种问题
 * 恰恰是肉眼最容易漏的。
 */

export type FileStatus = "ok" | "error" | "warning" | "skipped";

export interface ImportFileVerdict {
  path: string;
  size: number;
  status: FileStatus;
  kind?: string | null;
  reason?: string | null;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  /** 目录的状态由子孙上卷：只要有一个后代出错，这个目录就是 error */
  status: FileStatus;
  size: number;
  kind?: string | null;
  reason?: string | null;
  children: TreeNode[];
}

/** 严重程度序：error 最高，用于目录状态上卷 */
const SEVERITY: Record<FileStatus, number> = {
  error: 3,
  warning: 2,
  ok: 1,
  skipped: 0,
};

export function worseStatus(a: FileStatus, b: FileStatus): FileStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * 扁平清单 → 目录树。
 *
 * 目录状态取子孙里最严重的那个 —— 树默认折叠时，用户必须能从顶层目录的
 * 颜色看出「这里面有问题」，否则红标等于藏在折叠层里没人看见。
 */
export function buildTree(files: ImportFileVerdict[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirIndex = new Map<string, TreeNode>();

  const ensureDir = (dirPath: string): TreeNode | null => {
    if (!dirPath) return null;
    const existing = dirIndex.get(dirPath);
    if (existing) return existing;

    const segments = dirPath.split("/");
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join("/");
    const node: TreeNode = {
      name, path: dirPath, isDir: true, status: "skipped", size: 0, children: [],
    };
    dirIndex.set(dirPath, node);

    const parent = ensureDir(parentPath);
    (parent ? parent.children : roots).push(node);
    return node;
  };

  for (const f of files) {
    const segments = f.path.split("/");
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join("/");
    const node: TreeNode = {
      name, path: f.path, isDir: false, status: f.status,
      size: f.size, kind: f.kind, reason: f.reason, children: [],
    };
    const parent = ensureDir(parentPath);
    (parent ? parent.children : roots).push(node);
  }

  const rollUp = (node: TreeNode): FileStatus => {
    if (!node.isDir) return node.status;
    let status: FileStatus = "skipped";
    let size = 0;
    for (const child of node.children) {
      status = worseStatus(status, rollUp(child));
      size += child.size;
    }
    node.status = status;
    node.size = size;
    return status;
  };

  // 目录排前、同类按名字 —— 与文件管理器一致，用户不用重新学怎么读
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1);
    nodes.forEach((n) => sortTree(n.children));
  };

  roots.forEach(rollUp);
  sortTree(roots);
  return roots;
}

export function countByStatus(files: ImportFileVerdict[]): Record<FileStatus, number> {
  const out: Record<FileStatus, number> = { ok: 0, error: 0, warning: 0, skipped: 0 };
  for (const f of files) out[f.status] += 1;
  return out;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
