// 简历类型页：每个类型对应一个 resume/* Git 分支
import React, { useEffect, useState } from 'react'
import { GitBranch, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, CircleDotDashed } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner } from '../components/ui'

interface ResumeType {
  name: string
  label: string
  branch: string
  configured: boolean
  current: boolean
  local: boolean
  remote: boolean
}

export default function Variants() {
  const toast = useToast()
  const [types, setTypes] = useState<ResumeType[] | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ResumeType | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    try {
      const data = await api.get<{ types: ResumeType[]; currentBranch: string | null }>('/api/resume-types')
      setTypes(data.types)
      setCurrentBranch(data.currentBranch)
    } catch (err: any) {
      toast('error', err.message)
      setTypes([])
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ensureBranch = async (type: ResumeType) => {
    setBusy(type.name)
    try {
      const result = await api.post<{ branch: string; created: boolean }>(
        `/api/resume-types/${encodeURIComponent(type.name)}/ensure-branch`,
        {},
      )
      toast('success', result.created ? `已创建分支 ${result.branch}` : `分支 ${result.branch} 已存在`)
      await load()
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  const checkout = async (type: ResumeType) => {
    setBusy(type.name)
    try {
      await api.post(`/api/resume-types/${encodeURIComponent(type.name)}/checkout`, {})
      toast('success', `已切换到「${type.label}」`)
      await load()
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (type: ResumeType) => {
    if (!confirm(`确定删除简历类型「${type.label}」和本地分支 ${type.branch} 吗？\n远程分支不会自动删除。`)) return
    setBusy(type.name)
    try {
      await api.del(`/api/resume-types/${encodeURIComponent(type.name)}`)
      toast('success', `已删除简历类型「${type.label}」`)
      await load()
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  if (types === null) return <Spinner label="加载简历类型…" />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-300">一个简历类型对应一个独立 Git 分支。</p>
          <p className="mt-1 text-xs text-zinc-600">
            当前工作分支：<code className="text-indigo-300">{currentBranch || '—'}</code>。内容、模板与布局统一在「简历定制」中设置。
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={load} title="刷新类型状态">
            <RefreshCw size={14} />
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> 新增类型
          </Button>
        </div>
      </div>

      {types.length === 0 ? (
        <EmptyState
          icon={<GitBranch size={30} />}
          title="还没有简历类型"
          desc="新增类型后会创建并切换到对应的 resume/* 分支。"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => (
            <Card
              key={type.branch}
              title={type.label}
              desc={type.name}
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(type)} title="修改类型名称">
                    <Pencil size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300"
                    disabled={type.current || busy === type.name}
                    onClick={() => remove(type)}
                    title={type.current ? '当前类型不能删除' : '删除类型'}
                  >
                    <Trash2 size={13} />
                  </Button>
                </>
              }
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <GitBranch size={14} className={type.current ? 'text-emerald-400' : 'text-zinc-500'} />
                  <code className="min-w-0 flex-1 truncate text-xs text-zinc-300">{type.branch}</code>
                  {type.current ? <Badge tone="emerald">当前</Badge> : <Badge tone="zinc">未切换</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={type.configured ? 'sky' : 'zinc'}>{type.configured ? '配置已载入' : '分支类型'}</Badge>
                  <Badge tone={type.local ? 'indigo' : 'zinc'}>本地 {type.local ? '有' : '无'}</Badge>
                  <Badge tone={type.remote ? 'emerald' : 'zinc'}>远程 {type.remote ? '有' : '无'}</Badge>
                </div>
                <div className="flex justify-end gap-2">
                  {!type.local ? (
                    <Button size="sm" variant="secondary" loading={busy === type.name} onClick={() => ensureBranch(type)}>
                      <CircleDotDashed size={13} /> 创建分支
                    </Button>
                  ) : type.current ? (
                    <Button size="sm" disabled>
                      <CheckCircle2 size={13} /> 正在使用
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" loading={busy === type.name} onClick={() => checkout(type)}>
                      <GitBranch size={13} /> 切换到此类型
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <TypeModal
          title="新增简历类型"
          onClose={() => setCreating(false)}
          onSave={async ({ name, label, branch }) => {
            setBusy(name)
            try {
              await api.post('/api/resume-types', { name, label, branch })
              toast('success', `已创建并切换到「${label}」`)
              setCreating(false)
              await load()
            } catch (err: any) {
              toast('error', err.message)
            } finally {
              setBusy(null)
            }
          }}
        />
      )}

      {editing && (
        <RenameModal
          type={editing}
          onClose={() => setEditing(null)}
          onSave={async (label) => {
            try {
              await api.put(`/api/resume-types/${encodeURIComponent(editing.name)}`, { label })
              toast('success', '类型名称已更新')
              setEditing(null)
              await load()
            } catch (err: any) {
              toast('error', err.message)
            }
          }}
        />
      )}
    </div>
  )
}

function TypeModal({
  title,
  onClose,
  onSave,
}: {
  title: string
  onClose: () => void
  onSave: (value: { name: string; label: string; branch: string }) => void
}) {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const branch = `resume/${name || 'type'}`

  return (
    <Modal open title={title} onClose={onClose}>
      <div className="space-y-4">
        <Field label="类型名称" hint="例如：前端工程师、技术管理">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <Field label="类型标识" hint="用于文件名与分支名，仅限小写字母、数字、下划线和连字符">
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} className="font-mono" />
        </Field>
        <Field label="Git 分支">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-indigo-300">{branch}</div>
        </Field>
        <p className="text-xs leading-relaxed text-zinc-600">创建类型需要工作区无未提交改动；创建后系统会直接切换到新分支。</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!name || !label.trim()} onClick={() => onSave({ name, label: label.trim(), branch })}>
            <GitBranch size={14} /> 创建并切换
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RenameModal({ type, onClose, onSave }: { type: ResumeType; onClose: () => void; onSave: (label: string) => void }) {
  const [label, setLabel] = useState(type.label)
  return (
    <Modal open title="修改类型名称" onClose={onClose}>
      <div className="space-y-4">
        <Field label="类型名称">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <p className="text-xs text-zinc-600">类型标识和分支名保持不变：<code>{type.branch}</code></p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!label.trim()} onClick={() => onSave(label.trim())}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
