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

function normalizeGroupedLatex(text) {
  let next = text
  // ModernCV：把模板自动追加的等级移除，并将整行放入正文列。
  next = next.replace(/^\\cvline\{((?:掌握|熟悉) [^{}\r\n]*)\}\{[^{}\r\n]*\}$/gm, '\\cvline{}{$1}')
  // Jake：同样移除等级及其冒号。
  next = next.replace(/^\\textbf\{((?:掌握|熟悉) [^{}\r\n]*)\}[:：][^\r\n]*$/gm, '$1')
  // ModernCV：兴趣爱好合并后也放入正文列，保持单行直列且不产生冒号。
  next = next.replace(/^\\cvline\{([^{}\r\n]*、[^{}\r\n]*)\}\{\}$/gm, '\\cvline{}{$1}')
  // Jake：同样移除兴趣爱好的粗体包裹。
  next = next.replace(/^\\textbf\{([^{}\r\n]*、[^{}\r\n]*)\}$/gm, '$1')
  return next
}

function normalizeGroupedHtml(text) {
  return text.replace(
    /(<div class="resume-skill-name">(?:掌握|熟悉) [^<]*)<span class="resume-skill-level">[^<]*<\/span>/g,
    '$1',
  )
}

async function normalizeGeneratedOutputs(repo, variant, env) {
  const outDir = path.join(repo, 'resumes')
  const texPath = path.join(outDir, `${variant}.tex`)
  const htmlPath = path.join(outDir, `${variant}.html`)
  let texChanged = false
  let output = ''

  if (fs.existsSync(texPath)) {
    const original = fs.readFileSync(texPath, 'utf8')
    const normalized = normalizeGroupedLatex(original)
    texChanged = normalized !== original
    if (texChanged) fs.writeFileSync(texPath, normalized, 'utf8')
  }

  if (fs.existsSync(htmlPath)) {
    const original = fs.readFileSync(htmlPath, 'utf8')
    const normalized = normalizeGroupedHtml(original)
    if (normalized !== original) fs.writeFileSync(htmlPath, normalized, 'utf8')
  }

  if (!texChanged) return { ok: true, output }
  const compiler = env.xelatex || env.tectonic
  if (!compiler) return { ok: false, output: 'LaTeX 输出已格式化，但未找到 xelatex 或 tectonic 以重新生成 PDF' }
  const args = env.xelatex
    ? ['-interaction=nonstopmode', '-halt-on-error', `${variant}.tex`]
    : [`${variant}.tex`]
  const result = await run(compiler, args, outDir)
  if (result.code !== 0 || !fs.existsSync(path.join(outDir, `${variant}.pdf`))) {
    return { ok: false, output: `格式化后的 PDF 重新编译失败：${(result.stdout + result.stderr).slice(-1200)}` }
  }
  output = result.stdout + result.stderr
  return { ok: true, output }
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
  let output = r.stdout + r.stderr
  if (r.code === 0) {
    const normalized = await normalizeGeneratedOutputs(repo, variant, env)
    output += normalized.output || ''
    if (!normalized.ok) return { ok: false, output: output.trim(), pdf: null }
  }
  const ok = r.code === 0 && fs.existsSync(pdf)
  return { ok, output: output.trim(), pdf: ok ? `${variant}.pdf` : null }
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
  let output = r.stdout + r.stderr
  if (r.code === 0) {
    const normalized = await normalizeGeneratedOutputs(repo, variant, env)
    output += normalized.output || ''
    if (!normalized.ok) return { ok: false, output: output.trim(), html: null }
  }
  const ok = r.code === 0 && fs.existsSync(html)
  return { ok, output: output.trim(), html: ok ? `${variant}.html` : null }
}
