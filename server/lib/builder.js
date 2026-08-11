// PDF 构建：调用本地 yamlresume CLI 构建简历（先组合，后构建）
// 依赖：yamlresume CLI（npm i -g yamlresume）+ XeTeX/Tectonic 排版引擎
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { generateAll } from './compose.js'

export function checkEnvironment() {
  const which = (cmd) => {
    try {
      const r = spawnSync('where', [cmd], { shell: true })
      if (r.status !== 0) return null
      return r.stdout.toString().trim().split(/\r?\n/)[0] || null
    } catch {
      return null
    }
  }
  return {
    yamlresume: which('yamlresume'),
    xelatex: which('xelatex'),
    tectonic: which('tectonic'),
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    // 用 shell 执行（Windows 上 npm 全局命令是 .cmd 垫片，非 shell 模式无法运行）
    // 参数先做引号处理；调用方必须对方向名做白名单校验
    const q = (s) => (/[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)
    const cmdline = [cmd, ...args].map(q).join(' ')
    const p = spawn(cmdline, { cwd, shell: true, windowsHide: true })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('close', (code) => resolve({ code, stdout, stderr }))
    p.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }))
  })
}

// 构建某个方向的 PDF（自动先组合）
export async function buildVariant(repo, variant, { verbose = true, compose = true } = {}) {
  if (!/^[\w-]+$/.test(variant)) {
    return { ok: false, output: `非法方向名：${variant}` }
  }
  const env = checkEnvironment()
  if (!env.yamlresume) {
    return { ok: false, output: '未找到 yamlresume CLI，请先安装：npm install -g yamlresume' }
  }
  if (compose) {
    try {
      generateAll(repo, [variant])
    } catch (err) {
      return { ok: false, output: `组合失败：${err.message}` }
    }
  }
  const args = ['build', `resumes/${variant}.yml`, '-t', '120']
  if (verbose) args.unshift('-v')
  const r = await run(env.yamlresume, args, repo)
  const pdf = path.join(repo, 'resumes', `${variant}.pdf`)
  const ok = r.code === 0 && fs.existsSync(pdf)
  return { ok, output: (r.stdout + r.stderr).trim(), pdf: ok ? `${variant}.pdf` : null }
}

export function pdfPath(repo, variant) {
  return path.join(repo, 'resumes', `${variant}.pdf`)
}

// 仅构建 HTML 输出（html 引擎，无需 xelatex，用于简历定制实时渲染）
export async function buildHtmlVariant(repo, variant) {
  const env = checkEnvironment()
  if (!env.yamlresume) {
    return { ok: false, output: '未找到 yamlresume CLI，请先安装：npm install -g yamlresume' }
  }
  const args = ['build', `resumes/${variant}.yml`, '-t', '120']
  const r = await run(env.yamlresume, args, repo)
  const html = path.join(repo, 'resumes', `${variant}.html`)
  const ok = r.code === 0 && fs.existsSync(html)
  return { ok, output: (r.stdout + r.stderr).trim(), html: ok ? `${variant}.html` : null }
}
