// 模板初始化页：按私有数据仓格式一键生成骨架，方便新用户上手
import React, { useEffect, useState } from 'react'
import { Copy, Check, FolderPlus, Lock, Globe2, Workflow, FileCode2 } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Card, Button, Input, Field, EmptyState } from '../components/ui'

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      className="shrink-0 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setOk(true)
        setTimeout(() => setOk(false), 1500)
      }}
    >
      {ok ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  )
}

export default function Templates() {
  const toast = useToast()
  const [templateFiles, setTemplateFiles] = useState<string[]>([])
  const [targetDir, setTargetDir] = useState('')
  const [initResult, setInitResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .get<{ files: string[] }>('/api/template/info')
      .then((d) => setTemplateFiles(d.files))
      .catch(() => {})
  }, [])

  const init = async () => {
    if (!targetDir.trim()) return toast('warn', '请填写目标目录')
    setBusy(true)
    try {
      const r = await api.post<{ target: string }>('/api/project/init', { targetDir: targetDir.trim() })
      setInitResult(r.target)
      toast('success', '模板已生成')
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setBusy(false)
    }
  }

  const ghCmd = `gh repo create resume-data --private --source ${initResult || 'DIR'} --remote origin --push`
  const gitCmd = `cd ${initResult || 'DIR'}\ngit init -b main\ngit add -A\ngit commit -m "init: resume data"\ngit branch -M main`

  return (
    <div className="space-y-6">
      {/* 架构说明 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={<span className="inline-flex items-center gap-2"><Lock size={14} className="text-emerald-400" />私有数据仓</span>}
          desc="github.com/你/xxx（Private）—— 你的简历信息只存在这里"
        >
          <ul className="space-y-2 text-sm text-zinc-400">
            <li>· <code className="text-zinc-300">data/</code> 信息全集：工作、教育、项目、技能…每条可打标签</li>
            <li>· <code className="text-zinc-300">scripts/variants.yml</code> 简历方向配方</li>
            <li>· GitHub Action 自动组合 + 构建 PDF（artifact 私有保存）</li>
            <li>· 通过本管理端可视化编辑，或直接改 YAML</li>
          </ul>
        </Card>
        <Card
          title={<span className="inline-flex items-center gap-2"><Globe2 size={14} className="text-indigo-400" />公开管理端</span>}
          desc="本仓库 resume-manager（Public）—— 纯工具，不含任何个人数据"
        >
          <ul className="space-y-2 text-sm text-zinc-400">
            <li>· 本地运行，通过 <code className="text-zinc-300">设置</code> 指向你的私有数据仓目录</li>
            <li>· 提供 YAML 编辑、PDF 预览、Git 同步看板全部功能</li>
            <li>· 令牌等敏感配置存于 <code className="text-zinc-300">~/.resume-manager/</code>，不进仓库</li>
            <li>· 服务只监听 <code className="text-zinc-300">127.0.0.1</code>，数据不出本机</li>
          </ul>
        </Card>
      </div>

      {/* 初始化 */}
      <Card title="用模板初始化私有数据仓" desc="生成与数据格式完全匹配的骨架，含示例数据与 CI 工作流">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Field label="目标目录（本地新建/已有空目录的路径）">
              <Input value={targetDir} onChange={(e) => setTargetDir(e.target.value)} placeholder="例如 E:\code\my-resume-data" className="font-mono" />
            </Field>
          </div>
          <div className="flex items-end">
            <Button variant="primary" loading={busy} onClick={init}>
              <FolderPlus size={15} /> 生成模板
            </Button>
          </div>
        </div>

        {initResult && (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">
              ✅ 模板已生成到 <code className="font-mono">{initResult}</code>，包含 {templateFiles.length} 个文件。
              接下来创建 GitHub 私有仓库并推送：
            </div>
            <div className="space-y-2">
              {[
                { title: '1. 创建私有仓库并推送（推荐，用 gh CLI）', cmd: ghCmd },
                { title: '2. 或手动 git 初始化', cmd: gitCmd },
              ].map((s) => (
                <div key={s.title} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <p className="mb-1.5 text-xs font-medium text-zinc-400">{s.title}</p>
                  <div className="flex items-center gap-1 rounded-md bg-black/40 p-2">
                    <pre className="flex-1 overflow-x-auto text-xs text-zinc-300">{s.cmd}</pre>
                    <CopyBtn text={s.cmd} />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-zinc-800 p-4 text-xs text-zinc-500">
              推送完成后，回到本管理端「设置」填入 <code className="text-zinc-300">{initResult}</code> 作为数据仓路径，即可开始可视化管理。
            </div>
          </div>
        )}
      </Card>

      {/* 模板文件预览 */}
      <Card title="模板内容" desc="私有数据仓骨架（与数据格式规范完全一致）">
        {templateFiles.length ? (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {templateFiles.map((f) => (
              <div key={f} className="flex items-center gap-2 rounded-md bg-zinc-950/50 px-2.5 py-1.5 font-mono text-xs text-zinc-400">
                <FileCode2 size={12} className="shrink-0 text-zinc-600" />
                <span className="truncate">{f}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="模板目录不存在" desc="请确认项目根目录下存在 templates/private-repo" />
        )}
      </Card>

      <Card title="数据格式速览" desc="详细规范见 docs/DATA-FORMAT.md">
        <pre className="overflow-x-auto rounded-lg bg-zinc-950/60 p-4 text-[11px] leading-relaxed text-zinc-400">
{`data/work.yml            # 信息全集：一条经历一个条目
- id: company-a          # 元数据：稳定标识
  company: 某公司         # → 组合时映射为 name
  position: 高级工程师
  startDate: "2021-03"   # 留空 = 至今
  tags: [frontend]       # ★ 方向标签（元数据，不进入简历）
  achievements:
    - text: 做了什么
      tags: [frontend]   # 无标签 = 通用，所有方向保留

scripts/variants.yml     # 简历方向配方
variants:
  frontend:
    blocks:
      work: { tags: [frontend] }   # 按标签筛选
      projects: { include: all }`}
        </pre>
      </Card>
    </div>
  )
}
