// 数据存储：读写私有数据仓 data/*.yml 的信息全集。
// id/tags 参与组稿；notes 等管理状态位于 ~/.resume-manager/repos/，不会写入私有仓。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import {
  deleteEntryNote,
  getEntryNote,
  getManagerState,
  setEntryNote,
  updateManagerState,
} from './manager-state.js'

export const DEFAULT_CATEGORIES = [
  'basics',
  'work',
  'education',
  'projects',
  'skills',
  'certificates',
  'interests',
]

export const DEFAULT_CATEGORY_LABELS = {
  basics: '基础信息',
  work: '工作经历',
  education: '教育背景',
  projects: '项目经历',
  skills: '专业技能',
  certificates: '证书资质',
  interests: '兴趣爱好',
}

export const CATEGORIES = DEFAULT_CATEGORIES

export const CATEGORY_LABELS = DEFAULT_CATEGORY_LABELS

const KEY_RE = /^[a-z][a-z0-9_-]*$/

// 扫描 data/*.yml 自动发现的分类 key（未配置时兜底）
export function scanDataKeys(repo) {
  const dir = path.join(repo, 'data')
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => f.replace(/\.yml$/, ''))
      .filter((k) => KEY_RE.test(k))
  } catch {
    return []
  }
}

// 读取本机管理状态中的分类配置，并与 data/*.yml 自动发现结果合并。
// 分类展示名/排序/显隐不写入私有数据仓。
export function getCategories(repo) {
  const configured = getManagerState(repo).categories
  const list = []
  if (Array.isArray(configured)) {
    for (const c of configured) {
      if (c && KEY_RE.test(c.key)) {
        list.push({ key: c.key, label: c.label || c.key, visible: c.visible !== false })
      }
    }
  }
  const keys = new Set(list.map((c) => c.key))
  // 未配置时用默认 7 类兜底
  if (list.length === 0) {
    for (const k of DEFAULT_CATEGORIES) {
      list.push({ key: k, label: DEFAULT_CATEGORY_LABELS[k] || k, visible: true })
      keys.add(k)
    }
  }
  // data/*.yml 自动发现（未在配置中的新分类追加，label 取默认或 key）
  for (const k of scanDataKeys(repo)) {
    if (!keys.has(k)) {
      list.push({ key: k, label: DEFAULT_CATEGORY_LABELS[k] || k, visible: true })
      keys.add(k)
    }
  }
  return list
}

export function saveCategories(repo, categories) {
  updateManagerState(repo, (state) => {
    state.categories = categories
    return state
  })
}

/* ---------- 标签库（本机管理状态；不会写入私有仓） ---------- */
export function libTags(repo) {
  return getManagerState(repo).tags
}

export function saveLibTags(repo, tags) {
  const clean = [...new Set(tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))]
  updateManagerState(repo, (state) => {
    state.tags = clean
    return state
  })
  return clean
}

// 全条目重命名标签（from → to，合并去重），返回受影响条目数
export function renameTag(repo, from, to) {
  let affected = 0
  for (const cat of getCategories(repo)) {
    const entries = readCategory(repo, cat.key)
    if (cat.key === 'basics') continue
    let changed = false
    for (const e of entries) {
      if (Array.isArray(e.tags) && e.tags.includes(from)) {
        e.tags = [...new Set(e.tags.map((t) => (t === from ? to : t)))]
        changed = true
      }
    }
    if (changed) {
      writeCategory(repo, cat.key, entries)
      affected += entries.length
    }
  }
  // 更新标签库
  const lib = libTags(repo)
  if (lib.includes(from)) {
    saveLibTags(repo, lib.map((t) => (t === from ? to : t)))
  }
  return affected
}

// 全条目删除标签，返回受影响条目数
export function deleteTag(repo, tag) {
  let affected = 0
  for (const cat of getCategories(repo)) {
    const entries = readCategory(repo, cat.key)
    if (cat.key === 'basics') continue
    let changed = false
    for (const e of entries) {
      if (Array.isArray(e.tags) && e.tags.includes(tag)) {
        e.tags = e.tags.filter((t) => t !== tag)
        changed = true
      }
    }
    if (changed) {
      writeCategory(repo, cat.key, entries)
      affected += entries.length
    }
  }
  saveLibTags(repo, libTags(repo).filter((t) => t !== tag))
  return affected
}
// 组稿时剥除的键；notes 仅用于兼容迁移前数据。
export const META_KEYS = new Set(['id', 'tags', 'notes'])

