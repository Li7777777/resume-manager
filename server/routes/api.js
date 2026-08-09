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

/* ---------- 项目总览 ---------- */
router.get('/project/status', async (req, res) => {
  try {
    res.json(await gitSvc.projectOverview(getRepoPath(), getSettings()))
  } catch (err) {
    res.json({ configured: !!getRepoPath(), error: String(err.message) })
  }
})

/* ---------- 信息条目 ---------- */
router.get('/entries', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { entries, tagCount } = store.allEntries(repo)
  res.json({ ok: true, entries, tagCount, categories: store.CATEGORIES, labels: store.CATEGORY_LABELS })
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
    for (const cat of store.CATEGORIES) {
      const f = store.dataFile(repo, cat)
      files.push({ path: `data/${cat}.yml`, label: store.CATEGORY_LABELS[cat], exists: fs.existsSync(f) })
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
