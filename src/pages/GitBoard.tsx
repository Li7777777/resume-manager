// Git 同步看板：可视化的仓库状态、提交、推送/拉取、diff 与历史
import React, { useCallback, useEffect, useState } from 'react'
import {
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  GitCommit,
  GitBranch,
  Cloud,
  FilePlus2,
  FileEdit,
  FileMinus2,
  FileQuestion,
  ShieldAlert,
  History,
} from 'lucide-react'
import { api } from '../api'
import type { GitFileStatus, Commit } from '../types'
import { useToast } from '../toast'
import { Card, Button, Badge, Input, Spinner, Modal, EmptyState, relativeTime } from '../components/ui'

interface GitStatus {
  ok: boolean
  branch?: string | null
  remoteUrl?: string | null
  head?: string | null
  files?: GitFileStatus[]
  ahead?: number
  behind?: number
}

const BADGE_MAP: Record<string, { label: string; tone: 'emerald' | 'amber' | 'red' | 'sky' | 'zinc'; icon: React.ReactNode }> = {
  added: { label: '新增', tone: 'emerald', icon: <FilePlus2 size={11} /> },
  modified: { label: '修改', tone: 'amber', icon: <FileEdit size={11} /> },
  deleted: { label: '删除', tone: 'red', icon: <FileMinus2 size={11} /> },
  untracked: { label: '未跟踪', tone: 'sky', icon: <FileQuestion size={11} /> },
}

