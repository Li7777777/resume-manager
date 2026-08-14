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
  Settings2,
  Tags,
  ArrowUp,
  ArrowDown,
  EyeOff,
  PlusCircle,
} from 'lucide-react'
import { api } from '../api'
import type { Category, Entry } from '../types'
import { useToast } from '../toast'
import { Card, Button, Modal, Field, Input, Textarea, Select, TagChip, TagInput, EmptyState, Spinner } from '../components/ui'

// 学位与技能等级：显示中文、存储 YAMLResume schema 英文枚举（翻译会导致简历校验失败）
const DEGREES = ['Middle School', 'High School', 'Diploma', 'Associate', 'Bachelor', 'Master', 'Doctor']
const DEGREE_LABELS: Record<string, string> = {
  'Middle School': '初中',
  'High School': '高中',
  Diploma: '专科',
  Associate: '副学士',
  Bachelor: '学士',
  Master: '硕士',
  Doctor: '博士',
}
// 熟练度两级：存储用 yamlresume schema 合法枚举（Expert=熟练 / Master=掌握），界面只显示中文两级
const LEVELS = ['Expert', 'Master']
const LEVEL_LABELS: Record<string, string> = {
  Expert: '熟练',
  Master: '掌握',
  // 旧 6 级兼容显示：统一归入新 2 级
  Novice: '熟练',
  Beginner: '熟练',
  Intermediate: '熟练',
  Advanced: '熟练',
}

// 自定义分类的通用字段（新增分类使用）
const GENERIC_FIELDS: FieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true },
  { key: 'description', label: '简介', type: 'text' },
  { key: 'summary', label: '要点', type: 'summary', hint: '每行一条要点，自动转为 markdown 列表' },
  { key: 'keywords', label: '关键词', type: 'tags' },
  { key: 'tags', label: '方向标签', type: 'tags', hint: '元数据，用于筛选（不进入简历）' },
  { key: 'notes', label: '备注', type: 'textarea', hint: '仅自己可见' },
]

const DEFAULT_CATEGORIES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'basics', label: '基础信息', icon: <UserRound size={14} /> },
  { key: 'work', label: '工作经历', icon: <Briefcase size={14} /> },
  { key: 'education', label: '教育背景', icon: <GraduationCap size={14} /> },
  { key: 'projects', label: '项目经历', icon: <FolderKanban size={14} /> },
  { key: 'skills', label: '专业技能', icon: <Wrench size={14} /> },
  { key: 'certificates', label: '证书资质', icon: <Award size={14} /> },
  { key: 'interests', label: '兴趣爱好', icon: <Heart size={14} /> },
]

