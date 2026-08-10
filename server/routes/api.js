// API 路由：信息管理 / 组合 / 构建 / YAML 编辑 / Git 看板 / 模板初始化 / 设置
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import yaml from 'js-yaml'
import { getSettings, saveSettings, getRepoPath } from '../config.js'
import * as store from '../lib/data-store.js'
import * as compose from '../lib/compose.js'
import * as builder from '../lib/builder.js'
import * as gitSvc from '../lib/git-service.js'
import { detectGithubAuth, maskToken } from '../lib/github-auth.js'
import { ghApi, ghDownload, parseRemoteUrl } from '../lib/github-api.js'
import AdmZip from 'adm-zip'
import { recordBuild, listBuilds } from '../lib/build-history.js'
import { TEMPLATES, ENGINE_LABELS } from '../lib/templates.js'

const router = express.Router()
const TEMPLATE_DIR = path.resolve('templates/private-repo')

function safeJoin(repo, rel) {
  const abs = path.resolve(repo, rel)
  if (!abs.startsWith(path.resolve(repo) + path.sep)) throw new Error('非法路径')
  return abs
}

function sendError(res, err) {
  res.status(400).json({ ok: false, error: String(err?.message || err) })
}

/* ---------- 健康检查 ---------- */
router.get('/health', (req, res) => {
  const repo = getRepoPath()
  res.json({
    ok: true,
    version: '0.1.0',
    repoConfigured: !!repo && fs.existsSync(repo),
    ...builder.checkEnvironment(),
  })
})

/* ---------- 设置 ---------- */
router.get('/settings', (req, res) => {
  const s = getSettings()
  res.json({ ok: true, settings: { ...s, token: s.token ? '••••••' : '' } })
})

router.put('/settings', (req, res) => {
  const { repoPath, token, gitUsername, gitEmail, localPdfBuild, githubPdfBuild } = req.body || {}
  const patch = {}
  if (typeof repoPath === 'string') patch.repoPath = repoPath
  if (typeof token === 'string' && token !== '••••••') patch.token = token
  if (typeof gitUsername === 'string') patch.gitUsername = gitUsername
  if (typeof gitEmail === 'string') patch.gitEmail = gitEmail
  if (typeof localPdfBuild === 'boolean') patch.localPdfBuild = localPdfBuild
  if (typeof githubPdfBuild === 'boolean') patch.githubPdfBuild = githubPdfBuild
  const saved = saveSettings(patch)
  res.json({ ok: true, settings: { ...saved, token: saved.token ? '••••••' : '' } })
})

/* ---------- GitHub 凭据自动检测 ---------- */
// 先尝试从系统环境获取（GITHUB_TOKEN/GH_TOKEN 环境变量、gh CLI 登录态），
// 获取不到时由前端引导用户创建 Token（设置页内置教程与链接）。
router.get('/github/autodetect', async (req, res) => {
  try {
    const sources = await detectGithubAuth()
    const first = sources[0] || null
    res.json({
      ok: true,
      found: !!first,
      source: first?.source || null,
      username: first?.username || null,
      // token 仅在本机 localhost 环境下返回给前端，供一键启用
      token: first?.token || null,
      tokenPreview: first ? maskToken(first.token) : null,
    })
  } catch (err) {
    res.json({ ok: true, found: false, source: null, username: null, token: null, tokenPreview: null })
  }
})

/* ---------- 项目总览 ---------- */
router.get('/project/status', async (req, res) => {
  try {
    res.json(await gitSvc.projectOverview(getRepoPath(), getSettings()))
  } catch (err) {
    res.json({ configured: !!getRepoPath(), error: String(err.message) })
  }
})

/* ---------- 分类管理（自定义 tab：增/删/改名/排序） ---------- */
// 分类定义存私有仓 categories.json；data/*.yml 自动发现兜底
router.get('/categories', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    res.json({ ok: true, categories: store.getCategories(repo) })
  } catch (err) {
    sendError(res, err)
  }
})

