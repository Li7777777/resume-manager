# 开发文档（LLM / 开发者）

面向 AI 编码代理与贡献者的详尽工程文档。快速上手看 [AGENTS.md](../AGENTS.md)。

## 1. 架构总览

```
┌── 前端 src/ (React 18 + Vite + Tailwind 4) ──┐
│  pages/  Dashboard Entries Variants Customizer │
│          History GitBoard Settings              │
│  components/ ui.tsx YamlEditor YamlWorkspace   │
│  api.ts types.ts toast.tsx                    │
└──────────────┬────────────────────────────────┘
               │ HTTP /api（dev 时 Vite proxy → :8787）
┌──────────────▼────────────────────────────────┐
│  后端 server/ (Express, 纯 JS ESM)             │
│  index.js       入口：监听 127.0.0.1:8787     │
│  config.js      设置存取 ~/.resume-manager/   │
│  routes/api.js  全部 REST 端点                 │
│  lib/                                         │
│    data-store.js  data/*.yml 读写（元数据）   │
│    compose.js     组合引擎（配方 → 简历 YAML）│
│    builder.js     yamlresume 构建 PDF         │
│    git-service.js isomorphic-git 封装         │
└──────────────────────────────────────────────┘
               │ 指向用户配置的私有数据仓目录
               ▼
    E:\code\my-resume-data\  (私有仓库本地副本)
```

**关键设计**：管理端（公开仓库）是纯工具；私有仓保存简历内容与组稿所需规则，并随仓版本化标签库（`tags.yml`）与分类显示配置（`categories.yml`），打包数据仓即可直接使用。
`server/config.js` 把 Token/编译开关写到 `~/.resume-manager/settings.json`；`server/lib/manager-state.js` 按数据仓哈希把备注、类型展示名/分支映射、定制页草稿与最后工作区状态写到 `~/.resume-manager/repos/*.json`，二者都永不进入私有仓。

## 2. 运行方式

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 开发：Vite :5173（proxy /api → :8787）+ API :8787 |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 生产：单进程托管 dist + API（`NODE_ENV=production`） |
| `npm run typecheck` | 前端 TS 检查（`tsc --noEmit`） |

后端无构建步骤（纯 ESM JS）。Node >= 20。

## 3. 数据流

```
信息管理页  ──POST /api/entries/:cat──►  data-store.js ──► data/<cat>.yml
简历类型页  ──/api/resume-types───────►  git-service.js  ──► resume/<type> 分支
简历定制页  ──GET/PUT /api/custom/state►  按数据仓/类型恢复与自动保存本机草稿（不产生 Git diff）
             ├─POST /api/custom/preview─►  按当前草稿生成临时预览（不落盘、不进时间轴）
             └─POST /api/custom/release►  保存配方 + 归档正式版 + 写入时间轴
YAML 工作区  ──PUT /api/yaml───────────►  只保存源码；预览/发布由右侧独立按钮触发
PDF 预览页  ──GET /api/history?variant►  指定类型分支的正式版 + Git 提交/CI（只读）
Git 看板    ──/api/git/*────────────►  git-service.js ──► 仓库 .git（isomorphic-git）
```

组合引擎（`server/lib/compose.js`）语义契约见 [DATA-FORMAT.md](./DATA-FORMAT.md) 第 4-5 节。
它与私有仓 CI 的 `templates/private-repo/scripts/compose.py` 保持行为一致，修改时两者须同步。

## 4. REST API 参考

统一约定：请求体 JSON；响应 `{ok: boolean, ...}`；业务错误 `{ok: false, error}`，HTTP 400。

### 系统
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 版本 + 构建环境探测（yamlresume/xelatex/tectonic 是否在 PATH） |
| GET | `/api/settings` | 返回设置（token 打码为 `••••••`）；含编译开关 `localPdfBuild`（默认 true）/ `githubPdfBuild`（默认 false） |
| PUT | `/api/settings` | 保存设置；token 传 `••••••` 表示保持不变；编译开关接受 boolean |
| GET | `/api/github/autodetect` | 自动检测系统 GitHub 凭据（`GITHUB_TOKEN`/`GH_TOKEN` 环境变量、`gh auth token`），返回 `{found, source, username, token, tokenPreview}`（token 仅本机 localhost 返回） |
| GET | `/api/project/status` | 数据仓总览（配置/仓库/分支/HEAD/脏文件数/领先落后/最近提交） |

