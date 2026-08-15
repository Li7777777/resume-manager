// API 路由：信息管理 / 组合 / 构建 / YAML 编辑 / Git 看板 / 模板初始化 / 设置
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import yaml from 'js-yaml'
import { getSettings, saveSettings, getRepoPath } from '../config.js'
import * as store from '../lib/data-store.js'
import * as compose from '../lib/compose.js'
import { refreshGithubStars } from '../lib/github-stars.js'
import * as builder from '../lib/builder.js'
import * as gitSvc from '../lib/git-service.js'
import * as managerState from '../lib/manager-state.js'
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
// Git 同步开关：关闭时折叠 git 配置、隐藏看板、时间线只显示正式版，后端 git 端点拒绝。
const gitSyncOn = () => getSettings().gitSyncEnabled !== false
const gitSyncGuard = (res) => {
  if (gitSyncOn()) return true
  res.json({ ok: false, error: 'Git 同步已关闭，请在「设置」页开启' })
  return false
}

/* ---------- 文件夹选择（设置页数据仓路径浏览） ---------- */
// 仅返回目录名（不含文件内容），供前端文件夹选择面板导航
router.get('/fs/dirs', (req, res) => {
  const reqPath = String(req.query.path || '').trim()
  try {
    if (process.platform === 'win32') {
      if (!reqPath) {
        // 根视图：枚举可用盘符
        const drives = []
        for (let c = 65; c <= 90; c++) {
          const letter = String.fromCharCode(c)
          try {
            if (fs.existsSync(`${letter}:\\`)) drives.push(`${letter}:`)
          } catch {
            /* 跳过无权限盘符 */
          }
        }
        return res.json({ ok: true, current: '', parent: null, dirs: drives })
      }
      const stat = fs.statSync(reqPath)
      if (!stat.isDirectory()) return res.json({ ok: false, error: '不是目录' })
      const dirs = fs
        .readdirSync(reqPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, 'zh'))
      const parent = path.dirname(reqPath)
      return res.json({ ok: true, current: reqPath, parent: parent === reqPath ? null : parent, dirs })
    }
    // 非 Windows
    const current = reqPath || '/'
    const stat = fs.statSync(current)
    if (!stat.isDirectory()) return res.json({ ok: false, error: '不是目录' })
    const dirs = fs
      .readdirSync(current, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'zh'))
    const parent = path.dirname(current)
    return res.json({ ok: true, current, parent: parent === current ? null : parent, dirs })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

// Git 同步关闭时，拒绝所有 git / github 交互端点（含自动检测、Actions 变量、CI 产物）
router.use('/git', (req, res, next) => {
  if (gitSyncOn()) return next()
  res.json({ ok: false, error: 'Git 同步已关闭，请在「设置」页开启' })
})
router.use('/github', (req, res, next) => {
  if (gitSyncOn()) return next()
  res.json({ ok: false, error: 'Git 同步已关闭，请在「设置」页开启' })
})

router.get('/settings', (req, res) => {
  const s = getSettings()
  res.json({ ok: true, settings: { ...s, token: s.token ? '••••••' : '' } })
})

router.put('/settings', (req, res) => {
  const { repoPath, token, gitUsername, gitEmail, localPdfBuild, githubPdfBuild, gitSyncEnabled, starsEnabled } = req.body || {}
  const patch = {}
  if (typeof repoPath === 'string') patch.repoPath = repoPath
  if (typeof token === 'string' && token !== '••••••') patch.token = token
  if (typeof gitUsername === 'string') patch.gitUsername = gitUsername
  if (typeof gitEmail === 'string') patch.gitEmail = gitEmail
  if (typeof localPdfBuild === 'boolean') patch.localPdfBuild = localPdfBuild
  if (typeof githubPdfBuild === 'boolean') patch.githubPdfBuild = githubPdfBuild
  if (typeof gitSyncEnabled === 'boolean') patch.gitSyncEnabled = gitSyncEnabled
  if (typeof starsEnabled === 'boolean') patch.starsEnabled = starsEnabled
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
  const repo = getRepoPath()
  try {
    if (!gitSyncOn()) {
      // Git 同步关闭：不访问 .git，git 字段全部置空
      return res.json({
        configured: !!repo,
        gitSyncEnabled: false,
        isRepo: false,
        branch: null,
        remoteUrl: null,
        head: null,
        dirty: 0,
        ahead: 0,
        behind: 0,
        recentCommits: [],
      })
    }
    res.json({ ...(await gitSvc.projectOverview(repo, getSettings())), gitSyncEnabled: true })
  } catch (err) {
    res.json({ configured: !!repo, gitSyncEnabled: gitSyncOn(), error: String(err.message) })
  }
})

/* ---------- 分类管理（自定义 tab：增/删/改名/排序） ---------- */
// 分类名/排序/显隐存私有仓 categories.yml（随 Git 版本化）；只有新增/删除分类时才创建/删除 data/*.yml。
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
// 标签列表：私有仓 tags.yml 标签库（方向 + 细分）+ 条目标签计数
router.get('/tags', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const lib = store.libTags(repo)
    const subLib = store.libSubTags(repo)
    const { tagCount, subTagCount } = store.allEntries(repo)
    const tags = Object.keys(tagCount)
      .map((name) => ({ name, count: tagCount[name], inLibrary: lib.includes(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    // 标签库中尚无条目使用的标签也列出
    for (const t of lib) {
      if (!tags.some((x) => x.name === t)) tags.push({ name: t, count: 0, inLibrary: true })
    }
    res.json({ ok: true, tags, library: lib, subLibrary: subLib, subTagCount: subTagCount || {} })
  } catch (err) {
    sendError(res, err)
  }
})

// 新增标签（写入方向标签库；条目编辑时 TagInput 建议即包含）
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

// 新增细分标签（写入细分标签库；对应条目 keywords）
router.put('/tags/sublibrary', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { tags } = req.body || {}
  if (!Array.isArray(tags)) return res.json({ ok: false, error: '参数错误' })
  try {
    const lib = store.saveLibSubTags(repo, tags)
    res.json({ ok: true, subLibrary: lib })
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

// 重命名细分标签（同步所有条目 keywords，细分库同步）
router.post('/tags/sub-rename', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { from, to } = req.body || {}
  if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
    return res.json({ ok: false, error: '参数错误' })
  }
  const f = from.trim()
  const t = to.trim()
  if (!f || !t) return res.json({ ok: false, error: '细分标签不能为空' })
  if (f === t) return res.json({ ok: true, affected: 0, message: '新旧细分标签相同' })
  try {
    const affected = store.renameSubTag(repo, f, t)
    res.json({ ok: true, affected, from: f, to: t })
  } catch (err) {
    sendError(res, err)
  }
})

// 删除细分标签（同步所有条目 keywords，细分库同步移除）
router.post('/tags/sub-delete', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const { tag } = req.body || {}
  if (!tag || typeof tag !== 'string') return res.json({ ok: false, error: '参数错误' })
  try {
    const affected = store.deleteSubTag(repo, tag.trim())
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
  res.json({ ok: true, entries, tagCount, library: store.libTags(repo), subLibrary: store.libSubTags(repo), categories: store.getCategories(repo) })
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

// 按 id 顺序重排分类条目（注意：必须注册在 /entries/:cat/:id 之前，避免 reorder 被当作 id）
router.put('/entries/:cat/reorder', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id) => typeof id === 'string' && id.length > 0)
      : []
    const next = store.reorderEntries(repo, req.params.cat, ids)
    res.json({ ok: true, entries: next })
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
    const deleted = store.deleteEntry(repo, req.params.cat, req.params.id)
    if (!deleted) return res.json({ ok: false, error: '未找到该条目，可能已删除' })
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
    const variants = compose.listVariants(repo).map((variant) => {
      const meta = managerState.getResumeTypeMeta(repo, variant.name) || {}
      return {
        ...variant,
        label: meta.label || variant.name,
        branch: meta.branch || `resume/${variant.name}`,
      }
    })
    res.json({ ok: true, variants, defaults: (yaml.load(fs.readFileSync(path.join(repo, 'scripts', 'variants.yml'), 'utf8')) || {}).defaults || {} })
  } catch (err) {
    sendError(res, err)
  }
})

router.put('/variants', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const doc = req.body || { defaults: {}, variants: {} }
    for (const [name, variant] of Object.entries(doc.variants || {})) {
      if (variant?.label || variant?.branch) {
        managerState.setResumeTypeMeta(repo, name, {
          ...(variant.label ? { label: variant.label } : {}),
          ...(variant.branch ? { branch: variant.branch } : {}),
        })
      }
    }
    compose.saveVariantsDoc(repo, doc)
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 简历类型（每个类型对应一个 Git 分支；main 类型直接使用主分支） ---------- */
const TYPE_NAME_RE = /^[a-z][a-z0-9_-]*$/
const TYPE_BRANCH_RE = /^resume\/[a-z][a-z0-9._/-]*$/
const typeBranch = (repo, name) => {
  // 默认类型 main 直接用仓库主分支，不再创建 resume/main
  if (name === 'main') return 'main'
  return managerState.getResumeTypeMeta(repo, name)?.branch || `resume/${name}`
}
const typeLabel = (repo, name) => managerState.getResumeTypeMeta(repo, name)?.label || name

router.get('/resume-types', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const doc = compose.loadVariantsDoc(repo)
    const branches = await gitSvc.listBranches(repo)
    const byName = new Map()
    for (const [name] of Object.entries(doc.variants || {})) {
      const branch = typeBranch(repo, name)
      byName.set(name, {
        name,
        label: typeLabel(repo, name),
        branch,
        configured: true,
        current: branches.current === branch,
        local: branches.local.includes(branch),
        remote: branches.remote.includes(branch),
      })
    }
    for (const branch of [...branches.local, ...branches.remote]) {
      if (!branch.startsWith('resume/')) continue
      const name = branch.slice('resume/'.length)
      if (!name || byName.has(name)) continue
      byName.set(name, {
        name,
        label: typeLabel(repo, name),
        branch,
        configured: false,
        current: branches.current === branch,
        local: branches.local.includes(branch),
        remote: branches.remote.includes(branch),
      })
    }
    const types = [...byName.values()].sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))
    res.json({ ok: true, types, currentBranch: branches.current })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/resume-types', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  if (!gitSyncGuard(res)) return
  const name = String(req.body?.name || '').trim()
  const label = String(req.body?.label || '').trim()
  const branch = String(req.body?.branch || `resume/${name}`).trim()
  if (!TYPE_NAME_RE.test(name)) return res.json({ ok: false, error: '类型标识只能使用小写字母、数字、下划线和连字符，且必须以字母开头' })
  if (!TYPE_BRANCH_RE.test(branch)) return res.json({ ok: false, error: '分支必须以 resume/ 开头，并使用合法的 Git 分支字符' })
  try {
    const doc = compose.loadVariantsDoc(repo)
    doc.variants = doc.variants || {}
    if (doc.variants[name]) return res.json({ ok: false, error: `简历类型 ${name} 已存在` })
    const branches = await gitSvc.listBranches(repo)
    if (branches.local.includes(branch)) return res.json({ ok: false, error: `Git 分支 ${branch} 已存在` })
    await gitSvc.createBranch(repo, branch)
    await gitSvc.checkoutBranch(repo, branch)
    doc.variants[name] = {
      blocks: {
        basics: { include: 'all' },
        work: { include: 'all' },
        education: { include: 'all' },
        projects: { include: 'all' },
        skills: { include: 'all' },
      },
      sectionOrder: ['basics', 'skills', 'work', 'projects', 'education'],
      layout: { engine: 'latex', template: doc.defaults?.layout?.template || 'moderncv-banking' },
    }
    compose.saveVariantsDoc(repo, doc)
    managerState.setResumeTypeMeta(repo, name, { label: label || name, branch })
    res.json({ ok: true, type: { name, label: label || name, branch, configured: true, current: true, local: true, remote: false } })
  } catch (err) {
    sendError(res, err)
  }
})