// 整体保存分类（前端管理后的完整数组）；服务端 diff 创建/删除 data/<key>.yml
router.put('/categories', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { categories } = req.body || {}
  if (!Array.isArray(categories)) return res.json({ ok: false, error: '参数错误' })
  try {
    const clean = []
    const seen = new Set()
    for (const c of categories) {
      if (!c || typeof c.key !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(c.key) || seen.has(c.key)) continue
      seen.add(c.key)
      clean.push({ key: c.key, label: String(c.label || c.key).trim() || c.key, visible: c.visible !== false })
    }
    if (clean.length === 0) return res.json({ ok: false, error: '至少保留一个分类' })
    // 删除的分类 → 移除 data/<key>.yml
    const dataDir = path.join(repo, 'data')
    for (const key of store.scanDataKeys(repo)) {
      if (!seen.has(key)) {
        const f = store.dataFile(repo, key)
        if (fs.existsSync(f)) fs.unlinkSync(f)
      }
    }
    store.saveCategories(repo, clean)
    // 新增分类（无 data 文件）→ 创建空数组文件
    for (const c of clean) {
      const f = store.dataFile(repo, c.key)
      if (!fs.existsSync(f)) {
        fs.mkdirSync(dataDir, { recursive: true })
        fs.writeFileSync(f, c.key === 'basics' ? '# 基础信息\n' : '# ' + c.label + '\n[]\n', 'utf8')
      }
    }
    res.json({ ok: true, categories: store.getCategories(repo) })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 标签管理（增删改，作用于全部条目） ---------- */
// 标签列表：标签库（tags.json）+ 全条目标签计数
router.get('/tags', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const lib = store.libTags(repo)
    const { tagCount } = store.allEntries(repo)
    const tags = Object.keys(tagCount)
      .map((name) => ({ name, count: tagCount[name], inLibrary: lib.includes(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    // 标签库中尚无条目使用的标签也列出
    for (const t of lib) {
      if (!tags.some((x) => x.name === t)) tags.push({ name: t, count: 0, inLibrary: true })
    }
    res.json({ ok: true, tags, library: lib })
  } catch (err) {
    sendError(res, err)
  }
})

// 新增标签（写入标签库；条目编辑时 TagInput 建议即包含）
router.put('/tags/library', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { tags } = req.body || {}
  if (!Array.isArray(tags)) return res.json({ ok: false, error: '参数错误' })
  try {
    const lib = store.saveLibTags(repo, tags)
    res.json({ ok: true, library: lib })
  } catch (err) {
    sendError(res, err)
  }
})

// 重命名标签（所有条目同步改名，标签库同步）
router.post('/tags/rename', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { from, to } = req.body || {}
  if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
    return res.json({ ok: false, error: '参数错误' })
  }
  const f = from.trim()
  const t = to.trim()
  if (!f || !t) return res.json({ ok: false, error: '标签不能为空' })
  if (f === t) return res.json({ ok: true, affected: 0, message: '新旧标签相同' })
  try {
    const affected = store.renameTag(repo, f, t)
    res.json({ ok: true, affected, from: f, to: t })
  } catch (err) {
    sendError(res, err)
  }
})

// 删除标签（所有条目移除，标签库同步移除）
router.post('/tags/delete', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { tag } = req.body || {}
  if (!tag || typeof tag !== 'string') return res.json({ ok: false, error: '参数错误' })
  try {
    const affected = store.deleteTag(repo, tag.trim())
    res.json({ ok: true, affected, tag: tag.trim() })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 信息条目 ---------- */
router.get('/entries', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { entries, tagCount } = store.allEntries(repo)
  res.json({ ok: true, entries, tagCount, categories: store.getCategories(repo) })
})

router.get('/entries/:cat', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    res.json({ ok: true, category: req.params.cat, entries: store.readCategory(repo, req.params.cat) })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/entries/:cat', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const entry = store.upsertEntry(repo, req.params.cat, req.body || {})
    res.json({ ok: true, entry })
  } catch (err) {
    sendError(res, err)
  }
})

router.put('/entries/:cat/:id', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const entry = store.upsertEntry(repo, req.params.cat, { ...req.body, id: req.params.id })
    res.json({ ok: true, entry })
  } catch (err) {
    sendError(res, err)
  }
})

router.delete('/entries/:cat/:id', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    store.deleteEntry(repo, req.params.cat, req.params.id)
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 简历方向（变体配方） ---------- */
router.get('/variants', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    res.json({ ok: true, variants: compose.listVariants(repo), defaults: (yaml.load(fs.readFileSync(path.join(repo, 'scripts', 'variants.yml'), 'utf8')) || {}).defaults || {} })
  } catch (err) {
    sendError(res, err)
  }
})

