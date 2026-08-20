# 私有数据仓 · 数据格式规范（v1）

> 本规范定义"简历信息全集 + 简历方向配方"的数据格式。它是本管理端与私有数据仓
> CI（GitHub Action）之间的**唯一契约**。两份组合器实现语义一致：
> - 管理端：`server/lib/compose.js`（JS）
> - 私有仓 CI：`templates/private-repo/scripts/compose.py`（Python）

## 1. 目录结构

```
<repo>/
├── data/                      # 信息全集（唯一真相源，按主题分类）
│   ├── basics.yml             # 基础信息（单对象）
│   ├── work.yml               # 工作经历（数组）
│   ├── education.yml          # 教育背景（数组）
│   ├── projects.yml           # 项目经历（数组）
│   ├── skills.yml             # 专业技能（数组）
│   ├── certificates.yml       # 证书资质（数组）
│   └── interests.yml          # 兴趣爱好（数组）
├── assets/
│   └── profile-photo.jpg      # 可选证件照（由基础信息页上传；也可能是 .png）
├── tags.yml                   # 管理端标签库（随 Git 版本化）
├── categories.yml             # 管理端分类显示/排序/显隐（随 Git 版本化）
├── scripts/
│   ├── variants.yml           # 简历方向配方
│   ├── compose.py             # 组合器（CI 用）
│   └── postprocess-output.py  # yamlresume TeX/HTML 输出规范化（CI 用）
├── resumes/                   # 生成的各方向简历（gitignore）
├── .github/workflows/build.yml
└── README.md
```

`data/` 按**信息主题**分类，不是按简历分类。**一份简历 = data/ 的部分子集**（按配方筛选），
绝不需要把一份简历拆成多个 YAML。

## 2. 组稿元数据约定

每条条目可以携带以下与组稿直接相关的键，它们不会进入最终简历：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 稳定唯一标识（如 `company-a`）；用于精确选择条目 |
| `tags` | string[] | 组稿标签：配方按此筛选（如 `frontend` / `management` / `backend`） |
| `_xxx` | any | 以 `_` 开头的扩展数据，组合器输出前剥除 |

个人备注 `notes`、类型展示名/分支映射属于本机管理状态，只存于 `~/.resume-manager/repos/*.json`；
**标签库（`tags.yml`）与分类显示/排序/显隐（`categories.yml`）随私有仓版本化**，打包数据仓交给他人即可直接使用。
组合器仍会剥除旧数据中的 `notes` 以兼容迁移前仓库。

## 3. 各分类字段

### basics.yml（单对象）

```yaml
name: 张三            # 姓名
photo: assets/profile-photo.jpg  # 可选；基础信息页上传后在浏览器裁剪为标准一寸 JPEG（295×413 / 300 DPI），再自动写入
headline: 资深前端工程师
phone: "138-0000-0000"
email: zhangsan@example.com
url: https://example.com
summary:              # 字符串数组或字符串（markdown 列表）
  - 8 年前端开发经验
```

### work.yml（数组）

```yaml
- id: company-a
  company: 某公司          # ★ 组合时映射为简历 schema 的 name
  position: 高级工程师
  url: https://...
  startDate: "2021-03"    # 字符串日期；留空/null = 至今
  endDate: null
  tags: [frontend]        # 元数据
  keywords: [React, TypeScript]
  achievements:           # ★ 成就要点：逐条可打标签
    - text: 主导性能优化，首屏降低 45%
      tags: [frontend, performance]   # 无标签 = 通用（所有方向保留）
```

### education.yml / projects.yml

```yaml
# education
- institution: 某大学
  degree: Bachelor        # Middle School/High School/Diploma/Associate/Bachelor/Master/Doctor
  area: 计算机科学与技术
  score: "3.8"
  startDate: "2012-09"
  endDate: "2016-06"
  url: ...
  summary: [要点…]
  tags: []

# projects
- name: 微前端改造平台      # 项目名称（可从内容提取；无则留空，展示时用 source 兜底）
  source: 公司内部赛事      # 来源/机构/赛事/期刊（管理端字段，不进简历，组稿时剥除）
  role: 独立负责            # 我的角色/职责边界（独立负责/核心参与/团队协作/二作/待确认；管理端字段，不进简历）
  background: 解决多个子应用独立交付时的依赖冲突与发布协作问题  # 项目背景（组合时映射为 schema 的 description）
  stage: 本科               # 阶段（本科/硕士等；管理端字段，不进简历，组稿时剥除）
  url: ...
  startDate: "2022-01"
  endDate: "2022-12"
  tech: [qiankun, Monorepo] # 技术栈（组合时映射为 schema 的 keywords）
  summary: |                # Markdown 项目要点；缩进两个空格可创建下一级
    - 设计统一的应用注册与生命周期协议
      - 支持异常隔离和独立回退
    - **优化**公共依赖加载，首屏体积降低 35%
  achievements:             # ★ 结果证据：可量化/可核验的成果，逐条可打标签（组合时并入 summary 的「成果」小节）
    - text: 首屏体积降低 35%
      tags: [frontend]
  tags: [frontend]
```

