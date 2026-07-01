[English](README.en.md) · **中文**

# Ditto —— 模式路由式网站克隆器

> *ditto(名词):同上、再来一个 —— 一份精确的副本。*

**Ditto** 是一个开源的 [Claude Code](https://claude.com/claude-code) agent skill(可移植到 9+ 种其它
agent),用来逆向并克隆网站。它把两种经过验证的路线融合为一:

- **"真源码优先"** 的方法论严谨性 —— 先恢复真实源码,对每条实现结论打 `SOURCE`/`PARTIAL`/`GUESS`
  证据级别,并用客观的像素 + SSIM diff 验证;
- **foreman 编排** 的工程化 —— 干净的 Next.js / React / Tailwind / shadcn 重建目标,在 git worktree
  里并行的 builder 子 agent,以及始终可编译的构建。

单靠任一半都无法在 *"原样镜像"* 与 *"干净重建"* 之间做对选择。**Ditto 把"模式选择"变成第一决策。**

## 五种模式

Ditto 的核心特性是一棵决策树:把每个站点路由到最合适的策略,而不是用一种策略硬套所有站点。

| 模式 | 适用 | 做什么 |
|------|------|--------|
| **M1 · 静态镜像** | 纯静态 / 静态构建站,或已恢复真源码 | 字节级镜像 + 剥离追踪脚本 |
| **M2 · 框架重建** | 内容型站点(React/Vue/Next) | 灌入真实内容,重建进 Next.js 脚手架 |
| **M3 · API-Fixture 重建** | SPA / SaaS / 数据驱动 | 抓取 API fixtures + 本地 mock server |
| **M4 · 特效逆向** | WebGL / Canvas / Three.js 重特效 | 从源码逐行还原,或运行时 GL 帧捕获 |
| **M5 · 设计 DNA 换肤** | "保留观感、替换内容" | 提取设计 token,换肤 |

## 工作流(一条龙流水线)

1. **分诊 & 脚手架** —— 规范化 URL、确认浏览器后端、建立每个克隆的独立工作区。
2. **侦察 Recon** —— 1440/768/390 三视口截图、框架指纹、字体,**完整动态层清点**
   (视频 / canvas / 背景图 / 分层叠加),交互扫描。
3. **恢复源码** —— GitHub 搜索、sourcemap 还原、部署 slug 技巧、静态镜像。
4. **分级 & 路由** —— 复杂度 L1–L6 → 精确选择五种模式之一。
5. **构建** —— 先锁定 token/资源基座,再并行 spec-and-dispatch builder(重建模式),或全屏滚动镜像 /
   证据分级的特效逆向(忠实模式)。
6. **验证(loop)** —— 像素 + SSIM diff、结构对比、残留审计 —— 迭代到跨过阈值为止,如实汇报。
7. **化为己有** —— 剥离追踪脚本、替换文案/媒体/品牌、核查许可证。

## 安装

```bash
# 克隆到你的 Claude Code skills 目录(或用 skills 安装器):
git clone https://github.com/Onevium/ditto ~/.claude/skills/clone-website

# 安装脚本依赖(自动化工具链):
cd ~/.claude/skills/clone-website
npm install && npx playwright install chromium
```

然后直接对 Claude Code 说:**"clone https://example.com"**。

## 伦理与许可

Ditto 面向**学习与转化性创作**。它**不**用于钓鱼、仿冒,或把别人的网站冒充成自己的。它会剥离
logo、商标和受版权保护的内容并替换为你自己的,尊重 `robots.txt`/服务条款,绝不绕过登录或付费墙。
布局与配色本身不受版权保护,但一个可辨识品牌的整体"观感"可能受**商业外观(trade dress)**保护 ——
所以务必把它做成**你自己的**。详见 [`references/licensing.md`](references/licensing.md)。

## 项目结构

- [`SKILL.md`](SKILL.md) —— skill 本体:决策树。
- [`references/`](references/) —— 每个步骤一篇方法论文档,按需加载。
- `scripts/` —— 确定性的 Node/Playwright 自动化(recon、镜像、diff、审计、同步 …)。
- `dist/` —— 由 `scripts/sync-skills.mjs` 从 `SKILL.md` 生成的各平台命令文件。

## 状态

可用。`SKILL.md` + 13 篇 references 覆盖完整方法论;16 个 `scripts/` 已实现(带动态层清点的 recon、
computed-style 提取、素材抓取、像素 + SSIM 视觉 diff、残留审计、多平台同步)。欢迎贡献。

## 许可证

MIT —— 见 [`LICENSE`](LICENSE)。
