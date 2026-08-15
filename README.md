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
│    - company: 某公司    │        │  · 简历类型（每类一个 Git 分支）│
│      tags: [frontend]   │        │  · 简历定制（编排/YAML/预览） │
│      achievements: [...]│        │  · PDF 预览（按分支只读时间线）│
│  scripts/variants.yml   │        │  · Git 同步看板（提交/推送）   │
└─────────────────────────┘        └──────────────────────────────┘
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
> `npm install -g yamlresume`（[yamlresume 地址](https://www.npmjs.com/package/yamlresume)）。没有也不影响其他功能。

### 2. 准备私有数据仓（二选一）

- **管理端自动连接**：打开「设置」→「连接数据仓」，选择不存在或空目录时会自动生成骨架并执行 `git init`；
- **手动准备**：参考 [`templates/private-repo/`](./templates/private-repo/) 或
  [数据格式规范](./docs/DATA-FORMAT.md)，从零创建 `data/` + `scripts/variants.yml`。

### 3. 连接私有数据

打开「设置」，填入私有数据仓的**本地目录路径**（如 `E:\code\my-resume-data`）。

**GitHub 同步凭据会自动检测**：系统会优先从环境自动获取（`gh` CLI 登录态、`GITHUB_TOKEN`/`GH_TOKEN` 环境变量），
检测到后点「一键启用系统凭据」即可；获取不到时，设置页内置图文教程与链接（
[Fine-grained Token](https://github.com/settings/personal-access-tokens/new)、[Classic Token](https://github.com/settings/tokens)）引导你创建，
或先执行 `gh auth login` 再回来「重新检测」。

## 功能一览

| 页面 | 能力 |
| --- | --- |
| 总览 | 数据统计、仓库同步状态、最近提交、标签云、快捷入口 |
| 信息管理 | 分类管理（工作/教育/项目/技能/证书/兴趣/基础信息），标签筛选与搜索，可视化增删改，成就点逐条打标签 |
| 简历类型 | 轻量管理多个简历类型；每个类型对应 `resume/<type>` Git 分支，支持创建、切换、改名和删除 |
| 简历定制 | 在“可视化编排 / YAML 源码”间切换；选择全部模板（ModernCV/Jake/Jake 原版/Calm/VS Code），拖拽内容与章节或直接编辑全部 YAML 文件。未发布的可视化草稿按数据仓和简历类型自动保存在本机，返回页面或刷新后继续上次状态；“预览”只生成临时产物，“保存发布正式版”才保存配方并进入版本时间轴 |
| PDF 预览 | **按简历类型分支分类**查看本机正式版与 Git 提交/CI 时间线、对应版本文件和 YAML 数据快照；临时预览不会显示，页面严格只读 |
| Git 同步看板 | 分支/远程/领先落后/未同步文件可视化；提交、提交并推送、拉取；文件级 diff；提交历史时间线 |
| 设置 | 数据仓路径、**PDF 编译开关**、GitHub Token（**自动检测 + 教程引导**）、提交身份、隐私说明 |

## PDF 编译开关（设置页）

| 开关 | 默认 | 控制内容 |
| --- | --- | --- |
| **本地编译 PDF** | 开启 ✅ | 「简历定制」页预览或发布 LaTeX 版本时生成 PDF。**需要安装 [yamlresume](https://www.npmjs.com/package/yamlresume)**（`npm install -g yamlresume`）及 XeTeX/Tectonic 排版引擎 |
| **GitHub 编译 PDF** | 关闭 ❌ | 是否触发私有仓 GitHub Action；状态保存在本机并同步为 `RESUME_MANAGER_PDF_BUILD` Actions 仓库变量，不修改私有仓文件 |
| **GitHub star 徽章** | 开启 ✅ | 项目链接指向 GitHub 仓库时，在项目名后追加 shields.io 风格「stars + 1.1k」灰蓝双色徽章；**仅正式发布时拉取最新 star 数**，预览只读本机缓存不访问网络；0 star 不显示徽章 |

> 📌 **本地编译需要安装 yamlresume**：https://www.npmjs.com/package/yamlresume
> （`npm install -g yamlresume`）。未安装时无法在简历定制页生成 LaTeX PDF，其余功能不受影响。

## 隐私与安全

- 服务只监听 `127.0.0.1`；Token 与备注、类型展示信息等管理状态保存在 `~/.resume-manager/`（用户主目录，不进仓库）；标签库（`tags.yml`）与分类显示配置（`categories.yml`）随私有仓版本化，打包数据仓即可直接使用；
- 私有仓只保留简历内容、组稿所需的 `id/tags`、组稿规则与 CI，不保存管理端设置字段；
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