export function dataFile(repoPath, category) {
  return path.join(repoPath, 'data', `${category}.yml`)
}

export function isMetaKey(key) {
  return META_KEYS.has(key) || key.startsWith('_')
}

export function stripMeta(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const out = {}
  for (const [k, v] of Object.entries(entry)) {
    if (!isMetaKey(k)) out[k] = v
  }
  return out
}

export function genId() {
  return crypto.randomUUID().slice(0, 8)
}

// 读取某个分类的条目；basics 返回单对象，其余返回数组
export function readCategory(repoPath, category) {
  const file = dataFile(repoPath, category)
  if (!fs.existsSync(file)) return category === 'basics' ? {} : []
  const raw = yaml.load(fs.readFileSync(file, 'utf8')) || {}
  if (category === 'basics') {
    const note = getEntryNote(repoPath, category, 'basics')
    delete raw.notes
    return note ? { ...raw, notes: note } : raw
  }
  const list = Array.isArray(raw) ? raw : []
  // 补齐 id/tags 并从本机侧车恢复备注，保证后续操作稳定
  for (const e of list) {
    if (e && typeof e === 'object') {
      if (!e.id) e.id = genId()
      if (!Array.isArray(e.tags)) e.tags = []
      const note = getEntryNote(repoPath, category, e.id)
      if (note) e.notes = note
      else delete e.notes
    }
  }
  return list
}

export function writeCategory(repoPath, category, entries) {
  const file = dataFile(repoPath, category)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const persisted = Array.isArray(entries)
    ? entries.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        const { notes, ...resumeData } = entry
        return resumeData
      })
    : entries && typeof entries === 'object'
      ? Object.fromEntries(Object.entries(entries).filter(([key]) => key !== 'notes'))
      : entries
  fs.writeFileSync(file, yaml.dump(persisted, { noRefs: true, lineWidth: -1, sortKeys: false }), 'utf8')
}

export function getEntry(repoPath, category, id) {
  const list = readCategory(repoPath, category)
  if (category === 'basics') return list
  return list.find((e) => e.id === id)
}

export function upsertEntry(repoPath, category, entry) {
  if (category === 'basics') {
    const current = readCategory(repoPath, category)
    const { notes, id: ignoredId, ...resumeData } = entry
    const { notes: ignoredCurrentNotes, id: ignoredCurrentId, ...currentResumeData } = current
    setEntryNote(repoPath, category, 'basics', notes)
    if (JSON.stringify(currentResumeData) !== JSON.stringify(resumeData)) {
      writeCategory(repoPath, category, resumeData)
    }
    return { ...resumeData, ...(notes ? { notes } : {}), id: 'basics' }
  }
  const list = readCategory(repoPath, category)
  const id = entry.id || genId()
  const idx = list.findIndex((e) => e.id === id)
  const { notes, ...resumeData } = entry
  const next = { ...resumeData, id }
  setEntryNote(repoPath, category, id, notes)
  if (idx >= 0) {
    const { notes: ignoredCurrentNotes, ...currentResumeData } = list[idx]
    list[idx] = next
    if (JSON.stringify(currentResumeData) !== JSON.stringify(next)) writeCategory(repoPath, category, list)
  } else {
    list.push(next)
    writeCategory(repoPath, category, list)
  }
  return { ...next, ...(notes ? { notes } : {}) }
}

export function deleteEntry(repoPath, category, id) {
  const list = readCategory(repoPath, category)
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return false
  list.splice(idx, 1)
  deleteEntryNote(repoPath, category, id)
  writeCategory(repoPath, category, list)
  return true
}

// 汇总所有条目（用于统计与标签云）
export function allEntries(repoPath) {
  const out = {}
  const tagCount = {}
  for (const cat of getCategories(repoPath)) {
    if (cat.visible === false) continue
    const entries = readCategory(repoPath, cat.key)
    out[cat.key] = entries
    if (cat.key === 'basics') continue
    for (const e of entries) {
      for (const t of e.tags || []) {
        tagCount[t] = (tagCount[t] || 0) + 1
      }
    }
  }
  return { entries: out, tagCount }
}
