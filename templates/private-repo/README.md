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
├── variants.yml          简历方向配方（选哪些信息、什么模板、章节顺序）
└── compose.py            组合器（CI 用）
resumes/                  生成的各方向简历（gitignore，不提交）
resume-manager.config.json GitHub 编译 PDF 开关（默认关闭）
```

## PDF 编译开关

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| **本地编译 PDF** | 开启 | 在 Resume Manager「PDF 预览」页构建，或本地 CLI 构建。**需要安装 [yamlresume](https://www.npmjs.com/package/yamlresume)**：`npm install -g yamlresume`（另需 XeTeX/Tectonic 排版引擎） |
| **GitHub 编译 PDF** | 关闭 | push 后由 GitHub Action 自动编译 PDF。在 Resume Manager 设置页打开并「同步并推送」后生效（写入本仓 `resume-manager.config.json`） |

## 工作流

1. 修改 `data/` 下的信息（示例内容全部替换为真实信息）；
2. 本地构建：`python scripts/compose.py && yamlresume build resumes/<方向>.yml`；
3. 或在 Resume Manager 开启 GitHub 编译后 push 到 main，由 Action 自动组合并构建。

## 隐私

仓库保持 **Private**。构建只在 GitHub 托管 runner 上完成，不向任何第三方上传数据；
未启用 Pages 则无公网入口。
