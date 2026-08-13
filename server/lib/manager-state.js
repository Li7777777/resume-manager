// 每个简历数据仓的管理端状态：只保存在 ~/.resume-manager/repos/，不写入数据仓。
// 注：tags/categories 字段仅供首次迁移回退；权威来源是私有仓 tags.yml / categories.yml。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'

const ROOT = path.join(os.homedir(), '.resume-manager', 'repos')
const DEFAULT_TYPE_LABELS = {
  frontend: '前端工程师',
  management: '技术管理',
  custom: '定制简历',
}

function repoKey(repoPath) {
  const normalized = path.resolve(repoPath).replace(/\\/g, '/').toLowerCase()
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20)
}

export function managerStateFile(repoPath) {
  return path.join(ROOT, `${repoKey(repoPath)}.json`)
}

function emptyState(repoPath) {
  return {
    version: 1,
    repoPath: path.resolve(repoPath),
    categories: null,
    tags: [],
    entryNotes: {},
    resumeTypes: {},
  }
}

function migrateLegacyState(repoPath) {
  const state = emptyState(repoPath)

  try {
    const raw = JSON.parse(fs.readFileSync(path.join(repoPath, 'categories.json'), 'utf8'))
    if (Array.isArray(raw.categories)) state.categories = raw.categories
  } catch {
    /* 没有旧分类配置 */
  }

  try {
    const raw = JSON.parse(fs.readFileSync(path.join(repoPath, 'tags.json'), 'utf8'))
    if (Array.isArray(raw.tags)) state.tags = raw.tags
  } catch {
    /* 没有旧标签库 */
  }

  try {
    const doc = yaml.load(fs.readFileSync(path.join(repoPath, 'scripts', 'variants.yml'), 'utf8')) || {}
    for (const [name, variant] of Object.entries(doc.variants || {})) {
      state.resumeTypes[name] = {
        label: variant?.label || DEFAULT_TYPE_LABELS[name] || name,
        branch: variant?.branch || `resume/${name}`,
      }
    }
  } catch {
    /* 没有旧类型配置 */
  }

  try {
    const dataDir = path.join(repoPath, 'data')
    for (const file of fs.readdirSync(dataDir).filter((name) => name.endsWith('.yml'))) {
      const category = file.replace(/\.yml$/, '')
      const value = yaml.load(fs.readFileSync(path.join(dataDir, file), 'utf8'))
      if (category === 'basics' && value && typeof value === 'object' && !Array.isArray(value)) {
        if (typeof value.notes === 'string' && value.notes.trim()) {
          state.entryNotes['basics:basics'] = value.notes
        }
        continue
      }
      if (!Array.isArray(value)) continue
      for (const entry of value) {
        if (entry?.id && typeof entry.notes === 'string' && entry.notes.trim()) {
          state.entryNotes[`${category}:${entry.id}`] = entry.notes
        }
      }
    }
  } catch {
    /* 没有旧备注 */
  }

  return state
}

function normalize(state, repoPath) {
  return {
    ...emptyState(repoPath),
    ...(state || {}),
    version: 1,
    repoPath: path.resolve(repoPath),
    tags: Array.isArray(state?.tags) ? state.tags : [],
    entryNotes: state?.entryNotes && typeof state.entryNotes === 'object' ? state.entryNotes : {},
    resumeTypes: state?.resumeTypes && typeof state.resumeTypes === 'object' ? state.resumeTypes : {},
  }
}

export function getManagerState(repoPath) {
  const file = managerStateFile(repoPath)
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')), repoPath)
  } catch {
    const state = migrateLegacyState(repoPath)
    saveManagerState(repoPath, state)
    return state
  }
}

export function saveManagerState(repoPath, state) {
  const next = normalize(state, repoPath)
  fs.mkdirSync(ROOT, { recursive: true })
  fs.writeFileSync(managerStateFile(repoPath), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

export function updateManagerState(repoPath, updater) {
  const state = getManagerState(repoPath)
  const next = updater(state) || state
  return saveManagerState(repoPath, next)
}

export function getResumeTypeMeta(repoPath, name) {
  return getManagerState(repoPath).resumeTypes[name] || null
}

export function setResumeTypeMeta(repoPath, name, patch) {
  return updateManagerState(repoPath, (state) => {
    state.resumeTypes[name] = { ...(state.resumeTypes[name] || {}), ...patch }
    return state
  }).resumeTypes[name]
}

export function deleteResumeTypeMeta(repoPath, name) {
  updateManagerState(repoPath, (state) => {
    delete state.resumeTypes[name]
    return state
  })
}

export function getEntryNote(repoPath, category, id) {
  return getManagerState(repoPath).entryNotes[`${category}:${id}`] || ''
}

export function setEntryNote(repoPath, category, id, note) {
  updateManagerState(repoPath, (state) => {
    const key = `${category}:${id}`
    if (typeof note === 'string' && note.trim()) state.entryNotes[key] = note
    else delete state.entryNotes[key]
    return state
  })
}

export function deleteEntryNote(repoPath, category, id) {
  setEntryNote(repoPath, category, id, '')
}
