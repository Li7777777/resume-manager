// GitHub star 数量拉取与本地缓存
// - 解析 GitHub 仓库 URL → owner/repo
// - 拉取 stargazers_count（正式发布时调用）
// - 缓存到 ~/.resume-manager/github-stars.json（预览只读缓存，不发起网络请求）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSettings } from '../config.js'

const CACHE_FILE = path.join(os.homedir(), '.resume-manager', 'github-stars.json')

// 解析 GitHub 仓库 URL（https://github.com/owner/repo、git 后缀、末尾斜杠均可），返回 owner/repo 或 null
export function parseGithubRepoUrl(url) {
  if (!url || typeof url !== 'string') return null
  const s = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  const m = s.match(/github\.com\/([^/?#]+\/[^/?#]+)/i)
  if (!m) return null
  const parts = m[1].split('/')
  if (parts.length !== 2) return null
  if (!/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return null
  return `${parts[0]}/${parts[1]}`
}

// GitHub 风格数字格式化：1100 → 1.1k、1500000 → 1.5m
export function formatStarCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return ''
  if (num >= 1000000) return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}m`
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.floor(num))
}

export function loadStarsCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function saveStarsCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}

function authToken() {
  const s = getSettings()
  return s.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null
}

// 拉取单个仓库 star 数（未配置 token 时匿名访问，受 60 次/小时限制）
export async function fetchGithubStars(ownerRepo) {
  const token = authToken()
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'resume-manager' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${ownerRepo}`, { headers })
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${ownerRepo}`)
  const data = await res.json()
  return typeof data.stargazers_count === 'number' ? data.stargazers_count : null
}

// 刷新一批项目的 star 数并写回缓存（拉取失败保留旧缓存，不抛出）
export async function refreshGithubStars(projects) {
  const cache = loadStarsCache()
  let changed = false
  const seen = new Set()
  for (const p of projects || []) {
    const ownerRepo = parseGithubRepoUrl(p?.url)
    if (!ownerRepo || seen.has(ownerRepo)) continue
    seen.add(ownerRepo)
    try {
      const count = await fetchGithubStars(ownerRepo)
      if (count != null) {
        cache[ownerRepo] = { count, updatedAt: Date.now() }
        changed = true
      }
    } catch {
      // 保留旧缓存，继续下一个
    }
  }
  if (changed) saveStarsCache(cache)
  return cache
}
