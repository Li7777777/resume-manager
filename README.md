# Resume Manager · 简历可视化管理系统

一个**独立的、现代化的简历管理网页**（公开项目）。它帮助你管理**私有数据仓**里的全部个人信息：
给每条经历/项目/技能打上方向标签，按需**动态组合出多份不同类型的简历**——而不是把一份简历拆成多个 YAML。

> ⚠️ **隐私模型**：本仓库（公开）**不包含任何你的数据**。你的简历信息只存在于你自己的
> **私有 GitHub 仓库**（如 `github.com/you/resume-data`，Private）。本管理端在本地运行，
> 通过配置指向该私有仓的本地目录进行管理，数据不出本机。

## 核心概念

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  私有数据仓 (PRIVATE)    │  ◄──── │  本管理端 (PUBLIC, 本地运行)   │
│                         │        │                              │
│  data/work.yml          │ 读写   │  · 信息管理（标签分类/增删改） │
│    - company: 某公司    │        │  · 简历方向（可视化配方）      │
│      tags: [frontend]   │        │  · YAML 编辑                  │
│      achievements: [...]│        │  · PDF 预览（本地构建）       │
│  scripts/variants.yml   │        │  · Git 同步看板（提交/推送）   │
│  .github/workflows      │        └──────────────────────────────┘
└─────────────────────────┘
        │ git push（数据流向 GitHub 私有仓，不经过第三方）
        ▼
  GitHub Actions 自动组合 + 构建 PDF → Artifact（私有保存）
```

## 快速开始

### 1. 安装依赖与构建

```sh
npm install
npm run build        # 构建前端（dist/）
npm start            # 启动服务: http://127.0.0.1:8787
```

开发模式：`npm run dev`（Vite dev server :5173 + API :8787）。

> 构建 PDF 需要本机安装 `yamlresume` CLI 与 XeTeX/Tectonic：
> `npm install -g yamlresume`。没有也不影响其他功能。

### 2. 准备私有数据仓（二选一）

- **用内置模板生成**：打开管理端 →「模板初始化」→ 填目标目录 → 生成骨架 → 推送到新建的
  GitHub **私有**仓库（页面提供可复制的命令）；
- **手动准备**：参考 [`templates/private-repo/`](./templates/private-repo/) 或
  [数据格式规范](./docs/DATA-FORMAT.md)，从零创建 `data/` + `scripts/variants.yml`。

### 3. 连接私有数据

打开「设置」，填入私有数据仓的**本地目录路径**（如 `E:\code\Tech7Resume`），
再填写 GitHub Token（fine-grained，Contents 读写）与提交身份，保存后即可开始管理。

## 功能一览

| 页面 | 能力 |
| --- | --- |
| 总览 | 数据统计、仓库同步状态、最近提交、标签云、快捷入口 |
| 信息管理 | 分类管理（工作/教育/项目/技能/证书/兴趣/基础信息），标签筛选与搜索，可视化增删改，成就点逐条打标签 |
| 简历方向 | 可视化编辑配方：按标签筛选各章节、模板、语言、章节顺序、基础信息覆盖；实时显示命中条目数 |
| YAML 编辑 | 内置 CodeMirror 语法高亮编辑全部数据文件，保存时校验 |
| PDF 预览 | 一键组合 + 本地构建 + 浏览器内渲染 PDF（缩放/下载） |
| Git 同步看板 | 分支/远程/领先落后/未同步文件可视化；提交、提交并推送、拉取；文件级 diff；提交历史时间线 |
| 模板初始化 | 按数据格式一键生成私有数据仓骨架 + 建仓推送指引 |
| 设置 | 数据仓路径、GitHub Token（仅存本机）、提交身份、隐私说明 |

## 隐私与安全

- 服务只监听 `127.0.0.1`；Token 保存在 `~/.resume-manager/settings.json`（用户主目录，不进仓库）；
- 所有数据读写都发生在你配置的私有数据仓目录内；
- `git push` 仅与 GitHub 私有仓库通信，不经过任何第三方服务；
- 本公开仓库不含 `data/`、不含 Token、不含任何个人信息。

## 文档

- [数据格式规范（私有仓）](./docs/DATA-FORMAT.md) —— 信息全集、元数据、标签、配方设计
- [开发文档（LLM / 开发者）](./docs/DEVELOPMENT.md) —— 架构、API、扩展指南
- [AGENTS.md](./AGENTS.md) —— 给 AI 编码代理的快速上手

## 技术栈

- 前端：Vite + React 18 + TypeScript + Tailwind CSS 4 + CodeMirror 6 + pdf.js
- 后端：Express 5 风格（当前 4.x）+ isomorphic-git（纯 JS git）+ js-yaml
- 构建 PDF：本地 `yamlresume` CLI（可选，CI 中由 GitHub Action 完成）

## License

MIT