router.put('/variants', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    compose.saveVariantsDoc(repo, req.body || { defaults: {}, variants: {} })
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- YAML 文件编辑 ---------- */
router.get('/files', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const files = []
    for (const cat of store.getCategories(repo)) {
      const f = store.dataFile(repo, cat.key)
      files.push({ path: `data/${cat.key}.yml`, label: cat.label, exists: fs.existsSync(f) })
    }
    files.push({ path: 'scripts/variants.yml', label: '简历方向配方', exists: fs.existsSync(path.join(repo, 'scripts', 'variants.yml')) })
    res.json({ ok: true, files })
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/yaml', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const p = safeJoin(repo, req.query.path)
    if (!fs.existsSync(p)) return res.json({ ok: false, error: '文件不存在' })
    res.json({ ok: true, content: fs.readFileSync(p, 'utf8') })
  } catch (err) {
    sendError(res, err)
  }
})

router.put('/yaml', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const { path: rel, content } = req.body
    const p = safeJoin(repo, rel)
    yaml.load(content) // 语法校验
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf8')
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 构建与 PDF 预览 ---------- */
router.post('/build', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { variant } = req.body || {}
  if (!variant) return res.json({ ok: false, error: '缺少 variant' })
  // 本地编译开关（服务端强制校验，默认开启）
  if (getSettings().localPdfBuild === false) {
    return res.json({ ok: false, error: '本地 PDF 编译已关闭，请在「设置」页开启后再构建' })
  }
  try {
    const result = await builder.buildVariant(repo, variant)
    if (result.ok) {
      // 本地构建成功 → 写入本地构建历史（时间轴记录）
      try {
        const head = (await gitSvc.getLog(repo, 1))[0] || null
        recordBuild({
          kind: 'local',
          repoPath: repo,
          variant,
          sha: head?.oid || null,
          headMessage: head?.message || null,
          timestamp: Math.floor(Date.now() / 1000),
          status: 'success',
          pdfs: [result.pdf],
          output: (result.output || '').slice(0, 500),
        })
      } catch {
        /* 记录失败不影响构建结果 */
      }
      res.json({ ok: true, pdf: `/api/pdf/${variant}.pdf`, output: result.output })
    } else {
      res.json({ ok: false, error: result.output })
    }
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/pdf/:name', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.status(404).end()
  const name = path.basename(req.params.name)
  const p = builder.pdfPath(repo, name.replace(/\.pdf$/, ''))
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'PDF 不存在，请先构建' })
  res.setHeader('Content-Type', 'application/pdf')
  fs.createReadStream(p).pipe(res)
})

