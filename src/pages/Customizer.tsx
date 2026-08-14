// 简历定制：按当前简历类型组织内容、选择模板，并在本页构建预览
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  FileCode2,
  CheckCircle2,
  CheckSquare2,
  Square,
  X,
  LayoutTemplate,
  ExternalLink,
  GitBranch,
  Eye,
  PackageCheck,
  Tag,
} from 'lucide-react'
import { api } from '../api'
import type { Entry, Variant } from '../types'
import { useToast } from '../toast'
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, TagChip, Textarea } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import YamlWorkspace from '../components/YamlWorkspace'

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

interface ResumeType {
  name: string
  label: string
  branch: string
  configured: boolean
  current: boolean
  local: boolean
  remote: boolean
}

interface TemplateItem {
  id: string
  engine: 'latex' | 'html'
  name: string
  desc: string
}

interface CustomizerDraft {
  template: string
  sections: Section[]
  headline: string
  summary: string
  updatedAt?: number
}

interface CustomizerMemory {
  selectedType?: string
  workspaceMode?: 'visual' | 'yaml'
  category?: string
  drafts?: Record<string, CustomizerDraft>
}

function entryTitle(cat: string, entry: Entry) {
  if (cat === 'work') return (entry.company as string) || (entry.name as string) || '未命名'
  if (cat === 'education') return (entry.institution as string) || (entry.name as string) || '未命名'
  if (cat === 'projects') return (entry.name as string) || (entry.subtitle as string) || '未命名'
  return (entry.name as string) || '未命名'
}

function sectionsFromVariant(variant?: Variant): Section[] {
  if (!variant?.blocks) return []
  return (variant.sectionOrder || Object.keys(variant.blocks))
    .map((key) => {
      const block = variant.blocks?.[key]
      if (!block) return null
      if (block.include === 'all' || block.include === 'true' || block.include === true) return { key, mode: 'all' as const }
      if (Array.isArray(block.ids)) return { key, mode: 'ids' as const, ids: [...block.ids] }
      if (Array.isArray(block.tags)) return { key, mode: 'tags' as const, tags: [...block.tags] }
      return null
    })
    .filter(Boolean) as Section[]
}

interface DragData {
  type: 'entry' | 'entries' | 'section'
  key: string
  id?: string
  ids?: string[]
}

const DND_MIME = 'application/x-rm-item'
const DND_REORDER_MIME = 'application/x-rm-section-reorder'