### 信息条目
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/entries` | 全部分类条目 + 标签计数 |
| GET | `/api/entries/:cat` | 单分类 |
| POST | `/api/entries/:cat` | 新增（basics 为整对象替换） |
| GET | `/api/entries/basics/photo` | 读取当前证件照（仅仓内固定路径，no-store） |
| POST | `/api/entries/basics/photo` | 上传/更换 JPEG 或 PNG 证件照（原始图片请求体，最大 4 MB） |
| DELETE | `/api/entries/basics/photo` | 删除证件照文件并清除 basics.photo |
| PUT | `/api/entries/:cat/reorder` | 按 id 顺序重排分类条目（写回 YAML 数组顺序） |
| PUT | `/api/entries/:cat/:id` | 更新（按 id） |
| DELETE | `/api/entries/:cat/:id` | 删除 |

### 简历类型 / YAML / 构建
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/resume-types` | 类型列表；合并 `variants.yml` 与 `resume/*` 分支，返回本地/远程/当前状态 |
| POST | `/api/resume-types` | 新建类型、创建 `resume/<name>` 分支并切换；要求工作区干净 |
| PUT | `/api/resume-types/:name` | 修改类型展示名称，类型标识与分支名保持稳定 |
| POST | `/api/resume-types/:name/ensure-branch` | 为旧类型初始化对应本地分支 |
| POST | `/api/resume-types/:name/checkout` | 安全切换类型分支；有未提交改动时拒绝 |
| DELETE | `/api/resume-types/:name` | 删除类型配置与本地分支（不自动删除远程分支，当前分支不可删除） |
| GET | `/api/variants` | 兼容层：类型内容/模板配置与命中统计；每项含 `branch` |
| PUT | `/api/variants` | 整体保存 variants 文档 `{defaults, variants}`（内部/兼容用途） |
| GET | `/api/files` | 可编辑文件列表 |
| GET | `/api/yaml?path=` | 读文件（路径必须位于数据仓内） |
| PUT | `/api/yaml` | 写文件（先做 YAML 语法校验） |
| POST | `/api/build` | 兼容 API：`{variant}` → 组合 + 构建；前端 PDF 预览页不调用此端点 |
| GET | `/api/pdf/history/:file` | Git/CI 历史版本 PDF 预览（`resumes/history/` 缓存目录） |
| GET | `/api/release/history/:file` | 读取本机正式版归档（HTML/PDF） |
| GET | `/api/history?variant=<type>` | 仅返回该类型 `resume/*` 分支的本机正式版、Git 提交与 CI 运行；旧预览记录过滤，按时间倒序 |
| GET | `/api/github/history/pdf?sha=&variant=` | 下载指定提交中该类型的 PDF 产物（缓存到 `resumes/history/`） |
| GET | `/api/git/file-at?sha=&path=` | 读取指定提交下的文件内容（仅限 `data/`、`scripts/`），历史版本 YAML 快照 |
| POST | `/api/github/pdf-sync` | 从私有仓 GitHub Actions 最近成功运行拉取 `resume-pdfs` artifact，解压 PDF 写入 `resumes/` 供预览（GitHub 编译方式的预览链路） |

### GitHub 编译开关（私有数据仓配置同步）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/github/pdf-config` | 读取 GitHub Actions 仓库变量 `RESUME_MANAGER_PDF_BUILD`，不读取私有仓文件 |
| POST | `/api/github/pdf-config` | 按本机 `githubPdfBuild` 设置创建/更新 Actions 仓库变量，不产生 Git diff（Token 需 Actions Variables 读写权限） |

### Git 看板
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/git/status` | 分支/远程/HEAD/变更文件（badge: added/modified/deleted/untracked）+ 领先落后 |
| GET | `/api/git/log?limit=` | 提交历史 |
| GET | `/api/git/diff?file=` | 单文件工作区 vs HEAD 行级 diff |
| POST | `/api/git/commit` | `{message}` 全量 add + commit |
| POST | `/api/git/fetch` | 抓取远程 |
| POST | `/api/git/pull` | fetch + fast-forward |
| POST | `/api/git/push` | 推送（需 settings.token，用户名 `x-access-token`） |

### 模板与定制
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/templates` | 全部官网 LaTeX/HTML 模板元数据；由简历定制页使用 || GET | `/api/html/:name` | 已生成的 HTML 简历预览（no-cache） |
| GET | `/api/custom/state` | 获取当前数据仓的最后简历类型、工作区模式、信息库分类与各类型可视化草稿（本机侧车） |
| PUT | `/api/custom/state` | 自动保存模板、章节顺序/选择；职业头衔和个人简介始终读取基础信息，不作为定制草稿保存 |
| POST | `/api/custom/preview` | `{variant, sections?, template?}`：可视化模式按当前草稿、YAML 模式按落盘文件生成临时 HTML/PDF；不保存配方、不写时间轴 |
| POST | `/api/custom/release` | `{variant, sections?, template?}`：保存可视化配方（YAML 模式直接使用落盘配置）、归档不可变 HTML/PDF 正式版并写入时间轴 |
| POST | `/api/custom/layout` | 旧客户端兼容端点，按“保存发布正式版”处理 |
| POST | `/api/template/apply` | 旧客户端兼容端点；当前 UI 不再使用，模板入口已合并至简历定制 |

