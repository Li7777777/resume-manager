// 通用 UI 组件库（Tailwind 深色主题）
import React, { useEffect, useMemo, useState } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'

/* ---------- 按钮 ---------- */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  const styles: Record<string, string> = {
    primary:
      'bg-indigo-500 text-white hover:bg-indigo-400 disabled:bg-indigo-500/40 shadow-lg shadow-indigo-500/20',
    secondary:
      'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700/60',
    ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70',
    danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30',
    success: 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400',
  }
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1.5 text-xs rounded-lg gap-1.5',
    md: 'px-3.5 py-2 text-sm rounded-lg gap-2',
  }
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${sizes[size]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

/* ---------- 卡片 ---------- */
export function Card({
  title,
  desc,
  actions,
  children,
  className = '',
  pad = true,
  fill = false,
}: {
  title?: React.ReactNode
  desc?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  pad?: boolean
  /** 撑满父容器高度：外部 flex-col + 内容区 flex-1（用于全高布局） */
  fill?: boolean
}) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/50 ${fill ? 'flex flex-col' : ''} ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>}
            {desc && <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`min-h-0 ${fill ? 'flex flex-1 flex-col' : ''} ${pad ? 'p-4' : ''}`}>{children}</div>
    </div>
  )
}

/* ---------- 表单 ---------- */
export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-zinc-400">
        <span>{label}{required && <span className="ml-0.5 text-red-400">*</span>}</span>
        {hint && <span className="text-[11px] text-zinc-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-700/70 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className || ''}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} min-h-[90px] resize-y ${props.className || ''}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputCls} appearance-none ${props.className || ''}`}>
      {props.children}
    </select>
  )
}

/* ---------- 弹窗 ---------- */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} overflow-y-auto rounded-xl border border-zinc-700/60 bg-zinc-900 shadow-2xl shadow-black/60`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-5 py-3.5 backdrop-blur">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <button className="text-zinc-500 hover:text-zinc-200" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/* ---------- 标签 ---------- */
const TAG_COLORS = [
  'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  'bg-teal-500/15 text-teal-300 border-teal-500/30',
  'bg-rose-500/15 text-rose-300 border-rose-500/30',
]

export function tagColor(tag: string) {
  let h = 0
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) | 0
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tagColor(tag)}`}
    >
      {tag}
      {onRemove && (
        <button className="opacity-60 hover:opacity-100" onClick={onRemove}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
}: {
  value: string[]
  onChange: (v: string[]) => void
  suggestions?: string[]
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const add = (t: string) => {
    const tag = t.trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }
  const filtered = useMemo(
    () => suggestions.filter((s) => !value.includes(s) && s.includes(draft.trim())),
    [suggestions, value, draft],
  )
  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-900 px-2.5 py-1.5 focus-within:border-indigo-500">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <TagChip key={t} tag={t} onRemove={() => onChange(value.filter((x) => x !== t))} />
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={placeholder || '+ 添加标签'}
          className="min-w-[90px] flex-1 bg-transparent py-1 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
        />
      </div>
      {filtered.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 border-t border-zinc-800 pt-1.5">
          {filtered.map((s) => (
            <button
              key={s}
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-indigo-400 hover:text-indigo-300"
            >
              <Plus size={10} className="mr-0.5 inline" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- 状态徽章 ---------- */
export function Badge({
  tone,
  children,
}: {
  tone: 'emerald' | 'amber' | 'red' | 'sky' | 'zinc' | 'indigo'
  children: React.ReactNode
}) {
  const map = {
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    red: 'bg-red-500/15 text-red-300 border-red-500/30',
    sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    zinc: 'bg-zinc-700/30 text-zinc-400 border-zinc-600/40',
    indigo: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  )
}

/* ---------- 开关 ---------- */
export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-indigo-500' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

/* ---------- 空状态 / 加载 ---------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
      <Loader2 size={16} className="animate-spin" />
      {label || '加载中…'}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon?: React.ReactNode
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 py-12 text-center">
      {icon && <div className="text-zinc-600">{icon}</div>}
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      {desc && <p className="max-w-sm text-xs text-zinc-600">{desc}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* ---------- 相对时间 ---------- */
export function relativeTime(ts: number) {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}
