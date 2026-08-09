// 信息管理页：分类管理全部个人信息，支持标签筛选、搜索、增删改
import React, { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  Briefcase,
  GraduationCap,
  FolderKanban,
  Wrench,
  Award,
  Heart,
  UserRound,
  ListChecks,
} from 'lucide-react'
import { api } from '../api'
import type { Category, Entry } from '../types'
import { useToast } from '../toast'
import { Card, Button, Modal, Field, Input, Textarea, Select, TagChip, TagInput, EmptyState, Spinner } from '../components/ui'

const DEGREES = ['Middle School', 'High School', 'Diploma', 'Associate', 'Bachelor', 'Master', 'Doctor']
const LEVELS = ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master']

const CATEGORIES: { key: Category; label: string; icon: React.ReactNode }[] = [
  { key: 'basics', label: '基础信息', icon: <UserRound size={14} /> },
  { key: 'work', label: '工作经历', icon: <Briefcase size={14} /> },
  { key: 'education', label: '教育背景', icon: <GraduationCap size={14} /> },
  { key: 'projects', label: '项目经历', icon: <FolderKanban size={14} /> },
  { key: 'skills', label: '专业技能', icon: <Wrench size={14} /> },
  { key: 'certificates', label: '证书资质', icon: <Award size={14} /> },
  { key: 'interests', label: '兴趣爱好', icon: <Heart size={14} /> },
]

// 字段配置：类型 text/textarea/date/select/tags/achievements/summary
interface FieldDef {
  key: string
  label: string
  type: string
  hint?: string
  options?: string[]
  required?: boolean
}