/* ---------- Git 看板 ---------- */
router.get('/git/status', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const s = await gitSvc.getStatus(repo, getSettings())
    const ab = await gitSvc.aheadBehind(repo, getSettings()).catch(() => ({ ahead: 0, behind: 0 }))
    res.json({ ok: true, ...s, ...ab })
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/git/log', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    res.json({ ok: true, commits: await gitSvc.getLog(repo, Number(req.query.limit) || 20) })
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/git/diff', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const hunks = await gitSvc.getDiff(repo, req.query.file)
    res.json({ ok: true, hunks })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/git/commit', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { message } = req.body || {}
  if (!message || !message.trim()) return res.json({ ok: false, error: '提交信息不能为空' })
  try {
    const oid = await gitSvc.commitAll(repo, message.trim(), getSettings())
    res.json({ ok: true, oid })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/git/fetch', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    await gitSvc.fetchRemote(repo, getSettings())
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/git/pull', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const r = await gitSvc.pullRemote(repo, getSettings())
    res.json({ ok: true, ...r })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/git/push', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  if (!settings.token) return res.json({ ok: false, error: '未配置 GitHub Token（设置页填写）' })
  try {
    const r = await gitSvc.pushRemote(repo, settings)
    if (r.error) return res.json({ ok: false, error: r.error.message || String(r.error) })
    res.json({ ok: true, pushed: r.pushed, branch: r.branch || null })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- GitHub 编译开关（私有数据仓配置同步） ---------- */
const PDF_CONFIG_FILE = 'resume-manager.config.json'

router.get('/repo/pdf-config', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const cfgPath = path.join(repo, PDF_CONFIG_FILE)
  let repoValue = null
  if (fs.existsSync(cfgPath)) {
    try {
      repoValue = !!JSON.parse(fs.readFileSync(cfgPath, 'utf8')).githubPdfBuild
    } catch {
      repoValue = null
    }
  }
  res.json({ ok: true, present: fs.existsSync(cfgPath), repoValue })
})

// 把当前设置写入私有数据仓 resume-manager.config.json（可选：提交/推送）
router.post('/repo/pdf-config', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { commit = false, push = false } = req.body || {}
  const settings = getSettings()
  const value = !!settings.githubPdfBuild
  const cfgPath = path.join(repo, PDF_CONFIG_FILE)
  try {
    fs.writeFileSync(cfgPath, JSON.stringify({ githubPdfBuild: value }, null, 2) + '\n', 'utf8')
    let committed = false
    let pushed = false
    if (commit) {
      await gitSvc.commitFile(
        repo,
        PDF_CONFIG_FILE,
        `chore: 设置 GitHub PDF 编译 = ${value ? '开启' : '关闭'}`,
        settings,
      )
      committed = true
      if (push) {
        if (!settings.token) {
          return res.json({ ok: false, error: '未配置 GitHub Token：已写入并提交本地，请到「Git 同步看板」推送', committed })
        }
        await gitSvc.pushRemote(repo, settings)
        pushed = true
      }
    }
    res.json({ ok: true, committed, pushed, value, file: PDF_CONFIG_FILE })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- GitHub 编译产物同步（github 编译方式的 PDF 预览） ---------- */
// 从私有仓 GitHub Actions 最近成功运行中拉取 resume-pdfs artifact，
// 解压出各方向 PDF 写入本地 resumes/ 目录，供 /api/pdf/:name 预览。
router.post('/github/pdf-sync', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  if (!settings.token) return res.json({ ok: false, error: '未配置 GitHub Token，无法拉取 CI 产物' })
  try {
    const remoteUrl = await gitSvc.getRemoteUrl(repo)
    const parsed = parseRemoteUrl(remoteUrl)
    if (!parsed) return res.json({ ok: false, error: '无法从远程地址解析仓库（仅支持 github.com）' })
    const { owner, repo: repoName } = parsed
    const branch = (await gitSvc.currentBranchSafe(repo)) || 'main'

    // 1. 最近一次成功运行
    const runs = await ghApi(
      `/repos/${owner}/${repoName}/actions/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=1`,
      settings.token,
    )
    const run = runs.workflow_runs?.[0]
    if (!run) {
      return res.json({ ok: false, error: `还没有成功的 CI 运行（分支 ${branch}）。推送代码或手动触发 workflow 后重试` })
    }

    // 2. 该运行的 artifacts
    const arts = await ghApi(`/repos/${owner}/${repoName}/actions/runs/${run.id}/artifacts`, settings.token)
    const art = arts.artifacts?.find((a) => a.name === 'resume-pdfs') || arts.artifacts?.[0]
    if (!art) {
      return res.json({
        ok: false,
        error: `最近成功运行（#${run.run_number}）没有产出 PDF artifact——可能是 GitHub 编译开关未开启或构建被跳过。请在设置页开启「GitHub 编译 PDF」并同步推送`,
        runId: run.id,
        runNumber: run.run_number,
      })
    }

    // 3. 下载 zip
    const zipBuf = await ghDownload(`/repos/${owner}/${repoName}/actions/artifacts/${art.id}/zip`, settings.token)

    // 4. 解压，提取 PDF 写入 repo/resumes/
    const zip = new AdmZip(zipBuf)
    const entries = zip.getEntries().filter((e) => e.entryName.toLowerCase().endsWith('.pdf'))
    if (entries.length === 0) {
      return res.json({ ok: false, error: 'artifact 中未找到 PDF 文件' })
    }
    fs.mkdirSync(path.join(repo, 'resumes'), { recursive: true })
    const pdfs = []
    for (const e of entries) {
      const base = path.basename(e.entryName)
      const target = path.join(repo, 'resumes', base)
      fs.writeFileSync(target, e.getData())
      pdfs.push(base)
    }

    res.json({
      ok: true,
      pdfs,
      source: 'github',
      runId: run.id,
      runNumber: run.run_number,
      artifactId: art.id,
      createdAt: art.created_at,
      branch,
    })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- GitHub 历史版本（提交时间轴 + CI 产物匹配 + YAML 快照） ---------- */
const HISTORY_DIR = (repo) => path.join(repo, 'resumes', 'history')

/* ---------- 合并时间轴（本地构建记录 + GitHub 提交/CI 运行） ---------- */
// 返回统一时间轴：kind=local（本地 yamlresume 构建）与 kind=github（提交 + CI 运行）
router.get('/history', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  const limit = Math.min(Number(req.query.limit) || 30, 50)
  try {
    const commits = await gitSvc.getLog(repo, limit)
    const remoteUrl = await gitSvc.getRemoteUrl(repo)
    const parsed = parseRemoteUrl(remoteUrl)
    let runMap = {}
    if (parsed && settings.token) {
      try {
        const runs = await ghApi(
          `/repos/${parsed.owner}/${parsed.repo}/actions/runs?branch=${encodeURIComponent((await gitSvc.currentBranchSafe(repo)) || 'main')}&per_page=50`,
          settings.token,
        )
        runMap = Object.fromEntries(
          (runs.workflow_runs || []).map((r) => [
            r.head_sha,
            { id: r.id, run_number: r.run_number, status: r.status, conclusion: r.conclusion, created_at: r.created_at, name: r.name },
          ]),
        )
      } catch {
        /* token 权限不足或网络问题：仅展示提交 */
      }
    }
    const githubItems = commits.map((c) => ({
      kind: 'github',
      id: c.oid,
      oid: c.oid,
      short: c.short,
      message: c.message,
      author: c.author,
      timestamp: c.timestamp,
      run: runMap[c.oid] || null,
    }))
    // 本地构建记录（当前数据仓的）
    const localItems = listBuilds(repo).map((b) => ({ ...b, kind: 'local' }))
    // 合并按时间倒序（github 提交时间戳 / 本地构建时间戳）
    const items = [...githubItems, ...localItems]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit)
    res.json({
      ok: true,
      items,
      owner: parsed?.owner || null,
      repo: parsed?.repo || null,
    })
  } catch (err) {
    sendError(res, err)
  }
})

// 下载指定提交构建的 CI 产物 PDF（缓存到 resumes/history/），返回预览 URL 列表
router.get('/github/history/pdf', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  const sha = String(req.query.sha || '').trim()
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return res.json({ ok: false, error: '无效的提交标识' })
  if (!settings.token) return res.json({ ok: false, error: '未配置 GitHub Token，无法拉取历史产物' })
  try {
    const remoteUrl = await gitSvc.getRemoteUrl(repo)
    const parsed = parseRemoteUrl(remoteUrl)
    if (!parsed) return res.json({ ok: false, error: '无法解析远程仓库地址' })
    // 短 sha 先展开为完整 oid（GitHub API head_sha 需要完整 40 位）
    const fullSha = await gitSvc.expandOid(repo, sha)
    // 1. 找到该提交的运行
    const runs = await ghApi(`/repos/${parsed.owner}/${parsed.repo}/actions/runs?head_sha=${fullSha}&per_page=1`, settings.token)
    const run = runs.workflow_runs?.[0]
    if (!run) {
      return res.json({ ok: false, error: '该提交没有对应的 CI 运行（可能 GitHub 编译未开启）', sha })
    }
    if (run.conclusion !== 'success') {
      return res.json({ ok: false, error: `该提交的 CI 运行 ${run.status}/${run.conclusion || '未知'}，没有可用产物`, runNumber: run.run_number })
    }
    // 2. 产物
    const arts = await ghApi(`/repos/${parsed.owner}/${parsed.repo}/actions/runs/${run.id}/artifacts`, settings.token)
    const art = arts.artifacts?.find((a) => a.name === 'resume-pdfs') || arts.artifacts?.[0]
    if (!art) {
      return res.json({ ok: false, error: '该运行没有 PDF artifact（GitHub 编译可能未开启）', runNumber: run.run_number })
    }
    // 3. 下载 + 解压 + 缓存（避免重复下载）
    const cacheDir = HISTORY_DIR(repo)
    fs.mkdirSync(cacheDir, { recursive: true })
    const short = sha.slice(0, 7)
    const existing = fs.readdirSync(cacheDir).filter((f) => f.startsWith(`${short}-`))
    if (existing.length > 0) {
      return res.json({ ok: true, pdfs: existing, sha, runNumber: run.run_number, cached: true })
    }
    const zipBuf = await ghDownload(`/repos/${parsed.owner}/${parsed.repo}/actions/artifacts/${art.id}/zip`, settings.token)
    const zip = new AdmZip(zipBuf)
    const pdfs = []
    for (const e of zip.getEntries()) {
      if (e.entryName.toLowerCase().endsWith('.pdf')) {
        const fname = `${short}-${path.basename(e.entryName)}`
        fs.writeFileSync(path.join(cacheDir, fname), e.getData())
        pdfs.push(fname)
      }
    }
    res.json({ ok: true, pdfs, sha, runNumber: run.run_number, cached: false })
  } catch (err) {
    sendError(res, err)
  }
})

// 历史版本 YAML 快照（读取指定提交下的数据文件）
router.get('/git/file-at', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const sha = String(req.query.sha || '').trim()
  const file = String(req.query.path || '').trim()
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return res.json({ ok: false, error: '无效的提交标识' })
  try {
    const abs = safeJoin(repo, file)
    if (!abs.startsWith(path.join(repo, 'data')) && !abs.startsWith(path.join(repo, 'scripts'))) {
      return res.json({ ok: false, error: '仅允许查看 data/ 与 scripts/ 下的文件' })
    }
    const content = await gitSvc.readFileAt(repo, sha, file)
    res.json({ ok: true, content })
  } catch (err) {
    res.json({ ok: false, error: `该提交下不存在文件：${String(err.message).slice(0, 60)}` })
  }
})

// 历史版本 PDF 预览（resumes/history/ 缓存目录）
router.get('/pdf/history/:file', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.status(404).end()
  const fname = path.basename(req.params.file)
  const p = path.join(HISTORY_DIR(repo), fname)
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: '历史 PDF 不存在' })
  res.setHeader('Content-Type', 'application/pdf')
  fs.createReadStream(p).pipe(res)
})

