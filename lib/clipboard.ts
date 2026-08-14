/**
 * 复制文本到剪贴板。
 *
 * ## 为什么不能直接用 navigator.clipboard
 *
 * 异步 Clipboard API 只在**安全上下文**（https 或 localhost）里存在。而客户
 * 内网部署走的是纯 http + 内网 IP（例如 http://192.168.80.3:3001），在那里
 * `navigator.clipboard` 是 `undefined` —— 直接调用会抛 TypeError。
 *
 * 那种失败最难查：按钮点得动、没有任何提示、剪贴板里什么也没有。用户会以为
 * 自己复制成功了，粘贴出来才发现是上一次的内容。所以这里必须有兜底，
 * 且**必须把失败真的报出来**，不能吞掉。
 *
 * 兜底用 document.execCommand("copy")。它已被标记为废弃，但仍是非安全上下文
 * 下唯一可用的路径，且所有目标浏览器都还支持。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // 首选路径。isSecureContext 与 clipboard 都要判：某些浏览器在 http 下
  // 保留了 clipboard 对象但调用必定 reject。
  // window 也必须 typeof 判——服务端渲染时它不存在，直接取属性是 ReferenceError。
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 落到兜底 —— 权限被拒、文档失焦等都会走到这里
    }
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;

  const ta = document.createElement("textarea");
  ta.value = text;
  // readonly 防止移动端弹出软键盘
  ta.setAttribute("readonly", "");
  // 移出视口而不是 display:none —— 隐藏元素选不中，复制会静默失败。
  // 用 fixed 且不改 scrollTop，避免复制时页面跳动。
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";

  const previouslyFocused = document.activeElement as HTMLElement | null;

  document.body.appendChild(ta);
  try {
    ta.select();
    // iOS Safari 上 select() 不足以建立选区，必须显式给范围
    ta.setSelectionRange(0, ta.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    // 还原焦点，否则输入框会失焦、光标位置丢失
    previouslyFocused?.focus?.();
  }
}
