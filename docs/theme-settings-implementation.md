# 主题设置功能实现文档

## 概述

本功能实现了一个全局主题配置系统，允许超级管理员在系统设置中配置应用的主色调，配置后整个应用的 UI 会自动适应新的主题颜色。

## 技术栈

- **UI 框架**: shadcn/ui + Tailwind CSS
- **颜色转换**: colorjs.io（HEX → HSL）
- **状态管理**: SWR（数据获取和缓存）
- **持久化**: PostgreSQL 数据库

## 实现原理

### shadcn/ui 主题系统

shadcn/ui 使用 CSS 变量（HSL 格式）定义颜色，所有组件都引用这些变量。通过修改 `:root` 上的 CSS 变量，可以实现全局主题切换。

核心变量包括：
- `--primary` / `--primary-foreground`: 主色
- `--background` / `--foreground`: 背景和前景色
- `--card`, `--popover`, `--muted`, `--accent` 等: 各组件颜色
- `--sidebar-*`: 侧边栏专用颜色

### 工作流程

```
用户选择主色 #2563eb
        ↓
applyTheme() 实时预览（修改 CSS 变量）
        ↓
点击"保存配置"
        ↓
API 保存到数据库 (theme_primary_color)
        ↓
SWR 缓存更新，触发 useSystemSettings 重新获取
        ↓
其他页面/组件自动获得新主题
```

## 文件结构

### 新增文件

#### `lib/theme.ts`

主题工具函数库，包含：

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `ThemeColors` | interface | CSS 变量对象类型定义 |
| `ThemeConfig` | interface | 主题配置：`{ primaryColor: string, grayScale: GrayScale }` |
| `PRESET_PRIMARY_COLORS` | const | 8 种预设主色调 |
| `hexToHsl(hex)` | function | HEX 转 HSL 字符串 |
| `getContrastForeground(hex)` | function | 自动计算对比前景色 |
| `generateThemeColors(config)` | function | 生成完整 CSS 变量对象 |
| `applyTheme(config)` | function | 应用主题到 document |
| `resetTheme()` | function | 重置为默认主题 |
| `isValidHexColor(hex)` | function | 验证 HEX 颜色格式 |
| `getDefaultThemeConfig()` | function | 获取默认主题配置 |

### 修改文件

#### `hooks/useSystemSettings.ts`

- 添加 `theme_primary_color` 字段到 `SystemSettings` 接口
- 数据加载后自动调用 `applyTheme()` 应用主题
- 返回值添加 `themePrimaryColor`

#### `pages/api/system/index.ts`

- GET: 从数据库读取 `theme_primary_color` 字段
- PUT: 验证并保存主题配置到数据库
- 自动创建数据库字段（如果不存在）
- 验证：主色调必须是有效的 HEX 格式

#### `app/system-settings/page.tsx`

新的主题设置 UI：

```
┌─────────────────────────────────────────────────────────────┐
│ 主题设置                                                     │
├─────────────────────────────────────────────────────────────┤
│ 主色调                                                       │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ... ┌────────┐         │
│ │ 蓝色 │ │ 绿色 │ │ 紫色 │ │ 橙色 │     │ 自定义 │         │
│ │  ✓   │ │      │ │      │ │      │     │ [色盘] │         │
│ └──────┘ └──────┘ └──────┘ └──────┘     └────────┘         │
│                                                             │
│ 当前颜色: [#2563eb]                                          │
│                                                             │
│                   [重置为默认主题] [保存配置]                  │
└─────────────────────────────────────────────────────────────┘
```

## 数据库字段

在 `system_settings` 表中添加：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `theme_primary_color` | VARCHAR(20) | 主色调 HEX 值，如 `#2563eb` |

字段会在首次保存时自动创建。

## 预设主色调

| 名称 | HEX | 说明 |
|------|-----|------|
| 蓝色 | #2563eb | 专业、信任 |
| 绿色 | #10b981 | 成长、自然 |
| 紫色 | #8b5cf6 | 创意、科技 |
| 橙色 | #f97316 | 活力、热情 |
| 红色 | #ef4444 | 醒目、重要 |
| 青色 | #06b6d4 | 清新、现代 |
| 粉色 | #ec4899 | 温暖、友好 |
| 靛蓝 | #6366f1 | 高端、神秘 |

## 依赖

需要安装 colorjs.io：

```bash
pnpm add colorjs.io
```

## 使用示例

### 在组件中应用主题

主题通过 `useSystemSettings` hook 自动应用，无需手动处理。

### 手动应用主题

```typescript
import { applyTheme, generateThemeColors } from "@/lib/theme";

// 应用主题
applyTheme({
  primaryColor: "#2563eb",
  grayScale: "neutral",
});

// 或者获取 CSS 变量对象
const colors = generateThemeColors({
  primaryColor: "#2563eb",
  grayScale: "neutral",
});
console.log(colors["--primary"]); // "217 91% 60%"
```

### 验证颜色

```typescript
import { isValidHexColor } from "@/lib/theme";

isValidHexColor("#2563eb"); // true
isValidHexColor("2563eb");  // false
isValidHexColor("#fff");    // true
```

## 注意事项

1. **实时预览**: 修改主题时会立即应用到页面，页面本身就是预览效果
2. **权限**: 只有超级管理员可以修改系统主题
3. **默认值**: 如果未设置主题，使用黑色（#000000）作为默认主色
4. **兼容性**: 主题变更不影响已有的 Tailwind 类名，只影响 CSS 变量

## 后续优化建议

1. 支持暗色模式切换
2. 支持更多自定义变量（如圆角大小）
3. 添加主题导入/导出功能