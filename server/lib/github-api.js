// GitHub REST API 封装：JSON 请求与二进制下载（artifact zip），支持代理与重定向跟随。
// 用途：从 GitHub Actions 拉取 CI 构建产出的 PDF（github 编译方式预览）。
import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'

const PROXY_URL =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  null
const AGENT = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined
const API_BASE = 'https://api.github.com'
const USER_AGENT = 'resume-manager'

function request(url, { method = 'GET', headers = {}, accept } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent: AGENT,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept || 'application/vnd.github+json',
          ...headers,
        },
      },
      (res) => {
        // 跟随重定向（artifact zip 会 302 到对象存储）。
        // 注意：重定向 URL 已含 SAS 签名，必须去掉 Authorization 等自定义头，
        // 否则 Azure/对象存储会以 401 拒绝（curl -L 跨主机默认也会丢弃这些头）。
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          resolve(request(res.headers.location, { method: 'GET' }))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          resolve({ status: res.statusCode, body: buf })
        })
      },
    )
    req.setTimeout(60000, () => {
      req.destroy()
      reject(new Error('GitHub API 请求超时'))
    })
    req.on('error', (e) => reject(new Error(`GitHub API 请求失败：${e.message}`)))
    req.end()
  })
}

/** 从远程 URL 解析 owner/repo */
export function parseRemoteUrl(remoteUrl) {
  if (!remoteUrl) return null
  const m = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

/** GET JSON：/repos/.../actions/runs?status=success */
export async function ghApi(path, token, { method = 'GET', body } = {}) {
  const r = await request(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (r.status >= 400) {
    let msg = `GitHub API ${r.status}`
    try {
      msg = JSON.parse(r.body.toString('utf8')).message || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (r.body.length === 0) return {}
  return JSON.parse(r.body.toString('utf8'))
}

/** 下载二进制（artifact zip），返回 Buffer */
export async function ghDownload(path, token) {
  const r = await request(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (r.status >= 400) {
    throw new Error(`下载 GitHub 产物失败：HTTP ${r.status}`)
  }
  return r.body
}
