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
  GitPullRequestArrow,
} from 'lucide-react'
import { api } from '../api'
import type { Settings } from '../types'
import { loadSettings, patchSettings } from '../settings'
import { useToast } from '../toast'
import { Card, Button, Field, Input, Switch, Badge, Spinner } from '../components/ui'

export default function SettingsPage() {
  const toast = useToast()
  const [form, setForm] = useState<Settings>({})
  const [githubCfg, setGithubCfg] = useState<{ available: boolean; present: boolean; remoteValue: boolean | null } | null>(null)
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
  const [connecting, setConnecting] = useState(false)
  const [connectResult, setConnectResult] = useState<{
    generated?: boolean
    inited?: boolean
    target?: string
    status?: { isRepo?: boolean; branch?: string; error?: string }
  } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadSettings()
      .then((s) => setForm(s))
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  // Git 同步开启时才执行 gh 状态检测与 Actions 变量同步检查；关闭时折叠且不检测。
  const gitSyncOn = form.gitSyncEnabled !== false
  useEffect(() => {
    if (gitSyncOn) {
      runDetect()
      loadGithubCfg()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitSyncOn])

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
      const saved = await patchSettings({
        token: detected.token,
        gitUsername: detected.username || form.gitUsername,
      })
      setForm(saved)
      toast('success', `已启用系统凭据${detected.username ? `（@${detected.username}）` : ''}`)
      runDetect(true)
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  const loadGithubCfg = () =>
    api
      .get<{ available: boolean; present: boolean; remoteValue: boolean | null }>('/api/github/pdf-config')
      .then(setGithubCfg)
      .catch(() => setGithubCfg(null))

  const save = async () => {
    try {
      const saved = await patchSettings({
        repoPath: form.repoPath,
        token: form.token,
        gitUsername: form.gitUsername,
        gitEmail: form.gitEmail,
      })
      setForm(saved)
      toast('success', '设置已保存')
      setTestResult(null)
      window.dispatchEvent(new Event('rm-settings-saved'))
      loadGithubCfg()
    } catch (e: any) {
      toast('error', e.message)
    }
  }

  // ★ 编译开关：切换即自动保存 + 热重载（乐观更新，失败回滚）
  const toggleLocal = async (v: boolean) => {
    setForm((f) => ({ ...f, localPdfBuild: v }))
    try {
      await patchSettings({ localPdfBuild: v })
      toast('success', `本地编译 PDF 已${v ? '开启' : '关闭'}（即时生效）`)
    } catch (e: any) {
      setForm((f) => ({ ...f, localPdfBuild: !v }))
      toast('error', `保存失败：${e.message}`)
    }
  }

  const toggleGithub = async (v: boolean) => {
    setForm((f) => ({ ...f, githubPdfBuild: v }))
    try {
      await patchSettings({ githubPdfBuild: v })
      toast('success', `GitHub 编译 PDF 已${v ? '开启' : '关闭'}（需同步 Actions 变量后 CI 生效）`)
      loadGithubCfg()
    } catch (e: any) {
      setForm((f) => ({ ...f, githubPdfBuild: !v }))
      toast('error', `保存失败：${e.message}`)
    }
  }

  // ★ Git 同步开关：切换即保存；关闭折叠 git 配置与看板，开启后重新检测 gh 状态
  const toggleGitSync = async (v: boolean) => {
    setForm((f) => ({ ...f, gitSyncEnabled: v }))
    try {
      await patchSettings({ gitSyncEnabled: v })
      window.dispatchEvent(new Event('rm-settings-saved'))
      toast('success', `Git 同步已${v ? '开启' : '关闭'}`)
    } catch (e: any) {
      setForm((f) => ({ ...f, gitSyncEnabled: !v }))
      toast('error', `保存失败：${e.message}`)
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

  // 连接数据仓：目录不存在/为空 → 自动生成模板骨架 + git init；已有内容 → 不生成直接连接
  const connect = async () => {
    if (!form.repoPath || !form.repoPath.trim()) return toast('warn', '请先填写数仓路径')
    setConnecting(true)
    setConnectResult(null)
    try {
      const r = await api.post<{
        ok?: boolean
        generated?: boolean
        inited?: boolean
        target?: string
        status?: { isRepo?: boolean; branch?: string; error?: string }
        error?: string
      }>('/api/project/connect', { repoPath: form.repoPath.trim() })
      if (r.ok === false) throw new Error(r.error || '连接失败')
      setConnectResult(r)
      setForm((f) => ({ ...f, repoPath: r.target }))
      toast('success', r.generated ? '已生成数据仓骨架并初始化 git' : '已连接数据仓')
      try {
        await patchSettings({ repoPath: r.target })
      } catch {
        /* 静默 */
      }
      setTestResult(null)
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setConnecting(false)
    }
  }


  // 同步到 GitHub Actions 仓库变量；不创建、修改或提交私有仓文件。
  const syncGithubSwitch = async () => {
    setSyncing(true)
    try {
      const r = await api.post<{ ok?: boolean; remoteValue: boolean; variable: string; error?: string }>('/api/github/pdf-config', {})
      if (r.ok === false) throw new Error(r.error || '同步失败')
      toast('success', `已同步 GitHub Actions 变量 ${r.variable}`)
      loadGithubCfg()
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setSyncing(false)
    }
  }

  const localBuildOn = form.localPdfBuild !== false // 默认开启
  const githubBuildOn = form.githubPdfBuild === true // 默认关闭
  const cfgNeedsSync = githubCfg?.available && githubCfg.remoteValue !== githubBuildOn

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
              <Button variant="primary" loading={connecting} onClick={connect}>
                <FolderGit2 size={14} /> 连接数据仓
              </Button>
            </div>
          </Field>
          {testResult && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-400">{testResult}</div>
          )}
          {connectResult && (
            <div className="space-y-2">
              <div className={`rounded-lg border px-3 py-2 text-xs ${connectResult.generated ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-zinc-800 bg-zinc-950/50 text-zinc-400'}`}>
                {connectResult.generated
                  ? `✅ 已自动生成数据仓骨架：${connectResult.target}（含示例数据、简历类型配置、CI 工作流）${connectResult.inited ? '，并已初始化 git 仓库' : ''}`
                  : `✅ 已连接：${connectResult.target}${connectResult.status?.isRepo ? `（git 仓库，分支 ${connectResult.status.branch}）` : ''}`}
              </div>
              {/* 折叠的建仓推送指引 */}
              <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">创建 GitHub 私有仓并推送（可选）</summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">{`cd ${connectResult.target}
git add -A
git commit -m "init: resume data"
gh repo create resume-data --private --source . --remote origin --push`}</pre>
                <p className="mt-1.5 text-[11px] text-zinc-600">推送后到「Git 同步看板」可提交/推送后续修改；或在本页填入 GitHub 令牌后直接使用看板。</p>
              </details>
            </div>
          )}
        </div>
      </Card>

      {/* Git 同步开关 */}
      <Card title="Git 同步" desc="控制 Git 同步看板与 GitHub 配置的展示与使用">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 rounded-lg p-1.5 ${gitSyncOn ? 'bg-indigo-500/15 text-indigo-300' : 'bg-zinc-800 text-zinc-500'}`}>
              <GitPullRequestArrow size={15} />
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-200">启用 Git 同步 <Badge tone="emerald">默认开启</Badge></p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                关闭后：折叠 GitHub 同步与 GitHub 编译配置、侧栏隐藏「Git 同步看板」、版本时间线只显示本机正式版，git 相关接口不可用；开启后自动检测 gh 状态并提醒配置。
              </p>
            </div>
          </div>
          <Switch checked={gitSyncOn} disabled={!ready} onChange={(v) => toggleGitSync(v)} />
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
                  在「简历定制」页选择 LaTeX 模板并生成 PDF 预览。需要本机安装
                  <a className="mx-1 text-indigo-400 underline decoration-dotted hover:text-indigo-300" href="https://www.npmjs.com/package/yamlresume" target="_blank" rel="noreferrer">yamlresume</a>
                  （<code className="text-zinc-400">npm install -g yamlresume</code>）与 XeTeX/Tectonic 排版引擎。
                </p>
              </div>
            </div>
            <Switch checked={localBuildOn} disabled={!ready} onChange={(v) => toggleLocal(v)} />
          </div>
          {/* GitHub 编译（Git 同步关闭时折叠） */}
          {gitSyncOn && (
            <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 rounded-lg p-1.5 ${githubBuildOn ? 'bg-sky-500/15 text-sky-400' : 'bg-zinc-800 text-zinc-500'}`}>
                <CloudCog size={15} />
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-200">GitHub 编译 PDF <Badge tone="zinc">默认关闭</Badge></p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  开启后，类型分支 push 会由 GitHub Action 自动编译；开关同步为 GitHub Actions 仓库变量，
                  <strong className="text-zinc-300">不会修改私有仓文件或产生 Git diff</strong>。
                </p>
                {githubCfg && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={githubCfg.available && githubCfg.remoteValue === githubBuildOn ? 'emerald' : 'amber'}>
                      {githubCfg.available && githubCfg.remoteValue === githubBuildOn ? (
                        <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} />Actions 变量已同步</span>
                      ) : !githubCfg.available ? (
                        '配置 Token 后可同步 Actions 变量'
                      ) : githubCfg.present ? (
                        `Actions 当前：${githubCfg.remoteValue ? '开启' : '关闭'}（未同步）`
                      ) : (
                        'Actions 变量尚未创建'
                      )}
                    </Badge>
                    {cfgNeedsSync && (
                      <Button size="sm" loading={syncing} onClick={syncGithubSwitch}>
                        <CloudUpload size={13} /> 同步到 Actions
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <Switch checked={githubBuildOn} disabled={!ready} onChange={(v) => toggleGithub(v)} />
            </div>
          )}
        </div>
        <p className="mt-3 rounded-lg bg-zinc-950/50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
          开关<b className="text-zinc-400">切换即保存到本机并即时生效</b>；GitHub 编译开关通过 Actions 仓库变量同步，不会改动简历数据仓。
        </p>
      </Card>

      {/* GitHub 同步（Git 同步关闭时折叠） */}
      {gitSyncOn && (
        <Card title="GitHub 同步" desc="用于 push / pull 的凭据，仅保存在本机，不上传">
        <div className="space-y-4">
          <Field label="GitHub 令牌" hint="需要仓库权限（细粒度：内容读写）">
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
                      <a className="mx-1 inline-flex items-center gap-0.5 text-indigo-400 underline decoration-dotted hover:text-indigo-300" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建细粒度令牌<ExternalLink size={10} /></a>
                      （或<a className="mx-1 text-indigo-400 underline decoration-dotted hover:text-indigo-300" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">经典 Token<ExternalLink size={10} /></a>）
                    </li>
                    <li>仓库访问 → 仅所选仓库 → 勾选你的简历私有仓</li>
                    <li>权限：<span className="text-zinc-200">内容（读写）</span>；同步编译开关另需<span className="text-zinc-200">变量（读写）</span>；读取 CI 产物需<span className="text-zinc-200">操作（读）</span></li>
                    <li>生成令牌 → 复制 <code className="text-zinc-300">github_pat_</code> / <code className="text-zinc-300">ghp_</code> 开头的令牌，粘贴到上方输入框</li>
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
      )}

      <Card title="隐私说明">
        <div className="flex items-start gap-2.5 text-sm text-zinc-400">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          <ul className="space-y-1.5 text-xs leading-relaxed">
            <li>· 私有仓保存简历内容、组稿规则、标签库与分类显示配置（随 Git 版本化，打包即可分发）；备注、类型展示信息等管理状态保存在 <code className="text-zinc-300">~/.resume-manager/repos/</code>。</li>
            <li>· Token 与编译开关保存在 <code className="text-zinc-300">~/.resume-manager/settings.json</code>，服务仅监听 127.0.0.1。</li>
            <li>· 推送时数据只流向 GitHub 私有仓库，不经过任何第三方。</li>
          </ul>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save}>
          <Save size={15} /> 保存设置
        </Button>
      </div>
      {!ready && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40">
          <Spinner label="正在加载设置…" />
        </div>
      )}
    </div>
  )
}