/* ---------- 模板管理（官网模板载入 + 实时切换） ---------- */
router.get('/templates', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const doc = compose.loadVariantsDoc(repo)
    const current = {}
    for (const [name, v] of Object.entries(doc.variants || {})) {
      current[name] = v.layout?.template || null
    }
    res.json({ ok: true, templates: TEMPLATES, current, engineLabels: ENGINE_LABELS })
  } catch (err) {
    sendError(res, err)
  }
})

// 把模板应用到指定方向（实时切换：默认同时触发构建以便立即预览）
router.post('/template/apply', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { variant, template, engine, build = true } = req.body || {}
  try {
    const doc = compose.loadVariantsDoc(repo)
    const v = doc.variants?.[variant]
    if (!v) return res.json({ ok: false, error: `方向 ${variant} 不存在` })
    const tpl = TEMPLATES.find((t) => t.id === template)
    if (!tpl) return res.json({ ok: false, error: '未知模板' })
    v.layout = { ...(v.layout || {}), engine: engine || tpl.engine, template: tpl.id }
    compose.saveVariantsDoc(repo, doc)
    // 用新 layout 重新组合该方向的简历 YAML，再构建产物
    compose.generateAll(repo, [variant])
    let preview = null
    let output = ''
    if (build && tpl.engine === 'latex') {
      const r = await builder.buildVariant(repo, variant)
      if (r.ok) preview = `/api/pdf/${variant}.pdf`
      output = r.output
    } else if (build && tpl.engine === 'html') {
      const r = await builder.buildHtmlVariant(repo, variant)
      if (r.ok) preview = `/api/html/${variant}`
      output = r.output
    }
    res.json({ ok: true, variant, template: tpl.id, engine: tpl.engine, preview, output: output.slice(0, 300) })
  } catch (err) {
    sendError(res, err)
  }
})