const FIELDS: Record<Category, FieldDef[]> = {
  basics: [
    { key: 'name', label: '姓名', type: 'text', required: true },
    { key: 'headline', label: '职位头衔', type: 'text' },
    { key: 'phone', label: '电话', type: 'text' },
    { key: 'email', label: '邮箱', type: 'text' },
    { key: 'url', label: '个人主页', type: 'text' },
    { key: 'summary', label: '个人简介', type: 'summary', hint: '每行一条要点，自动转为 markdown 列表' },
  ],
  work: [
    { key: 'company', label: '公司', type: 'text', required: true },
    { key: 'position', label: '职位', type: 'text', required: true },
    { key: 'startDate', label: '开始时间', type: 'text', hint: '如 2021-03' },
    { key: 'endDate', label: '结束时间', type: 'text', hint: '留空 = 至今' },
    { key: 'url', label: '公司主页', type: 'text' },
    { key: 'keywords', label: '技能关键词', type: 'tags' },
    { key: 'achievements', label: '成就要点', type: 'achievements', hint: '每条可打标签，无标签 = 通用（所有方向保留）' },
    { key: 'tags', label: '方向标签', type: 'tags', hint: '元数据，用于筛选（不进入简历）' },
    { key: 'notes', label: '备注', type: 'textarea', hint: '仅自己可见' },
  ],
  education: [
    { key: 'institution', label: '学校', type: 'text', required: true },
    { key: 'degree', label: '学位', type: 'select', options: DEGREES },
    { key: 'area', label: '专业', type: 'text' },
    { key: 'score', label: '成绩/GPA', type: 'text' },
    { key: 'startDate', label: '开始时间', type: 'text' },
    { key: 'endDate', label: '结束时间', type: 'text' },
    { key: 'url', label: '学校主页', type: 'text' },
    { key: 'summary', label: '描述', type: 'summary' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  projects: [
    { key: 'name', label: '项目名称', type: 'text', required: true },
    { key: 'description', label: '一句话简介', type: 'text' },
    { key: 'url', label: '链接', type: 'text' },
    { key: 'startDate', label: '开始时间', type: 'text' },
    { key: 'endDate', label: '结束时间', type: 'text' },
    { key: 'keywords', label: '技术栈', type: 'tags' },
    { key: 'summary', label: '项目要点', type: 'summary' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  skills: [
    { key: 'name', label: '技能名称', type: 'text', required: true },
    { key: 'level', label: '熟练度', type: 'select', options: LEVELS },
    { key: 'keywords', label: '细分关键词', type: 'tags' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  certificates: [
    { key: 'name', label: '证书名称', type: 'text', required: true },
    { key: 'issuer', label: '颁发机构', type: 'text' },
    { key: 'date', label: '获取时间', type: 'text' },
    { key: 'url', label: '验证链接', type: 'text' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  interests: [
    { key: 'name', label: '兴趣名称', type: 'text', required: true },
    { key: 'keywords', label: '关键词', type: 'tags' },
  ],
}

function emptyEntry(cat: Category): Entry {
  const e: Entry = { tags: [] }
  if (cat === 'work') e.achievements = []
  if (cat === 'basics') e.summary = []
  return e
}

export default function Entries() {
  const toast = useToast()
  const [category, setCategory] = useState<Category>('work')
  const [all, setAll] = useState<Record<string, any>>({})
  const [tagCount, setTagCount] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Entry | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = () =>
    api
      .get<{ entries: Record<string, Entry[]>; tagCount: Record<string, number> }>('/api/entries')
      .then((d) => {
        setAll(d.entries)
        setTagCount(d.tagCount)
        setLoading(false)
      })
      .catch((e) => toast('error', e.message))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entries: Entry[] = (all[category] as Entry[]) || []
  const allTags = useMemo(() => Object.keys(tagCount).sort(), [tagCount])

  const filtered = useMemo(() => {
    let list = entries
    if (filterTag) list = list.filter((e) => (e.tags || []).includes(filterTag))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((e) =>
        JSON.stringify(e)
          .toLowerCase()
          .includes(q),
      )
    }
    return list
  }, [entries, filterTag, search])

  const save = async (entry: Entry) => {
    try {
      if (isNew || !entry.id) await api.post(`/api/entries/${category}`, entry)
      else await api.put(`/api/entries/${category}/${entry.id}`, entry)
      toast('success', '已保存')
      setEditing(null)
      load()
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!confirm(`确定删除「${name}」吗？`)) return
    try {
      await api.del(`/api/entries/${category}/${id}`)
      toast('success', '已删除')
      load()
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const titleOf = (e: Entry) =>
    category === 'work' ? (e.company as string) || (e.name as string) : (e.name as string) || '未命名'
  const subOf = (e: Entry) => {
    if (category === 'work') return `${e.position || ''} · ${e.startDate || ''} ~ ${e.endDate || '至今'}`
    if (category === 'education') return `${e.degree || ''} ${e.area || ''} · ${e.startDate || ''}`
    if (category === 'projects') return e.description as string
    if (category === 'skills') return e.level as string
    if (category === 'certificates') return e.issuer as string
    return ''
  }

  if (loading) return <Spinner label="加载信息…" />

  return (
    <div className="space-y-5">
      {/* 分类切换 */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setCategory(c.key)
              setFilterTag(null)
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
              category === c.key
                ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {c.icon}
            {c.label}
            <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
              {category === c.key ? filtered.length : all[c.key]?.length || 0}
            </span>
          </button>
        ))}
      </div>

      {/* 搜索与标签筛选 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`搜索${CATEGORIES.find((c) => c.key === category)?.label}…`} className="pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter size={14} className="text-zinc-600" />
          <button
            onClick={() => setFilterTag(null)}
            className={`rounded-full border px-2.5 py-1 text-xs ${!filterTag ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
          >
            全部
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setFilterTag(filterTag === t ? null : t)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                filterTag === t
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t} · {tagCount[t]}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => { setEditing(emptyEntry(category)); setIsNew(true) }}>
          <Plus size={15} /> 新增
        </Button>
      </div>

      {/* 条目列表 */}
      {category === 'basics' ? (
        <Card>
          <BasicsForm
            initial={all.basics || {}}
            onSave={async (b) => {
              try {
                await api.post('/api/entries/basics', b)
                toast('success', '已保存')
                load()
              } catch (e: any) {
                toast('error', e.message)
              }
            }}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filterTag ? `没有命中「${filterTag}」标签的条目` : '该分类暂无条目'}
          desc="点右上角「新增」创建第一条，记得打上方向标签。"
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map((e) => (
            <div key={e.id} className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition hover:border-zinc-700">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-zinc-100">{titleOf(e)}</h4>
                  {subOf(e) && <p className="mt-0.5 truncate text-xs text-zinc-500">{subOf(e)}</p>}
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-indigo-300" onClick={() => { setEditing({ ...e }); setIsNew(false) }}>
                    <Pencil size={14} />
                  </button>
                  <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400" onClick={() => remove(e.id!, titleOf(e))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {(e.tags || []).length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {(e.tags as string[]).map((t) => (
                    <button key={t} onClick={() => setFilterTag(t)} title="点击筛选">
                      <TagChip tag={t} />
                    </button>
                  ))}
                </div>
              )}
              {category === 'work' && (e.achievements as any[])?.length > 0 && (
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-zinc-800/70 pt-2 text-[11px] text-zinc-600">
                  <ListChecks size={12} />
                  {((e.achievements as any[]).length)} 条成就要点
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {editing && category !== 'basics' && (
        <EntryModal
          category={category}
          entry={editing}
          allTags={allTags}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

/* ---------- 基础信息表单（独立单条） ---------- */
function BasicsForm({ initial, onSave }: { initial: Entry; onSave: (e: Entry) => void }) {
  const [form, setForm] = useState<Entry>(() => ({ ...initial }))
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="姓名" required><Input value={(form.name as string) || ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="职位头衔"><Input value={(form.headline as string) || ''} onChange={(e) => set('headline', e.target.value)} /></Field>
        <Field label="电话"><Input value={(form.phone as string) || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="邮箱"><Input value={(form.email as string) || ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="个人主页"><Input value={(form.url as string) || ''} onChange={(e) => set('url', e.target.value)} /></Field>
      </div>
      <Field label="个人简介" hint="每行一条要点，自动转 markdown 列表">
        <Textarea
          value={Array.isArray(form.summary) ? (form.summary as string[]).join('\n') : (form.summary as string) || ''}
          onChange={(e) => set('summary', e.target.value.split('\n').filter(Boolean))}
        />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => onSave(form)}>保存基础信息</Button>
      </div>
    </div>
  )
}

/* ---------- 条目编辑弹窗 ---------- */
function EntryModal({
  category,
  entry,
  allTags,
  onClose,
  onSave,
}: {
  category: Category
  entry: Entry
  allTags: string[]
  onClose: () => void
  onSave: (e: Entry) => void
}) {
  const [form, setForm] = useState<Entry>(() => ({
    ...entry,
    tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
    keywords: Array.isArray(entry.keywords) ? [...(entry.keywords as string[])] : [],
  }))
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const renderField = (f: FieldDef) => {
    const value = form[f.key]
    switch (f.type) {
      case 'text':
        return <Input value={(value as string) || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.hint} />
      case 'textarea':
        return <Textarea value={(value as string) || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.hint} />
      case 'select':
        return (
          <Select value={(value as string) || ''} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">— 请选择 —</option>
            {(f.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        )
      case 'tags':
        return <TagInput value={(value as string[]) || []} onChange={(v) => set(f.key, v)} suggestions={allTags} />
      case 'summary':
        return (
          <Textarea
            value={Array.isArray(value) ? (value as string[]).join('\n') : (value as string) || ''}
            onChange={(e) => set(f.key, e.target.value.split('\n').filter(Boolean))}
            placeholder={f.hint}
          />
        )
      case 'achievements':
        return (
          <AchievementsEditor
            value={(value as any[]) || []}
            onChange={(v) => set(f.key, v)}
            allTags={allTags}
          />
        )
      default:
        return null
    }
  }

  const submit = () => {
    setSaving(true)
    setTimeout(() => {
      onSave(form)
      setSaving(false)
    }, 50)
  }

  return (
    <Modal open title={entry.id ? '编辑条目' : '新增条目'} onClose={onClose} wide>
      <div className="space-y-4">
        {FIELDS[category].map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {renderField(f)}
          </Field>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saving} onClick={submit}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- 成就要点编辑器 ---------- */
function AchievementsEditor({
  value,
  onChange,
  allTags,
}: {
  value: { text?: string; tags?: string[] }[]
  onChange: (v: { text?: string; tags?: string[] }[]) => void
  allTags: string[]
}) {
  return (
    <div className="space-y-2">
      {value.map((a, i) => (
        <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
          <div className="flex items-start gap-2">
            <Textarea
              className="min-h-[52px] flex-1"
              value={a.text || ''}
              onChange={(e) => {
                const next = [...value]
                next[i] = { ...next[i], text: e.target.value }
                onChange(next)
              }}
              placeholder="成就描述…"
            />
            <button
              className="mt-1 shrink-0 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
              onClick={() => onChange(value.filter((_, x) => x !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="mt-1.5">
            <TagInput
              value={a.tags || []}
              onChange={(v) => {
                const next = [...value]
                next[i] = { ...next[i], tags: v }
                onChange(next)
              }}
              suggestions={allTags}
              placeholder="+ 该成就的标签（无标签=通用）"
            />
          </div>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange([...value, { text: '', tags: [] }])}
        className="w-full border border-dashed border-zinc-700"
      >
        <Plus size={14} /> 添加成就要点
      </Button>
    </div>
  )
}