### 模板
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/template/info` | 模板文件清单 |
| POST | `/api/project/init` | `{targetDir}` 复制 `templates/private-repo/` 到目标目录 |

## 5. 前端结构要点

- **页面切换**：`App.tsx` 用 state + hash 导航（`#/entries` 等可直达）；导航顺序为信息/类型/定制/PDF/Git，旧 `#/yaml` 自动重定向到 `#/customizer`，主内容区没有独立顶栏。
- **定制工作区**：`pages/Customizer.tsx` 在可视化编排与 YAML 源码间切换，右侧预览常驻；最后选中的类型/模式/信息库分类以及每个类型的模板、章节会自动保存到本机侧车并在重访时恢复；职业头衔和个人简介统一来自 `data/basics.yml`；`components/YamlWorkspace.tsx` 负责文件选择、未保存保护、CodeMirror 保存与同步状态。
- **组件库** `components/ui.tsx`：Button/Card/Field/Input/Textarea/Select/Modal/TagChip/TagInput/Badge/Spinner/EmptyState/relativeTime。
- **表单字段配置** `pages/Entries.tsx` 的 `FIELDS`：新增分类时在此登记字段（type: text/textarea/select/tags/summary/markdown/achievements），并同步 `server/lib/data-store.js` 的 `CATEGORIES`；项目要点使用专用 Markdown 编辑器，快捷工具栏和 Tab 缩进保留多级列表源码。
- **编辑器** `components/YamlEditor.tsx`：CodeMirror 6 + lang-yaml + oneDark。
- **PDF 渲染** `pages/History.tsx` + `components/PdfViewer.tsx`：按类型分支读取时间线与已有 PDF；pdfjs worker 通过 `?url` 导入；本页禁止构建。
- **Toast** `toast.tsx`：`useToast()` 返回 `(type, message) => void`。
- **样式** `src/styles.css`：Tailwind 4 `@theme` 定义字体；全站深色主题（zinc + indigo 强调色）。

## 6. 组合引擎（server/lib/compose.js）要点

- `listVariants(repo)`：解析 variants.yml + 计算每方向命中条目数（`matched`，供 UI 预览）。
- `generateAll(repo, only?)`：组合并写出 `resumes/<name>.yml`（含头部注释，null → 空值）。
- 字段映射：`company → name`；`achievements → summary`（按标签过滤）；列表 summary 转字符串；剥除元数据。
- PDF/HTML 紧凑输出：技能按细分方向（tags）分组为“方向：技能、技能”每方向一行，兴趣合并为单行；项目 description 组合为无项目符号的“项目背景：xxx”，summary 按 Markdown 多级列表渲染并保留加粗/斜体，旧纯文本兼容为顶级列表；LaTeX 原始 URL 改为项目名链接；中文优先使用 Microsoft YaHei（缺失时沿用模板的 Noto CJK 回退），HTML 同样以 Microsoft YaHei 为首选；`server/lib/builder.js` 与私有仓 `scripts/postprocess-output.py` 移除 yamlresume 模板强加的等级文本，并让 ModernCV/Jake 的标题首列和项目背景按正文宽度自然换行。
- 证件照：基础信息页把 JPEG/PNG 保存到私有仓 `assets/profile-photo.*`，`basics.photo` 只记录仓内路径；组合器剥离该字段以保持 YAMLResume schema 合法，`builder.js` / `postprocess-output.py` 再将照片作为不占正文排版宽度的独立页首浮层注入 ModernCV、Jake 和 HTML，Jake 原版也复用同一浮层逻辑；桌面/PDF 保持原文字几何，窄屏 HTML 将照片独立置于标题上方。
- 自定义模板 `jake-original`（Jake 原版）：`server/lib/jake-original.js` 从组合后的 YAML 直接生成 jakegut/resume.tex 风格 LaTeX（居中头部 + `\titlerule` 分节 + tabular* 日期右对齐 + 项目单行标题），`buildVariant` 检测到该模板时跳过 yamlresume 直接用 xelatex 编译。
- GitHub star 徽章：`server/lib/github-stars.js` 解析项目 URL，在项目名后追加 GitHub Logo + `owner/repo` 地址 + star 数徽章。**仅「保存发布正式版」时拉取 GitHub API 并写本机缓存** `~/.resume-manager/github-stars.json`（预览/组合只读缓存，不访问网络）；0 star 仍显示地址但不显示数量；项目背景 description 保留完整内容；设置页可关（`starsEnabled`，默认开）。
- 与 `templates/private-repo/scripts/compose.py` 行为一致——**改动任一实现必须同步另一份**，
  并以 `yamlresume validate` 验证输出（长度/必填规则）。

