// 总览页：数据统计、仓库状态、最近提交、标签云、快捷入口
import React, { useEffect, useState } from 'react'
import {
  Database,
  GitBranch,
  GitCommitHorizontal,
  CloudUpload,
  AlertTriangle,
  CheckCircle2,
  FileText,
  FolderGit2,
} from 'lucide-react'
import { api } from '../api'
import type { ProjectStatus, Variant, Entry } from '../types'
import { Card, Badge, Spinner, EmptyState, relativeTime, tagColor } from '../components/ui'

export default function Dashboard({ go }: { go: (page: string) => void }) {
  const [status, setStatus] = useState<ProjectStatus | null>(null)
  const [entries, setEntries] = useState<Record<string, Entry[]> | null>(null)
  const [tagCount, setTagCount] = useState<Record<string, number>>({})
  const [variants, setVariants] = useState<Variant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<ProjectStatus>('/api/project/status').catch(() => null),
      api
        .get<{ entries: Record<string, Entry[]>; tagCount: Record<string, number> }>('/api/entries')
        .catch(() => null),
      api.get<{ variants: Variant[] }>('/api/variants').catch(() => null),
    ]).then(([s, e, v]) => {
      setStatus(s)
      if (e) {
        setEntries(e.entries)
        setTagCount(e.tagCount)
      }
      if (v) setVariants(v.variants)
      setLoading(false)
    })
  }, [])

  if (loading) return <Spinner label="加载总览…" />

  if (!status?.configured) {
    return (
      <EmptyState
        icon={<FolderGit2 size={40} />}
        title="尚未配置私有数据仓"
        desc="先在「设置」中填写私有数据仓的本地路径（例如 E:\\code\\my-resume-data），或到「模板初始化」一键生成数据仓骨架。"
        action={
          <button
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400"
            onClick={() => go('settings')}
          >
            前往设置
          </button>
        }
      />
    )
  }

  if (!status.isRepo) {
    return (
      <EmptyState
        icon={<FolderGit2 size={40} />}
        title="目录已配置，但还不是 git 仓库"
        desc="在该目录执行 git init 后刷新，或到「Git 同步看板」查看详情。"
      />
    )
  }

  const totalEntries = Object.entries(entries || {})
    .filter(([k]) => k !== 'basics')
    .reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 0), 0)

  const stats = [
    { label: '信息条目', value: totalEntries, icon: <Database size={16} />, to: 'entries' },
    { label: '简历方向', value: variants.length, icon: <GitBranch size={16} />, to: 'variants' },
    {
      label: '未同步修改',
      value: status.dirty ?? 0,
      icon: <AlertTriangle size={16} />,
      to: 'git',
      warn: (status.dirty ?? 0) > 0,
    },
    {
      label: '同步进度',
      value: status.ahead ? `领先 ${status.ahead}` : status.behind ? `落后 ${status.behind}` : '已同步',
      icon: <CloudUpload size={16} />,
      to: 'git',
    },
  ]

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.label}
            onClick={() => go(s.to)}
            className={`rounded-xl border p-4 text-left transition hover:border-indigo-500/50 hover:bg-zinc-900 ${
              s.warn ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/50'
            }`}
          >
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {s.icon}
              {s.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-zinc-100">{s.value}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 仓库状态 */}
        <Card
          title="私有数据仓"
          desc={status.remoteUrl || '未配置远程'}
          actions={
            <Badge tone={status.behind ? 'amber' : status.dirty ? 'amber' : 'emerald'}>
              {status.behind ? '需拉取' : status.ahead ? '待推送' : status.dirty ? '有修改' : '已同步'}
            </Badge>
          }
        >
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">分支</span>
              <span className="font-mono text-zinc-200">{status.branch}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">最新提交</span>
              <span className="font-mono text-zinc-400">{status.head?.slice(0, 7) || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">领先 / 落后</span>
              <span className="font-mono text-zinc-200">
                {status.ahead || 0} / {status.behind || 0}
              </span>
            </div>
            <button
              onClick={() => go('git')}
              className="mt-2 w-full rounded-lg border border-zinc-700 py-1.5 text-xs text-zinc-300 hover:border-indigo-500 hover:text-indigo-300"
            >
              打开 Git 同步看板 →
            </button>
          </div>
        </Card>

        {/* 最近提交 */}
        <Card
          title="最近提交"
          desc="私有数据仓的版本历史"
          actions={<GitCommitHorizontal size={16} className="text-zinc-600" />}
        >
          {status.recentCommits?.length ? (
            <ul className="space-y-2.5">
              {status.recentCommits.slice(0, 6).map((c) => (
                <li key={c.oid} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-200">{c.message}</p>
                    <p className="text-[11px] text-zinc-600">
                      {c.short} · {relativeTime(c.timestamp)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-zinc-600">暂无提交记录</p>
          )}
        </Card>

        {/* 标签云 */}
        <Card title="标签分类" desc="点击标签可在信息管理中筛选">
          {Object.keys(tagCount).length ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(tagCount)
                .sort((a, b) => b[1] - a[1])
                .map(([tag, n]) => (
                  <button
                    key={tag}
                    onClick={() => go('entries')}
                    className={`rounded-full border px-2.5 py-1 text-xs transition hover:opacity-80 ${tagColor(tag)}`}
                  >
                    {tag} · {n}
                  </button>
                ))}
            </div>
          ) : (
            <p className="py-6 text-center text-xs text-zinc-600">暂无标签，去信息管理给条目打上标签吧</p>
          )}
        </Card>
      </div>

      {/* 快捷操作 */}
      <Card title="快捷操作">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: '编辑信息', desc: '管理全部个人信息与标签', icon: <Database size={18} />, to: 'entries' },
            { label: '配置简历方向', desc: '按标签动态组稿多份简历', icon: <GitBranch size={18} />, to: 'variants' },
            { label: '构建并预览 PDF', desc: '生成并在线查看各方向简历', icon: <FileText size={18} />, to: 'pdf' },
            { label: 'Git 同步', desc: '提交、推送、拉取与历史', icon: <CloudUpload size={18} />, to: 'git' },
            { label: '编辑 YAML', desc: '直接查看/修改数据文件', icon: <FileText size={18} />, to: 'yaml' },
            { label: '模板初始化', desc: '为新人生成数据仓骨架', icon: <CheckCircle2 size={18} />, to: 'templates' },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => go(a.to)}
              className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-left transition hover:border-indigo-500/50 hover:bg-zinc-900"
            >
              <span className="text-indigo-400">{a.icon}</span>
              <span>
                <span className="block text-sm font-medium text-zinc-200">{a.label}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{a.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
