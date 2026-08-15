// PDF 构建：调用本地 yamlresume CLI 构建简历（先组合，后构建）
// 依赖：yamlresume CLI（npm i -g yamlresume）+ XeTeX/Tectonic 排版引擎
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { generateAll } from './compose.js'
import { renderJakeOriginal } from './jake-original.js'

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

// ModernCV 补丁：1) cvitem 正文改 raggedright 防长行溢出；2) cventry 名称与时间同一行、时间右对齐。仅 moderncv 文档注入。
const CVITEM_PATCH_MARK = 'rm-moderncv-patches'
const CVITEM_PATCH = `% ${CVITEM_PATCH_MARK}
\\makeatletter
\\renewcommand*{\\cvitem}[3][.25em]{%
  \\ifstrempty{#2}{}{\\hintstyle{#2}：}\\raggedright#3%
  \\par\\addvspace{#1}}
\\makeatother
% 名称与时间同一行，时间在最右侧右对齐
\\renewcommand*{\\cventry}[7][.25em]{%
  \\begin{tabular*}{\\maincolumnwidth}{l@{\\extracolsep{\\fill}}r}%
    \\ifboolexpr{%
      test {\\ifstrempty{#4}}
      and
      test {\\ifstrempty{#5}}}%
      {}%
      {{\\bfseries #4} & {\\bfseries #2}\\\\}%
    {\\itshape #3\\ifstrempty{#6}{}{, #6}} & {}\\\\%
  \\end{tabular*}%
  \\ifx&#7&%
  \\else{\\\\%
    \\begin{minipage}{\\maincolumnwidth}%
      \\small#7%
    \\end{minipage}}\\fi%
  \\par\\addvspace{#1}}
`

function normalizeGroupedLatex(text) {
  let next = text
  // ModernCV：技能（“方向：技能、技能”）与兴趣爱好整行移入正文列，移除模板追加的等级标记。
  next = next.replace(/^\\cvline\{([^{}\r\n]+)\}\{[^{}\r\n]*\}$/gm, '\\cvline{}{$1}')
  // 项目关键字：改名为“技术栈”并另起一行（必须先于 Jake 技能正则执行，避免被其误删）。
  // 用 \\leavevmode\\ 强制换行：cventry 是非 long 宏（参数禁 \\par），且摘要可能是 itemize（\\newline 会报错）。
  next = next.replace(/\\textbf\{关键字\}/g, '\\leavevmode\\\\\\textbf{技术栈}')
  // Jake：移除技能行粗体包裹与末尾等级冒号（技能名含方向冒号，冒号后不允许出现 }）。
  next = next.replace(/^\\textbf\{([^{}\r\n]*：[^{}\r\n]*)\}[:：][^{}\r\n]*$/gm, '$1')
  // Jake：移除兴趣行纯粗体包裹（以、连接，无等级）。
  next = next.replace(/^\\textbf\{([^{}\r\n]*、[^{}\r\n]*)\}$/gm, '$1')
  // ModernCV：正文列改 raggedright，避免长技能行因两端对齐产生 Overfull \\hbox。
  if (/moderncv/.test(next) && !next.includes(CVITEM_PATCH_MARK)) {
    next = next.replace(/^(\\begin\{document\})/m, CVITEM_PATCH + '$1')
  }
  // GitHub star 徽章：yamlresume 输出中的「[stars|N]」标记 → shields 风格双色徽章
  if (/\[stars\|[0-9]+(?:\.[0-9]+)?[km]?\]/.test(next)) {
    next = next.replace(/\s*\[stars\|([0-9]+(?:\.[0-9]+)?[km]?)\]/g, ' \\starsbadge{$1}')
    if (!next.includes(STARS_BADGE_MARK)) {
      next = next.replace(/^(\\begin\{document\})/m, STARS_BADGE_TEX + '$1')
    }
  }
  return next
}