export default function Customizer() {
  const toast = useToast()
  const [entries, setEntries] = useState<Record<string, Entry[]>>({})
  const [cats, setCats] = useState<{ key: string; label: string }[]>(DEFAULT_CATS)
  const [cat, setCat] = useState('work')
  const [tagFilter, setTagFilter] = useState('')
  const [variants, setVariants] = useState<Variant[]>([])
  const [variantDefaults, setVariantDefaults] = useState<{ layout?: { engine?: string; template?: string } }>({})
  const [types, setTypes] = useState<ResumeType[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [template, setTemplate] = useState('moderncv-banking')
  const [sections, setSections] = useState<Section[]>([])
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewEngine, setPreviewEngine] = useState<'latex' | 'html'>('latex')
  const [busyAction, setBusyAction] = useState<'preview' | 'release' | null>(null)
  const [lastAction, setLastAction] = useState<'preview' | 'release' | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [dragSectionKey, setDragSectionKey] = useState<string | null>(null)
  const [reorderOverKey, setReorderOverKey] = useState<string | null>(null)
  const [reorderSide, setReorderSide] = useState<'before' | 'after'>('before')
  const [workspaceMode, setWorkspaceMode] = useState<'visual' | 'yaml'>('visual')
  const [yamlDirty, setYamlDirty] = useState(false)
  const [yamlRevision, setYamlRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [draftReady, setDraftReady] = useState(false)
  const [draftSaveState, setDraftSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const draftsRef = useRef<Record<string, CustomizerDraft>>({})
  const persistPayloadRef = useRef<CustomizerMemory | null>(null)
  const rendering = busyAction !== null

  useEffect(() => {
    Promise.all([
      api.get<{ entries: Record<string, Entry[]> }>('/api/entries').catch(() => ({ entries: {} })),
      api.get<{ variants: Variant[]; defaults?: { layout?: { engine?: string; template?: string } } }>('/api/variants').catch(() => ({ variants: [], defaults: undefined })),
      api.get<{ types: ResumeType[] }>('/api/resume-types').catch(() => ({ types: [] })),
      api.get<{ templates: TemplateItem[] }>('/api/templates').catch(() => ({ templates: [] })),
      api.get<{ categories: { key: string; label: string; visible: boolean }[] }>('/api/categories').catch(() => ({ categories: [] })),
      api.get<{ state: CustomizerMemory }>('/api/custom/state').catch(() => ({ state: {} as CustomizerMemory })),
    ])
      .then(([entryData, variantData, typeData, templateData, categoryData, customizerData]) => {
        setEntries(entryData.entries)
        setVariants(variantData.variants)
        setVariantDefaults(variantData.defaults || {})
        setTypes(typeData.types)
        setTemplates(templateData.templates)
        const visibleCats = categoryData.categories?.length
          ? categoryData.categories.filter((item) => item.visible !== false).map((item) => ({ key: item.key, label: item.label }))
          : DEFAULT_CATS
        setCats(visibleCats)

        const memory = customizerData.state || {}
        draftsRef.current = memory.drafts || {}
        if (memory.workspaceMode === 'yaml' || memory.workspaceMode === 'visual') setWorkspaceMode(memory.workspaceMode)
        if (memory.category && visibleCats.some((item) => item.key === memory.category)) setCat(memory.category)

        const initial = typeData.types.find((item) => item.name === memory.selectedType)
          || typeData.types.find((item) => item.current)
          || typeData.types[0]
        if (initial) {
          setSelectedType(initial.name)
          applyRememberedVariant(initial.name, draftsRef.current, variantData.variants, variantData.defaults)
        }
        setDraftReady(true)
      })
      .catch((err) => toast('error', err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyVariant = (
    name: string,
    source = variants,
    defaults = variantDefaults,
  ) => {
    const variant = source.find((item) => item.name === name)
    setSections(sectionsFromVariant(variant))
    setHeadline(variant?.overrides?.basics?.headline || '')
    setSummary(
      Array.isArray(variant?.overrides?.basics?.summary)
        ? variant!.overrides!.basics!.summary!.join('\n')
        : '',
    )
    setTemplate(variant?.layout?.template || defaults.layout?.template || 'moderncv-banking')
    setPreviewUrl(null)
    setLastAction(null)
  }

  const cloneSections = (value: Section[]) => value.map((section) => ({
    ...section,
    ...(section.ids ? { ids: [...section.ids] } : {}),
    ...(section.tags ? { tags: [...section.tags] } : {}),
  }))

  const applyRememberedVariant = (
    name: string,
    draftSource = draftsRef.current,
    source = variants,
    defaults = variantDefaults,
  ) => {
    const draft = draftSource[name]
    if (!draft) {
      applyVariant(name, source, defaults)
      return
    }
    setSections(cloneSections(draft.sections || []))
    setHeadline(draft.headline || '')
    setSummary(draft.summary || '')
    setTemplate(draft.template || source.find((item) => item.name === name)?.layout?.template || defaults.layout?.template || 'moderncv-banking')
    setPreviewUrl(null)
    setLastAction(null)
  }

  const captureCurrentDraft = () => {
    if (!selectedType) return
    draftsRef.current = {
      ...draftsRef.current,
      [selectedType]: {
        template,
        sections: cloneSections(sections),
        headline,
        summary,
        updatedAt: Date.now(),
      },
    }
  }

  // 可视化草稿按数据仓、简历类型自动保存到本机侧车；离开页面或刷新时再强制刷新一次。
  useEffect(() => {
    if (!draftReady || !selectedType) return
    const draft: CustomizerDraft = {
      template,
      sections: cloneSections(sections),
      headline,
      summary,
      updatedAt: Date.now(),
    }
    const drafts = { ...draftsRef.current, [selectedType]: draft }
    draftsRef.current = drafts
    const payload: CustomizerMemory = { selectedType, workspaceMode, category: cat, drafts }
    persistPayloadRef.current = payload
    setDraftSaveState('saving')
    const timer = window.setTimeout(() => {
      api.put<{ state: CustomizerMemory }>('/api/custom/state', payload)
        .then(() => {
          if (persistPayloadRef.current === payload) setDraftSaveState('saved')
        })
        .catch(() => {
          if (persistPayloadRef.current === payload) setDraftSaveState('error')
        })
    }, 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, selectedType, workspaceMode, cat, template, sections, headline, summary])

  useEffect(() => {
    const flush = () => {
      const payload = persistPayloadRef.current
      if (!payload) return
      void fetch('/api/custom/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  const selected = types.find((item) => item.name === selectedType)
  const activeTemplate = templates.find((item) => item.id === template)
  const canCustomize = !!selected?.current && selected.configured
  const canEditVisual = canCustomize && !yamlDirty

  const commit = (next: Section[]) => {
    setSections(next)
    setPreviewUrl(null)
    setLastAction(null)
  }

  const onDragStart = (data: DragData) => (event: React.DragEvent) => {
    event.dataTransfer.setData(DND_MIME, JSON.stringify(data))
    event.dataTransfer.effectAllowed = 'copy'
  }

  const parseDrop = (event: React.DragEvent): DragData | null => {
    try {
      return JSON.parse(event.dataTransfer.getData(DND_MIME)) as DragData
    } catch {
      return null
    }
  }

  // 统一投放逻辑：条目/整章从左侧信息库拖入布局
  const applyDrop = (data: DragData) => {
    const label = cats.find((item) => item.key === data.key)?.label || data.key
    const existing = sections.find((item) => item.key === data.key)

    // 整章（“拖入所有”/“拖入选中”底部的整章入口）：已存在则转为“全部”，否则新增“全部”
    if (data.type === 'section') {
      if (existing) {
        commit(sections.map((s) => (s === existing ? { ...s, mode: 'all', ids: undefined, tags: undefined } : s)))
      } else {
        commit([...sections, { key: data.key, mode: 'all' }])
      }
      return
    }

    const incomingIds = data.type === 'entry'
      ? [data.id]
      : data.type === 'entries'
        ? data.ids || []
        : []
    const validIds = incomingIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (validIds.length === 0) return

    // 无该分类章节：新增为“ids”模式
    if (!existing) {
      commit([...sections, { key: data.key, mode: 'ids', ids: [...new Set(validIds)] }])
      return
    }

    // 章节已存在但展示全部/标签：无需重复添加具体条目
    if (existing.mode !== 'ids') {
      toast('warn', `${label} 章节已展示全部条目，无需重复添加`)
      return
    }

    // 追加缺失的条目（修复：从布局中移除后重新拖入应能重新加入）
    const missing = validIds.filter((id) => !(existing.ids || []).includes(id))
    if (missing.length === 0) {
      toast('warn', '这些条目已在布局中')
      return
    }
    commit(sections.map((s) => (s === existing ? { ...s, ids: [...new Set([...(s.ids || []), ...missing])] } : s)))
  }

  // 章节拖拽排序：把 fromKey 移动到 toKey 前/后（toKey 为 null 时移到末尾）
  const applyReorder = (fromKey: string, toKey: string | null, side: 'before' | 'after') => {
    const from = sections.findIndex((s) => s.key === fromKey)
    if (from < 0) return
    let insertAt = sections.length - 1
    if (toKey) {
      const to = sections.findIndex((s) => s.key === toKey)
      if (to < 0) return
      if (to === from) return
      let target = to + (side === 'after' ? 1 : 0)
      if (from < to) target -= 1
      insertAt = target
    }
    const next = [...sections]
    const [moved] = next.splice(from, 1)
    next.splice(insertAt, 0, moved)
    commit(next)
  }

  const resetDrag = () => {
    setDragOver(null)
    setDragSectionKey(null)
    setReorderOverKey(null)
  }

  const onSectionDragStart = (key: string) => (event: React.DragEvent) => {
    event.dataTransfer.setData(DND_REORDER_MIME, key)
    event.dataTransfer.effectAllowed = 'move'
    setDragSectionKey(key)
  }

  const onSectionDragOver = (key: string) => (event: React.DragEvent) => {
    if (!canEditVisual) return
    const types = Array.from(event.dataTransfer.types)
    if (types.includes(DND_REORDER_MIME)) {
      if (dragSectionKey && dragSectionKey !== key) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        setReorderOverKey(key)
        setReorderSide(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }
      return
    }
    if (types.includes(DND_MIME)) {
      event.preventDefault()
      setDragOver(key)
    }
  }

  const onSectionDrop = (event: React.DragEvent, key: string) => {
    event.preventDefault()
    event.stopPropagation()
    const reorderKey = event.dataTransfer.getData(DND_REORDER_MIME)
    if (reorderKey) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      applyReorder(reorderKey, key, side)
      resetDrag()
      return
    }
    const data = parseDrop(event)
    if (data) applyDrop(data)
    setDragOver(null)
  }

  const onCanvasDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const reorderKey = event.dataTransfer.getData(DND_REORDER_MIME)
    if (reorderKey) {
      applyReorder(reorderKey, null, 'after')
      resetDrag()
      return
    }
    const data = parseDrop(event)
    if (data) applyDrop(data)
    setDragOver(null)
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const next = [...sections]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  const renderCurrent = async (publish: boolean) => {
    if (yamlDirty) {
      toast('warn', '请先保存或放弃 YAML 修改')
      return
    }
    if (!selectedType) return
    if (workspaceMode === 'visual' && (!activeTemplate || sections.length === 0)) return
    setBusyAction(publish ? 'release' : 'preview')
    try {
      const body = workspaceMode === 'visual'
        ? {
            variant: selectedType,
            sections,
            template: activeTemplate!.id,
            overrides: {
              basics: {
                ...(headline.trim() ? { headline: headline.trim() } : {}),
                ...(summary.trim() ? { summary: summary.split('\n').map((line) => line.trim()).filter(Boolean) } : {}),
              },
            },
          }
        : { variant: selectedType }
      const result = await api.post<{
        preview: string | null
        engine: 'latex' | 'html'
        output?: string
        release?: { id: string; timestamp: number } | null
      }>(publish ? '/api/custom/release' : '/api/custom/preview', body)
      if (!result.preview) throw new Error(result.output || (publish ? '正式版发布失败' : '构建未生成预览'))
      setPreviewEngine(result.engine)
      setPreviewUrl(`${result.preview}?t=${Date.now()}`)
      setLastAction(publish ? 'release' : 'preview')
      if (publish) {
        setYamlRevision((value) => value + 1)
        toast('success', '正式版已保存并发布到版本时间轴')
        const refreshed = await api.get<{ variants: Variant[]; defaults?: { layout?: { engine?: string; template?: string } } }>('/api/variants').catch(() => ({ variants, defaults: undefined }))
        setVariants(refreshed.variants)
        if (refreshed.defaults) setVariantDefaults(refreshed.defaults)
      } else {
        toast('success', '预览已更新，不会进入版本时间轴')
      }
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setBusyAction(null)
    }
  }

  const refreshFromYaml = async () => {
    const [entryData, variantData, categoryData] = await Promise.all([
      api.get<{ entries: Record<string, Entry[]> }>('/api/entries'),
      api.get<{ variants: Variant[]; defaults?: { layout?: { engine?: string; template?: string } } }>('/api/variants'),
      api.get<{ categories: { key: string; label: string; visible: boolean }[] }>('/api/categories'),
    ])
    setEntries(entryData.entries)
    setVariants(variantData.variants)
    setVariantDefaults(variantData.defaults || {})
    if (categoryData.categories?.length) {
      setCats(categoryData.categories.filter((item) => item.visible !== false).map((item) => ({ key: item.key, label: item.label })))
    }
    applyVariant(selectedType, variantData.variants, variantData.defaults)
  }

  const handleYamlSaved = async () => {
    try {
      await refreshFromYaml()
      setPreviewUrl(null)
      setLastAction(null)
    } catch (err: any) {
      toast('error', `YAML 已保存，但工作区刷新失败：${err.message}`)
    }
  }

  const changeType = (name: string) => {
    if (yamlDirty) {
      toast('warn', '请先保存或放弃 YAML 修改')
      return
    }
    captureCurrentDraft()
    setSelectedEntryIds([])
    setSelectedType(name)
    applyRememberedVariant(name)
    setYamlRevision((value) => value + 1)
  }

  const toggleEntrySelection = (id?: string) => {
    if (!canEditVisual || !id) return
    setSelectedEntryIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const selectedEntryCount = selectedEntryIds.length
  const bulkDragData: DragData = selectedEntryCount > 0
    ? { type: 'entries', key: cat, ids: selectedEntryIds }
    : { type: 'section', key: cat }

  const listOf = (key: string): Entry[] => (Array.isArray(entries[key]) ? entries[key] : [])
  const sectionLabel = (key: string) => cats.find((item) => item.key === key)?.label || key
  const categoryCount = (key: string) => (Array.isArray(entries[key]) ? entries[key].length : entries[key] ? 1 : 0)
  // 信息库 tag 筛选：当前分类条目的标签选项 + 过滤后的条目
  const infoTagOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const e of listOf(cat)) {
      for (const t of e.tags || []) if (typeof t === 'string' && t.trim()) seen.add(t)
    }
    return [...seen].sort()
  }, [cat, entries])
  const filteredListOf = (key: string): Entry[] => {
    const list = listOf(key)
    if (!tagFilter) return list
    return list.filter((e) => (e.tags as string[] | undefined)?.includes(tagFilter))
  }

  const layoutEntries = useMemo(() => {
    const result = new Map<string, Entry>()
    for (const section of sections) {
      for (const entry of listOf(section.key)) result.set(`${section.key}:${entry.id}`, entry)
    }
    return result
  }, [sections, entries])

  if (loading) return <Spinner label="加载简历定制…" />

  return (
    <div className="flex flex-col gap-4 xl:h-full">
      <div className="shrink-0 border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <GitBranch size={15} className="text-zinc-500" />
            <Select
              value={selectedType}
              onChange={(event) => changeType(event.target.value)}
              className="w-52"
            >
              {types.map((type) => (
                <option key={type.name} value={type.name}>{type.label} · {type.branch}</option>
              ))}
            </Select>
          </div>
          {selected?.current ? <Badge tone="emerald">当前分支</Badge> : <Badge tone="amber">未切换到此分支</Badge>}
          <span className="text-xs text-zinc-600">模板、内容和布局均保存到该类型分支。</span>
          {!canCustomize && (
            <Button size="sm" variant="secondary" onClick={() => { window.location.hash = '/variants' }}>
              <GitBranch size={13} /> 前往切换分支
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {templates.map((item) => {
            const active = template === item.id
            return (
              <button
                key={item.id}
                disabled={!canEditVisual}
                onClick={() => {
                  setTemplate(item.id)
                  setPreviewUrl(null)
                }}
                className={`min-h-[74px] rounded-md border px-3 py-2 text-left transition ${
                  active
                    ? 'border-indigo-500/60 bg-indigo-500/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-600'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <LayoutTemplate size={13} className={active ? 'text-indigo-400' : 'text-zinc-600'} /> {item.name}
                  </span>
                  <Badge tone={item.engine === 'html' ? 'sky' : 'zinc'}>{item.engine === 'html' ? 'HTML' : 'LaTeX'}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-600">{item.desc}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1" role="tablist" aria-label="定制工作区">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'visual'}
            onClick={() => setWorkspaceMode('visual')}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${workspaceMode === 'visual' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <Layers size={13} /> 可视化编排
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'yaml'}
            onClick={() => setWorkspaceMode('yaml')}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${workspaceMode === 'yaml' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <FileCode2 size={13} /> YAML 源码
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {workspaceMode === 'visual' ? (
            draftSaveState === 'error' ? <Badge tone="red">草稿保存失败</Badge>
              : draftSaveState === 'saving' ? <Badge tone="zinc">草稿保存中</Badge>
                : draftSaveState === 'saved' ? <Badge tone="emerald">草稿已自动保存</Badge>
                  : <Badge tone="zinc">草稿自动保存</Badge>
          ) : yamlDirty ? <Badge tone="amber">YAML 未保存</Badge> : <Badge tone="zinc">磁盘已同步</Badge>}
          {previewUrl && !yamlDirty && (
            <Badge tone="emerald">{lastAction === 'release' ? '正式版已发布' : '预览已更新'}</Badge>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
        {workspaceMode === 'visual' && (
          <>
        <Card title="简历信息库" desc="拖拽条目或章节到布局" className="w-full shrink-0 xl:w-72" pad={false} fill>
          <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
            {cats.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setCat(item.key)
                  setTagFilter('')
                  setSelectedEntryIds([])
                }}
                className={`rounded-md px-2 py-1 text-[11px] transition ${
                  cat === item.key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {item.label}<span className={`ml-1 ${cat === item.key ? 'text-zinc-400' : 'text-zinc-600'}`}>{categoryCount(item.key)}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
            <Tag size={11} className="shrink-0 text-zinc-600" />
            <button
              onClick={() => setTagFilter('')}
              className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                !tagFilter ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              全部
            </button>
            {infoTagOptions.map((t) => (
              <button
                key={t}
                onClick={() => setTagFilter(tagFilter === t ? '' : t)}
                className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                  tagFilter === t ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t}
              </button>
            ))}
            {tagFilter && (
              <span className="ml-auto text-[10px] text-zinc-600">已筛选：{tagFilter}</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div
              draggable={canEditVisual}
              onDragStart={onDragStart(bulkDragData)}
              data-library-bulk-action
              title={selectedEntryCount > 0 ? '将选中的条目拖入布局' : '将当前分类的全部条目拖入布局'}
              className={`mb-2 flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs transition ${
                canEditVisual ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-50'
              } ${selectedEntryCount > 0 ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200' : 'border-indigo-500/40 bg-indigo-500/5 text-indigo-300'}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {selectedEntryCount > 0 ? <CheckSquare2 size={13} /> : <Layers size={13} />}
                <span className="truncate">{selectedEntryCount > 0 ? `拖入选中（${selectedEntryCount}）` : '拖入所有'}</span>
              </span>
              {selectedEntryCount > 0 && (
                <button
                  type="button"
                  aria-label="清除选中条目"
                  title="清除选中条目"
                  draggable={false}
                  onClick={() => setSelectedEntryIds([])}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-indigo-300 transition hover:bg-indigo-500/20 hover:text-indigo-100"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {cat === 'basics' ? (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">基础信息作为章节整体拖入布局。</div>
            ) : filteredListOf(cat).length === 0 ? (
              <EmptyState title={tagFilter ? `没有命中「${tagFilter}」标签的条目` : '暂无条目'} />
            ) : (
              filteredListOf(cat).map((entry) => {
                const inLayout = sections.some((section) => section.key === cat && (section.mode === 'all' || section.ids?.includes(entry.id!)))
                const isSelected = !!entry.id && selectedEntryIds.includes(entry.id)
                return (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={canEditVisual ? 0 : -1}
                    aria-pressed={isSelected}
                    aria-disabled={!canEditVisual}
                    data-library-entry={entry.id || ''}
                    draggable={canEditVisual}
                    onClick={() => toggleEntrySelection(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleEntrySelection(entry.id)
                      }
                    }}
                    onDragStart={onDragStart({ type: 'entry', key: cat, id: entry.id })}
                    className={`mb-1.5 rounded-md border px-3 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 ${
                      canEditVisual ? 'cursor-pointer active:cursor-grabbing' : 'cursor-not-allowed opacity-50'
                    } ${
                      isSelected
                        ? 'border-indigo-500/60 bg-indigo-500/10'
                        : inLayout
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : 'border-zinc-800 bg-zinc-950/50 hover:border-indigo-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {isSelected ? <CheckSquare2 size={12} className="shrink-0 text-indigo-300" /> : <Square size={12} className="shrink-0 text-zinc-600" />}
                      <GripVertical size={12} className="text-zinc-600" />
                      <span className="truncate text-xs font-medium text-zinc-200">{entryTitle(cat, entry)}</span>
                      {inLayout && <CheckCircle2 size={12} className="ml-auto text-emerald-400" />}
                    </div>
                    {(entry.tags || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 pl-8">
                        {(entry.tags as string[]).map((tag) => <TagChip key={tag} tag={tag} />)}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </Card>

        <Card
          title="内容与布局"
          desc="按当前顺序生成简历"
          className="min-w-0 flex-1"
          pad={false}
          fill
          actions={<Button size="sm" variant="ghost" disabled={!canEditVisual} onClick={() => commit([])}><Trash2 size={12} /> 清空</Button>}
        >
          <div className="space-y-2 border-b border-zinc-800 p-3">
            <Input
              value={headline}
              disabled={!canEditVisual}
              onChange={(event) => { setHeadline(event.target.value); setPreviewUrl(null) }}
              placeholder="针对该类型的职位头衔"
              className="text-xs"
            />
            <Textarea
              value={summary}
              disabled={!canEditVisual}
              onChange={(event) => { setSummary(event.target.value); setPreviewUrl(null) }}
              placeholder="针对该类型的个人简介，每行一条"
              className="min-h-[68px] text-xs"
            />
          </div>
          <div
            className={`min-h-0 flex-1 overflow-auto p-3 ${dragOver === 'canvas' ? 'ring-2 ring-inset ring-indigo-500/40' : ''}`}
            data-customizer-canvas
            onDragOver={(event) => {
              if (!canEditVisual) return
              const types = Array.from(event.dataTransfer.types)
              if (types.includes(DND_REORDER_MIME)) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setReorderOverKey(null)
                setDragOver('canvas')
                return
              }
              if (types.includes(DND_MIME)) {
                event.preventDefault()
                setDragOver('canvas')
              }
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={onCanvasDrop}
          >
            {sections.length === 0 ? (
              <EmptyState icon={<Layers size={30} />} title="布局为空" desc="从左侧拖入信息条目或整个章节。" />
            ) : (
              <div className="space-y-2">
                {sections.map((section, index) => {
                  const isReorderSource = dragSectionKey === section.key
                  const isReorderTarget = reorderOverKey === section.key
                  return (
                  <div
                    key={section.key}
                    data-section-key={section.key}
                    draggable={canEditVisual}
                    onDragStart={onSectionDragStart(section.key)}
                    onDragEnd={resetDrag}
                    onDragOver={onSectionDragOver(section.key)}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(event) => onSectionDrop(event, section.key)}
                    className={`relative rounded-md border p-2.5 transition ${
                      isReorderSource
                        ? 'border-zinc-700 opacity-40'
                        : dragOver === section.key
                          ? 'border-indigo-500/60 bg-indigo-500/5'
                          : 'border-zinc-800 bg-zinc-950/40'
                    } ${canEditVisual ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    {isReorderTarget && (
                      <span
                        className={`pointer-events-none absolute left-2 right-2 h-0.5 rounded-full bg-indigo-400 ${
                          reorderSide === 'before' ? '-top-1.5' : '-bottom-1.5'
                        }`}
                      />
                    )}
                    <div className="flex items-center gap-1.5">
                      <GripVertical size={13} className="text-zinc-600" />
                      <span className="text-xs font-semibold text-zinc-200">{sectionLabel(section.key)}</span>
                      <Badge tone={section.mode === 'all' ? 'emerald' : section.mode === 'ids' ? 'sky' : 'indigo'}>
                        {section.mode === 'all' ? '全部' : section.mode === 'ids' ? `${(section.ids || []).length} 条` : `${(section.tags || []).length} 标签`}
                      </Badge>
                      <div className="ml-auto flex gap-0.5">
                        <button disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(index, -1)}><ArrowUp size={12} /></button>
                        <button disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(index, 1)}><ArrowDown size={12} /></button>
                        <button disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400" onClick={() => commit(sections.filter((item) => item !== section))}><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
                      {section.mode === 'all' ? (
                        <span className="text-[11px] text-zinc-500">展示该章节全部条目</span>
                      ) : section.mode === 'ids' ? (
                        (section.ids || []).map((id) => {
                          const entry = layoutEntries.get(`${section.key}:${id}`)
                          return (
                            <span key={id} className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                              {entry ? entryTitle(section.key, entry) : id}
                              <button disabled={!canEditVisual} className="text-zinc-600 hover:text-red-400" onClick={() => commit(sections.map((item) => item === section ? { ...item, ids: (item.ids || []).filter((value) => value !== id) } : item))}><Trash2 size={10} /></button>
                            </span>
                          )
                        })
                      ) : (
                        (section.tags || []).map((tag) => <TagChip key={tag} tag={tag} />)
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </Card>
          </>
        )}
        <div className={workspaceMode === 'yaml' ? 'min-h-0 min-w-0 flex-1' : 'hidden'}>
          <YamlWorkspace
            disabled={rendering}
            revision={yamlRevision}
            onDirtyChange={setYamlDirty}
            onSaved={handleYamlSaved}
          />
        </div>

        <Card
          title="模板预览"
          desc={activeTemplate ? `${activeTemplate.name} · ${activeTemplate.engine === 'html' ? 'HTML' : 'LaTeX PDF'}` : '选择模板'}
          className="min-h-[560px] w-full shrink-0 xl:min-h-0 xl:w-[46%]"
          pad={false}
          fill
          actions={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-indigo-300" title="新窗口打开"><ExternalLink size={13} /></a>}
              <Button
                size="sm"
                variant="secondary"
                loading={busyAction === 'preview'}
                disabled={!canCustomize || rendering || yamlDirty || (workspaceMode === 'visual' && (sections.length === 0 || !activeTemplate))}
                onClick={() => renderCurrent(false)}
              >
                <Eye size={13} /> 预览
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busyAction === 'release'}
                disabled={!canCustomize || rendering || yamlDirty || (workspaceMode === 'visual' && (sections.length === 0 || !activeTemplate))}
                onClick={() => renderCurrent(true)}
              >
                <PackageCheck size={13} /> 保存发布正式版
              </Button>
            </div>
          }
        >
          <div className="min-h-0 flex-1 overflow-auto">
            {rendering ? (
              <div className="flex h-full items-center justify-center">
                <Spinner label={busyAction === 'release' ? '正在生成并归档正式版…' : '正在组合并生成预览…'} />
              </div>
            ) : previewUrl ? (
              previewEngine === 'latex' ? <PdfViewer url={previewUrl} /> : <iframe key={previewUrl} src={previewUrl} className="h-full w-full bg-white" title="HTML 简历预览" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState icon={<FileCode2 size={30} />} title="选择模板并预览" desc="预览只用于检查效果，不进入版本时间轴；确认后再发布正式版。" />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