const CAT_ICONS: Record<string, React.ReactNode> = {
  basics: <UserRound size={14} />,
  work: <Briefcase size={14} />,
  education: <GraduationCap size={14} />,
  projects: <FolderKanban size={14} />,
  skills: <Wrench size={14} />,
  certificates: <Award size={14} />,
  interests: <Heart size={14} />,
}

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
    { key: 'keywords', label: '细分标签', type: 'tags', hint: '展示用，不参与筛选（对应简历中的关键词）' },
    { key: 'achievements', label: '成就要点', type: 'achievements', hint: '每条可打标签，无标签 = 通用（所有方向保留）' },
    { key: 'tags', label: '方向标签', type: 'tags', hint: '元数据，用于筛选（不进入简历）' },
    { key: 'notes', label: '备注', type: 'textarea', hint: '仅自己可见' },
  ],
  education: [
    { key: 'institution', label: '学校', type: 'text', required: true },
    { key: 'degree', label: '学位', type: 'select', options: DEGREES },
    { key: 'area', label: '专业', type: 'text' },
    { key: 'score', label: '成绩', type: 'text' },
    { key: 'startDate', label: '开始时间', type: 'text' },
    { key: 'endDate', label: '结束时间', type: 'text' },
    { key: 'url', label: '学校主页', type: 'text' },
    { key: 'summary', label: '描述', type: 'summary' },
    { key: 'keywords', label: '细分标签', type: 'tags' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  projects: [
    { key: 'name', label: '项目名称', type: 'text', required: true },
    { key: 'subtitle', label: '副标题', type: 'text', hint: '如赛事 / 机构 / 来源' },
    { key: 'description', label: '一句话简介', type: 'text' },
    { key: 'stage', label: '阶段', type: 'select', options: ['本科', '硕士'] },
    { key: 'url', label: '链接', type: 'text' },
    { key: 'startDate', label: '开始时间', type: 'text' },
    { key: 'endDate', label: '结束时间', type: 'text' },
    { key: 'keywords', label: '细分标签', type: 'tags', hint: '技术栈/技术点' },
    { key: 'summary', label: '项目要点', type: 'summary' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  skills: [
    { key: 'name', label: '技能名称', type: 'text', required: true },
    { key: 'level', label: '熟练度', type: 'select', options: LEVELS },
    { key: 'keywords', label: '细分标签', type: 'tags' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  certificates: [
    { key: 'name', label: '证书名称', type: 'text', required: true },
    { key: 'issuer', label: '颁发机构', type: 'text' },
    { key: 'date', label: '获取时间', type: 'text' },
    { key: 'url', label: '验证链接', type: 'text' },
    { key: 'keywords', label: '细分标签', type: 'tags' },
    { key: 'tags', label: '方向标签', type: 'tags' },
  ],
  interests: [
    { key: 'name', label: '兴趣名称', type: 'text', required: true },
    { key: 'keywords', label: '细分标签', type: 'tags' },
  ],
}

function emptyEntry(cat: string): Entry {
  const e: Entry = { tags: [] }
  if (cat === 'work') e.achievements = []
  if (cat === 'basics') e.summary = []
  return e
}

export default function Entries() {
  const toast = useToast()
  const [categories, setCategories] = useState<{ key: string; label: string; visible: boolean }[]>(DEFAULT_CATEGORIES.map((c) => ({ key: c.key, label: c.label, visible: true })))
  const [category, setCategory] = useState<string>('work')
  const [all, setAll] = useState<Record<string, any>>({})
  const [tagCount, setTagCount] = useState<Record<string, number>>({})
  const [library, setLibrary] = useState<string[]>([])
  const [subTags, setSubTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Entry | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [tagManageOpen, setTagManageOpen] = useState(false)

  const load = () =>
    api
      .get<{ entries: Record<string, Entry[]>; tagCount: Record<string, number>; categories: { key: string; label: string; visible: boolean }[]; library?: string[]; subLibrary?: string[] }>('/api/entries')
      .then((d) => {
        setAll(d.entries)
        setTagCount(d.tagCount)
        if (Array.isArray(d.library)) setLibrary(d.library)
        if (Array.isArray(d.subLibrary)) setSubTags(d.subLibrary)
        if (d.categories?.length) setCategories(d.categories)
        setLoading(false)
      })
      .catch((e) => toast('error', e.message))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entries: Entry[] = (all[category] as Entry[]) || []
  const allTags = useMemo(() => Array.from(new Set([...Object.keys(tagCount), ...library])).sort(), [tagCount, library])

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
    category === 'work'
      ? (e.company as string) || (e.name as string)
      : category === 'education'
        ? (e.institution as string) || (e.name as string)
        : category === 'projects'
          ? (e.name as string) || (e.subtitle as string) || '未命名'
          : (e.name as string) || '未命名'
  const subOf = (e: Entry) => {
    if (category === 'work') return `${e.position || ''} · ${e.startDate || ''} ~ ${e.endDate || '至今'}`
    if (category === 'education') return `${DEGREE_LABELS[(e.degree as string) || ''] || (e.degree as string) || ''} ${e.area || ''} · ${e.startDate || ''}`
    if (category === 'projects') {
      const parts: string[] = []
      if (e.startDate) parts.push(String(e.startDate))
      if (e.stage) parts.push(String(e.stage))
      if (e.description) parts.push(String(e.description))
      return parts.join(' · ')
    }
    if (category === 'skills') return (LEVEL_LABELS[(e.level as string) || ''] || (e.level as string) || '') as string
    if (category === 'certificates') return e.issuer as string
    return ''
  }

  if (loading) return <Spinner label="加载信息…" />

  return (
    <div className="space-y-5">
      {/* 分类切换（动态 tab，可管理增删改排序） */}
      <div className="flex flex-wrap items-center gap-2">
        {categories
          .filter((c) => c.visible !== false)
          .map((c) => (
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
              {CAT_ICONS[c.key] || <FolderKanban size={14} />}
              {c.label}
              <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
                {category === c.key ? filtered.length : all[c.key]?.length || 0}
              </span>
            </button>
          ))}
        <button
          onClick={() => setManageOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:border-indigo-400 hover:text-indigo-300"
          title="管理分类：新增/改名/排序/删除"
        >
          <Settings2 size={13} /> 管理分类
        </button>
      </div>

      {/* 搜索与标签筛选 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`搜索${categories.find((c) => c.key === category)?.label || ''}…`} className="pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter size={14} className="text-zinc-600" />
          <button
            onClick={() => setFilterTag(null)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              !filterTag
                ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-100'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            全部
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setFilterTag(filterTag === t ? null : t)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                filterTag === t
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-100'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t} · {tagCount[t] || 0}
            </button>
          ))}
          <button
            onClick={() => setTagManageOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:border-indigo-400 hover:text-indigo-300"
            title="管理标签：新增/重命名/删除（作用于全部条目）"
          >
            <Tags size={13} /> 管理标签
          </button>
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
              {((e.keywords as string[]) || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {(e.keywords as string[]).map((k) => (
                    <span key={k} className="rounded-full border border-dashed border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500">
                      {k}
                    </span>
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
          subTags={subTags}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      {/* 分类管理弹窗（增/删/改名/排序/显隐） */}
      <CategoryManagerModal
        open={manageOpen}
        categories={categories}
        current={category}
        onClose={() => setManageOpen(false)}
        onSaved={(cats) => {
          setCategories(cats)
          setCategory((c) => (cats.some((x) => x.key === c && x.visible !== false) ? c : (cats.find((x) => x.visible !== false)?.key || 'work')))
        }}
      />

      {/* 标签管理弹窗（新增/重命名/删除，作用于全部条目） */}
      <TagManagerModal
        open={tagManageOpen}
        onClose={() => setTagManageOpen(false)}
        onChanged={() => load()}
      />
    </div>
  )
}

/* ---------- 标签管理弹窗 ---------- */
interface TagItem {
  name: string
  count: number
  inLibrary: boolean
}

function TagManagerModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [tab, setTab] = useState<'dir' | 'sub'>('dir')
  const [dirTags, setDirTags] = useState<TagItem[]>([])
  const [subTags, setSubTags] = useState<TagItem[]>([])
  const [newTag, setNewTag] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const load = () =>
    api
      .get<{ tags: TagItem[]; subLibrary?: string[]; subTagCount?: Record<string, number> }>('/api/tags')
      .then((d) => {
        setDirTags(d.tags)
        setSubTags((d.subLibrary || []).map((name) => ({ name, count: d.subTagCount?.[name] || 0, inLibrary: true })))
      })
      .catch((e) => toast('error', e.message))

  const list = tab === 'dir' ? dirTags : subTags

  // 新增标签：方向写入 library、细分写入 sublibrary（条目编辑建议即包含）
  const addTag = async () => {
    const t = newTag.trim()
    if (!t) return
    setBusy(true)
    try {
      const cur = list.map((x) => x.name)
      if (cur.includes(t)) return toast('warn', '标签已存在')
      await api.put(tab === 'dir' ? '/api/tags/library' : '/api/tags/sublibrary', { tags: [...cur, t] })
      toast('success', `已新增${tab === 'dir' ? '方向' : '细分'}标签「${t}」`)
      setNewTag('')
      await load()
      onChanged()
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setBusy(false)
    }
  }

  // 重命名标签：方向同步条目 tags、细分同步条目 keywords
  const renameTag = async (from: string) => {
    const to = window.prompt(`将标签「${from}」重命名为：`, from)
    if (!to || to.trim() === from) return
    setBusy(true)
    try {
      const r = await api.post<{ affected: number }>(tab === 'dir' ? '/api/tags/rename' : '/api/tags/sub-rename', { from, to: to.trim() })
      toast('success', `已重命名，影响 ${r.affected} 个条目`)
      await load()
      onChanged()
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setBusy(false)
    }
  }

  // 删除标签：所有条目移除（方向 tags / 细分 keywords）
  const deleteTag = async (t: string) => {
    if (!confirm(`确定删除标签「${t}」吗？将从所有条目中移除。`)) return
    setBusy(true)
    try {
      const r = await api.post<{ affected: number }>(tab === 'dir' ? '/api/tags/delete' : '/api/tags/sub-delete', { tag: t })
      toast('success', `已删除，影响 ${r.affected} 个条目`)
      await load()
      onChanged()
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="管理标签" onClose={onClose} wide>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        标签库保存在私有仓 <code className="text-zinc-400">tags.yml</code>，随 Git 版本化。两类标签：
        <b className="text-zinc-300">方向标签</b>参与组稿筛选；<b className="text-zinc-300">细分标签</b>对应条目关键词（展示用）。
      </p>
      <div className="mb-3 flex gap-1.5">
        <button
          onClick={() => setTab('dir')}
          className={`rounded-md px-3 py-1.5 text-xs transition ${tab === 'dir' ? 'bg-indigo-500/15 text-indigo-100' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
        >
          方向标签
        </button>
        <button
          onClick={() => setTab('sub')}
          className={`rounded-md px-3 py-1.5 text-xs transition ${tab === 'sub' ? 'bg-indigo-500/15 text-indigo-100' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
        >
          细分标签
        </button>
      </div>
      <div className="flex gap-2">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder={tab === 'dir' ? '新增方向标签（如：general）' : '新增细分标签（如：TypeScript）'}
          className="flex-1 !py-1.5 text-xs"
        />
        <Button size="sm" variant="secondary" loading={busy} disabled={!newTag.trim()} onClick={addTag}>
          <Plus size={13} /> 新增
        </Button>
      </div>
      <div className="mt-3 space-y-1.5">
        {list.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-600">暂无{tab === 'dir' ? '方向' : '细分'}标签</p>
        ) : (
          list.map((t) => (
            <div key={t.name} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <TagChip tag={t.name} />
              <span className="text-[11px] text-zinc-600">{t.count} 个条目{t.inLibrary ? ' · 标签库' : ''}</span>
              <div className="ml-auto flex gap-1">
                <button className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => renameTag(t.name)} title="重命名">
                  <Pencil size={13} />
                </button>
                <button className="rounded p-1 text-zinc-600 hover:bg-red-500/20 hover:text-red-400" onClick={() => deleteTag(t.name)} title="删除">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  )
}

/* ---------- 分类管理弹窗 ---------- */
function CategoryManagerModal({
  open,
  categories,
  current,
  onClose,
  onSaved,
}: {
  open: boolean
  categories: { key: string; label: string; visible: boolean }[]
  current: string
  onClose: () => void
  onSaved: (cats: { key: string; label: string; visible: boolean }[]) => void
}) {
  const toast = useToast()
  const [list, setList] = useState<{ key: string; label: string; visible: boolean }[]>([])
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setList(categories.map((c) => ({ ...c })))
  }, [open, categories])

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setList(next)
  }

  const save = async () => {
    if (list.length === 0) return toast('warn', '至少保留一个分类')
    setSaving(true)
    try {
      await api.put('/api/categories', { categories: list })
      toast('success', '分类已保存')
      onSaved(list)
      onClose()
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="管理分类" onClose={onClose} wide>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        分类名称、排序和显隐随私有仓 <code className="text-zinc-400">categories.yml</code> 版本化；新增分类会在私有仓创建对应的 <code className="text-zinc-400">data/*.yml</code>，删除分类会同时删除其简历数据。
      </p>
      <div className="space-y-1.5">
        {list.map((c, i) => (
          <div key={c.key} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
            <span className="font-mono text-[11px] text-zinc-600">{c.key}</span>
            <Input
              value={c.label}
              onChange={(e) => setList(list.map((x) => (x === c ? { ...x, label: e.target.value } : x)))}
              className="flex-1 !py-1.5 text-xs"
            />
            <button
              className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={() => setList(list.map((x) => (x === c ? { ...x, visible: !x.visible } : x)))}
              title={c.visible ? '隐藏（不删除数据）' : '显示'}
            >
              {c.visible ? <EyeOff size={13} /> : <EyeOff size={13} className="text-zinc-400" />}
            </button>
            <button className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(i, -1)} disabled={i === 0}>
              <ArrowUp size={13} />
            </button>
            <button className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
              <ArrowDown size={13} />
            </button>
            <button
              className="rounded p-1 text-zinc-600 hover:bg-red-500/20 hover:text-red-400"
              onClick={() => {
                if (c.key === current && list.length > 1) toast('warn', '当前分类删除后会自动切换')
                setList(list.filter((x) => x !== c))
              }}
              title="删除（同时删除 data 文件）"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {/* 新增分类 */}
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 p-3">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          placeholder="分类标识（英文小写，如 awards）"
          className="w-44 !py-1.5 font-mono text-xs"
        />
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="中文名称，如：荣誉奖项"
          className="flex-1 !py-1.5 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!/^[a-z][a-z0-9_-]*$/.test(newKey) || !newLabel.trim()}
          onClick={() => {
            if (list.some((x) => x.key === newKey)) return toast('warn', '该分类标识已存在')
            setList([...list, { key: newKey, label: newLabel.trim(), visible: true }])
            setNewKey('')
            setNewLabel('')
          }}
        >
          <PlusCircle size={13} /> 添加
        </Button>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" loading={saving} onClick={save}>保存分类</Button>
      </div>
    </Modal>
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
  subTags,
  onClose,
  onSave,
}: {
  category: string
  entry: Entry
  allTags: string[]
  subTags: string[]
  onClose: () => void
  onSave: (e: Entry) => void
}) {
  const [form, setForm] = useState<Entry>(() => ({
    ...entry,
    tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
    keywords: Array.isArray(entry.keywords) ? [...(entry.keywords as string[])] : [],
  }))
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  // 学位/等级：显示中文，存储 schema 英文枚举
  const optionLabel = (f: FieldDef, o: string) => {
    if (f.key === 'degree') return DEGREE_LABELS[o] || o
    if (f.key === 'level') return LEVEL_LABELS[o] || o
    return o
  }

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
              <option key={o} value={o}>{optionLabel(f, o)}</option>
            ))}
          </Select>
        )
      case 'tags':
        return (
          <TagInput
            value={(value as string[]) || []}
            onChange={(v) => set(f.key, v)}
            suggestions={f.key === 'keywords' ? subTags : allTags}
          />
        )
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
    // 必填字段校验（防止空条目误保存）
    const fields = FIELDS[category as Category] || GENERIC_FIELDS
    for (const f of fields) {
      if (f.required) {
        const v = form[f.key]
        if (!v || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim())) {
          toast('warn', `「${f.label}」为必填项`)
          return
        }
      }
    }
    setSaving(true)
    setTimeout(() => {
      onSave(form)
      setSaving(false)
    }, 50)
  }

  return (
    <Modal open title={entry.id ? '编辑条目' : '新增条目'} onClose={onClose} wide>
      <div className="space-y-4">
        {(FIELDS[category as Category] || GENERIC_FIELDS).map((f) => (
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
