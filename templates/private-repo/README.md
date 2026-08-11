# 我的简历数据仓（私有）

**本仓库是简历信息的唯一真相源（PRIVATE）**。数据格式规范见
[resume-manager 数据格式文档](https://github.com/Li7777777/resume-manager/blob/main/docs/DATA-FORMAT.md)。

## 结构

```
data/                     信息全集（按主题分类，每条条目可打 tags 标签）
├── basics.yml            基本信息
├── work.yml              工作经历（成就点可逐条打标签）
├── education.yml         教育背景
├── projects.yml          项目经历
├── skills.yml            专业技能
├── certificates.yml      证书资质
└── interests.yml         兴趣爱好
scripts/
├── variants.yml          组稿规则（内容选择、模板、章节顺序）
└── compose.py            组合器（CI 用）
resumes/                  生成的各类型简历（gitignore，不提交）
```

分类显示、标签库、备注、类型展示名/分支映射与编译开关均由 Resume Manager 保存在本机，不属于本数据仓。

## PDF 编译开关

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| **本地编译 PDF** | 开启 | 在 Resume Manager「简历定制」页选择 LaTeX 模板并生成预览，或使用本地 CLI。**需要安装 [yamlresume](https://www.npmjs.com/package/yamlresume)**：`npm install -g yamlresume`（另需 XeTeX/Tectonic 排版引擎） |
| **GitHub 编译 PDF** | 关闭 | workflow 读取 GitHub Actions 仓库变量 `RESUME_MANAGER_PDF_BUILD`；在 Resume Manager 设置页同步变量，不修改本仓文件 |

## 工作流

1. 在 Resume Manager「简历类型」页为每个类型创建 `resume/<type>` 分支并切换；
2. 在「简历定制」页选择内容与模板，生成 HTML/PDF 预览；
3. 本地 CLI：`python scripts/compose.py && yamlresume build resumes/<类型>.yml`；
4. 或开启 GitHub 编译后把各类型分支推送到远程；Action 会按分支名只构建对应类型，`main` 构建全部类型。

## 隐私

仓库保持 **Private**，只保存简历信息、组稿所需 `id/tags`、输出规则和 CI；不保存管理端设置、分类展示、标签库、备注或类型展示字段。构建只在 GitHub 托管 runner 上完成，不向任何第三方上传数据；未启用 Pages 则无公网入口。