const STARS_BADGE_MARK = '% rm-stars-badge'
const STARS_BADGE_TEX = `${STARS_BADGE_MARK}
\\makeatletter
\\@ifpackageloaded{xcolor}{
  \\definecolor{rmbadgeleft}{HTML}{555555}
  \\definecolor{rmbadgeright}{HTML}{007EC6}
}{
  \\definecolor{rmbadgeleft}{gray}{0.33}
  \\definecolor{rmbadgeright}{rgb}{0.0,0.494,0.776}
}
\\makeatother
\\newcommand{\\starsbadge}[1]{\\leavevmode\\begingroup\\setlength{\\fboxsep}{1pt}\\raisebox{-1.5pt}{\\colorbox{rmbadgeleft}{\\textcolor{white}{\\ttfamily\\fontsize{6.5}{7}\\selectfont stars}}\\colorbox{rmbadgeright}{\\textcolor{white}{\\ttfamily\\fontsize{6.5}{7}\\selectfont #1}}}\\endgroup}
`

function normalizeGroupedHtml(text) {
  let next = text.replace(
    /(<div class="resume-skill-name">[^<]*)<span class="resume-skill-level">[^<]*<\/span>/g,
    '$1',
  )
  // 项目关键字改名为“技术栈”（HTML 中已是独立行）。
  next = next.replace(/<span>关键字<\/span>/g, '<span>技术栈</span>')
  // GitHub star 徽章：shields.io 风格双色标签（左灰 stars + 右蓝数量）
  return next.replace(/\s*\[stars\|([0-9]+(?:\.[0-9]+)?[km]?)\]/g, (_, n) => starBadgeHtml(n))
}

function starBadgeHtml(n) {
  return `<span style="display:inline-block;margin-left:6px;vertical-align:middle;font-family:Verdana,Geneva,DejaVu Sans,sans-serif;font-size:10px;line-height:10px;white-space:nowrap;"><span style="display:inline-block;background:#555;color:#fff;padding:3px 4px;border-radius:2px 0 0 2px;">stars</span><span style="display:inline-block;background:#007EC6;color:#fff;padding:3px 4px;border-radius:0 2px 2px 0;">${n}</span></span>`
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
  if (compose) {
    try {
      generateAll(repo, [variant])
    } catch (err) {
      return { ok: false, output: `组合失败：${err.message}` }
    }
  }

  // 自定义模板（jake-original）：直接生成 .tex 并编译，不走 yamlresume
  const ymlPath = path.join(repo, 'resumes', `${variant}.yml`)
  let template = 'moderncv-banking'
  try {
    const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'))
    template = doc?.layouts?.[0]?.template || template
  } catch {
    /* 保持默认，走 yamlresume 分支时再报错 */
  }
  if (template === 'jake-original') {
    return buildJakeOriginal(repo, variant, env)
  }

  if (!env.yamlresume) {
    return { ok: false, output: '未找到 yamlresume CLI，请先安装：npm install -g yamlresume' }
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

// 自定义模板 Jake 原版：从组合 YAML 生成 tex 并编译 PDF
async function buildJakeOriginal(repo, variant, env) {
  const outDir = path.join(repo, 'resumes')
  const ymlPath = path.join(outDir, `${variant}.yml`)
  const texPath = path.join(outDir, `${variant}.tex`)
  const pdfPath = path.join(outDir, `${variant}.pdf`)
  try {
    const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'))
    const tex = renderJakeOriginal(doc)
    fs.writeFileSync(texPath, tex, 'utf8')
  } catch (err) {
    return { ok: false, output: `Jake 原版模板渲染失败：${err.message}` }
  }
  const compiler = env.xelatex || env.tectonic
  if (!compiler) return { ok: false, output: '未找到 xelatex 或 tectonic，无法编译 Jake 原版模板' }
  const args = env.xelatex
    ? ['-interaction=nonstopmode', '-halt-on-error', `${variant}.tex`]
    : [`${variant}.tex`]
  const result = await run(compiler, args, outDir)
  const ok = result.code === 0 && fs.existsSync(pdfPath)
  return { ok, output: (result.stdout + result.stderr).trim(), pdf: ok ? `${variant}.pdf` : null }
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
