# 最小简历数据仓（私有）

这是 Resume Manager 的可运行示例仓。连接后先编辑以下三个文件即可看到第一份预览：

- `data/basics.yml`：姓名、职位、邮箱、简介和可选证件照路径；
- `data/work.yml`：一段工作经历；
- `data/skills.yml`：一组技能。

`data/education.yml` 保留一条最小教育经历；`projects.yml`、`certificates.yml` 和 `interests.yml` 暂时为空，后续按需添加数组条目。所有条目都可以用 `id` 和 `tags` 参与不同简历方向的组稿。

## 目录

```text
data/                     信息全集
├── basics.yml             基本信息（单对象）
├── work.yml               工作经历（数组）
├── education.yml         教育背景（数组）
├── projects.yml           项目经历（数组）
├── skills.yml             专业技能（数组）
├── certificates.yml       证书资质（数组）
└── interests.yml          兴趣爱好（数组）
assets/
└── profile-photo.jpg      可选证件照（基础信息页上传，也可能是 .png）
scripts/
├── variants.yml           简历方向配方（含可选 fonts.cjk/latin）
├── compose.py             组合器（CI 使用）
├── font_options.py        系统字体名校验、旧值迁移与跨平台回退
└── postprocess-output.py  规范化技能/字体等 TeX/HTML 输出（CI 使用）
resumes/                  自动生成的简历文件（gitignore）
```

## 首次使用

1. 在 Resume Manager「设置」中填写本仓库路径，点击「连接数据仓」；空目录会自动生成本骨架并初始化 Git。
2. 打开「信息管理 → 基础信息」填写个人资料；可上传 JPEG/PNG 证件照，文件会保存为 `assets/profile-photo.*` 并自动加入所有模板的简历页首。
3. 打开「简历定制」页直接编辑 `main` 类型（默认类型使用仓库主分支）；可从“字体”页签把中文字体、英文字体组件拖入画布并从当前系统字体目录中搜索选择，也可直接编辑 `scripts/variants.yml` 的 `fonts.cjk/latin`（保存字体家族原名）。
4. 用「预览」临时检查效果，确认后点「保存发布正式版」。系统字体选择只使用本机字体和开源回退，不请求远程字体。
5. 修改 `data/` 或 `scripts/variants.yml` 后，在 Git 同步看板提交并推送。

默认示例使用 HTML `calm` 模板，不依赖本机 LaTeX。需要 PDF 时，可在「简历定制」中改用 LaTeX 模板，并安装 `yamlresume` 与 XeTeX/Tectonic。技能会按“掌握/熟悉”合并为每类一行，兴趣爱好合并为单行；CI 会自动规范化 yamlresume 生成的 TeX/HTML 并重新编译 PDF。

## 隐私

请将本仓库设为 Private。真实简历内容只存放在这个数据仓中；管理端的分类显示、标签库、备注、类型展示名和分支映射保存在本机，不会写入仓库。

完整字段和组稿规则见 [Resume Manager 数据格式规范](https://github.com/Li7777777/resume-manager/blob/main/docs/DATA-FORMAT.md)。
