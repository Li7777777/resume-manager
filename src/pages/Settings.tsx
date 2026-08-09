// 设置页：数据仓路径、编译开关、GitHub Token、提交身份
import React, { useEffect, useState } from 'react'
import {
  Save,
  FolderGit2,
  KeyRound,
  UserRound,
  ShieldCheck,
  RefreshCw,
  Hammer,
  CloudCog,
  CloudUpload,
  CheckCircle2,
  ScanSearch,
  ExternalLink,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import { api } from '../api'
import type { Settings } from '../types'
import { useToast } from '../toast'
import { Card, Button, Field, Input, Switch, Badge } from '../components/ui'

export default function SettingsPage() {
  const toast = useToast()
  const [form, setForm] = useState<Settings>({})
  const [repoCfg, setRepoCfg] = useState<{ present: boolean; repoValue: boolean | null } | null>(null)
  const [detected, setDetected] = useState<{
    found: boolean
    source?: string | null
    username?: string | null
    token?: string | null
    tokenPreview?: string | null
  } | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    api.get<{ settings: Settings }>('/api/settings').then((d) => setForm(d.settings))
    loadRepoCfg()
    runDetect()
  }, [])

  const runDetect = async (silent = false) => {
    if (!silent) setDetecting(true)
    try {
      const d = await api.get<{
        found: boolean
        source?: string | null
        username?: string | null
        token?: string | null
        tokenPreview?: string | null
      }>('/api/github/autodetect')
      setDetected(d)
    } catch {
      setDetected({ found: false })
    } finally {
      setDetecting(false)
    }
  }

  // 一键启用系统检测到的凭据
  const applyDetected = async () => {
    if (!detected?.token) return
    try {
      await api.put('/api/settings', {
        token: detected.token,
        gitUsername: detected.username || form.gitUsername,
      })
      toast('success', `已启用系统凭据${detected.username ? `（@${detected.username}）` : ''}`)
      setForm((f) => ({ ...f, token: detected.token!, gitUsername: detected.username || f.gitUsername }))
      runDetect(true)
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const loadRepoCfg = () =>
    api
      .get<{ present: boolean; repoValue: boolean | null }>('/api/repo/pdf-config')
      .then(setRepoCfg)
      .catch(() => setRepoCfg(null))

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

  // 把 GitHub 编译开关同步到私有数据仓（写入 resume-manager.config.json 并提交推送）
  const syncGithubSwitch = async (withPush = true) => {
    setSyncing(true)
    try {
      const r = await api.post<{ ok?: boolean; committed: boolean; pushed: boolean; error?: string }>('/api/repo/pdf-config', {
        commit: true,
        push: withPush,
      })
      if (r.ok === false) throw new Error(r.error || '同步失败')
      toast('success', r.pushed ? '已写入私有仓并推送到 GitHub' : '已写入并提交本地（未推送）')
      loadRepoCfg()
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setSyncing(false)
    }
  }

  const localBuildOn = form.localPdfBuild !== false // 默认开启
  const githubBuildOn = form.githubPdfBuild === true // 默认关闭
  const cfgNeedsSync = repoCfg && repoCfg.repoValue !== githubBuildOn

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

      {/* 编译开关 */}
      <Card title="PDF 编译开关" desc="控制简历 PDF 的编译方式">
        <div className="divide-y divide-zinc-800/80">
          {/* 本地编译 */}
          <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 rounded-lg p-1.5 ${localBuildOn ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                <Hammer size={15} />
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-200">本地编译 PDF <Badge tone="emerald">默认开启</Badge></p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  在「PDF 预览」页构建并预览简历。需要本机安装
                  <a className="mx-1 text-indigo-400 underline decoration-dotted hover:text-indigo-300" href="https://www.npmjs.com/package/yamlresume" target="_blank" rel="noreferrer">yamlresume</a>
                  （<code className="text-zinc-400">npm install -g yamlresume</code>）与 XeTeX/Tectonic 排版引擎。
                </p>
              </div>
            </div>
            <Switch checked={localBuildOn} onChange={(v) => setForm({ ...form, localPdfBuild: v })} />
          </div>
          {/* GitHub 编译 */}
          <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 rounded-lg p-1.5 ${githubBuildOn ? 'bg-sky-500/15 text-sky-400' : 'bg-zinc-800 text-zinc-500'}`}>
                <CloudCog size={15} />
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-200">GitHub 编译 PDF <Badge tone="zinc">默认关闭</Badge></p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  开启后，push 到私有数据仓会触发 GitHub Action 自动编译 PDF（开关记录在
                  <code className="mx-1 text-zinc-400">resume-manager.config.json</code>）。
                </p>
                {repoCfg && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={repoCfg.repoValue === githubBuildOn ? 'emerald' : 'amber'}>
                      {repoCfg.repoValue === githubBuildOn ? (
                        <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} />私有仓已同步</span>
                      ) : repoCfg.present ? (
                        `私有仓当前：${repoCfg.repoValue ? '开启' : '关闭'}（未同步）`
                      ) : (
                        '私有仓缺少配置文件'
                      )}
                    </Badge>
                    {cfgNeedsSync && (
                      <Button size="sm" loading={syncing} onClick={() => syncGithubSwitch(true)}>
                        <CloudUpload size={13} /> 同步并推送
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <Switch checked={githubBuildOn} onChange={(v) => setForm({ ...form, githubPdfBuild: v })} />
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-zinc-950/50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
          修改开关后点「保存设置」生效；GitHub 编译开关还需「同步并推送」到私有数据仓才会让 CI 生效。
        </p>
      </Card>

      <Card title="GitHub 同步" desc="用于 push / pull 的凭据，仅保存在本机，不上传">
        <div className="space-y-4">
          <Field label="GitHub Token" hint="需要 repo 权限（fine-grained: Contents 读写）">
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

          {/* 自动检测状态区 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <ScanSearch size={14} className="text-zinc-500" />
                <span className="text-zinc-400">系统凭据自动检测</span>
                {detecting && <span className="text-[11px] text-zinc-600">检测中…</span>}
                {!detecting && detected?.found && (
                  <Badge tone="emerald">
                    <Sparkles size={11} />
                    已检测到（{detected.source === 'gh' ? 'gh CLI' : detected.source}）
                  </Badge>
                )}
                {!detecting && !detected?.found && form.token && <Badge tone="emerald"><CheckCircle2 size={11} />已配置</Badge>}
                {!detecting && !detected?.found && !form.token && <Badge tone="amber">未检测到，请手动添加</Badge>}
              </div>
              <Button size="sm" variant="ghost" loading={detecting} onClick={() => runDetect()}>
                <RefreshCw size={12} /> 重新检测
              </Button>
            </div>
            {!detecting && detected?.found && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
                <span className="text-[11px] text-zinc-500">
                  从{detected.source === 'gh' ? ' gh CLI 登录态' : ` 环境变量 ${detected.source}`}检测到凭据
                  {detected.username ? `（用户 @${detected.username}）` : ''}：
                  <code className="text-zinc-400">{detected.tokenPreview}</code>
                </span>
                <Button size="sm" variant="success" onClick={applyDetected}>
                  <Sparkles size={12} /> 一键启用系统凭据
                </Button>
              </div>
            )}
          </div>

          {/* 获取不到时：教程引导 */}
          {!detecting && !detected?.found && !form.token && (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                <TerminalSquare size={13} /> 如何获取 GitHub Token（二选一）
              </p>
              <div className="mt-2.5 space-y-3 text-xs leading-relaxed text-zinc-400">
                <div>
                  <p className="font-medium text-zinc-300">方式一：GitHub 网页创建（推荐）</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                    <li>打开
                      <a className="mx-1 inline-flex items-center gap-0.5 text-indigo-400 underline decoration-dotted hover:text-indigo-300" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建 Fine-grained Token<ExternalLink size={10} /></a>
                      （或<a className="mx-1 text-indigo-400 underline decoration-dotted hover:text-indigo-300" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">经典 Token<ExternalLink size={10} /></a>）
                    </li>
                    <li>Repository access → Only select repositories → 勾选你的简历私有仓</li>
                    <li>Permissions → Contents → <span className="text-zinc-200">Read and write</span>（GitHub 编译开关另需 Workflows: Read and write）</li>
                    <li>Generate token → 复制 <code className="text-zinc-300">github_pat_</code> / <code className="text-zinc-300">ghp_</code> 开头的 Token，粘贴到上方输入框</li>
                  </ol>
                </div>
                <div>
                  <p className="font-medium text-zinc-300">方式二：gh CLI（本机已登录则本页会自动检测到）</p>
                  <pre className="mt-1 rounded-md bg-black/40 p-2 text-[11px] text-zinc-300">gh auth login</pre>
                  <p className="mt-1 text-zinc-500">登录后返回本页点「重新检测」即可一键启用。</p>
                </div>
              </div>
            </div>
          )}
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