router.put('/resume-types/:name', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const name = String(req.params.name || '')
  const label = String(req.body?.label || '').trim()
  if (!label) return res.json({ ok: false, error: '类型名称不能为空' })
  try {
    const doc = compose.loadVariantsDoc(repo)
    if (!doc.variants?.[name]) return res.json({ ok: false, error: `简历类型 ${name} 不存在` })
    const branch = typeBranch(repo, name)
    managerState.setResumeTypeMeta(repo, name, { label, branch })
    res.json({ ok: true, name, label, branch })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/resume-types/:name/ensure-branch', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  if (!gitSyncGuard(res)) return
  const name = String(req.params.name || '')
  try {
    const doc = compose.loadVariantsDoc(repo)
    const variant = doc.variants?.[name]
    if (!variant) return res.json({ ok: false, error: `简历类型 ${name} 不存在` })
    const branch = typeBranch(repo, name)
    const result = await gitSvc.createBranch(repo, branch)
    res.json({ ok: true, name, branch, created: result.created })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/resume-types/:name/checkout', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  if (!gitSyncGuard(res)) return
  const name = String(req.params.name || '')
  try {
    const doc = compose.loadVariantsDoc(repo)
    const branch = typeBranch(repo, name)
    const branches = await gitSvc.listBranches(repo)
    if (!branches.local.includes(branch)) return res.json({ ok: false, error: `类型分支 ${branch} 尚未创建` })
    await gitSvc.checkoutBranch(repo, branch)
    res.json({ ok: true, name, branch })
  } catch (err) {
    sendError(res, err)
  }
})

router.delete('/resume-types/:name', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  if (!gitSyncGuard(res)) return
  const name = String(req.params.name || '')
  try {
    const doc = compose.loadVariantsDoc(repo)
    const variant = doc.variants?.[name]
    if (!variant) return res.json({ ok: false, error: `简历类型 ${name} 不存在` })
    const branch = typeBranch(repo, name)
    await gitSvc.deleteBranch(repo, branch)
    delete doc.variants[name]
    compose.saveVariantsDoc(repo, doc)
    managerState.deleteResumeTypeMeta(repo, name)
    res.json({ ok: true, name, branch, note: '远程分支如已推送，请在 GitHub 上按需删除' })
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
      // 兼容构建只生成临时产物；正式版必须从简历定制页显式发布。
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

/* ---------- GitHub 编译开关（Actions 仓库变量；不修改私有仓文件） ---------- */
const PDF_BUILD_VARIABLE = 'RESUME_MANAGER_PDF_BUILD'

async function githubRepoContext(repo, settings) {
  const remoteUrl = await gitSvc.getRemoteUrl(repo)
  const parsed = parseRemoteUrl(remoteUrl)
  if (!parsed) throw new Error('无法从远程地址解析 GitHub 仓库')
  if (!settings.token) throw new Error('未配置 GitHub Token，无法读写 Actions 仓库变量')
  return parsed
}

router.get('/github/pdf-config', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  if (!settings.token) return res.json({ ok: true, available: false, present: false, remoteValue: null })
  try {
    const parsed = await githubRepoContext(repo, settings)
    const result = await ghApi(`/repos/${parsed.owner}/${parsed.repo}/actions/variables?per_page=100`, settings.token)
    const variable = (result.variables || []).find((item) => item.name === PDF_BUILD_VARIABLE)
    res.json({
      ok: true,
      available: true,
      present: !!variable,
      remoteValue: variable ? String(variable.value).toLowerCase() === 'true' : false,
      variable: PDF_BUILD_VARIABLE,
    })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/github/pdf-config', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  try {
    const parsed = await githubRepoContext(repo, settings)
    const base = `/repos/${parsed.owner}/${parsed.repo}/actions/variables`
    const result = await ghApi(`${base}?per_page=100`, settings.token)
    const present = (result.variables || []).some((item) => item.name === PDF_BUILD_VARIABLE)
    const value = String(!!settings.githubPdfBuild)
    if (present) {
      await ghApi(`${base}/${PDF_BUILD_VARIABLE}`, settings.token, {
        method: 'PATCH',
        body: { name: PDF_BUILD_VARIABLE, value },
      })
    } else {
      await ghApi(base, settings.token, {
        method: 'POST',
        body: { name: PDF_BUILD_VARIABLE, value },
      })
    }
    res.json({ ok: true, present: true, remoteValue: value === 'true', variable: PDF_BUILD_VARIABLE })
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

/* ---------- 合并时间轴（本机正式版 + Git 提交/CI 运行） ---------- */
// 预览不会进入时间轴；只返回 kind=release（显式发布）与 kind=github。
router.get('/history', async (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  const settings = getSettings()
  const limit = Math.min(Number(req.query.limit) || 30, 50)
  try {
    const doc = compose.loadVariantsDoc(repo)
    const names = Object.keys(doc.variants || {})
    const variant = String(req.query.variant || names[0] || '')
    const cfg = doc.variants?.[variant]
    if (!cfg) return res.json({ ok: false, error: `简历类型 ${variant || '—'} 不存在` })
    // 分支由类型配置决定，前端不能注入任意 ref
    const branch = typeBranch(repo, variant)
    let ref = null
    let parsed = null
    let githubItems = []
    if (gitSyncOn()) {
      const branches = await gitSvc.listBranches(repo)
      ref = branches.local.includes(branch) ? branch : branches.remote.includes(branch) ? `origin/${branch}` : null
      const commits = ref ? await gitSvc.getLog(repo, limit, ref) : []
      const remoteUrl = await gitSvc.getRemoteUrl(repo)
      parsed = parseRemoteUrl(remoteUrl)
      let runMap = {}
      if (parsed && settings.token) {
        try {
          const runs = await ghApi(
            `/repos/${parsed.owner}/${parsed.repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=50`,
            settings.token,
          )
          runMap = Object.fromEntries(
            (runs.workflow_runs || []).map((r) => [
              r.head_sha,
              { id: r.id, run_number: r.run_number, status: r.status, conclusion: r.conclusion, created_at: r.created_at, name: r.name },
            ]),
          )
        } catch {
          /* token 权限不足或网络问题：仅展示该分支的本地提交 */
        }
      }
      githubItems = commits.map((c) => ({
        kind: 'github',
        id: c.oid,
        oid: c.oid,
        short: c.short,
        message: c.message,
        author: c.author,
        timestamp: c.timestamp,
        variant,
        branch,
        run: runMap[c.oid] || null,
      }))
    }
    // 仅显式发布的正式版进入时间轴；旧 kind=local 预览记录永久过滤；Git 同步关闭时只返回正式版。
    const releaseItems = listBuilds(repo)
      .filter((b) => b.kind === 'release' && (b.branch === branch || (!b.branch && b.variant === variant)))
      .map((b) => ({ ...b, kind: 'release', branch }))
    const items = [...githubItems, ...releaseItems]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit)
    res.json({
      ok: true,
      items,
      variant,
      branch,
      branchExists: !!ref,
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
  const variant = String(req.query.variant || '').trim()
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return res.json({ ok: false, error: '无效的提交标识' })
  if (variant && !TYPE_NAME_RE.test(variant)) return res.json({ ok: false, error: '无效的简历类型' })
  if (!settings.token) return res.json({ ok: false, error: '未配置 GitHub Token，无法拉取历史产物' })
  try {
    const remoteUrl = await gitSvc.getRemoteUrl(repo)
    const parsed = parseRemoteUrl(remoteUrl)
    if (!parsed) return res.json({ ok: false, error: '无法解析远程仓库地址' })
    // 短 sha 先展开为完整 oid（GitHub API head_sha 需要完整 40 位）
    const fullSha = await gitSvc.expandOid(repo, sha)
    const doc = compose.loadVariantsDoc(repo)
    const branch = variant && doc.variants?.[variant] ? typeBranch(repo, variant) : null
    // 1. 找到该提交在对应类型分支上的运行（新分支可能共享同一初始 SHA，必须同时按 branch 过滤）
    const branchQuery = branch ? `&branch=${encodeURIComponent(branch)}` : ''
    const runs = await ghApi(`/repos/${parsed.owner}/${parsed.repo}/actions/runs?head_sha=${fullSha}${branchQuery}&per_page=1`, settings.token)
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
    const existing = fs.readdirSync(cacheDir).filter((f) => f.startsWith(`${short}-`) && (!variant || f === `${short}-${variant}.pdf`))
    if (existing.length > 0) {
      return res.json({ ok: true, pdfs: existing, sha, variant: variant || null, runNumber: run.run_number, cached: true })
    }
    const zipBuf = await ghDownload(`/repos/${parsed.owner}/${parsed.repo}/actions/artifacts/${art.id}/zip`, settings.token)
    const zip = new AdmZip(zipBuf)
    const pdfs = []
    for (const e of zip.getEntries()) {
      if (e.entryName.toLowerCase().endsWith('.pdf')) {
        const base = path.basename(e.entryName)
        const fname = `${short}-${base}`
        fs.writeFileSync(path.join(cacheDir, fname), e.getData())
        if (!variant || base === `${variant}.pdf`) pdfs.push(fname)
      }
    }
    if (variant && pdfs.length === 0) {
      return res.json({ ok: false, error: `该运行没有 ${variant}.pdf 产物`, sha, variant, runNumber: run.run_number })
    }
    res.json({ ok: true, pdfs, sha, variant: variant || null, runNumber: run.run_number, cached: false })
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

// 本机正式版归档；支持 PDF 与 HTML，不提供预览构建产物的历史入口。
router.get('/release/history/:file', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.status(404).end()
  const fname = path.basename(req.params.file)
  const p = path.join(HISTORY_DIR(repo), fname)
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: '正式版产物不存在' })
  const extension = path.extname(fname).toLowerCase()
  if (extension === '.pdf') res.setHeader('Content-Type', 'application/pdf')
  else if (extension === '.html') res.setHeader('Content-Type', 'text/html; charset=utf-8')
  else return res.status(400).json({ ok: false, error: '不支持的正式版文件类型' })
  res.setHeader('Cache-Control', 'no-cache')
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

/* ---------- 简历定制草稿（本机侧车，不写私有仓） ---------- */
function sanitizeCustomizerState(repo, input) {
  const raw = input && typeof input === 'object' ? input : {}
  const doc = compose.loadVariantsDoc(repo)
  const variantNames = new Set(Object.keys(doc.variants || {}))
  const categories = store.getCategories(repo).map((item) => item.key)
  const allowedCategories = new Set(categories)
  const drafts = {}

  for (const [name, value] of Object.entries(raw.drafts || {})) {
    if (!variantNames.has(name) || !value || typeof value !== 'object') continue
    const template = TEMPLATES.some((item) => item.id === value.template)
      ? value.template
      : doc.variants?.[name]?.layout?.template || doc.defaults?.layout?.template || TEMPLATES[0]?.id
    if (!template) continue

    const sections = []
    const sectionKeys = new Set()
    for (const section of Array.isArray(value.sections) ? value.sections : []) {
      if (!section || typeof section.key !== 'string' || !allowedCategories.has(section.key) || sectionKeys.has(section.key)) continue
      sectionKeys.add(section.key)
      if (section.mode === 'all') sections.push({ key: section.key, mode: 'all' })
      else if (section.mode === 'ids') {
        const ids = [...new Set((Array.isArray(section.ids) ? section.ids : []).filter((id) => typeof id === 'string' && id).slice(0, 500))]
        sections.push({ key: section.key, mode: 'ids', ids })
      } else if (section.mode === 'tags') {
        const tags = [...new Set((Array.isArray(section.tags) ? section.tags : []).filter((tag) => typeof tag === 'string' && tag).slice(0, 100))]
        sections.push({ key: section.key, mode: 'tags', tags })
      }
    }

    drafts[name] = {
      template,
      sections,
      updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    }
  }

  return {
    selectedType: variantNames.has(raw.selectedType) ? raw.selectedType : '',
    workspaceMode: raw.workspaceMode === 'yaml' ? 'yaml' : 'visual',
    category: allowedCategories.has(raw.category)
      ? raw.category
      : categories.find((key) => key !== 'basics') || categories[0] || 'work',
    drafts,
  }
}

router.get('/custom/state', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const state = sanitizeCustomizerState(repo, managerState.getCustomizerState(repo))
    managerState.setCustomizerState(repo, state)
    res.json({ ok: true, state })
  } catch (err) {
    sendError(res, err)
  }
})

router.put('/custom/state', (req, res) => {
  const repo = getRepoPath()
  if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
  try {
    const current = managerState.getCustomizerState(repo)
    const incoming = req.body && typeof req.body === 'object' ? req.body : {}
    const drafts = { ...(current.drafts || {}) }
    for (const [name, draft] of Object.entries(incoming.drafts || {})) {
      const currentTime = Number(drafts[name]?.updatedAt) || 0
      const incomingTime = Number(draft?.updatedAt) || 0
      if (incomingTime >= currentTime) drafts[name] = draft
    }
    const state = sanitizeCustomizerState(repo, { ...current, ...incoming, drafts })
    res.json({ ok: true, state: managerState.setCustomizerState(repo, state) })
  } catch (err) {
    sendError(res, err)
  }
})

/* ---------- 简历定制（预览不留历史；显式发布才进入时间轴） ---------- */
function resolveCustomizedVariant(repo, doc, variant, body) {
  const current = doc.variants?.[variant]
  if (!current) throw new Error(`当前 YAML 中不存在简历类型 ${variant}`)

  const hasVisualDraft = body.template !== undefined || body.sections !== undefined
  if (!hasVisualDraft) {
    const layout = { ...(doc.defaults?.layout || {}), ...(current.layout || {}) }
    const template = TEMPLATES.find((item) => item.id === layout.template)
    if (!template) throw new Error(`当前 YAML 使用了未知模板 ${layout.template || '—'}`)
    const engine = layout.engine || template.engine
    if (engine !== 'latex' && engine !== 'html') throw new Error(`不支持的预览引擎 ${engine}`)
    return { next: current, template, engine }
  }

  if (!Array.isArray(body.sections)) throw new Error('布局格式无效')
  const template = TEMPLATES.find((item) => item.id === body.template)
  if (!template) throw new Error('请选择有效的简历模板')
  const allowed = new Set(store.getCategories(repo).map((category) => category.key))
  const blocks = {}
  const order = []
  for (const section of body.sections) {
    if (!allowed.has(section.key)) continue
    if (section.mode === 'all') blocks[section.key] = { include: 'all' }
    else if (section.mode === 'ids' && Array.isArray(section.ids) && section.ids.length) blocks[section.key] = { ids: [...new Set(section.ids)] }
    else if (section.mode === 'tags' && Array.isArray(section.tags) && section.tags.length) blocks[section.key] = { tags: [...new Set(section.tags)] }
    else continue
    order.push(section.key)
  }
  if (Object.keys(blocks).length === 0) throw new Error('布局为空，请先拖入内容')
  // 基础信息始终用于简历头部，不受可视化正文章节拖拽影响。
  blocks.basics = { include: true }
  const currentWithoutOverrides = { ...current }
  delete currentWithoutOverrides.overrides

  return {
    next: {
      ...currentWithoutOverrides,
      layout: {
        engine: template.engine,
        template: template.id,
        typography: { fontSize: template.engine === 'html' ? '16px' : '11pt' },
      },
      htmlLayout: undefined,
      sectionOrder: order,
      blocks,
    },
    template,
    engine: template.engine,
  }
}

function archiveRelease(repo, variant, engine) {
  const id = `release-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const extension = engine === 'html' ? 'html' : 'pdf'
  const source = path.join(repo, 'resumes', `${variant}.${extension}`)
  if (!fs.existsSync(source)) throw new Error('正式版产物不存在')
  fs.mkdirSync(HISTORY_DIR(repo), { recursive: true })
  const artifact = `${variant}-${id}.${extension}`
  fs.copyFileSync(source, path.join(HISTORY_DIR(repo), artifact))
  return { id, artifact }
}

async function renderCustomizedVariant(repo, variant, config, defaults, engine, branch, publish) {
  // 正式发布时才拉取 GitHub star 数并更新缓存；预览只读缓存，不发起网络请求
  if (publish && getSettings().starsEnabled !== false) {
    try {
      await refreshGithubStars(store.readCategory(repo, 'projects'))
    } catch {
      // 拉取失败不阻断发布，组合时退回旧缓存或无徽章
    }
  }
  compose.generateVariant(repo, variant, config, defaults)
  const result = engine === 'html'
    ? await builder.buildHtmlVariant(repo, variant)
    : await builder.buildVariant(repo, variant, { compose: false })
  const preview = result.ok
    ? engine === 'html'
      ? `/api/html/${encodeURIComponent(variant)}`
      : `/api/pdf/${encodeURIComponent(variant)}.pdf`
    : null

  let release = null
  if (result.ok && publish) {
    const archived = archiveRelease(repo, variant, engine)
    const head = (await gitSvc.getLog(repo, 1))[0] || null
    release = recordBuild({
      id: archived.id,
      kind: 'release',
      repoPath: repo,
      variant,
      branch,
      engine,
      artifacts: [archived.artifact],
      sha: head?.oid || null,
      headMessage: head?.message || null,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'success',
      output: (result.output || '').slice(0, 500),
    })
  }
  return { result, preview, release }
}

function customizedHandler({ persist, publish }) {
  return async (req, res) => {
    const repo = getRepoPath()
    if (!repo) return res.json({ ok: false, error: '未配置数据仓' })
    const variant = String(req.body?.variant || '')
    if (!TYPE_NAME_RE.test(variant)) return res.json({ ok: false, error: '请选择有效的简历类型' })
    try {
      const doc = compose.loadVariantsDoc(repo)
      const expectedBranch = typeBranch(repo, variant)
      const activeBranch = await gitSvc.currentBranchSafe(repo)
      if (activeBranch !== expectedBranch) {
        return res.json({ ok: false, error: `请先在「简历类型」页切换到 ${expectedBranch}，再定制该类型` })
      }
      const resolved = resolveCustomizedVariant(repo, doc, variant, req.body || {})
      if (resolved.engine === 'latex' && getSettings().localPdfBuild === false) {
        return res.json({ ok: false, error: '本地 PDF 编译已关闭，请在「设置」页开启后再生成 LaTeX 版本' })
      }
      if (persist) {
        doc.variants[variant] = resolved.next
        compose.saveVariantsDoc(repo, doc)
      }
      const { result, preview, release } = await renderCustomizedVariant(
        repo,
        variant,
        resolved.next,
        doc.defaults || {},
        resolved.engine,
        expectedBranch,
        publish,
      )
      res.json({
        ok: result.ok,
        preview,
        engine: resolved.engine,
        template: resolved.template.id,
        release: release ? { id: release.id, timestamp: release.timestamp } : null,
        error: result.ok ? undefined : (result.output || (publish ? '正式版发布失败' : '预览构建失败')).slice(-500),
        output: (result.output || '').slice(-500),
      })
    } catch (err) {
      sendError(res, err)
    }
  }
}

// 旧客户端兼容：原“保存并预览”按正式发布处理。
router.post('/custom/layout', customizedHandler({ persist: true, publish: true }))
router.post('/custom/release', customizedHandler({ persist: true, publish: true }))
// 可视化草稿可随请求预览；仅传 variant 时按落盘 YAML 预览。两者均不写时间轴。
router.post('/custom/preview', customizedHandler({ persist: false, publish: false }))

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