// 已生成的 HTML 简历预览（html 引擎产物）
router.get('/html/:name', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.status(404).end()
  const name = path.basename(req.params.name)
  const p = path.join(repo, 'resumes', `${name}.html`)
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'HTML 简历不存在，请先生成' })
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  fs.createReadStream(p).pipe(res)
})

/* ---------- 简历定制（拖拽布局 → 实时渲染 HTML） ---------- */
// 定制布局文档：{ sections: [{key, mode: 'all'|'ids'|'tags', ids?, tags?}], overrides? }
// 映射为 variants.custom（html 引擎）→ compose → 构建 HTML
router.post('/custom/layout', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { sections = [], overrides, template = 'calm' } = req.body || {}
  try {
    const blocks = {}
    const order = []
    for (const s of sections) {
      const allowed = new Set(store.getCategories(repo).map((c) => c.key))
      if (!allowed.has(s.key)) continue
      if (s.mode === 'all') blocks[s.key] = { include: 'all' }
      else if (s.mode === 'ids' && Array.isArray(s.ids) && s.ids.length) blocks[s.key] = { ids: [...new Set(s.ids)] }
      else if (s.mode === 'tags' && Array.isArray(s.tags) && s.tags.length) blocks[s.key] = { tags: [...s.tags] }
      else continue
      order.push(s.key)
    }
    if (Object.keys(blocks).length === 0) {
      return res.json({ ok: false, error: '布局为空，请先拖入内容' })
    }
    const doc = compose.loadVariantsDoc(repo)
    doc.variants = doc.variants || {}
    doc.variants.custom = {
      label: '定制简历',
      // html 引擎：显式合法字号（覆盖 defaults 的 pt 值，避免 html 引擎校验失败）
      layout: { engine: 'html', template, typography: { fontSize: '16px' } },
      sectionOrder: order,
      blocks,
      overrides: overrides?.basics ? { basics: overrides.basics } : undefined,
    }
    compose.saveVariantsDoc(repo, doc)
    compose.generateAll(repo, ['custom'])
    const r = await builder.buildHtmlVariant(repo, 'custom')
    res.json({
      ok: r.ok,
      htmlUrl: r.ok ? '/api/html/custom' : null,
      output: (r.output || '').slice(-400),
    })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 连接数据仓（设置页：自动检测 + 空目录自动生成骨架 + git init） ---------- */
// 复用模板复制逻辑
function copyTemplate(dest) {
  fs.mkdirSync(dest, { recursive: true })
  const copy = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      const s = path.join(src, name)
      const d = path.join(dst, name)
      if (fs.statSync(s).isDirectory()) copy(s, d)
      else fs.copyFileSync(s, d)
    }
  }
  copy(TEMPLATE_DIR, dest)
}

