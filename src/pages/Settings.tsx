// 设置页：数据仓路径、GitHub Token、提交身份
import React, { useEffect, useState } from 'react'
import { Save, FolderGit2, KeyRound, UserRound, ShieldCheck, RefreshCw } from 'lucide-react'
import { api } from '../api'
import type { Settings } from '../types'
import { useToast } from '../toast'
import { Card, Button, Field, Input, Badge } from '../components/ui'

export default function SettingsPage() {
  const toast = useToast()
  const [form, setForm] = useState<Settings>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ settings: Settings }>('/api/settings').then((d) => setForm(d.settings))
  }, [])

  const save = async () => {
    try {
      await api.put('/api/settings', form)
      toast('success', '设置已保存')
      setTestResult(null)
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await api.get<{ isRepo?: boolean; branch?: string; dirty?: number; error?: string }>('/api/project/status')
      setTestResult(r.error || `✅ 已连接：${r.isRepo ? `git 仓库，分支 ${r.branch}，${r.dirty || 0} 个未同步修改` : '目录存在，但不是 git 仓库'}`)
    } catch (e: any) {
      setTestResult(`❌ ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card title="数据仓" desc="指向你的私有简历数据仓本地目录（如 E:\code\my-resume-data）">
        <div className="space-y-4">
          <Field label="仓库路径">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderGit2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <Input
                  value={form.repoPath || ''}
                  onChange={(e) => setForm({ ...form, repoPath: e.target.value })}
                  placeholder="E:\code\my-resume-data"
                  className="pl-9 font-mono"
                />
              </div>
              <Button variant="secondary" loading={testing} onClick={test}>
                <RefreshCw size={13} /> 测试连接
              </Button>
            </div>
          </Field>
          {testResult && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-400">{testResult}</div>
          )}
        </div>
      </Card>

      <Card title="GitHub 同步" desc="用于 push / pull 的凭据，仅保存在本机，不上传">
        <div className="space-y-4">
          <Field
            label="GitHub Token"
            hint="需要 repo 权限（fine-grained: Contents 读写）"
          >
            <div className="relative">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <Input
                type="password"
                value={form.token || ''}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                placeholder="ghp_xxx 或 gho_xxx（留空表示已填过则保持不变）"
                className="pl-9 font-mono"
              />
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="提交用户名">
              <div className="relative">
                <UserRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <Input value={form.gitUsername || ''} onChange={(e) => setForm({ ...form, gitUsername: e.target.value })} placeholder="GitHub 用户名" className="pl-9" />
              </div>
            </Field>
            <Field label="提交邮箱">
              <Input value={form.gitEmail || ''} onChange={(e) => setForm({ ...form, gitEmail: e.target.value })} placeholder="you@example.com" />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="隐私说明">
        <div className="flex items-start gap-2.5 text-sm text-zinc-400">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <ul className="space-y-1.5 text-xs leading-relaxed">
            <li>· 本管理端是公开项目，但<strong className="text-zinc-200">不包含任何你的数据</strong>；数据只在你的私有仓库里。</li>
            <li>· Token 保存在 <code className="text-zinc-300">~/.resume-manager/settings.json</code>，服务仅监听 127.0.0.1。</li>
            <li>· 推送时数据只流向 GitHub 私有仓库，不经过任何第三方。</li>
          </ul>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save}>
          <Save size={15} /> 保存设置
        </Button>
      </div>
    </div>
  )
}
