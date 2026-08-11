// Git 同步服务：基于 isomorphic-git 的纯 JS 实现，无需本机 git CLI
import fs from 'node:fs'
import path from 'node:path'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { diffLines } from 'diff'

// 代理支持：Node 的 https.request 不读 HTTP(S)_PROXY 环境变量，
// 而 curl / git CLI 会读。当环境存在代理时（如 Clash），必须显式隧道，
// 否则直连可能被重置（ECONNRESET / Request timed out）。
const PROXY_URL =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  null
const AGENT = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined

// isomorphic-git 的 push/fetch 不透传 agent（v1.41 签名无该参数），
// 因此这里包装 http 客户端，把代理 agent 注入每一次请求。
function httpClient() {
  if (!AGENT) return http
  return {
    request: (req) => http.request({ ...req, agent: AGENT }),
  }
}

// 状态码含义：0=不存在 1=一致 2=已修改 3=?
const STATUS_NAME = {
  '0': 'deleted',
  '1': 'unmodified',
  '2': 'added',
  '3': 'modified',
  '5': 'untracked',
}

export function isRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'))
}

export async function initRepo(dir) {
  if (isRepo(dir)) return false
  await git.init({ fs, dir, defaultBranch: 'main' })
  return true
}

export async function getRemoteUrl(dir, remote = 'origin') {
  const remotes = await git.listRemotes({ fs, dir }).catch(() => [])
  return remotes.find((r) => r.remote === remote)?.url || remotes[0]?.url || null
}

export async function currentBranchSafe(dir) {
  return git.currentBranch({ fs, dir }).catch(() => null)
}

export async function listBranches(dir) {
  const [local, remote, current] = await Promise.all([
    git.listBranches({ fs, dir }).catch(() => []),
    git.listBranches({ fs, dir, remote: 'origin' }).catch(() => []),
    currentBranchSafe(dir),
  ])
  return { local, remote, current }
}

export async function createBranch(dir, branch) {
  const local = await git.listBranches({ fs, dir })
  if (local.includes(branch)) return { created: false, branch }
  await git.branch({ fs, dir, ref: branch, checkout: false })
  return { created: true, branch }
}

export async function checkoutBranch(dir, branch) {
  const matrix = await git.statusMatrix({ fs, dir })
  const dirty = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
  if (dirty.length > 0) {
    throw new Error(`工作区有 ${dirty.length} 个未提交改动，请先在「Git 同步看板」提交后再切换类型`)
  }
  await git.checkout({ fs, dir, ref: branch })
  return branch
}

export async function deleteBranch(dir, branch) {
  const current = await currentBranchSafe(dir)
  if (current === branch) throw new Error('不能删除当前正在使用的类型分支，请先切换到其他类型')
  const local = await git.listBranches({ fs, dir })
  if (!local.includes(branch)) return { deleted: false, branch }
  await git.deleteBranch({ fs, dir, ref: branch })
  return { deleted: true, branch }
}

// 读取指定提交（sha）下某文件的文本内容（用于历史版本 YAML 快照）；支持短 sha
export async function readFileAt(dir, sha, filepath) {
  const oid = await git.expandOid({ fs, dir, oid: sha }).catch(() => sha)
  const { blob } = await git.readBlob({ fs, dir, oid, filepath })
  return Buffer.from(blob).toString('utf8')
}

export async function expandOid(dir, sha) {
  return git.expandOid({ fs, dir, oid: sha }).catch(() => sha)
}

function statusBadge(head, workdir, stage) {
  // 未跟踪：head=0, workdir=2, stage=0
  if (head === 0 && workdir === 2 && stage === 0) return 'untracked'
  if (stage === 0 && workdir === 2) return 'deleted' // 暂存区删除
  if (stage === 2) return 'added'
  if (stage === 3) return 'modified'
  if (stage === 0 && head !== 0 && workdir === 0) return 'deleted'
  if (workdir === 2 && stage === 1) return 'modified'
  return 'unmodified'
}

export async function getStatus(dir, settings) {
  if (!isRepo(dir)) return { ok: false, error: '目录不是 git 仓库' }
  const branch = await git.currentBranch({ fs, dir }).catch(() => null)
  const remotes = await git.listRemotes({ fs, dir }).catch(() => [])
  const remoteUrl = remotes[0]?.url || null
  const head = await git.resolveRef({ fs, dir, ref: branch || 'HEAD' }).catch(() => null)
  const matrix = await git.statusMatrix({ fs, dir })
  const files = []
  for (const [filepath, headS, workS, stageS] of matrix) {
    const badge = statusBadge(headS, workS, stageS)
    if (badge !== 'unmodified') files.push({ path: filepath, badge })
  }
  return { ok: true, branch, remoteUrl, head, files, remotes: remotes.map((r) => r.url) }
}