### skills.yml / certificates.yml / interests.yml

```yaml
# skills
- name: 前端开发
  level: Expert        # 熟练度仅 2 级：Expert（输出“熟悉”）/ Master（输出“掌握”）
  keywords: [React, TypeScript]
  tags: [frontend]

# certificates
- name: AWS Certified Developer - Associate
  issuer: Amazon Web Services
  date: "2022-03"
  url: ...
  tags: [backend]

# interests
- name: 开源
  keywords: [技术写作]
```

## 4. 简历类型配置（scripts/variants.yml）

每个 `variants` 条目是一个简历类型的组稿规则。展示名与 `resume/<type>` 分支映射由管理端保存在本机；私有仓只保留会影响简历输出的内容选择、模板和布局。职业头衔与个人简介统一读取 `data/basics.yml`，不再按类型覆盖。

```yaml
defaults:                 # 全局默认，可被类型覆盖
  locale: zh-hans
  layout:
    engine: latex
    template: moderncv-banking
    typography:
      fontSize: 11pt

variants:
  frontend:               # 类型标识 = 生成的 resumes/<name>.yml
    locale: zh-hans       # 可选，覆盖 defaults
    fonts:                # 可选；中英文分别选择，保存系统字体家族原名
      cjk: Microsoft YaHei
      latin: Arial
    sectionOrder: [skills, work, projects, education]  # 原生章节顺序，未列出的按默认排后
    blocks:               # 各章节的选择规则
      basics: { include: true }        # basics 仅支持 include
      work: { tags: [frontend] }       # 命中任一标签即入选
      projects: { include: all }       # 全部
      skills: { tags: [frontend] }
      certificates: { include: all }
      interests: { include: all }
      # education 省略 = 不生成该章节
```

### 选择规则

| 规则 | 含义 |
| --- | --- |
| `{include: all}` | 该分类全部条目 |
| `{tags: [a, b]}` | 条目 `tags` 命中任一标签入选；条目内 `achievements` 按同样标签过滤，无标签成就 = 通用保留 |
| `{ids: [id1]}` | 精确指定条目 id |
| 省略块 | 不生成该章节 |

### 字体规则

`fonts` 是 Resume Manager 的配方扩展，不属于 YAMLResume 原始 schema。可视化编排中的“中文字体”和“英文字体”是独立组件；移除组件会删除对应键，恢复组件会使用该组默认项。

| 键 | 可选值 | 默认组件值 |
| --- | --- | --- |
| `fonts.cjk` | 当前系统检测到且包含中文字形的字体家族名，如 `Microsoft YaHei`、`Noto Serif CJK SC` | 优先 `Microsoft YaHei`，否则取系统列表首项 |
| `fonts.latin` | 当前系统检测到且包含拉丁字形的字体家族名，如 `Arial`、`Times New Roman` | 优先 `Arial`，否则取系统列表首项 |

字体列表由管理端从当前操作系统读取：Windows 使用系统字体集合和实际字形映射，Linux/macOS 使用 `fontconfig`（不可用时退回安全基础集合）；“重新扫描”可在安装字体后刷新目录。配方保存稳定的字体家族原名，而不是本机文件路径。旧值 `microsoft-yahei`、`noto-sans-cjk`、`noto-serif-cjk`、`simsun`、`linux-libertine`、`arial`、`times-new-roman`、`tex-gyre-heros`、`consolas` 会自动转换为对应字体家族名。

组合器只把 YAMLResume 支持的西文字体栈写入 `layouts[].typography.fontFamily`。构建后处理再根据同一配方设置 CJK 字体：LaTeX 分别调用 `setmainfont/setCJKmainfont`，HTML 使用带 Unicode 范围的本地 `@font-face`，因此英文、数字与中文字符能命中不同字体。每个系统字体会按衬线、无衬线或等宽类型附加本地跨平台回退，不下载远程字体；字体名经过长度和控制字符校验，不能注入 LaTeX/CSS。跨机器打开配方时，即使当前系统未安装所选字体，也会保留原值并在构建时使用回退。未添加字体组件时保持模板原有西文字体，并继续使用 Microsoft YaHei 优先的现有中文回退。

### 组合输出规则

