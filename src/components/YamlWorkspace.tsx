// 简历定制页内的 YAML 工作区：保存后由父页面重建并刷新预览。
import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileCode2, RotateCcw, Save } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Button, Card, EmptyState, Spinner } from './ui'
import { YamlEditor } from './YamlEditor'

interface FileItem {
  path: string
  label: string
  exists: boolean
}

export default function YamlWorkspace({
  disabled,
  canPreview,
  revision,
  onDirtyChange,
  onSaved,
}: {
  disabled?: boolean
  canPreview: boolean
  revision: number
  onDirtyChange: (dirty: boolean) => void
  onSaved: (path: string) => Promise<void>
}) {
  const toast = useToast()
  const [files, setFiles] = useState<FileItem[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const currentRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)

  const setDirtyState = (next: boolean) => {
    dirtyRef.current = next
    setDirty(next)
    onDirtyChange(next)
  }

  const loadFile = async (file: string) => {
    setLoading(true)
    try {
      const result = await api.get<{ content: string }>(`/api/yaml?path=${encodeURIComponent(file)}`)
      currentRef.current = file
      setCurrent(file)
      setContent(result.content)
      setSavedContent(result.content)
      setDirtyState(false)
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setLoading(false)
    }
  }

  const chooseFile = async (file: string) => {
    if (file === currentRef.current) return
    if (dirtyRef.current && !window.confirm('当前 YAML 尚未保存，确定放弃修改并切换文件吗？')) return
    await loadFile(file)
  }

  useEffect(() => {
    let active = true
    api
      .get<{ files: FileItem[] }>('/api/files')
      .then(async (result) => {
        if (!active) return
        setFiles(result.files)
        const preferred = currentRef.current || result.files.find((file) => file.path === 'scripts/variants.yml' && file.exists)?.path || result.files.find((file) => file.exists)?.path
        if (preferred && !dirtyRef.current) await loadFile(preferred)
        else setLoading(false)
      })
      .catch((err) => {
        if (active) {
          toast('error', err.message)
          setLoading(false)
        }
      })
    return () => { active = false }
    // revision 由可视化保存触发，用于反向刷新 variants.yml。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const save = async () => {
    if (!current) return
    setSaving(true)
    try {
      await api.put('/api/yaml', { path: current, content })
      setSavedContent(content)
      setDirtyState(false)
      toast('success', 'YAML 已保存')
      await onSaved(current)
    } catch (err: any) {
      toast('error', `保存失败：${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setContent(savedContent)
    setDirtyState(false)
  }

  return (
    <div className="flex min-h-[520px] min-w-0 flex-col gap-3 md:flex-row xl:h-full xl:min-h-0">
      <div className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-y-auto md:pb-0">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            disabled={!file.exists}
            onClick={() => chooseFile(file.path)}
            className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left transition md:w-full ${
              current === file.path
                ? 'bg-indigo-500/15 text-indigo-200'
                : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <FileCode2 size={14} className="shrink-0" />
            <span className="min-w-0">
              <span className="block truncate font-mono text-[11px]">{file.path}</span>
              <span className="block truncate text-[10px] text-zinc-600">{file.label}</span>
            </span>
          </button>
        ))}
      </div>

      <Card
        title={current ? <span className="font-mono text-xs">{current}</span> : 'YAML 源码'}
        desc={dirty ? '有未保存修改' : '已与磁盘同步'}
        className="min-h-0 min-w-0 flex-1"
        pad={false}
        fill
        actions={
          <div className="flex items-center gap-1">
            {dirty && <span className="hidden items-center gap-1 text-[11px] text-amber-400 sm:flex"><AlertTriangle size={12} />未保存</span>}
            <button
              type="button"
              title="放弃修改"
              aria-label="放弃修改"
              disabled={!dirty || saving}
              onClick={discard}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <RotateCcw size={14} />
            </button>
            <Button variant="primary" size="sm" loading={saving} disabled={disabled || !dirty || !current} onClick={save}>
              <Save size={14} /> {canPreview ? '保存并更新预览' : '保存 YAML'}
            </Button>
          </div>
        }
      >
        <div className="min-h-[430px] flex-1 xl:min-h-0">
          {loading ? (
            <Spinner label="读取 YAML…" />
          ) : current ? (
            <YamlEditor
              value={content}
              readOnly={disabled || saving}
              onChange={(value) => {
                setContent(value)
                setDirtyState(value !== savedContent)
              }}
            />
          ) : (
            <EmptyState icon={<FileCode2 size={28} />} title="没有可编辑的 YAML 文件" />
          )}
        </div>
      </Card>
    </div>
  )
}