export async function getLog(dir, depth = 20, ref = 'HEAD') {
  const commits = await git.log({ fs, dir, depth, ref })
  return commits.map((c) => ({
    oid: c.oid,
    short: c.oid.slice(0, 7),
    message: c.commit.message.trim().split('\n')[0],
    author: c.commit.author.name,
    email: c.commit.author.email,
    timestamp: c.commit.author.timestamp,
  }))
}

function authCallback(settings) {
  return () => ({
    username: settings.gitUsername || 'x-access-token',
    password: settings.token || '',
  })
}

export async function commitAll(dir, message, settings) {
  const author = {
    name: settings.gitUsername || 'resume-manager',
    email: settings.gitEmail || 'resume-manager@localhost',
  }
  await git.add({ fs, dir, filepath: '.' })
  const oid = await git.commit({ fs, dir, message, author, committer: author })
  return oid
}

// 提交单个文件（用于同步 resume-manager.config.json 等仓库级配置）
export async function commitFile(dir, filepath, message, settings) {
  const author = {
    name: settings.gitUsername || 'resume-manager',
    email: settings.gitEmail || 'resume-manager@localhost',
  }
  await git.add({ fs, dir, filepath })
  const oid = await git.commit({ fs, dir, message, author, committer: author })
  return oid
}

export async function fetchRemote(dir, settings, remote = 'origin') {
  await git.fetch({
    fs,
    http: httpClient(),
    dir,
    remote,
    ref: 'HEAD',
    singleBranch: false,
    onAuth: authCallback(settings),
    onAuthFailure: () => ({ cancel: true }),
  })
  return true
}

export async function pullRemote(dir, settings, remote = 'origin') {
  const branch = (await git.currentBranch({ fs, dir })) || 'main'
  await fetchRemote(dir, settings, remote)
  const res = await git.fastForward({ fs, dir, ref: `${remote}/${branch}` })
  return { ff: res, branch }
}

export async function pushRemote(dir, settings, remote = 'origin') {
  const branch = (await git.currentBranch({ fs, dir })) || 'main'
  const res = await git.push({
    fs,
    http: httpClient(),
    dir,
    remote,
    ref: branch,
    onAuth: authCallback(settings),
    onAuthFailure: () => ({ cancel: true }),
  })
  return res
}

// 领先/落后计数：fetch 后对比本地分支与 origin 分支的提交
export async function aheadBehind(dir, settings, remote = 'origin') {
  const branch = (await git.currentBranch({ fs, dir })) || 'main'
  const remoteRef = `${remote}/${branch}`
  const local = await git.log({ fs, dir, ref: branch }).catch(() => [])
  const remoteLog = await git.log({ fs, dir, ref: remoteRef }).catch(() => [])
  const localOids = new Set(local.map((c) => c.oid))
  const remoteOids = new Set(remoteLog.map((c) => c.oid))
  let ahead = 0
  for (const c of local) if (!remoteOids.has(c.oid)) ahead++
  let behind = 0
  for (const c of remoteLog) if (!localOids.has(c.oid)) behind++
  return { ahead, behind, localCount: local.length, remoteCount: remoteLog.length }
}

// 单文件 diff（工作区 vs HEAD），文本行级
export async function getDiff(dir, filepath) {
  const abs = path.join(dir, filepath)
  if (!fs.existsSync(abs)) return null
  let headText = ''
  try {
    const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    const { blob } = await git.readBlob({ fs, dir, oid: headOid, filepath })
    headText = Buffer.from(blob).toString('utf8')
  } catch {
    headText = ''
  }
  const workText = fs.readFileSync(abs, 'utf8')
  const hunks = diffLines(headText, workText)
  return hunks
    .map((h) => ({
      value: h.value,
      added: h.added || false,
      removed: h.removed || false,
    }))
    .slice(0, 400)
}

export async function projectOverview(dir, settings) {
  if (!dir || !fs.existsSync(dir)) {
    return { configured: false, error: '未配置数据仓路径或目录不存在' }
  }
  if (!isRepo(dir)) {
    return { configured: true, isRepo: false, error: '目录不是 git 仓库（请先 git init）' }
  }
  const status = await getStatus(dir, settings)
  const ab = await aheadBehind(dir, settings).catch(() => ({ ahead: 0, behind: 0 }))
  const log = await getLog(dir, 8).catch(() => [])
  return {
    configured: true,
    isRepo: true,
    branch: status.branch,
    remoteUrl: status.remoteUrl,
    head: status.head,
    dirty: status.files.length,
    ahead: ab.ahead,
    behind: ab.behind,
    recentCommits: log,
  }
}