- 类型展示名和分支按 `resume/<类型标识>` 映射在本机管理状态中，不属于 `variants.yml`；
- 类型页负责类型/分支 CRUD 与切换，`blocks/sectionOrder/layout/fonts` 由简历定制页维护；职业头衔与个人简介始终来自 `data/basics.yml`；
- 剥除所有元数据键（`id/tags/notes/_*`、`achievements`）；
- `work.company` → `name`；`achievements` → `summary`（markdown 列表字符串）；
- 专业技能按细分方向（tags）分组：每个方向输出一行“方向：技能、技能”，跨方向技能同时出现在多行；优先罗列 `keywords`，为空时使用条目 `name`；yamlresume 模板自动追加的等级文字与正文列调整在构建后移除；
- 兴趣爱好合并成一行，以 `、` 直接罗列，不输出冒号；
- 项目 `background` 作为项目背景保留完整内容（组合时映射为 schema 的 `description`），组合输出自动补成“项目背景：xxx”，并在项目要点列表之前以无项目符号正文显示；项目 `summary` 按 Markdown 渲染，保留多级列表、加粗和斜体，旧纯文本自动兼容为顶级列表；项目 `tech` 映射为 schema 的 `keywords`（技术栈）；项目 `achievements` 按方向标签过滤后以「成果」加粗小节并入 `summary`；`source/role/stage` 为管理端字段，组稿时剥除；LaTeX 默认隐藏原始 URL，改为项目名称超链接；GitHub 项目名称后可附加 GitHub Logo、`owner/repo` 地址和 star 数徽章；
- `basics.photo` 是仓内证件照路径（固定为 `assets/profile-photo.jpg` 或 `.png`）；管理端选择最大 20 MB、50MP 的 JPEG/PNG 原图后，在浏览器中以固定 5:7 比例拖动、缩放并裁剪为标准一寸 295×413 px / 300 DPI 白底 JPEG，只有裁剪结果会上传和写入私有仓，取消裁剪不修改现有照片；组合器生成 YAML 时剥离该管理字段，再由 Jake 原版渲染器或 TeX/HTML 后处理注入不占正文排版宽度的独立页首浮层，避免违反 YAMLResume 的严格 basics schema，也不压缩原有文字；
- `summary` 统一转字符串（数组 → `- 项` 列表）；
- 空章节自动省略；`endDate` 空值输出为空（表示"至今"）；
- 生成文件写入 `resumes/<variant>.yml`，带"自动生成，请勿手改"头注释。

## 5. 组合输出示例（resumes/frontend.yml）

```yaml
---
content:
  basics:
    name: 张三
    headline: 资深前端工程师（React / TypeScript）
    summary: |
      - 8 年前端开发经验…
  education:
    - institution: 某大学
      degree: Bachelor
      area: 计算机科学与技术
      startDate: 2012-09
      endDate: 2016-06
      summary: |
        - 主修课程…
  work:
    - name: 某公司        # company → name
      position: 高级工程师
      startDate: 2021-03
      endDate:            # 空 = 至今
      summary: |
        - 主导性能优化，首屏降低 45%    # 仅保留命中的成就
      keywords:
        - React
  ...
locale:
  language: zh-hans
layouts:
  - engine: latex
    template: moderncv-banking
    typography:
      fontSize: 11pt
      fontFamily: Arial, TeX Gyre Heros  # 由 fonts.latin 生成；CJK 字体在构建后独立注入
    sections:
      order: [skills, work, projects, education]
```

## 5.1 随仓版本化与不进入私有仓的边界

以下管理数据随私有仓版本化（修改它们会产生私有仓 Git diff，打包数据仓即可分发）：

- `tags.yml`：标签库分两组——`tags`（方向标签，参与组稿筛选）与 `subtags`（细分标签，对应条目 `keywords`，展示用）；增删/重命名会同步到条目对应字段；
- `categories.yml`：分类 key、展示名、排序、显隐；`data/<key>.yml` 存放分类内容。

以下字段保存在 `~/.resume-manager/`，修改它们不产生私有仓 Git diff：

- `settings.json`：数据仓路径、Token、提交身份、本地/GitHub 编译开关；
- `repos/<repo-hash>.json`：条目备注、类型展示名和分支映射；
- GitHub 编译开关的远程状态使用 Actions 仓库变量 `RESUME_MANAGER_PDF_BUILD`，不使用仓库配置文件。

私有仓仅保留 `data/*.yml` 简历信息、`id/tags` 组稿元数据、`tags.yml` 标签库、`categories.yml` 分类配置、`scripts/variants.yml` 输出规则、组合器和 CI workflow。

首次读取时若仓库缺少 `tags.yml`/`categories.yml`，管理端会从本机侧车或旧根目录 `tags.json`/`categories.json` 一次性迁移生成，此后仓库文件为唯一权威来源。

## 6. 兼容与扩展

- 新增分类：在 `data/` 加 `xxx.yml`，并在配方 `blocks` 引用即可；管理端 `server/lib/data-store.js`
  的 `CATEGORIES` 需同步登记（前端表单字段在 `src/pages/Entries.tsx` 的 `FIELDS` 配置）。
- 新增模板/语言：`variants.yml` 中直接引用；yamlresume 支持清单可用
  `yamlresume templates list` / `yamlresume languages list` 查询。
- 未知字段：条目内允许存在额外字段（非元数据键），组合器原样保留——请勿在 `content` 层
  使用未知字段（yamlresume schema 严格校验）。
