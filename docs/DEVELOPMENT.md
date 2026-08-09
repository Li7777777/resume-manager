# 开发文档（LLM / 开发者）

面向 AI 编码代理与贡献者的详尽工程文档。快速上手看 [AGENTS.md](../AGENTS.md)。

## 1. 架构总览

```
┌── 前端 src/ (React 18 + Vite + Tailwind 4) ──┐
│  pages/  Dashboard Entries Variants YamlPage │
│          PdfPreview GitBoard Templates Settings│
│  components/ ui.tsx YamlEditor.tsx            │
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

**关键设计**：管理端（公开仓库）是纯工具；所有用户数据在私有数据仓目录中。
`server/config.js` 把 Token 等敏感配置写到 `~/.resume-manager/settings.json`，永不进项目。

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
简历方向页  ──PUT /api/variants──────►  compose.js     ──► scripts/variants.yml
PDF 预览页  ──POST /api/build────────►  compose.generateAll + builder.buildVariant ──► resumes/<v>.pdf
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
| PUT | `/api/entries/:cat/:id` | 更新（按 id） |
| DELETE | `/api/entries/:cat/:id` | 删除 |

### 方向 / YAML / 构建
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/variants` | 方向列表（含每个方向的命中条目统计 `matched`）+ defaults |
| PUT | `/api/variants` | 整体保存 variants 文档 `{defaults, variants}` |
| GET | `/api/files` | 可编辑文件列表 |
| GET | `/api/yaml?path=` | 读文件（路径必须位于数据仓内） |
| PUT | `/api/yaml` | 写文件（先做 YAML 语法校验） |
| POST | `/api/build` | `{variant}` → 组合 + 构建 → `{pdf: "/api/pdf/<v>.pdf"}`；**受 `localPdfBuild` 开关门控（服务端强制）** |
| GET | `/api/pdf/:name` | 流式返回 PDF |

### GitHub 编译开关（私有数据仓配置同步）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/repo/pdf-config` | 读取私有仓 `resume-manager.config.json` 的 `githubPdfBuild` 状态 |
| POST | `/api/repo/pdf-config` | 把当前设置写入私有仓配置文件；`{commit, push}` 可选提交/推送（push 需 Token） |

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

### 模板
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/template/info` | 模板文件清单 |
| POST | `/api/project/init` | `{targetDir}` 复制 `templates/private-repo/` 到目标目录 |

## 5. 前端结构要点

- **页面切换**：`App.tsx` 用 state 切换 + 轻量 hash 导航（`#/entries` 等可直达）；新增页面 = 写 `pages/X.tsx` + 在 `NAV`/`TITLES` 注册。
- **组件库** `components/ui.tsx`：Button/Card/Field/Input/Textarea/Select/Modal/TagChip/TagInput/Badge/Spinner/EmptyState/relativeTime。
- **表单字段配置** `pages/Entries.tsx` 的 `FIELDS`：新增分类时在此登记字段（type: text/textarea/select/tags/summary/achievements），并同步 `server/lib/data-store.js` 的 `CATEGORIES`。
- **编辑器** `components/YamlEditor.tsx`：CodeMirror 6 + lang-yaml + oneDark。
- **PDF 渲染** `pages/PdfPreview.tsx`：pdfjs-dist v4，worker 通过 `?url` 导入。
- **Toast** `toast.tsx`：`useToast()` 返回 `(type, message) => void`。
- **样式** `src/styles.css`：Tailwind 4 `@theme` 定义字体；全站深色主题（zinc + indigo 强调色）。

## 6. 组合引擎（server/lib/compose.js）要点

- `listVariants(repo)`：解析 variants.yml + 计算每方向命中条目数（`matched`，供 UI 预览）。
- `generateAll(repo, only?)`：组合并写出 `resumes/<name>.yml`（含头部注释，null → 空值）。
- 字段映射：`company → name`；`achievements → summary`（按标签过滤）；列表 summary 转字符串；剥除元数据。
- 与 `templates/private-repo/scripts/compose.py` 行为一致——**改动任一实现必须同步另一份**，
  并以 `yamlresume validate` 验证输出（长度/必填规则）。

## 7. 测试清单（手动验收）

1. 设置指向一个**测试副本**数据仓（勿在真实仓上做破坏性操作）；
2. 信息管理：新增/编辑/删除条目、标签筛选、搜索；
3. 简历方向：新增方向 → 保存 → PDF 页构建 → 预览；
4. YAML 页：修改保存、非法 YAML 报错回滚；
5. Git 看板：改文件 → 状态出现 → 提交 → 推送（测试用一次性临时私有仓）；
6. 模板初始化：生成 → 目录结构核对 → `yamlresume validate` 通过。

## 8. 隐私红线（评审时检查）

- `server/` 不得输出任何用户数据到日志/响应之外的第三方；
- Token 只写 `~/.resume-manager/settings.json`；
- 服务仅绑定 `127.0.0.1`；
- `templates/`、`docs/`、`src/` 不得包含真实个人信息（示例数据须明显标注）。

## 9. PDF 编译开关实现要点

- 设置键：`localPdfBuild`（默认 true）、`githubPdfBuild`（默认 false），存于 `~/.resume-manager/settings.json`；
- 本地开关：`server/routes/api.js` 的 `POST /api/build` 做服务端门控（`getSettings().localPdfBuild === false` 时拒绝），前端 `PdfPreview.tsx` 同步禁用按钮并提示；
- GitHub 开关：通过私有仓根目录 `resume-manager.config.json`（`{"githubPdfBuild": bool}`）控制 CI。workflow 模板（`templates/private-repo/.github/workflows/build.yml`）第一步读取该文件，为 false 时跳过全部构建步骤（默认关闭，安全回退）；
- 同步链路：设置页开关 → `POST /api/repo/pdf-config {commit:true, push:true}` → `git-service.commitFile`（仅提交该文件）→ push；未配 Token 时落本地并提示去 Git 看板推送；
- 代理支持：`server/lib/git-service.js` 读取 `HTTP(S)_PROXY` 环境变量，用 `https-proxy-agent` 包装 http 客户端注入每次请求（isomorphic-git 的 push 不透传 agent 参数，必须包装）；无代理变量时不影响；
- 修改 workflow 门控逻辑时，须同步更新模板与既有私有仓（两份 workflow 保持一致）。

## 9.1 GitHub 凭据自动检测实现要点

- 模块：`server/lib/github-auth.js`；检测顺序：`GITHUB_TOKEN`/`GH_TOKEN` 环境变量 → `gh auth token`（spawnSync，15s 超时）；
- 用户名反查：`gh api user --jq .login`（gh 源）或 `https://api.github.com/user`（best-effort，走 `HttpsProxyAgent`）；
- 前端：`src/pages/Settings.tsx` 挂载时自动调用 `GET /api/github/autodetect`；检测到 → 展示来源/用户/打码预览 + 「一键启用系统凭据」；未检测到且未配置 → 展示图文教程（Fine-grained/Classic Token 链接 + gh auth login）；
- 隐私：token 仅在本机 `127.0.0.1` 前端可用；检测结果不写日志。
