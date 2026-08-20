// PDF 构建：调用本地 yamlresume CLI 构建简历（先组合，后构建）
// 依赖：yamlresume CLI（npm i -g yamlresume）+ XeTeX/Tectonic 排版引擎
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { generateAll, loadVariantsDoc } from './compose.js'
import { renderJakeOriginal } from './jake-original.js'
import { readCategory } from './data-store.js'
import { resolveProfilePhoto } from './profile-photo.js'
import { brandLabel, brandIconSvg } from './brand-icons.js'
import {
  getHtmlFontConfiguration,
  getLatexFontFamilies,
  normalizeFontSettings,
} from './font-options.js'

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
\\usepackage{tabularx}
\\makeatletter
\\renewcommand*{\\cvitem}[3][.25em]{%
  \\ifstrempty{#2}{}{\\hintstyle{#2}：}\\raggedright#3%
  \\par\\addvspace{#1}}
\\makeatother
% 名称与时间同一行；背景/职位移出表格，以正文宽度自然换行
\\renewcommand*{\\cventry}[7][.25em]{%
  \\begin{tabularx}{\\maincolumnwidth}{@{}>{\\raggedright\\arraybackslash}Xr@{}}%
    \\ifboolexpr{%
      test {\\ifstrempty{#4}}
      and
      test {\\ifstrempty{#5}}}%
      {}%
      {{\\bfseries #4} & {\\bfseries #2}\\\\}%
  \\end{tabularx}\\par%
  \\ifboolexpr{%
    test {\\ifstrempty{#3}}
    and
    test {\\ifstrempty{#6}}}%
    {}%
    {\\begin{minipage}{\\maincolumnwidth}%
      \\raggedright\\itshape #3\\ifstrempty{#6}{}{, #6}%
    \\end{minipage}\\par}%
  \\ifx&#7&%
  \\else
    \\noindent\\begin{minipage}{\\maincolumnwidth}%
      \\small#7%
    \\end{minipage}%
  \\fi%
  \\par\\addvspace{#1}}
`

const JAKE_SUBHEADING_PATCH_MARK = 'rm-jake-subheading-patch'
const JAKE_SUBHEADING_PATCH = `% ${JAKE_SUBHEADING_PATCH_MARK}
\\usepackage{tabularx}
% 名称与时间同一行；项目背景/机构移出不可换行的表格列
\\renewcommand{\\resumeSubheading}[4]{%
  \\begin{tabularx}{\\textwidth}[t]{@{}>{\\raggedright\\arraybackslash}Xr@{}}%
    \\textbf{#1} & #2 \\\\%
  \\end{tabularx}\\par%
  \\begin{minipage}{\\textwidth}%
    \\raggedright\\itshape #3%
    \\ifx&#4&\\else\\hfill #4\\fi%
  \\end{minipage}\\par
}
`

function normalizeGroupedLatex(text, photoPath = null, fonts = {}) {
  let next = injectFontPreferencesLatex(text, fonts)
  // ModernCV：技能（“方向：技能、技能”）与兴趣爱好整行移入正文列，移除模板追加的等级标记。
  next = next.replace(/^\\cvline\{([^{}\r\n]+)\}\{[^{}\r\n]*\}$/gm, '\\cvline{}{$1}')
  // 项目关键字：改名为“技术栈”并另起一行（必须先于 Jake 技能正则执行，避免被其误删）。
  // 用 \\leavevmode\\ 强制换行：cventry 是非 long 宏（参数禁 \\par），且摘要可能是 itemize（\\newline 会报错）。
  next = next.replace(/\\textbf\{关键字\}/g, '\\leavevmode\\\\\\textbf{技术栈}')
  // Jake：移除技能行粗体包裹与末尾等级冒号（技能名含方向冒号，冒号后不允许出现 }）。
  next = next.replace(/^\\textbf\{([^{}\r\n]*：[^{}\r\n]*)\}[:：][^{}\r\n]*$/gm, '$1')
  // Jake：移除兴趣行纯粗体包裹（以、连接，无等级）。
  next = next.replace(/^\\textbf\{([^{}\r\n]*、[^{}\r\n]*)\}$/gm, '$1')
  // ModernCV：正文列改 raggedright，名称/日期同排，背景和职位移出不可换行的表格列。
  if (/moderncv/.test(next) && !next.includes(CVITEM_PATCH_MARK)) {
    next = next.replace(/^(\\begin\{document\})/m, CVITEM_PATCH + '$1')
  }
  // YAMLResume Jake 同样把副标题放在 l 列，长项目背景需改为表格后的普通段落。
  if (!/moderncv/.test(next) && /\\newcommand\{\\resumeSubheading\}/.test(next) && !next.includes(JAKE_SUBHEADING_PATCH_MARK)) {
    next = next.replace(/^(\\begin\{document\})/m, JAKE_SUBHEADING_PATCH + '$1')
  }
  // GitHub 仓库徽章：[github|owner/repo|N] → Logo + 地址 + stars 数
  if (/\[github\|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\|(?:[0-9]+(?:\.[0-9]+)?[km]?)?\]/.test(next)) {
    next = next.replace(
      /\s*\[github\|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\|([0-9]+(?:\.[0-9]+)?[km]?)?\]/g,
      ' \\githubbadge{$1}{$2}',
    )
    if (!next.includes(GITHUB_BADGE_MARK)) {
      next = next.replace(/^(\\begin\{document\})/m, GITHUB_BADGE_TEX + '$1')
    }
  }
  // 品牌徽章：[brand|iconId] → 品牌名徽章（lobe-icons SVG 无法嵌入 xelatex，用文字回退）
  if (/\[brand\|[a-z0-9-]+\]/.test(next)) {
    next = next.replace(/\s*\[brand\|([a-z0-9-]+)\]/g, (_, iconId) => ` \\brandbadge{${brandLabel(iconId)}}`)
    if (!next.includes(BRAND_BADGE_MARK)) {
      next = next.replace(/^(\\begin\{document\})/m, BRAND_BADGE_TEX + '$1')
    }
  }
  return injectProfilePhotoLatex(next, photoPath)
}

const FONT_PREFERENCES_MARK = 'rm-font-preferences'

const latexFontName = (family) => `\\detokenize{${family}}`

function latexFontCommands(families, commands) {
  return [...families].reverse().map((family) => {
    const name = latexFontName(family)
    return `\\IfFontExistsTF{${name}}{${commands.map((command) => `\\${command}{${name}}`).join('')}}{}`
  }).join('\n')
}

function latexCjkFontCommands(families) {
  return [...families].reverse().map((family) => {
    const name = latexFontName(family)
    return `\\IfFontExistsTF{${name}}{\\setCJKmainfont[AutoFakeBold,AutoFakeSlant]{${name}}\\setCJKsansfont[AutoFakeBold,AutoFakeSlant]{${name}}}{}`
  }).join('\n')
}

function injectFontPreferencesLatex(text, fonts) {
  if (text.includes(FONT_PREFERENCES_MARK)) return text
  const selected = normalizeFontSettings(fonts)
  const latinFamilies = selected.latin ? getLatexFontFamilies('latin', selected.latin) : []
  // 未选择中文字体时保持原有行为：本机优先微软雅黑，CI 沿用 YAMLResume 的 Noto 回退。
  const cjkFamilies = selected.cjk ? getLatexFontFamilies('cjk', selected.cjk) : ['Microsoft YaHei']
  const cjkCommands = latexCjkFontCommands(cjkFamilies)
  const patch = `% ${FONT_PREFERENCES_MARK}
${latinFamilies.length ? `${latexFontCommands(latinFamilies, ['setmainfont', 'setsansfont'])}\n` : ''}\\ifdefined\\setCJKmainfont\\else
\\IfFileExists{xeCJK.sty}{\\usepackage{xeCJK}}{}
\\fi
\\ifdefined\\setCJKmainfont
${cjkCommands}
\\fi
`
  return text.replace(/^(\\begin\{document\})/m, patch + '$1')
}

function injectFontPreferencesHtml(text, fonts, template) {
  const config = getHtmlFontConfiguration(fonts, template)
  if (!config || text.includes(FONT_PREFERENCES_MARK)) return text
  const localSources = (families) => families.map((family) => `local("${family}")`).join(', ')
  const fallbackFamilies = [...config.latinFamilies, ...config.cjkFamilies]
    .filter((family, index, list) => list.indexOf(family) === index)
    .map((family) => `"${family}"`)
    .join(', ')
  const css = `
/* ${FONT_PREFERENCES_MARK} */
@font-face {
  font-family: "Resume Manager Selected";
  src: ${localSources(config.latinFamilies)};
  unicode-range: U+0000-024F, U+1E00-1EFF;
}
@font-face {
  font-family: "Resume Manager Selected";
  src: ${localSources(config.cjkFamilies)};
  unicode-range: U+2E80-2FDF, U+3000-303F, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;
}
:root { --text-font-family: "Resume Manager Selected", ${fallbackFamilies}, ${config.generic}; }
`
  return text.replace('</style>', `${css}</style>`)
}

const GITHUB_BADGE_MARK = '% rm-github-badge'
const GITHUB_BADGE_TEX = `${GITHUB_BADGE_MARK}
\\IfFileExists{fontawesome5.sty}{\\usepackage{fontawesome5}}{\\providecommand{\\faGithub}{GitHub}\\providecommand{\\faStar}{*}}
\\makeatletter
\\@ifpackageloaded{xcolor}{
  \\definecolor{rmbadgeborder}{HTML}{D0D7DE}
  \\definecolor{rmbadgeleft}{HTML}{FFFFFF}
  \\definecolor{rmbadgeright}{HTML}{FFFFFF}
  \\definecolor{rmbadgetext}{HTML}{24292F}
}{
  \\definecolor{rmbadgeborder}{rgb}{0.816,0.843,0.867}
  \\definecolor{rmbadgeleft}{rgb}{1,1,1}
  \\definecolor{rmbadgeright}{rgb}{1,1,1}
  \\definecolor{rmbadgetext}{rgb}{0.141,0.161,0.184}
}
\\makeatother
\\newcommand{\\githubbadge}[2]{%
  \\leavevmode\\begingroup\\setlength{\\fboxsep}{1pt}\\setlength{\\fboxrule}{0.35pt}%
  \\hspace{0.3em}\\raisebox{0.6pt}{%
    \\fcolorbox{rmbadgeborder}{rmbadgeleft}{%
      \\fontsize{6.5}{6.5}\\selectfont\\strut
      \\textcolor{rmbadgetext}{\\faGithub\\ \\texttt{#1}}%
      \\if\\relax\\detokenize{#2}\\relax
      \\else
        \\hspace{0.45em}{\\color{rmbadgeborder}\\vrule width 0.35pt height 1.1ex depth 0.25ex}\\hspace{0.45em}%
        \\textcolor{rmbadgetext}{\\faStar\\ #2}%
      \\fi
    }%
  }%
  \\hspace{0.2em}\\endgroup}
`

const BRAND_BADGE_MARK = '% rm-brand-badge'
const BRAND_BADGE_TEX = `% rm-brand-badge
\newcommand{\brandbadge}[1]{%
  \leavevmode\begingroup\setlength{\fboxsep}{1pt}\setlength{\fboxrule}{0.35pt}%
  \hspace{0.3em}\raisebox{0.6pt}{%
    \fcolorbox{gray!60}{white}{%
      \fontsize{6.5}{6.5}\selectfont\strut
      \textcolor{gray!70}{#1}%
    }%
  }%
  \hspace{0.2em}\endgroup}
`

function normalizeGroupedHtml(text, photo = null, fonts = {}, template = 'calm') {
  let next = text.replace(
    /(<div class="resume-skill-name">[^<]*)<span class="resume-skill-level">[^<]*<\/span>/g,
    '$1',
  )
  // 项目关键字改名为“技术栈”（HTML 中已是独立行）。
  next = next.replace(/<span>关键字<\/span>/g, '<span>技术栈</span>')
  // HTML 输出优先使用 Windows 中文字体，其他系统通过 sans-serif 回退。
  next = next.replace(
    /--text-default-font-family:\s*[^;]+;/,
    '--text-default-font-family: "Microsoft YaHei", sans-serif;',
  )
  next = injectFontPreferencesHtml(next, fonts, template)
  next = next.replace(
    /\s*\[github\|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\|([0-9]+(?:\.[0-9]+)?[km]?)?\]/g,
    (_, repo, n) => githubBadgeHtml(repo, n || ''),
  )
  next = next.replace(/\s*\[brand\|([a-z0-9-]+)\]/g, (_, iconId) => {
    const svg = brandIconSvg(iconId)
    return svg ? ` ${brandLogoHtml(svg)}` : ` ${brandLabel(iconId)}`
  })
  return injectProfilePhotoHtml(next, photo)
}

function githubBadgeHtml(repo, stars) {
  // GitHub logo 来自 @lobehub/icons-static-svg/icons/github.svg（本地内联，无远程依赖）
  const githubLogo = '<svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="currentColor" fill-rule="evenodd" style="vertical-align:middle;margin-right:4px;"><path d="M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z"/></svg>'
  const starLogo = '<svg aria-hidden="true" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="m8 0 2.47 5.01 5.53.81-4 3.9.94 5.51L8 12.63l-4.94 2.6L4 9.72 0 5.82l5.53-.81L8 0z"/></svg>'
  const repoPart = `<span style="display:inline-flex;align-items:center;padding:2px 5px;">${githubLogo}${repo}</span>`
  const starsPart = stars ? `<span style="display:inline-flex;align-items:center;padding:2px 5px;border-left:1px solid #d0d7de;">${starLogo}${stars}</span>` : ''
  return `<span style="display:inline-flex;align-items:stretch;margin-left:8px;vertical-align:0.1em;background:#fff;color:#24292f;border:1px solid #d0d7de;border-radius:3px;overflow:hidden;font-family:Verdana,Geneva,DejaVu Sans,sans-serif;font-size:10px;line-height:1;white-space:nowrap;">${repoPart}${starsPart}</span>`
}

// 品牌 logo：把 lobe-icons 的 SVG 调整为徽章内联尺寸与对齐
function brandLogoHtml(svg) {
  return svg
    .replace('height="1em"', 'height="12"')
    .replace('width="1em"', 'width="12"')
    .replace(/style=\"[^\"]*\"/, 'style=\"vertical-align:middle;margin-right:4px;\"')
}

const PROFILE_PHOTO_MARK = 'rm-profile-photo'
const PROFILE_PHOTO_HTML_CSS = `
/* ${PROFILE_PHOTO_MARK} */
.resume-header { position: relative; }
.rm-profile-photo { position: absolute; top: 0; right: 18px; width: 66px; height: 92.4px; object-fit: cover; object-position: center top; border: 1px solid rgba(127,127,127,.35); border-radius: 2px; }
@media (max-width: 520px) {
  .rm-profile-photo { position: static; display: block; margin: 0 auto 16px; }
}
`

function getProfilePhoto(repo) {
  try {
    return resolveProfilePhoto(repo, readCategory(repo, 'basics').photo)
  } catch {
    return null
  }
}

function injectProfilePhotoLatex(text, photoPath) {
  if (!photoPath || text.includes(PROFILE_PHOTO_MARK)) return text
  const source = `\\detokenize{${String(photoPath).replace(/\\/g, '/')}}`
  const packages = [
    text.includes('\\usepackage{graphicx}') ? '' : '\\usepackage{graphicx}',
    text.includes('\\usepackage{eso-pic}') ? '' : '\\usepackage{eso-pic}',
    text.includes('\\usepackage{trimclip}') || text.includes('\\usepackage{adjustbox}') ? '' : '\\usepackage{trimclip}',
  ].filter(Boolean).join('\n')
  // ModernCV Casual 的姓名原生右对齐，照片放在相反角；其余模板右上角留白更充足。
  const horizontalPosition = /\\moderncvstyle\{casual\}/.test(text)
    ? '\\hspace*{0.8cm}%'
    : '\\hspace*{\\dimexpr\\paperwidth-3.3cm\\relax}%'
  const preamble = `${packages ? `${packages}\n` : ''}% ${PROFILE_PHOTO_MARK}
\\newsavebox{\\rmprofilephotobox}
\\newlength{\\rmprofilephototrim}
\\newcommand{\\rmprofilephotoimage}[1]{%
  \\sbox{\\rmprofilephotobox}{\\includegraphics[height=2.52cm]{#1}}%
  \\ifdim\\wd\\rmprofilephotobox>1.8cm
    \\setlength{\\rmprofilephototrim}{\\dimexpr\\wd\\rmprofilephotobox-1.8cm\\relax}%
    \\divide\\rmprofilephototrim by 2
    \\clipbox{\\the\\rmprofilephototrim{} 0pt \\the\\rmprofilephototrim{} 0pt}{\\usebox{\\rmprofilephotobox}}%
  \\else
    \\sbox{\\rmprofilephotobox}{\\includegraphics[width=1.8cm]{#1}}%
    \\setlength{\\rmprofilephototrim}{\\dimexpr\\ht\\rmprofilephotobox-2.52cm\\relax}%
    \\divide\\rmprofilephototrim by 2
    \\clipbox{0pt \\the\\rmprofilephototrim{} 0pt \\the\\rmprofilephototrim{}}{\\usebox{\\rmprofilephotobox}}%
  \\fi
}
\\newcommand{\\rmprofilephoto}[1]{%
  \\AddToShipoutPictureFG*{%
    \\AtPageUpperLeft{%
      \\raisebox{-3.2cm}[0pt][0pt]{%
        ${horizontalPosition}
        \\rmprofilephotoimage{#1}%
      }%
    }%
  }%
}
`
  const next = text.replace(/^(\\begin\{document\})/m, preamble + '$1')
  return next.replace(/^(\\begin\{document\})/m, `$1\n\\rmprofilephoto{${source}}`)
}

function injectProfilePhotoHtml(text, photo) {
  if (!photo || text.includes(PROFILE_PHOTO_MARK)) return text
  const data = fs.readFileSync(photo.file).toString('base64')
  const image = `<!-- ${PROFILE_PHOTO_MARK} --><img class="rm-profile-photo" src="data:${photo.mime};base64,${data}" alt="证件照">`
  let next = text.includes('</style>')
    ? text.replace('</style>', `${PROFILE_PHOTO_HTML_CSS}</style>`)
    : text.replace('</head>', `<style>${PROFILE_PHOTO_HTML_CSS}</style>\n</head>`)
  return next.replace(/<header class="resume-header">/, (header) => `${header}\n      ${image}`)
}

function resolveVariantFonts(repo, variant, override) {
  if (override !== undefined) return normalizeFontSettings(override)
  try {
    return normalizeFontSettings(loadVariantsDoc(repo).variants?.[variant]?.fonts)
  } catch {
    return {}
  }
}

async function normalizeGeneratedOutputs(repo, variant, env, fontOverride) {
  const outDir = path.join(repo, 'resumes')
  const texPath = path.join(outDir, `${variant}.tex`)
  const htmlPath = path.join(outDir, `${variant}.html`)
  const ymlPath = path.join(outDir, `${variant}.yml`)
  const photo = getProfilePhoto(repo)
  const photoPath = photo ? path.relative(outDir, photo.file).replace(/\\/g, '/') : null
  const fonts = resolveVariantFonts(repo, variant, fontOverride)
  let layouts = []
  try {
    layouts = yaml.load(fs.readFileSync(ymlPath, 'utf8'))?.layouts || []
  } catch {
    /* 构建器会在上游报告无效 YAML；后处理保持安全默认值。 */
  }
  const hasLatexLayout = layouts.some((layout) => layout?.engine === 'latex')
  const hasHtmlLayout = layouts.some((layout) => layout?.engine === 'html')
  const htmlTemplate = layouts.find((layout) => layout?.engine === 'html')?.template || 'calm'
  let texChanged = false
  let output = ''

  if (hasLatexLayout && fs.existsSync(texPath)) {
    const original = fs.readFileSync(texPath, 'utf8')
    const normalized = normalizeGroupedLatex(original, photoPath, fonts)
    texChanged = normalized !== original
    if (texChanged) fs.writeFileSync(texPath, normalized, 'utf8')
  }

  if (hasHtmlLayout && fs.existsSync(htmlPath)) {
    const original = fs.readFileSync(htmlPath, 'utf8')
    const normalized = normalizeGroupedHtml(original, photo, fonts, htmlTemplate)
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
export async function buildVariant(repo, variant, { verbose = true, compose = true, fonts } = {}) {
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
    return buildJakeOriginal(repo, variant, env, fonts)
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
    const normalized = await normalizeGeneratedOutputs(repo, variant, env, fonts)
    output += normalized.output || ''
    if (!normalized.ok) return { ok: false, output: output.trim(), pdf: null }
  }
  const ok = r.code === 0 && fs.existsSync(pdf)
  return { ok, output: output.trim(), pdf: ok ? `${variant}.pdf` : null }
}

// 自定义模板 Jake 原版：从组合 YAML 生成 tex 并编译 PDF
async function buildJakeOriginal(repo, variant, env, fontOverride) {
  const outDir = path.join(repo, 'resumes')
  const ymlPath = path.join(outDir, `${variant}.yml`)
  const texPath = path.join(outDir, `${variant}.tex`)
  const pdfPath = path.join(outDir, `${variant}.pdf`)
  try {
    const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'))
    const photo = getProfilePhoto(repo)
    const photoPath = photo ? path.relative(outDir, photo.file).replace(/\\/g, '/') : null
    const fonts = resolveVariantFonts(repo, variant, fontOverride)
    const tex = injectProfilePhotoLatex(injectFontPreferencesLatex(renderJakeOriginal(doc), fonts), photoPath)
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
export async function buildHtmlVariant(repo, variant, { fonts } = {}) {
  const env = checkEnvironment()
  if (!env.yamlresume) {
    return { ok: false, output: '未找到 yamlresume CLI，请先安装：npm install -g yamlresume' }
  }
  const args = ['build', `resumes/${variant}.yml`, '-t', '120']
  const r = await run(env.yamlresume, args, repo)
  const html = path.join(repo, 'resumes', `${variant}.html`)
  let output = r.stdout + r.stderr
  if (r.code === 0) {
    const normalized = await normalizeGeneratedOutputs(repo, variant, env, fonts)
    output += normalized.output || ''
    if (!normalized.ok) return { ok: false, output: output.trim(), html: null }
  }
  const ok = r.code === 0 && fs.existsSync(html)
  return { ok, output: output.trim(), html: ok ? `${variant}.html` : null }
}
