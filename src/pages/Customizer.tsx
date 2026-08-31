// 简历定制：按当前简历类型组织内容、选择模板，并在本页构建预览
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  Plus,
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
  Type,
  RefreshCw,
  Search,
} from 'lucide-react'
import { api } from '../api'
import type {
  Entry,
  ResumeFontGroup,
  ResumeFontKind,
  ResumeFontOption,
  ResumeFontSettings,
  Variant,
} from '../types'
import { useToast } from '../toast'
import { Badge, Button, Card, EmptyState, Select, Spinner, TagChip } from '../components/ui'
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
  fonts?: ResumeFontSettings
  componentOrder?: string[]
  headlines?: string[]
  updatedAt?: number
}

interface CustomizerMemory {
  selectedType?: string
  workspaceMode?: 'visual' | 'yaml'
  category?: string
  drafts?: Record<string, CustomizerDraft>
}

// 职位头衔选择器：拖拽排序 + 点击移除 + 添加未选头衔（顺序用于简历头部展示）
function HeadlinePicker({
  all,
  value,
  onChange,
}: {
  all: string[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return
    const next = [...value]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }
  const clearDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const addable = all.filter((h) => !value.includes(h))
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((h, i) => (
            <span
              key={`${h}-${i}`}
              draggable
              onDragStart={(e) => {
                setDragIndex(i)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', h)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (overIndex !== i) setOverIndex(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex !== null) reorder(dragIndex, i)
                clearDrag()
              }}
              onDragEnd={clearDrag}
              title="拖动调整顺序"
              className={`inline-flex cursor-grab items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] active:cursor-grabbing ${
                dragIndex === i ? 'opacity-40' : ''
              } ${
                overIndex === i && dragIndex !== null && dragIndex !== i ? 'ring-2 ring-indigo-400/70' : ''
              } border-indigo-500/40 bg-indigo-500/10 text-indigo-100`}
            >
              <GripVertical size={10} className="shrink-0 text-indigo-300/70" />
              {h}
              <button
                type="button"
                aria-label={`移除${h}`}
                className="text-indigo-300/60 hover:text-red-400"
                onClick={() => remove(i)}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-zinc-800 pt-1.5">
          {addable.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChange([...value, h])}
              className="rounded-full border border-dashed border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-indigo-400 hover:text-indigo-300"
            >
              <Plus size={10} className="mr-0.5 inline" />
              {h}
            </button>
          ))}
        </div>
      )}
      {value.length === 0 && addable.length === 0 && (
        <p className="text-[11px] text-zinc-600">暂无职位头衔，请在「信息管理 → 基础信息」添加</p>
      )}
    </div>
  )
}

interface SystemFontPickerProps {
  kind: ResumeFontKind
  label: string
  value: string
  options: ResumeFontOption[]
  disabled: boolean
  onChange: (value: string) => void
}