router.post('/project/connect', async (req, res) => {
  const { repoPath } = req.body || {}
  if (!repoPath) return res.json({ ok: false, error: '缺少数仓路径' })
  const dest = path.resolve(repoPath)
  try {
    let generated = false
    if (!fs.existsSync(dest)) {
      // 目录不存在 → 创建并生成骨架
      fs.mkdirSync(dest, { recursive: true })
      copyTemplate(dest)
      generated = true
    } else if (fs.readdirSync(dest).filter((f) => !f.startsWith('.')).length === 0) {
      // 空目录 → 生成骨架
      copyTemplate(dest)
      generated = true
    }
    // 无 .git 时自动 git init
    const inited = generated || !(await gitSvc.isRepo(dest)) ? await gitSvc.initRepo(dest) : false
    const status = await gitSvc.projectOverview(dest, getSettings()).catch(() => ({ configured: true, isRepo: gitSvc.isRepo(dest) }))
    res.json({
      ok: true,
      generated,
      inited,
      target: dest,
      status,
    })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 模板初始化 ---------- */
router.get('/template/info', (req, res) => {
  const files = []
  const walk = (dir, base = '') => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const rel = path.join(base, name)
      if (fs.statSync(p).isDirectory()) walk(p, rel)
      else files.push(rel)
    }
  }
  if (fs.existsSync(TEMPLATE_DIR)) walk(TEMPLATE_DIR)
  res.json({ ok: true, files, templateDir: TEMPLATE_DIR })
})

router.post('/project/init', (req, res) => {
  const { targetDir } = req.body || {}
  if (!targetDir) return res.json({ ok: false, error: '缺少目标目录' })
  const dest = path.resolve(targetDir)
  try {
    fs.mkdirSync(dest, { recursive: true })
    const copy = (src, dst) => {
      fs.mkdirSync(dst, { recursive: true })
      for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name)
        const d = path.join(dst, name)
        if (fs.statSync(s).isDirectory()) copy(s, d)
        else fs.copyFileSync(s, d)
      }
    }
    copy(TEMPLATE_DIR, dest)
    res.json({ ok: true, target: dest })
  } catch (err) {
    sendError(res, err)
  }
})

export default router
