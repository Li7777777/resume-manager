// 简历方向页：可视化编辑 variants.yml 配方（按标签动态组稿）
import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Eye } from 'lucide-react'
import { api } from '../api'
import type { Variant } from '../types'
import { useToast } from '../toast'
import { Card, Button, Modal, Field, Input, Textarea, Select, TagInput, Badge, Spinner, EmptyState } from '../components/ui'

const TEMPLATES = ['moderncv-banking', 'moderncv-casual', 'jake']
const LANGUAGES = ['zh-hans', 'zh-hant-hk', 'zh-hant-tw', 'en', 'ja', 'de', 'fr', 'es', 'pt-br']
const BLOCKS: { key: string; label: string }[] = [
  { key: 'basics', label: '基础信息' },
  { key: 'education', label: '教育背景' },
  { key: 'work', label: '工作经历' },
  { key: 'projects', label: '项目经历' },
  { key: 'skills', label: '专业技能' },
  { key: 'certificates', label: '证书资质' },
  { key: 'interests', label: '兴趣爱好' },
]

interface Doc {
  defaults: Record<string, any>
  variants: Record<string, Variant>
}

export default function Variants() {
  const toast = useToast()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])
  const [editing, setEditing] = useState<Variant | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = () =>
    Promise.all([
      api.get<{ variants: Variant[]; defaults: Record<string, any> }>('/api/variants'),
      api.get<{ tagCount: Record<string, number> }>('/api/entries'),
    ])
      .then(([v, e]) => {
        const variants: Record<string, Variant> = {}
        v.variants.forEach((x) => {
          variants[x.name] = x
        })
        setDoc({ defaults: v.defaults, variants })
        setAllTags(Object.keys(e.tagCount).sort())
      })
      .catch((err) => toast('error', err.message))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveDoc = async (next: Doc) => {
    try {
      await api.put('/api/variants', next)
      setDoc(next)
      toast('success', '配方已保存')
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const remove = async (name: string) => {
    if (!confirm(`确定删除方向「${name}」吗？`)) return
    const next = { ...doc!, variants: { ...doc!.variants } }
    delete next.variants[name]
    await saveDoc(next)
  }

  if (!doc) return <Spinner label="加载方向…" />

  const variants = Object.values(doc.variants)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          每个方向 = 一套"筛选标签 + 模板 + 章节顺序"配方，从<code className="text-indigo-300">data/</code> 信息全集动态组稿，无需把一份简历拆成多个 YAML。
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setEditing({ name: '', label: '', blocks: { basics: { include: 'true' } }, sectionOrder: ['skills', 'work', 'projects', 'education'] })
            setIsNew(true)
          }}
        >
          <Plus size={15} /> 新增方向
        </Button>
      </div>

      {variants.length === 0 ? (
        <EmptyState title="还没有简历方向" desc="新增一个方向，选择标签与模板，即可动态生成一份简历。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {variants.map((v) => (
            <Card
              key={v.name}
              title={<span className="font-mono">{v.name}</span>}
              desc={v.label}
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing({ ...v }); setIsNew(false) }}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => remove(v.name)}>
                    <Trash2 size={13} />
                  </Button>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone="zinc">{v.locale || doc.defaults.locale || 'zh-hans'}</Badge>
                <Badge tone="zinc">{v.layout?.template || doc.defaults.layout?.template || '—'}</Badge>
                {Object.entries(v.matched || {}).map(([block, n]) => (
                  <Badge key={block} tone="sky">
                    {BLOCKS.find((b) => b.key === block)?.label || block}: {n} 条
                  </Badge>
                ))}
              </div>
              {v.sectionOrder && v.sectionOrder.length > 0 && (
                <p className="mt-3 text-xs text-zinc-600">
                  章节顺序：{v.sectionOrder.map((s) => BLOCKS.find((b) => b.key === s)?.label || s).join(' → ')}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <VariantModal
          variant={editing}
          isNew={isNew}
          allTags={allTags}
          defaults={doc.defaults}
          onClose={() => setEditing(null)}
          onSave={async (name, v) => {
            const next = { ...doc, variants: { ...doc.variants } }
            if (isNew) {
              if (!name.trim()) return toast('error', '方向名称不能为空')
              if (next.variants[name]) return toast('error', `方向 ${name} 已存在`)
            } else {
              delete next.variants[editing.name]
            }
            next.variants[name] = v
            await saveDoc(next)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/* ---------- 方向编辑弹窗 ---------- */
function VariantModal({
  variant,
  isNew,
  allTags,
  defaults,
  onClose,
  onSave,
}: {
  variant: Variant
  isNew: boolean
  allTags: string[]
  defaults: Record<string, any>
  onClose: () => void
  onSave: (name: string, v: Variant) => void
}) {
  const [name, setName] = useState(variant.name || '')
  const [form, setForm] = useState<Variant>(() => ({
    ...variant,
    blocks: variant.blocks ? JSON.parse(JSON.stringify(variant.blocks)) : {},
    overrides: variant.overrides ? JSON.parse(JSON.stringify(variant.overrides)) : {},
    sectionOrder: variant.sectionOrder ? [...variant.sectionOrder] : [],
  }))

  const set = (patch: Partial<Variant>) => setForm((f) => ({ ...f, ...patch }))

  const setBlock = (key: string, patch: Record<string, unknown>) => {
    setForm((f) => ({
      ...f,
      blocks: { ...f.blocks, [key]: { ...(f.blocks?.[key] || {}), ...patch } },
    }))
  }

  const blockMode = (key: string) => {
    const b = form.blocks?.[key]
    if (!b) return 'none'
    if (b.include === 'all') return 'all'
    if (b.ids?.length) return 'ids'
    return 'tags'
  }

  const setBlockMode = (key: string, mode: string) => {
    if (mode === 'none') {
      const next = { ...form.blocks }
      delete next[key]
      setForm((f) => ({ ...f, blocks: next }))
    } else if (mode === 'all') {
      setBlock(key, { include: 'all' })
      delete (form.blocks?.[key] as any)?.tags
      delete (form.blocks?.[key] as any)?.ids
    } else if (mode === 'tags') {
      setBlock(key, { tags: [] })
      delete (form.blocks?.[key] as any)?.include
      delete (form.blocks?.[key] as any)?.ids
    } else if (mode === 'ids') {
      setBlock(key, { ids: [] })
      delete (form.blocks?.[key] as any)?.include
      delete (form.blocks?.[key] as any)?.tags
    }
  }

  const moveOrder = (idx: number, dir: -1 | 1) => {
    const order = [...(form.sectionOrder || [])]
    const j = idx + dir
    if (j < 0 || j >= order.length) return
    ;[order[idx], order[j]] = [order[j], order[idx]]
    set({ sectionOrder: order })
  }

  const summaryText =
    Array.isArray(form.overrides?.basics?.summary) ? form.overrides!.basics!.summary!.join('\n') : form.overrides?.basics?.summary || ''

  const matchedPreview = useMemo<{ block: string; cfg: any }[]>(() => {
    if (!form.blocks) return []
    return Object.entries(form.blocks)
      .filter(([k]) => k !== 'basics')
      .map(([k]) => ({ block: k, cfg: form.blocks![k] }))
  }, [form.blocks])

  return (
    <Modal open title={isNew ? '新增简历方向' : `编辑方向：${variant.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="方向标识" hint="文件名，如 frontend（字母数字）">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isNew} className="font-mono" />
          </Field>
          <Field label="展示名称" hint="如：前端工程师方向">
            <Input value={form.label || ''} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <Field label="语言">
            <Select value={form.locale || defaults.locale || 'zh-hans'} onChange={(e) => set({ locale: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="LaTeX 模板">
            <Select
              value={form.layout?.template || defaults.layout?.template || 'moderncv-banking'}
              onChange={(e) => set({ layout: { ...(form.layout || {}), template: e.target.value } })}
            >
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* 章节顺序 */}
        <Field label="章节顺序" hint="排在前面的优先显示，未列出的按默认顺序排在后面">
          <div className="flex flex-wrap gap-2">
            {(form.sectionOrder || []).map((s, i) => (
              <div key={s} className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300">
                {BLOCKS.find((b) => b.key === s)?.label || s}
                <button className="text-zinc-600 hover:text-zinc-300" onClick={() => moveOrder(i, -1)}><ArrowUp size={12} /></button>
                <button className="text-zinc-600 hover:text-zinc-300" onClick={() => moveOrder(i, 1)}><ArrowDown size={12} /></button>
              </div>
            ))}
          </div>
        </Field>

        {/* 章节内容筛选 */}
        <Field label="章节内容（按标签筛选信息全集）">
          <div className="space-y-2">
            {BLOCKS.map((b) => {
              const mode = blockMode(b.key)
              return (
                <div key={b.key} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-20 text-xs font-medium text-zinc-400">{b.label}</span>
                    {['none', 'all', 'tags', 'ids'].map((m) => (
                      <button
                        key={m}
                        onClick={() => setBlockMode(b.key, m)}
                        className={`rounded-md px-2 py-1 text-[11px] transition ${
                          mode === m ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {m === 'none' ? '不包含' : m === 'all' ? '全部' : m === 'tags' ? '按标签' : '指定 ID'}
                      </button>
                    ))}
                  </div>
                  {mode === 'tags' && (
                    <div className="mt-2 pl-20">
                      <TagInput
                        value={(form.blocks?.[b.key]?.tags as string[]) || []}
                        onChange={(v) => setBlock(b.key, { tags: v })}
                        suggestions={allTags}
                        placeholder="+ 命中任一标签即入选"
                      />
                    </div>
                  )}
                  {mode === 'ids' && (
                    <div className="mt-2 pl-20">
                      <Input
                        value={(form.blocks?.[b.key]?.ids as string[])?.join(', ') || ''}
                        onChange={(e) =>
                          setBlock(b.key, { ids: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                        }
                        placeholder="条目 id，逗号分隔"
                        className="font-mono"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Field>

        {/* 基础信息覆盖 */}
        <Field label="基础信息覆盖（针对该方向）" hint="留空则使用 data/basics.yml">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={form.overrides?.basics?.headline || ''}
              onChange={(e) => set({ overrides: { basics: { ...(form.overrides?.basics || {}), headline: e.target.value } } })}
              placeholder="职位头衔，如：前端技术负责人"
            />
          </div>
          <div className="mt-2">
            <Textarea
              value={summaryText}
              onChange={(e) =>
                set({
                  overrides: {
                    basics: {
                      ...(form.overrides?.basics || {}),
                      summary: e.target.value.split('\n').filter(Boolean),
                    },
                  },
                })
              }
              placeholder="针对该方向的个人简介（每行一条）"
              className="min-h-[70px]"
            />
          </div>
        </Field>

        {matchedPreview.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Eye size={12} />
            保存后可在「PDF 预览」页构建；组合结果由服务端按相同规则自动计算。
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onSave(name, form)}>保存配方</Button>
        </div>
      </div>
    </Modal>
  )
}