## 7. 测试清单（手动验收）

1. 设置指向一个**测试副本**数据仓（勿在真实仓上做破坏性操作）；
2. 信息管理：新增/编辑/删除条目、标签筛选、搜索；
3. 简历类型：为旧类型创建分支 → 切换类型 → 有未提交改动时验证切换被拒绝；
4. 简历定制：确认侧栏中位于 PDF 预览之前；“预览”不改 `variants.yml` 且不增加时间轴记录；“保存发布正式版”保存配方并增加正式版；YAML 保存只落盘，非法 YAML 保持未保存状态并显示错误；
5. 兼容路由：访问 `#/yaml` 自动进入 `#/customizer`，侧栏无独立 YAML 入口，主内容区无 header；
6. PDF 预览：切换类型后只出现该 `resume/*` 分支的正式版与 Git 记录，不出现预览结果，页面不存在构建/同步按钮；
7. Git 看板：改文件 → 状态出现 → 提交 → 推送（测试用一次性临时私有仓）；
8. 设置连接空目录：生成骨架 → 目录结构核对 → `yamlresume validate` 通过；
9. PDF 输出：生成包含长项目描述、技能和兴趣的 ModernCV 简历，确认 `.log` 无 `Overfull/Underfull`，技能按方向分组（如 `Agent：xxx、xxx`）分行、兴趣单行且均无模板等级/冒号；项目 `cventry` 中的“关键字”已改名为“技术栈”并另起一行，不被后处理误伤；项目/教育名称与日期同一行、日期右对齐。

## 8. 隐私红线（评审时检查）

- `server/` 不得输出任何用户数据到日志/响应之外的第三方；
- Token 与备注、类型展示名等管理状态只写 `~/.resume-manager/`；标签库与分类配置写入私有仓 `tags.yml`/`categories.yml`；
- 服务仅绑定 `127.0.0.1`；
- `templates/`、`docs/`、`src/` 不得包含真实个人信息（示例数据须明显标注）。

## 9. PDF 编译开关实现要点

- 设置键：`localPdfBuild`（默认 true）、`githubPdfBuild`（默认 false），只存于 `~/.resume-manager/settings.json`；
- 本地开关：`server/routes/api.js` 的兼容端点 `POST /api/build` 仍做服务端门控；当前 UI 的 LaTeX 构建入口只在简历定制页，PDF 预览页严格只读；
- GitHub 开关：workflow 读取 Actions 仓库变量 `RESUME_MANAGER_PDF_BUILD`；设置页通过 `/api/github/pdf-config` 调 GitHub REST API 同步变量，绝不创建/提交私有仓配置文件；
- 管理状态隔离：标签库与分类显示/排序/显隐随仓版本化（`tags.yml` / `categories.yml`，首次读取从侧车或旧 `tags.json`/`categories.json` 一次性迁移）；条目备注、类型展示名/分支映射仍位于 `~/.resume-manager/repos/<repo-hash>.json`；新增/删除分类以及修改真实简历字段仍会改变 `data/*.yml`；
- 代理支持：`server/lib/git-service.js` 读取 `HTTP(S)_PROXY` 环境变量，用 `https-proxy-agent` 包装 http 客户端注入每次请求（isomorphic-git 的 push 不透传 agent 参数，必须包装）；无代理变量时不影响；
- 修改 workflow 门控逻辑时，须同步更新模板与既有私有仓（两份 workflow 保持一致）。

## 9.1 GitHub 凭据自动检测实现要点

- 模块：`server/lib/github-auth.js`；检测顺序：`GITHUB_TOKEN`/`GH_TOKEN` 环境变量 → `gh auth token`（spawnSync，15s 超时）；
- 用户名反查：`gh api user --jq .login`（gh 源）或 `https://api.github.com/user`（best-effort，走 `HttpsProxyAgent`）；
- 前端：`src/pages/Settings.tsx` 挂载时自动调用 `GET /api/github/autodetect`；检测到 → 展示来源/用户/打码预览 + 「一键启用系统凭据」；未检测到且未配置 → 展示图文教程（Fine-grained/Classic Token 链接 + gh auth login）；
- 隐私：token 仅在本机 `127.0.0.1` 前端可用；检测结果不写日志。
