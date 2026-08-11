# AGENTS.md —— 给 AI 编码代理的快速上手

本仓库是 **Resume Manager**：一个本地运行的简历可视化管理系统（公开项目）。
你的任务是安全地在此仓库内进行编码与修改。

## 项目是什么

- **管理端（本仓库）**：公开工具。React 前端 + Express 后端，本地运行。
- **用户数据**：在用户自己的**私有** GitHub 仓库（`data/` 信息全集 + `scripts/variants.yml` 配方），
  通过「设置」页的路径指向。**本仓库永远不包含任何用户真实数据**。

## 常用命令

```sh
npm install        # 安装依赖
npm run dev        # 开发模式（前端 :5173，后端 :8787）
npm run build      # 前端构建 → dist/
npm start          # 生产模式（:8787，托管 dist + API）
npm run typecheck  # 前端 TS 检查
```

## 代码地图

| 路径 | 作用 |
| --- | --- |
| `server/routes/api.js` | 所有 REST 端点（见 docs/DEVELOPMENT.md §4） |
| `server/lib/data-store.js` | data/*.yml 读写、元数据约定（id/tags/notes/_*） |
| `server/lib/compose.js` | 组合引擎：配方 → 简历 YAML（与 templates/private-repo/scripts/compose.py 语义一致） |
| `server/lib/builder.js` | 调用本地 yamlresume CLI 构建 PDF |
| `server/lib/git-service.js` | isomorphic-git 封装（status/log/commit/push/pull/diff） |
| `server/config.js` | 设置存取 `~/.resume-manager/settings.json` |
| `server/lib/github-auth.js` | GitHub 凭据自动检测（环境变量 / gh CLI） |
| `src/pages/*.tsx` | 八个页面（总览/信息/方向/YAML/PDF/Git/模板/设置） |
| `src/components/ui.tsx` | UI 组件库（Button/Card/Modal/TagInput…） |
| `templates/private-repo/` | 私有数据仓模板（新用户初始化用） |
| `docs/DATA-FORMAT.md` | 数据格式契约（改格式先读它） |

## 硬性规则

1. **不引入真实用户数据**：示例/测试数据必须明显是占位符（张三/example.com）。
2. **Token 永不入库**：只存 `~/.resume-manager/settings.json`；响应中打码。
3. **路径安全**：任何读文件的端点必须用 `safeJoin` 校验路径在数据仓内（`../` 注入防护）。
4. **组合引擎双实现同步**：`server/lib/compose.js` 与 `templates/private-repo/scripts/compose.py`
   行为必须一致，改一个必须改另一个，并用 `yamlresume validate` 验证输出。
5. **服务器只监听 127.0.0.1**（`server/index.js` 的 HOST 常量）。
6. 修改后跑 `npm run typecheck` 和 `npm run build`，确认无错误。

## 常见任务示例

- **新增信息分类**（如 awards）：1) `server/lib/data-store.js` 的 `CATEGORIES` 加项；
  2) `src/pages/Entries.tsx` 的 `FIELDS` 加字段配置；3) 模板 `templates/private-repo/data/` 加文件；4) 更新 docs/DATA-FORMAT.md。
- **新增 API**：`server/routes/api.js` 注册路由 → `src/api.ts` 已是通用 client，前端直接调。
- **新增页面**：`src/pages/X.tsx` → `src/App.tsx` 的 `NAV`/`TITLES` 注册（支持 hash 直达 `#/x`）。
- **编译开关**：`localPdfBuild`（本地，默认开）/ `githubPdfBuild`（CI，默认关）；本机保存并通过 GitHub Actions 仓库变量同步，不写私有仓文件。详见 docs/DEVELOPMENT.md §9。
