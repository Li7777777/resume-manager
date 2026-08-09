// YAML 文件编辑页：直接查看/编辑数据文件与配方
import React, { useEffect, useState } from 'react'
import { Save, FileCode2, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Card, Button, Spinner } from '../components/ui'
import { YamlEditor } from '../components/YamlEditor'

interface FileItem {
  path: string
  label: string
  exists: boolean
}

export default function YamlPage() {
  const toast = useToast()
  const [files, setFiles] = useState<FileItem[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .get<{ files: FileItem[] }>('/api/files')
      .then((d) => {
        setFiles(d.files)
        setLoading(false)
      })
      .catch((e) => toast('error', e.message))
  }, [toast])

  const open = async (path: string) => {
    setCurrent(path)
    try {
      const d = await api.get<{ content: string }>(`/api/yaml?path=${encodeURIComponent(path)}`)
      setContent(d.content)
      setDirty(false)
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/yaml', { path: current, content })
      setDirty(false)
      toast('success', '已保存')
    } catch (e: any) {
      toast('error', `保存失败（YAML 语法错误？）：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="加载文件列表…" />

  return (
    <div className="flex gap-4">
      {/* 文件列表 */}
      <div className="w-60 shrink-0 space-y-1">
        <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-600">数据文件</p>
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => open(f.path)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
              current === f.path ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <FileCode2 size={14} className="shrink-0" />
            <span className="truncate font-mono text-xs">{f.path}</span>
          </button>
        ))}
      </div>

      {/* 编辑器 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <Card
            title={<span className="font-mono">{current}</span>}
            desc={dirty ? '有未保存的修改' : '直接编辑 YAML（保存时校验语法）'}
            actions={
              <>
                {dirty && <span className="flex items-center gap-1 text-xs text-amber-400"><AlertTriangle size={12} />未保存</span>}
                <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>
                  <Save size={14} /> 保存
                </Button>
              </>
            }
            pad={false}
          >
            <div className="h-[calc(100vh-220px)]">
              <YamlEditor value={content} onChange={(v) => { setContent(v); setDirty(true) }} />
            </div>
          </Card>
        ) : (
          <div className="flex h-[60vh] items-center justify-center text-sm text-zinc-600">
            从左侧选择一个文件开始编辑
          </div>
        )}
      </div>
    </div>
  )
}