// GitHub 凭据自动检测：先尝试从系统环境获取（环境变量 / gh CLI），
// 获取不到时由前端引导用户创建 Token（设置页内置教程与链接）。
import { spawnSync } from 'node:child_process'
import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'

const PROXY_URL =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  null
const AGENT = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined

export function maskToken(token) {
  if (!token) return ''
  if (token.length <= 8) return '••••••'
  return `${token.slice(0, 4)}••••${token.slice(-4)}`
}

// 来源 1：环境变量
function tryEnv() {
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const t = process.env[key]
    if (t && t.trim()) {
      return { source: `env:${key}`, token: t.trim(), username: null }
    }
  }
  return null
}

// 来源 2：gh CLI（已登录时 gh auth token 可取到）
function tryGh() {
  try {
    const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      let username = null
      try {
        const u = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', timeout: 15000, windowsHide: true })
        if (u.status === 0 && u.stdout) username = u.stdout.trim() || null
      } catch {
        /* ignore */
      }
      return { source: 'gh', token: r.stdout.trim(), username }
    }
  } catch {
    /* gh 未安装或不可用 */
  }
  return null
}

// 用 token 反查 GitHub 用户名（best-effort，走代理支持）
function resolveUsername(token) {
  return new Promise((resolve) => {
    try {
      const req = https.request(
        'https://api.github.com/user',
        {
          method: 'GET',
          agent: AGENT,
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'resume-manager',
            Accept: 'application/vnd.github+json',
          },
        },
        (res) => {
          let data = ''
          res.on('data', (d) => (data += d))
          res.on('end', () => {
            try {
              resolve(JSON.parse(data).login || null)
            } catch {
              resolve(null)
            }
          })
        },
      )
      req.setTimeout(15000, () => {
        req.destroy()
        resolve(null)
      })
      req.on('error', () => resolve(null))
      req.end()
    } catch {
      resolve(null)
    }
  })
}

export async function detectGithubAuth() {
  const sources = []
  const env = tryEnv()
  if (env) sources.push(env)
  const gh = tryGh()
  if (gh) sources.push(gh)
  // 首个来源缺用户名时反查（best-effort，不影响主流程）
  const first = sources[0]
  if (first && !first.username) {
    first.username = await resolveUsername(first.token)
  }
  return sources
}
