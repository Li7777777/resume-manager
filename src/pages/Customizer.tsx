// 简历定制页：左侧信息库拖拽到布局画布，右侧实时渲染 HTML 简历
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
  Layers,
  FileCode2,
  Loader2,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react'
import { api } from '../api'
import type { Entry } from '../types'
import { useToast } from '../toast'
import { Card, Button, Input, Badge, TagChip, Spinner, EmptyState } from '../components/ui'

const DEFAULT_CATS: { key: string; label: string }[] = [
  { key: 'basics', label: '基础信息' },
  { key: 'work', label: '工作经历' },
  { key: 'education', label: '教育背景' },
  { key: 'projects', label: '项目经历' },
  { key: 'skills', label: '专业技能' },
  { key: 'certificates', label: '证书资质' },
  { key: 'interests', label: '兴趣爱好' },
]

interface Section {
  key: string
  mode: 'all' | 'ids' | 'tags'
  ids?: string[]
  tags?: string[]
}

function entryTitle(cat: string, e: Entry) {
  if (cat === 'work') return (e.company as string) || (e.name as string) || '未命名'
  return (e.name as string) || '未命名'
}

const DND_MIME = 'application/x-rm-item'

export default function Customizer() {
  const toast = useToast()
  const [entries, setEntries] = useState<Record<string, Entry[]>>({})
  const [cat, setCat] = useState('work')
  const [cats, setCats] = useState<{ key: string; label: string }[]>(DEFAULT_CATS)
  const [sections, setSections] = useState<Section[]>([])
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 初始：加载信息全集 + 还原 custom 方向布局（若存在）
  useEffect(() => {
    Promise.all([
      api.get<{ entries: Record<string, Entry[]> }>('/api/entries').catch(() => ({ entries: {} })),
      api.get<{ variants: any[] }>('/api/variants').catch(() => ({ variants: [] })),
      api.get<{ categories: { key: string; label: string; visible: boolean }[] }>('/api/categories').catch(() => ({ categories: [] })),
    ]).then(([e, v, c]) => {
      setEntries(e.entries)
      if (c.categories?.length) setCats(c.categories.filter((x) => x.visible !== false).map((x) => ({ key: x.key, label: x.label })))
      const custom = v.variants.find((x) => x.name === 'custom')
      if (custom?.blocks) {
        const secs: Section[] = (custom.sectionOrder || Object.keys(custom.blocks))
          .map((key: string) => {
            const b = custom.blocks[key]
            if (!b) return null
            if (b.include === 'all') return { key, mode: 'all' as const }
            if (Array.isArray(b.ids)) return { key, mode: 'ids' as const, ids: [...b.ids] }
            if (Array.isArray(b.tags)) return { key, mode: 'tags' as const, tags: [...b.tags] }
            return null
          })
          .filter(Boolean) as Section[]
        setSections(secs)
        const hd = (custom.overrides?.basics?.headline as string) || ''
        const sm = Array.isArray(custom.overrides?.basics?.summary)
          ? (custom.overrides.basics.summary as string[]).join('\n')
          : ((custom.overrides?.basics?.summary as string) || '')
        setHeadline(hd)
        setSummary(sm)
        // 恢复已有定制布局后自动渲染一次（用恢复值，避免闭包旧 state）
        setTimeout(() => scheduleRender(secs, hd, sm), 300)
      }
    })
  }, [])

  // 防抖实时渲染
  const scheduleRender = useCallback(
    (secs: Section[], hd: string, sm: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        if (secs.length === 0) return
        setRendering(true)
        try {
          const r = await api.post<{ htmlUrl: string | null; error?: string }>('/api/custom/layout', {
            sections: secs,
            template: 'calm',
            overrides: {
              basics: {
                ...(hd ? { headline: hd } : {}),
                ...(sm ? { summary: sm.split('\n').filter(Boolean) } : {}),
              },
            },
          })
          if (r.htmlUrl) setHtmlUrl(`${r.htmlUrl}?t=${Date.now()}`)
          else toast('error', r.error || '渲染失败')
        } catch (e: any) {
          toast('error', e.message)
        } finally {
          setRendering(false)
        }
      }, 700)
    },
    [toast],
  )

  const commit = useCallback(
    (secs: Section[]) => {
      setSections(secs)
      scheduleRender(secs, headline, summary)
    },
    [headline, summary, scheduleRender],
  )

  // 拖拽数据
  const onDragStart = (data: { type: 'entry' | 'section'; key: string; id?: string; name?: string }) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(data))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const parseDrop = (e: React.DragEvent) => {
    try {
      return JSON.parse(e.dataTransfer.getData(DND_MIME))
    } catch {
      return null
    }
  }

  // 区块 drop：条目 → ids 模式追加；章节 → all 模式
  const onSectionDrop = (e: React.DragEvent, sec: Section) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(null)
    const data = parseDrop(e)
    if (!data) return
    if (data.type === 'entry' && data.key === sec.key) {
      const ids = [...new Set([...(sec.ids || []), data.id])]
      commit(sections.map((s) => (s === sec ? { ...s, mode: 'ids', ids } : s)))
    } else if (data.type === 'section' && data.key === sec.key) {
      commit(sections.map((s) => (s === sec ? { ...s, mode: 'all', ids: undefined, tags: undefined } : s)))
    }
  }

  // 画布空白 drop：条目 → 新建 ids 区块；章节 → 新建 all 区块
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    const data = parseDrop(e)
    if (!data) return
    const exists = sections.some((s) => s.key === data.key)
    if (exists) return toast('warn', `${cats.find((c) => c.key === data.key)?.label} 已在布局中，直接拖入该区块`)
    if (data.type === 'entry') {
      commit([...sections, { key: data.key, mode: 'ids', ids: [data.id] }])
    } else {
      commit([...sections, { key: data.key, mode: 'all' }])
    }
  }

  const removeEntry = (sec: Section, id: string) => {
    commit(sections.map((s) => (s === sec ? { ...s, ids: (s.ids || []).filter((x) => x !== id) } : s)))
  }

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= sections.length) return
    const next = [...sections]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    commit(next)
  }

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const list of Object.values(entries)) {
      if (!Array.isArray(list)) continue
      for (const e of list) for (const t of e.tags || []) set.add(t as string)
    }
    return [...set]
  }, [entries])

  // 兼容 basics（对象）与非数组分类：统一返回数组
  const listOf = (key: string): Entry[] => (Array.isArray(entries[key]) ? (entries[key] as Entry[]) : [])

  const entryTitleOf = (key: string, e: Entry) => entryTitle(key, e)
  const sectionLabel = (key: string) => cats.find((c) => c.key === key)?.label || key

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 130px)' }}>
      {/* 左：信息库（可拖拽） */}
      <Card title="简历信息库" desc="拖拽条目或整个章节到中间布局" className="w-72 shrink-0" pad={false} fill>
        <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
          {cats.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`rounded-md px-2 py-1 text-[11px] transition ${
                cat === c.key ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {c.label}
              <span className="ml-1 text-zinc-600">{(entries[c.key] || []).length}</span>
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {/* 整章节拖拽 */}
          <div
            draggable
            onDragStart={onDragStart({ type: 'section', key: cat })}
            className="mb-2 flex cursor-grab items-center gap-2 rounded-lg border border-dashed border-indigo-500/40 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300 active:cursor-grabbing"
            title="拖到右侧布局，加入整个章节"
          >
            <Layers size={13} />
            拖入整个「{sectionLabel(cat)}」章节
          </div>
          {cat === 'basics' ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
              基础信息（姓名/联系方式等）作为区块拖入布局即可展示。
            </div>
          ) : listOf(cat).length === 0 ? (
            <EmptyState title="暂无条目" />
          ) : (
            listOf(cat).map((e) => {
              const inLayout = sections.some((s) => s.key === cat && (s.mode === 'all' || (s.mode === 'ids' && s.ids?.includes(e.id!))))
              return (
                <div
                  key={e.id}
                  draggable
                  onDragStart={onDragStart({ type: 'entry', key: cat, id: e.id, name: entryTitleOf(cat, e) })}
                  className={`mb-1.5 cursor-grab rounded-lg border px-3 py-2 transition active:cursor-grabbing ${
                    inLayout ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950/50 hover:border-indigo-500/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <GripVertical size={12} className="shrink-0 text-zinc-600" />
                    <span className="truncate text-xs font-medium text-zinc-200">{entryTitleOf(cat, e)}</span>
                    {inLayout && <CheckCircle2 size={12} className="ml-auto shrink-0 text-emerald-400" />}
                  </div>
                  {(e.tags || []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-5">
                      {(e.tags as string[]).slice(0, 4).map((t) => <TagChip key={t} tag={t} />)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </Card>

      {/* 中：布局画布 */}
      <Card
        title="简历布局"
        desc="区块按从上到下顺序展示；拖入条目/章节，支持排序与删除"
        className="min-w-0 flex-1"
        pad={false}
        fill
        actions={
          <Button size="sm" variant="ghost" onClick={() => commit([])}>
            <Trash2 size={12} /> 清空
          </Button>
        }
      >
        <div className="border-b border-zinc-800 p-3">
          <div className="mb-2 text-[11px] font-medium text-zinc-500">定制头衔（可选覆盖）</div>
          <Input
            value={headline}
            onChange={(e) => {
              setHeadline(e.target.value)
              scheduleRender(sections, e.target.value, summary)
            }}
            placeholder="例如：高级前端工程师（React / TypeScript）"
            className="text-xs"
          />
        </div>
        <div
          className={`min-h-0 flex-1 overflow-auto p-3 ${dragOver === 'canvas' ? 'ring-2 ring-inset ring-indigo-500/40' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver('canvas')
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={onCanvasDrop}
        >
          {sections.length === 0 ? (
            <EmptyState
              icon={<Layers size={30} />}
              title="布局为空"
              desc="从左侧拖拽信息条目或整个章节到这里，右侧将实时渲染 HTML 简历。"
            />
          ) : (
            <div className="space-y-2">
              {sections.map((sec, idx) => (
                <div
                  key={sec.key}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(sec.key)
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => onSectionDrop(e, sec)}
                  className={`rounded-lg border p-2.5 transition ${
                    dragOver === sec.key ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-950/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <GripVertical size={13} className="text-zinc-600" />
                    <span className="text-xs font-semibold text-zinc-200">{sectionLabel(sec.key)}</span>
                    <Badge tone={sec.mode === 'all' ? 'emerald' : sec.mode === 'ids' ? 'sky' : 'indigo'}>
                      {sec.mode === 'all' ? '全部' : sec.mode === 'ids' ? `${(sec.ids || []).length} 条` : `${(sec.tags || []).length} 标签`}
                    </Badge>
                    <div className="ml-auto flex gap-0.5">
                      <button className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(idx, -1)}><ArrowUp size={12} /></button>
                      <button className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(idx, 1)}><ArrowDown size={12} /></button>
                      <button
                        className="rounded p-1 text-zinc-600 hover:bg-red-500/20 hover:text-red-400"
                        onClick={() => commit(sections.filter((s) => s !== sec))}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
                    {sec.mode === 'all' ? (
                      <span className="text-[11px] text-zinc-500">展示该章节全部条目（把左侧条目拖到这里可按需切换为指定条目）</span>
                    ) : sec.mode === 'ids' ? (
                      (sec.ids || []).map((id) => {
                        const e = listOf(sec.key).find((x) => x.id === id)
                        return (
                          <span key={id} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                            {e ? entryTitleOf(sec.key, e) : id}
                            <button className="text-zinc-600 hover:text-red-400" onClick={() => removeEntry(sec, id)}><Trash2 size={10} /></button>
                          </span>
                        )
                      })
                    ) : (
                      (sec.tags || []).map((t) => <TagChip key={t} tag={t} />)
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 右：实时 HTML 渲染 */}
      <Card
        title="实时渲染"
        desc="Calm 模板 · HTML 引擎（每次拖拽自动重渲染）"
        className="w-[46%] shrink-0"
        pad={false}
        fill
        actions={
          <div className="flex items-center gap-2 text-[11px]">
            {rendering && (
              <span className="inline-flex items-center gap-1 text-indigo-400">
                <Loader2 size={12} className="animate-spin" /> 渲染中…
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => sections.length && scheduleRender(sections, headline, summary)}>
              <RefreshCw size={12} />
            </Button>
          </div>
        }
      >
        <div className="min-h-0 flex-1">
          {htmlUrl ? (
            <iframe key={htmlUrl} src={htmlUrl} className="h-full w-full bg-white" title="定制简历实时预览" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<FileCode2 size={30} />}
                title="HTML 简历将在这里实时渲染"
                desc="把信息拖入布局后自动生成并展示。"
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
