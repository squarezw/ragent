/**
 * 生成内置头像 SVG 到 public/avatars/。
 *
 * 为什么预生成成文件、而不是运行时算或调 DiceBear 的在线 API：
 * 与既有内置头像同一条理由（见 public/avatars/README.md）——它们随代码走，
 * 每个部署都一样，离线环境也能用。客户现场（Zenner / 紫丹）不保证有外网，
 * 调 api.dicebear.com 会让所有头像变成裂图。
 * 所以 @dicebear/* 只作 devDependency，运行时不依赖它。
 *
 * 风格 notionists 是 CC0 1.0（作者 Zoish）——无署名义务，可商用。
 * 选它之前逐个查过 collection 里全部 31 种的授权：CC BY 4.0 的那些要求在
 * 产品里持续署名，卖给客户会把这个义务一并带过去，所以只在 CC0 / MIT 里挑。
 *
 * 跑法：node scripts/gen-avatars.mjs
 */
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "avatars");

// 底色沿用既有内置头像那套浅色系：选中的头像不跟随主题变色，
// 所以颜色必须写死在文件里（README 里那条约定）。
const BG = ["ede9fe", "dbeafe", "dcfce7", "fef3c7", "fee2e2", "e0e7ff"];

// seed 决定长相。写死而不是随机：随机会出现戴墨镜、比手势这类不职业的组合，
// 而且每次重跑都换一批脸 —— 用户选过的头像会在下次生成后变成另一个人。
// 文件名即 apps.avatar_url 存的那截路径，改名等于让已选它的员工裂图。
//
// 这 12 个是从 40 个候选里人工挑的：留衬衫/立领、表情平和的，
// 排掉波点衫、莫西干、露肩背心这类不像上班的。男女大致各半。
// 换 seed 前先把候选铺开看一遍，别直接改名单。
const PEOPLE = [
  "alice", "ben", "dave", "diana", "elena", "grace",
  "ivan", "jane", "lily", "mark", "opal", "wendy",
];

let n = 0;
for (const [i, seed] of PEOPLE.entries()) {
  const svg = createAvatar(notionists, {
    seed,
    size: 96,
    radius: 50,                    // 圆形，与既有头像一致
    backgroundColor: [BG[i % BG.length]],
    // 关掉手势与胸前图标：数字员工的头像不该在比划或挂着随机图案
    gestureProbability: 0,
    bodyIconProbability: 0,
    // 眼镜也关掉：11 种里含墨镜，随机到就成了「戴墨镜的数字员工」
    glassesProbability: 0,
  }).toString();
  writeFileSync(join(OUT, `p-${seed}.svg`), svg);
  n++;
}
console.log(`已生成 ${n} 个头像到 public/avatars/（notionists, CC0 1.0）`);
