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
```

## 工作流

1. 修改 `data/` 下的信息（示例内容全部替换为真实信息）；
2. push 到 main —— GitHub Action 自动组合并构建各方向 PDF；
3. 到 Actions 页下载 Artifact；或本地 `python scripts/compose.py && yamlresume build resumes/<方向>.yml`。

## 隐私

仓库保持 **Private**。构建只在 GitHub 托管 runner 上完成，不向任何第三方上传数据；
未启用 Pages 则无公网入口。