function SystemFontPicker({ kind, label, value, options, disabled, onChange }: SystemFontPickerProps) {
  const [input, setInput] = useState(value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setInput(value), [value])
  useEffect(() => { if (!open) setQuery('') }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return options
    return options.filter((option) => option.id.toLocaleLowerCase().includes(q))
  }, [query, options])

  useEffect(() => setHighlight(0), [open, query])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-option-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const openDropdown = () => {
    if (disabled) return
    setQuery('')
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(Math.max(rect.width, 264), window.innerWidth - 16)
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < 344 && rect.top > 344
    const top = openUp ? rect.top - 344 - 6 : rect.bottom + 6
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setAnchor({ left, top, width })
    setOpen(true)
  }

  const select = (id: string) => {
    setInput(id)
    setQuery('')
    setOpen(false)
    if (id !== value) onChange(id)
  }

  const commit = () => {
    const match = options.find((option) => option.id.toLocaleLowerCase() === input.trim().toLocaleLowerCase())
    setQuery('')
    if (match) select(match.id)
    else setInput(value)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openDropdown()
      else setHighlight((current) => Math.min(current + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openDropdown()
      else setHighlight((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open && filtered[highlight]) select(filtered[highlight].id)
      else commit()
    } else if (event.key === 'Escape') {
      if (open) {
        setOpen(false)
        return
      }
      setInput(value)
      inputRef.current?.blur()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
      <input
        ref={inputRef}
        type="text"
        value={input}
        disabled={disabled}
        draggable={false}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        data-font-picker={kind}
        autoComplete="off"
        spellCheck={false}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(event) => {
          const next = event.target.value
          setInput(next)
          setQuery(next)
          setHighlight(0)
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="h-9 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-2 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={`搜索${label}`}
      />
      {open && anchor && createPortal(
        <div
          ref={listRef}
          role="listbox"
          aria-label={`${label}列表`}
          style={{ position: 'fixed', left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: 344, zIndex: 60 }}
          className="overflow-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/95 px-3 py-2 backdrop-blur">
            <span className="text-[11px] text-zinc-400">共 {filtered.length} 个字体</span>
            <span className="shrink-0 text-[10px] text-zinc-600">↑↓ 选择 · Enter 确认 · Esc 关闭</span>
          </div>
          {filtered.length ? filtered.map((option, index) => {
            const selected = option.id === value
            return (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={selected}
                data-option-index={index}
                onMouseDown={(event) => {
                  event.preventDefault()
                  select(option.id)
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition ${index === highlight ? 'bg-zinc-800' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs ${selected ? 'font-medium text-indigo-300' : 'text-zinc-200'}`}>{option.id}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{option.description}</span>
                </span>
                <span className="shrink-0 text-sm text-zinc-300" style={{ fontFamily: option.cssFamilies.join(', ') }}>{option.sample}</span>
              </button>
            )
          }) : (
            <div className="px-3 py-6 text-center text-xs text-zinc-500">没有匹配的字体</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
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

const TYPOGRAPHY_CATEGORY = { key: '__fonts', label: '字体' }
const FONT_KINDS: ResumeFontKind[] = ['cjk', 'latin']
const sectionItemId = (key: string) => `section:${key}`
const fontItemId = (kind: ResumeFontKind) => `font:${kind}`

function normalizeComponentOrder(
  order: string[] | undefined,
  sections: Section[],
  fonts: ResumeFontSettings,
) {
  const valid = new Set([
    ...sections.map((section) => sectionItemId(section.key)),
    ...FONT_KINDS.filter((kind) => !!fonts[kind]).map(fontItemId),
  ])
  const normalized = (order || []).filter((id, index, list) => valid.has(id) && list.indexOf(id) === index)
  for (const section of sections) {
    const id = sectionItemId(section.key)
    if (!normalized.includes(id)) normalized.push(id)
  }
  for (const kind of FONT_KINDS) {
    const id = fontItemId(kind)
    if (fonts[kind] && !normalized.includes(id)) normalized.push(id)
  }
  return normalized
}

interface DragData {
  type: 'entry' | 'entries' | 'section' | 'font'
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
  const [fontGroups, setFontGroups] = useState<ResumeFontGroup[]>([])
  const [fontCatalogLoading, setFontCatalogLoading] = useState(false)
  const [template, setTemplate] = useState('moderncv-banking')
  const [sections, setSections] = useState<Section[]>([])
  const [fonts, setFonts] = useState<ResumeFontSettings>({})
  const [headlines, setHeadlines] = useState<string[]>([])
  const [componentOrder, setComponentOrder] = useState<string[]>([])
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
  const dragItemRef = useRef<string | null>(null)
  const dragTargetRef = useRef<{ id: string | null; side: 'before' | 'after' } | null>(null)
  const persistPayloadRef = useRef<CustomizerMemory | null>(null)
  const rendering = busyAction !== null

  useEffect(() => {
    Promise.all([
      api.get<{ entries: Record<string, Entry[]> }>('/api/entries').catch(() => ({ entries: {} })),
      api.get<{ variants: Variant[]; defaults?: { layout?: { engine?: string; template?: string } } }>('/api/variants').catch(() => ({ variants: [], defaults: undefined })),
      api.get<{ types: ResumeType[] }>('/api/resume-types').catch(() => ({ types: [] })),
      api.get<{ templates: TemplateItem[] }>('/api/templates').catch(() => ({ templates: [] })),
      api.get<{ groups: ResumeFontGroup[] }>('/api/font-options').catch(() => ({ groups: [] })),
      api.get<{ categories: { key: string; label: string; visible: boolean }[] }>('/api/categories').catch(() => ({ categories: [] })),
      api.get<{ state: CustomizerMemory }>('/api/custom/state').catch(() => ({ state: {} as CustomizerMemory })),
    ])
      .then(([entryData, variantData, typeData, templateData, fontData, categoryData, customizerData]) => {
        setEntries(entryData.entries)
        setVariants(variantData.variants)
        setVariantDefaults(variantData.defaults || {})
        setTypes(typeData.types)
        setTemplates(templateData.templates)
        setFontGroups(fontData.groups)
        const visibleCats = categoryData.categories?.length
          ? categoryData.categories.filter((item) => item.visible !== false).map((item) => ({ key: item.key, label: item.label }))
          : DEFAULT_CATS
        setCats(visibleCats)

        const memory = customizerData.state || {}
        draftsRef.current = memory.drafts || {}
        if (memory.workspaceMode === 'yaml' || memory.workspaceMode === 'visual') setWorkspaceMode(memory.workspaceMode)
        if (typeof memory.category === 'string' && (memory.category === TYPOGRAPHY_CATEGORY.key || visibleCats.some((item) => item.key === memory.category))) setCat(memory.category)

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
    const nextSections = sectionsFromVariant(variant)
    const nextFonts = { ...(variant?.fonts || {}) }
    setSections(nextSections)
    setFonts(nextFonts)
    setHeadlines(defaultHeadlines(variant?.headlines))
    setComponentOrder(normalizeComponentOrder(undefined, nextSections, nextFonts))
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
    const nextSections = cloneSections(draft.sections || [])
    const nextFonts = { ...(draft.fonts || {}) }
    setSections(nextSections)
    setFonts(nextFonts)
    setHeadlines(defaultHeadlines(draft.headlines))
    setComponentOrder(normalizeComponentOrder(draft.componentOrder, nextSections, nextFonts))
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
        fonts: { ...fonts },
        componentOrder: [...componentOrder],
        headlines: [...headlines],
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
      fonts: { ...fonts },
      componentOrder: [...componentOrder],
      headlines: [...headlines],
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
  }, [draftReady, selectedType, workspaceMode, cat, template, sections, fonts, componentOrder])

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
  const libraryCategories = [...cats, TYPOGRAPHY_CATEGORY]

  const refreshSystemFonts = async () => {
    setFontCatalogLoading(true)
    try {
      const data = await api.get<{ groups: ResumeFontGroup[] }>('/api/font-options?refresh=1')
      setFontGroups(data.groups)
      const summary = data.groups.map((group) => `${group.label} ${group.options.length}`).join('，')
      toast('success', `系统字体已更新：${summary}`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '系统字体扫描失败')
    } finally {
      setFontCatalogLoading(false)
    }
  }

  const invalidatePreview = () => {
    setPreviewUrl(null)
    setLastAction(null)
  }

  const commit = (next: Section[]) => {
    setSections(next)
    setComponentOrder((current) => normalizeComponentOrder(current, next, fonts))
    invalidatePreview()
  }

  const commitFonts = (next: ResumeFontSettings) => {
    setFonts(next)
    setComponentOrder((current) => normalizeComponentOrder(current, sections, next))
    invalidatePreview()
  }

  // 职位头衔顺序（按变体保存），拖拽/增删后刷新预览
  const commitHeadlines = (next: string[]) => {
    setHeadlines(next)
    invalidatePreview()
  }

  // 基础信息里维护的全部职位头衔（定制页拖拽排序/选择的对象）
  const basicsHeadlines: string[] = Array.isArray((entries.basics as any)?.headlines)
    ? (entries.basics as any).headlines
    : []
  const defaultHeadlines = (variantHeadlines?: unknown) =>
    Array.isArray(variantHeadlines) && variantHeadlines.length
      ? [...(variantHeadlines as string[])]
      : [...basicsHeadlines]

  const addFontComponent = (kind: ResumeFontKind) => {
    if (fonts[kind]) {
      toast('warn', `${fontGroups.find((group) => group.kind === kind)?.label || '字体'}组件已在布局中`)
      return
    }
    const group = fontGroups.find((item) => item.kind === kind)
    if (!group) return
    commitFonts({ ...fonts, [kind]: group.defaultId })
  }

  const removeFontComponent = (kind: ResumeFontKind) => {
    const next = { ...fonts }
    delete next[kind]
    commitFonts(next)
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
    if (data.type === 'font' && FONT_KINDS.includes(data.id as ResumeFontKind)) {
      addFontComponent(data.id as ResumeFontKind)
      return
    }
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

  // 内容章节与字体组件共享同一画布顺序；输出时只提取章节顺序。
  const applyReorder = (fromId: string, toId: string | null, side: 'before' | 'after') => {
    const from = componentOrder.indexOf(fromId)
    if (from < 0) return
    const next = [...componentOrder]
    const [moved] = next.splice(from, 1)
    let insertAt = next.length
    if (toId) {
      const to = next.indexOf(toId)
      if (to < 0) return
      insertAt = to + (side === 'after' ? 1 : 0)
    }
    next.splice(insertAt, 0, moved)
    setComponentOrder(next)
    const byKey = new Map(sections.map((section) => [section.key, section]))
    setSections(next.flatMap((id) => id.startsWith('section:') ? [byKey.get(id.slice(8))].filter(Boolean) as Section[] : []))
    invalidatePreview()
  }

  const resetDrag = () => {
    dragItemRef.current = null
    dragTargetRef.current = null
    setDragOver(null)
    setDragSectionKey(null)
    setReorderOverKey(null)
  }

  const finishDrag = () => {
    const source = dragItemRef.current
    const target = dragTargetRef.current
    if (source && target) applyReorder(source, target.id, target.side)
    resetDrag()
  }

  const onSectionDragStart = (itemId: string) => (event: React.DragEvent) => {
    event.dataTransfer.setData(DND_REORDER_MIME, itemId)
    event.dataTransfer.effectAllowed = 'move'
    dragItemRef.current = itemId
    setDragSectionKey(itemId)
  }

  const onSectionDragOver = (itemId: string) => (event: React.DragEvent) => {
    if (!canEditVisual) return
    const types = Array.from(event.dataTransfer.types)
    if (types.includes(DND_REORDER_MIME)) {
      event.stopPropagation()
      if (dragItemRef.current && dragItemRef.current !== itemId) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        dragTargetRef.current = { id: itemId, side }
        setReorderOverKey(itemId)
        setReorderSide(side)
      }
      return
    }
    if (types.includes(DND_MIME)) {
      event.preventDefault()
      event.stopPropagation()
      setDragOver(itemId)
    }
  }

  const onSectionDrop = (event: React.DragEvent, itemId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const reorderKey = event.dataTransfer.getData(DND_REORDER_MIME)
    if (reorderKey) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const side = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      dragTargetRef.current = null
      applyReorder(reorderKey, itemId, side)
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

  const move = (itemId: string, direction: -1 | 1) => {
    const index = componentOrder.indexOf(itemId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= componentOrder.length) return
    applyReorder(itemId, componentOrder[target], direction < 0 ? 'before' : 'after')
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
            fonts,
            headlines,
            template: activeTemplate!.id,
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

  // 选类型即切换分支：与「简历类型」页保持一致（未提交改动自动保存），避免两页状态不一致
  const changeType = async (name: string) => {
    if (yamlDirty) {
      toast('warn', '请先保存或放弃 YAML 修改')
      return
    }
    captureCurrentDraft()
    setSelectedEntryIds([])
    try {
      // 分支不存在时先创建（含默认配置），再切换
      await api.post(`/api/resume-types/${encodeURIComponent(name)}/ensure-branch`, {})
      await api.post(`/api/resume-types/${encodeURIComponent(name)}/checkout`, {})
      const [typeData, variantData] = await Promise.all([
        api.get<{ types: ResumeType[] }>('/api/resume-types'),
        api.get<{ variants: Variant[]; defaults?: { layout?: { engine?: string; template?: string } } }>('/api/variants'),
      ])
      setTypes(typeData.types)
      setVariants(variantData.variants)
      setVariantDefaults(variantData.defaults || {})
      setSelectedType(name)
    } catch (e: any) {
      toast('error', e.message)
      return
    }
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
  const categoryCount = (key: string) => key === TYPOGRAPHY_CATEGORY.key
    ? fontGroups.length
    : (Array.isArray(entries[key]) ? entries[key].length : entries[key] ? 1 : 0)
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
    <div className="flex min-h-0 flex-col gap-4 xl:h-full xl:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
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
          <span className="text-xs text-zinc-600">模板、内容、字体和布局均保存到该类型分支。</span>
          {!canCustomize && (
            <Button size="sm" variant="secondary" onClick={() => { window.location.hash = '/variants' }}>
              <GitBranch size={13} /> 前往切换分支
            </Button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">
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
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <LayoutTemplate size={13} className={`shrink-0 ${active ? 'text-indigo-400' : 'text-zinc-600'}`} />
                    <span className="truncate">{item.name}</span>
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

      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <div className={`flex min-h-0 min-w-0 flex-1 ${workspaceMode === 'visual' ? 'flex-col gap-4 2xl:flex-row' : 'flex-col'}`}>
          {workspaceMode === 'visual' && (
            <>
        <Card title="简历信息库" desc="拖拽条目、章节或字体到布局" className="w-full xl:min-h-0 xl:flex-1 xl:basis-0 2xl:w-72 2xl:flex-none" pad={false} fill>
          <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
            {libraryCategories.map((item) => (
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
          {cat !== TYPOGRAPHY_CATEGORY.key && (
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
          )}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {cat === TYPOGRAPHY_CATEGORY.key ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 px-1 pb-1 text-[10px] text-zinc-600">
                  <span className="min-w-0 truncate">{fontGroups.length ? `系统 ${fontGroups[0].systemCount} · ${fontGroups.map((group) => `${group.label}可用 ${group.options.length}`).join(' · ')}` : '正在读取系统字体'}</span>
                  <button
                    type="button"
                    title="重新扫描系统字体"
                    aria-label="重新扫描系统字体"
                    disabled={fontCatalogLoading}
                    onClick={refreshSystemFonts}
                    className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-wait disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={fontCatalogLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {fontGroups.map((group) => {
                  const active = !!fonts[group.kind]
                  const defaultOption = group.options.find((option) => option.id === group.defaultId)
                  return (
                    <div
                      key={group.kind}
                      role="button"
                      tabIndex={canEditVisual && !active ? 0 : -1}
                      aria-disabled={!canEditVisual || active}
                      draggable={canEditVisual && !active}
                      data-font-library={group.kind}
                      onClick={() => canEditVisual && !active && addFontComponent(group.kind)}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && canEditVisual && !active) {
                          event.preventDefault()
                          addFontComponent(group.kind)
                        }
                      }}
                      onDragStart={onDragStart({ type: 'font', key: TYPOGRAPHY_CATEGORY.key, id: group.kind })}
                      className={`rounded-md border px-3 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 ${
                        !canEditVisual || active
                          ? 'cursor-not-allowed border-zinc-800 bg-zinc-950/30 opacity-55'
                          : 'cursor-grab border-zinc-800 bg-zinc-950/50 hover:border-indigo-500/50 active:cursor-grabbing'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Type size={14} className={active ? 'text-emerald-400' : 'text-indigo-400'} />
                        <span className="text-xs font-medium text-zinc-200">{group.label}</span>
                        {active && <Badge tone="emerald">已添加</Badge>}
                        <GripVertical size={13} className="ml-auto text-zinc-600" />
                      </div>
                      <p className="mt-2 text-[11px] text-zinc-500">{group.description} · {group.options.length} 个可用系统字体</p>
                      <p
                        className="mt-2 truncate border-t border-zinc-800 pt-2 text-sm text-zinc-300"
                        style={{ fontFamily: defaultOption?.cssFamilies.join(', ') }}
                      >
                        {defaultOption?.sample}
                      </p>
                    </div>
                  )
                })}
              </div>
            ) : (
            <>
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
              <>
              <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">基础信息作为章节整体拖入布局。</div>
              <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-200">职位头衔</span>
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-600">拖动调整顺序；简历头部按此顺序展示。</p>
                <HeadlinePicker all={basicsHeadlines} value={headlines} onChange={commitHeadlines} />
              </div>
              </>
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
            </>
            )}
          </div>
        </Card>

        <Card
          title="内容与布局"
          desc="按当前顺序生成简历"
          className="min-w-0 xl:min-h-0 xl:flex-1 xl:basis-0"
          pad={false}
          fill
          actions={<Button size="sm" variant="ghost" disabled={!canEditVisual} onClick={() => { setSections([]); setFonts({}); setComponentOrder([]); invalidatePreview() }}><Trash2 size={12} /> 清空</Button>}
        >
          <div
            className={`min-h-0 flex-1 overflow-auto p-3 ${dragOver === 'canvas' ? 'ring-2 ring-inset ring-indigo-500/40' : ''}`}
            data-customizer-canvas
            onDragOver={(event) => {
              if (!canEditVisual) return
              const types = Array.from(event.dataTransfer.types)
              if (types.includes(DND_REORDER_MIME)) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                dragTargetRef.current = { id: null, side: 'after' }
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
            {componentOrder.length === 0 ? (
              <EmptyState icon={<Layers size={30} />} title="布局为空" desc="从左侧拖入信息条目、章节或字体组件。" />
            ) : (
              <div className="space-y-2">
                {componentOrder.map((itemId) => {
                  const isReorderSource = dragSectionKey === itemId
                  const isReorderTarget = reorderOverKey === itemId
                  const sharedProps = {
                    draggable: canEditVisual,
                    onDragStart: onSectionDragStart(itemId),
                    onDragEnd: finishDrag,
                    onDragOver: onSectionDragOver(itemId),
                    onDragLeave: () => setDragOver(null),
                    onDrop: (event: React.DragEvent) => onSectionDrop(event, itemId),
                  }
                  const sharedClass = `relative rounded-md border p-2.5 transition ${
                    isReorderSource
                      ? 'border-zinc-700 opacity-40'
                      : dragOver === itemId
                        ? 'border-indigo-500/60 bg-indigo-500/5'
                        : 'border-zinc-800 bg-zinc-950/40'
                  } ${canEditVisual ? 'cursor-grab active:cursor-grabbing' : ''}`
                  const dropIndicator = isReorderTarget ? (
                    <span
                      className={`pointer-events-none absolute left-2 right-2 h-0.5 rounded-full bg-indigo-400 ${
                        reorderSide === 'before' ? '-top-1.5' : '-bottom-1.5'
                      }`}
                    />
                  ) : null

                  if (itemId.startsWith('font:')) {
                    const kind = itemId.slice(5) as ResumeFontKind
                    const group = fontGroups.find((item) => item.kind === kind)
                    if (!group || !fonts[kind]) return null
                    const availableOption = group.options.find((option) => option.id === fonts[kind])
                    const selectedOption: ResumeFontOption = availableOption || {
                      id: fonts[kind],
                      label: fonts[kind],
                      description: '当前系统未检测到，构建时使用本地回退',
                      sample: kind === 'cjk' ? '中文排版示例' : 'Typography Aa 123',
                      cssFamilies: [`"${fonts[kind]}"`],
                    }
                    const pickerOptions = availableOption ? group.options : [selectedOption, ...group.options]
                    return (
                      <div key={itemId} data-font-component={kind} {...sharedProps} className={sharedClass}>
                        {dropIndicator}
                        <div className="flex min-w-0 items-center gap-1.5">
                          <GripVertical size={13} className="shrink-0 text-zinc-600" />
                          <Type size={13} className="shrink-0 text-indigo-400" />
                          <span className="truncate text-xs font-semibold text-zinc-200">{group.label}</span>
                          <Badge tone="indigo">字体</Badge>
                          <div className="ml-auto flex shrink-0 gap-0.5">
                            <button type="button" draggable={false} title="上移" aria-label={`上移${group.label}`} disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(itemId, -1)}><ArrowUp size={12} /></button>
                            <button type="button" draggable={false} title="下移" aria-label={`下移${group.label}`} disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(itemId, 1)}><ArrowDown size={12} /></button>
                            <button type="button" draggable={false} title="移除" aria-label={`移除${group.label}`} disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400" onClick={() => removeFontComponent(kind)}><Trash2 size={12} /></button>
                          </div>
                        </div>
                        <div className="mt-2 grid min-w-0 gap-2 pl-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                          <SystemFontPicker
                            kind={kind}
                            label={group.label}
                            value={fonts[kind]}
                            options={pickerOptions}
                            disabled={!canEditVisual}
                            onChange={(value) => commitFonts({ ...fonts, [kind]: value })}
                          />
                          <div className="min-w-0 rounded border border-zinc-800 bg-zinc-900/70 px-2.5 py-2">
                            <p className="truncate text-sm text-zinc-200" style={{ fontFamily: selectedOption?.cssFamilies.join(', ') }}>{selectedOption?.sample}</p>
                            <p className="mt-0.5 truncate text-[10px] text-zinc-600">{selectedOption?.description}</p>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  const key = itemId.slice(8)
                  const section = sections.find((item) => item.key === key)
                  if (!section) return null
                  return (
                    <div key={itemId} data-section-key={section.key} {...sharedProps} className={sharedClass}>
                      {dropIndicator}
                      <div className="flex items-center gap-1.5">
                        <GripVertical size={13} className="text-zinc-600" />
                        <span className="text-xs font-semibold text-zinc-200">{sectionLabel(section.key)}</span>
                        <Badge tone={section.mode === 'all' ? 'emerald' : section.mode === 'ids' ? 'sky' : 'indigo'}>
                          {section.mode === 'all' ? '全部' : section.mode === 'ids' ? `${(section.ids || []).length} 条` : `${(section.tags || []).length} 标签`}
                        </Badge>
                        <div className="ml-auto flex gap-0.5">
                          <button type="button" draggable={false} title="上移" aria-label={`上移${sectionLabel(section.key)}`} disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(itemId, -1)}><ArrowUp size={12} /></button>
                          <button type="button" draggable={false} title="下移" aria-label={`下移${sectionLabel(section.key)}`} disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(itemId, 1)}><ArrowDown size={12} /></button>
                          <button type="button" draggable={false} title="移除" aria-label={`移除${sectionLabel(section.key)}`} disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400" onClick={() => commit(sections.filter((item) => item !== section))}><Trash2 size={12} /></button>
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
                                <button type="button" draggable={false} aria-label={`移除${entry ? entryTitle(section.key, entry) : id}`} disabled={!canEditVisual} className="text-zinc-600 hover:text-red-400" onClick={() => commit(sections.map((item) => item === section ? { ...item, ids: (item.ids || []).filter((value) => value !== id) } : item))}><Trash2 size={10} /></button>
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
        </div>

      </div>
    </div>

    <aside className="flex min-h-0 min-w-0 flex-1 flex-col xl:w-[46%] xl:flex-none">
      <Card
        title="模板预览"
        desc={activeTemplate ? `${activeTemplate.name} · ${activeTemplate.engine === 'html' ? 'HTML' : 'LaTeX PDF'}` : '选择模板'}
        className="h-full min-h-[560px] w-full xl:min-h-0"
        pad={false}
        fill
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {previewUrl && <Button size="sm" variant="secondary" onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')} title="新窗口打开"><ExternalLink size={13} /> 新窗口</Button>}
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
        <div className="min-h-0 flex-1 overflow-hidden">
          {rendering ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label={busyAction === 'release' ? '正在生成并归档正式版…' : '正在组合并生成预览…'} />
            </div>
          ) : previewUrl ? (
            previewEngine === 'latex' ? <PdfViewer url={previewUrl} fitPage /> : <iframe key={previewUrl} src={previewUrl} className="h-full w-full bg-white" title="HTML 简历预览" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={<FileCode2 size={30} />} title="选择模板并预览" desc="预览只用于检查效果，不进入版本时间轴；确认后再发布正式版。" />
            </div>
          )}
        </div>
      </Card>
    </aside>
  </div>
)
}