export default function GitBoard() {
  const toast = useToast()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const [diffHunks, setDiffHunks] = useState<{ value: string; added?: boolean; removed?: boolean }[] | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        api.get<GitStatus>('/api/git/status').catch(() => null),
        api.get<{ commits: Commit[] }>('/api/git/log?limit=30').catch(() => ({ commits: [] })),
      ])
      setStatus(s)
      setCommits(l.commits)
    } catch (e: any) {
      toast('error', e.message)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const run = async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(key)
    try {
      await fn()
      if (successMsg) toast('success', successMsg)
      await load()
    } catch (e: any) {
      toast('error', e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  const commit = async (withPush = false) => {
    if (!message.trim()) return toast('warn', '请填写提交信息')
    const msg = message.trim()
    await run('commit', () => api.post('/api/git/commit', { message: msg }), `已提交：${msg}`)
    if (withPush) await run('push', () => api.post('/api/git/push'), '已推送到远程')
    setMessage('')
  }

  const viewDiff = async (file: string) => {
    setDiffFile(file)
    setDiffHunks(null)
    try {
      const d = await api.get<{ hunks: { value: string; added?: boolean; removed?: boolean }[] | null }>(
        `/api/git/diff?file=${encodeURIComponent(file)}`,
      )
      setDiffHunks(d.hunks)
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  if (!status) return <Spinner label="加载 Git 状态…" />

  const synced = (status.ahead || 0) === 0 && (status.behind || 0) === 0 && !status.files?.length
  const dirty = status.files?.length || 0

  return (
    <div className="space-y-5">
      {/* 同步状态卡 */}
      <Card
        title="同步状态"
        desc="私有数据仓与 GitHub 远程的差异一目了然"
        actions={
          <div className="flex gap-2">
            <Button size="sm" loading={busy === 'refresh'} onClick={() => run('refresh', load)}>
              <RefreshCw size={13} /> 刷新
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'pull'}
              disabled={!status.remoteUrl}
              onClick={() => run('pull', () => api.post('/api/git/pull'), '已拉取远程更新')}
            >
              <DownloadCloud size={13} /> 拉取
            </Button>
            <Button
              size="sm"
              variant="success"
              loading={busy === 'push'}
              disabled={!status.remoteUrl || (status.ahead || 0) === 0}
              onClick={() => run('push', () => api.post('/api/git/push'), '已推送到远程')}
            >
              <UploadCloud size={13} /> 推送
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-zinc-950/50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500"><GitBranch size={12} /> 分支</div>
            <p className="mt-1 font-mono text-sm text-zinc-200">{status.branch || '—'}</p>
          </div>
          <div className="rounded-lg bg-zinc-950/50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Cloud size={12} /> 远程</div>
            <p className="mt-1 truncate font-mono text-xs text-zinc-400" title={status.remoteUrl || ''}>
              {status.remoteUrl ? status.remoteUrl.replace('https://', '') : '未配置'}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-950/50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500"><GitCommit size={12} /> 领先 / 落后</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={(status.ahead || 0) > 0 ? 'amber' : 'zinc'}>领先 {status.ahead || 0}</Badge>
              <Badge tone={(status.behind || 0) > 0 ? 'red' : 'zinc'}>落后 {status.behind || 0}</Badge>
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500"><FileEdit size={12} /> 未同步修改</div>
            <p className={`mt-1 text-sm font-semibold ${dirty ? 'text-amber-300' : 'text-emerald-300'}`}>
              {dirty} 个文件
            </p>
          </div>
        </div>
        {synced && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 本地与远程完全同步
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* 提交区 */}
        <Card title="提交到私有仓" desc="先把修改提交到本地，再推送到 GitHub" className="lg:col-span-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="提交信息，例如：update resume data"
            className="min-h-[80px] w-full resize-none rounded-lg border border-zinc-700/70 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" loading={busy === 'commit'} disabled={!message.trim()} onClick={() => commit(false)}>
              <GitCommit size={14} /> 提交
            </Button>
            <Button loading={busy === 'push'} disabled={!message.trim()} onClick={() => commit(true)}>
              <UploadCloud size={14} /> 提交并推送
            </Button>
          </div>
          {dirty > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-600">变更文件（{dirty}）</p>
              <div className="max-h-52 space-y-1 overflow-auto">
                {(status.files || []).map((f) => {
                  const b = BADGE_MAP[f.badge] || BADGE_MAP.untracked
                  return (
                    <div key={f.path} className="flex items-center gap-2 rounded-md bg-zinc-950/50 px-2 py-1.5">
                      <Badge tone={b.tone}>{b.icon}{b.label}</Badge>
                      <button
                        className="min-w-0 flex-1 truncate text-left font-mono text-xs text-zinc-300 hover:text-indigo-300"
                        onClick={() => viewDiff(f.path)}
                        title="查看 diff"
                      >
                        {f.path}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>

        {/* 历史时间线 */}
        <Card title="提交历史" desc="私有数据仓最近提交" className="lg:col-span-3" pad={false}>
          {commits.length === 0 ? (
            <div className="p-6"><EmptyState title="暂无提交" /></div>
          ) : (
            <ol className="max-h-[420px] overflow-auto p-3">
              {commits.map((c, i) => (
                <li key={c.oid} className="relative flex gap-3 pb-4 pl-1">
                  {i < commits.length - 1 && <span className="absolute left-[13px] top-6 h-full w-px bg-zinc-800" />}
                  <span className="relative mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                    <GitCommit size={12} className="text-indigo-400" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-200">{c.message}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      <span className="font-mono text-indigo-400/80">{c.short}</span> · {c.author} · {relativeTime(c.timestamp)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* 同步提醒 */}
      {(status.behind || 0) > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">远程有 {status.behind} 个新提交</p>
            <p className="mt-0.5 text-xs text-red-300/70">先点「拉取」合并远程更新，再提交本地修改，避免推送被拒绝。</p>
          </div>
        </div>
      )}

      {/* diff 弹窗 */}
      <Modal open={!!diffFile} title={`变更内容：${diffFile || ''}`} onClose={() => setDiffFile(null)} wide>
        {diffHunks === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-zinc-500"><History size={14} className="animate-spin" /> 计算中…</div>
        ) : diffHunks.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">无文本差异（可能是二进制或新文件）</p>
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed">
            {diffHunks.map((h, i) => (
              <div
                key={i}
                className={
                  h.added ? 'bg-emerald-500/10 text-emerald-300' : h.removed ? 'bg-red-500/10 text-red-300' : 'text-zinc-500'
                }
              >
                {h.value}
              </div>
            ))}
          </pre>
        )}
      </Modal>
    </div>
  )
}