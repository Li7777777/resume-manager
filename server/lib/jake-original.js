import { Lexer } from 'marked'
import { brandLabel } from './brand-icons.js'

// Jake Gut 原版模板渲染器：从组合后的简历 YAML 直接生成 jakegut/resume.tex 风格 LaTeX
// 参考：https://github.com/jakegut/resume —— 单栏 ATS 友好排版：
//   居中姓名头部 + \titlerule 下划线分节 + tabular* 日期右对齐 + 项目单行标题 + 紧凑 itemize 要点

const DEGREE_LABELS = {
  'Middle School': '初中',
  'High School': '高中',
  Diploma: '专科',
  Associate: '副学士',
  Bachelor: '学士',
  Master: '硕士',
  Doctor: '博士',
}

const SECTION_TITLES = {
  basics: '个人简介',
  education: '教育背景',
  work: '工作经历',
  projects: '项目经历',
  skills: '专业技能',
  certificates: '证书资质',
  interests: '兴趣爱好',
}

// 转义 LaTeX 特殊字符（反斜杠用占位符最后替换，避免二次转义）
function escapeLatex(text) {
  if (text == null) return ''
  return String(text)
    .replace(/\\/g, '\u0000')
    .replace(/[&%$#_{}]/g, (ch) => '\\' + ch)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}')
}

function formatDate(d) {
  if (!d) return ''
  const m = String(d).trim().match(/^(\d{4})-(\d{1,2})/)
  if (m) return `${m[1]}年${parseInt(m[2], 10)}月`
  return String(d)
}

function dateRange(e) {
  const start = formatDate(e?.startDate)
  const end = e?.endDate ? formatDate(e.endDate) : (e?.startDate ? '至今' : '')
  if (start && end) return `${start} -- ${end}`
  return start || end || ''
}

const EDUCATION_SEPARATOR = '\\hspace{0.4em}·\\hspace{0.4em}'

function joinNonEmpty(parts, sep = EDUCATION_SEPARATOR) {
  return parts.filter((p) => p && String(p).trim()).join(sep)
}

// summary 是 markdown 列表字符串（"- 项"），解析为要点数组；非列表则整段作为一条
function parseItems(summary) {
  const s = String(summary || '').trim()
  if (!s) return []
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length && lines.every((l) => /^[-*•]/.test(l))) {
    return lines.map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
  }
  return lines
}

function renderMarkdownInline(tokens = []) {
  return tokens.map((token) => {
    if (token.type === 'strong') return `\\textbf{${renderMarkdownInline(token.tokens)}}`
    if (token.type === 'em') return `\\emph{${renderMarkdownInline(token.tokens)}}`
    if (token.type === 'codespan') return `\\texttt{${escapeLatex(token.text)}}`
    if (token.type === 'link') return `\\href{${escapeLatex(token.href)}}{${renderMarkdownInline(token.tokens)}}`
    if (token.type === 'br') return '\\\\{}'
    if (Array.isArray(token.tokens)) return renderMarkdownInline(token.tokens)
    return escapeLatex(token.text || token.raw || '')
  }).join('')
}

function renderMarkdownList(token, depth = 0) {
  const environment = token.ordered ? 'enumerate' : 'itemize'
  // 显式管理列表间距，避免依赖模板中的负间距把项目标题、背景和要点压在一起。
  const options = depth > 0
    ? '[leftmargin=1.4em, topsep=1pt, itemsep=1pt, parsep=0pt, partopsep=0pt]'
    : '[leftmargin=1.4em, topsep=2pt, itemsep=1pt, parsep=0pt, partopsep=0pt]'
  const items = token.items.map((item) => {
    const parts = item.tokens.map((child) => {
      if (child.type === 'list') return `\n${renderMarkdownList(child, depth + 1)}`
      if (child.type === 'space') return ''
      return renderMarkdownInline(child.tokens || Lexer.lexInline(child.text || child.raw || ''))
    }).join('')
    return `\\item ${parts}`
  }).join('\n')
  return `\\begin{${environment}}${options}\n${items}\n\\end{${environment}}`
}

function renderProjectMarkdown(summary) {
  const source = String(summary || '').trim()
  if (!source) return ''
  const blocks = Lexer.lex(source)
  return blocks.map((token) => {
    if (token.type === 'list') return renderMarkdownList(token)
    if (token.type === 'space') return ''
    const inline = renderMarkdownInline(token.tokens || Lexer.lexInline(token.text || token.raw || ''))
    return inline ? `\\begin{itemize}\n\\item ${inline}\n\\end{itemize}` : ''
  }).filter(Boolean).join('\n')
}

// "方向：技能、技能" 中方向加粗
function boldLabel(name) {
  const idx = name.indexOf('：')
  if (idx > 0) return `\\textbf{${escapeLatex(name.slice(0, idx))}}${escapeLatex(name.slice(idx))}`
  return escapeLatex(name)
}

const PREAMBLE = `\\documentclass[a4paper,11pt]{article}

\\usepackage{titlesec}
\\usepackage[usenames,dvipsnames]{xcolor}
\\IfFileExists{fontawesome5.sty}{\\usepackage{fontawesome5}}{\\providecommand{\\faGithub}{GitHub}\\providecommand{\\faStar}{*}}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\usepackage[a4paper,top=1.27cm,bottom=1.27cm,left=1.27cm,right=1.27cm]{geometry}

\\usepackage{fontspec}
\\IfFontExistsTF{Linux Libertine O}{
  \\setmainfont[Ligatures={TeX, Common}, Numbers=Lining]{Linux Libertine O}
}{}
\\usepackage[UTF8, heading=false, punct=kaiming, scheme=plain, space=auto]{ctex}
\\IfFontExistsTF{Microsoft YaHei}{\\setCJKmainfont{Microsoft YaHei}}{\\IfFontExistsTF{Noto Serif CJK SC}{\\setCJKmainfont{Noto Serif CJK SC}}{}}
\\IfFontExistsTF{Microsoft YaHei}{\\setCJKsansfont{Microsoft YaHei}}{\\IfFontExistsTF{Noto Sans CJK SC}{\\setCJKsansfont{Noto Sans CJK SC}}{}}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

\\definecolor{rmbadgeborder}{HTML}{D0D7DE}
\\definecolor{rmbadgeleft}{HTML}{FFFFFF}
\\definecolor{rmbadgeright}{HTML}{FFFFFF}
\\definecolor{rmbadgetext}{HTML}{24292F}
% GitHub 徽章：Logo + owner/repo 地址 + star 数量
% 保留徽章的真实高度/深度，让所在行按内容自然撑开；不能伪装成 0pt 高盒子。
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
% 品牌徽章：非 GitHub 链接的品牌名（lobe-icons 的 SVG 无法嵌入 xelatex，用文字徽章回退）
\\newcommand{\\brandbadge}[1]{%
  \\leavevmode\\begingroup\\setlength{\\fboxsep}{1pt}\\setlength{\\fboxrule}{0.35pt}%
  \\hspace{0.3em}\\raisebox{0.6pt}{%
    \\fcolorbox{gray!60}{white}{%
      \\fontsize{6.5}{6.5}\\selectfont\\strut
      \\textcolor{gray!70}{#1}%
    }%
  }%
  \\hspace{0.2em}\\endgroup}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]


% Custom commands
\\newcommand{\\resumeItem}[1]{\\item\\small{{#1 \\vspace{-2pt}}}}

\\newcommand{\\resumeSubheading}[4]{%
  \\vspace{-2pt}\\item
    \\if\\relax\\detokenize{#3}\\relax
      \\if\\relax\\detokenize{#4}\\relax
        \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
          \\textbf{#1} & #2 \\\\%
        \\end{tabular*}%
      \\else
        \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
          \\textbf{#1} & #2 \\\\%
          \\textit{\\small #4} & \\\\%
        \\end{tabular*}%
      \\fi
    \\else
      \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
        \\textbf{#1} & #2 \\\\%
        \\textit{\\small#3} & \\textit{\\small #4} \\\\%
      \\end{tabular*}%
    \\fi
    \\vspace{-7pt}%
}

\\newcommand{\\resumeProjectHeading}[2]{%
  \\item
  % 这里位于 itemize 内部，必须使用当前列表的真实行宽；X 列负责长标题自然换行。
  \\begin{tabularx}{\\linewidth}[t]{@{}>{\\raggedright\\arraybackslash}Xr@{}}
    {\\small #1} & {\\small #2} \\\\
  \\end{tabularx}\\par
}

\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeProjectListStart}{\\begin{itemize}[leftmargin=0.15in, label={}, topsep=3pt, itemsep=4pt, parsep=0pt, partopsep=0pt]}
\\newcommand{\\resumeProjectListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}
`

function renderHeader(basics) {
  const name = escapeLatex(basics.name || '')
  const headline = escapeLatex(basics.headline || '')
  const phone = escapeLatex(basics.phone || '')
  const email = escapeLatex(basics.email || '')
  const url = escapeLatex(basics.url || '')
  const contact = [
    phone || null,
    email ? `\\href{mailto:${email}}{\\underline{${email}}}` : null,
    url ? `\\href{${url}}{\\underline{${url}}}` : null,
  ].filter(Boolean).join(' $|$ ')

  const lines = [`\\textbf{\\Huge \\scshape ${name}}\\vspace{2pt}`]
  if (headline) lines.push(`{\\small ${headline}}`)
  if (contact) lines.push(`{\\small ${contact}}`)
  return `\\begin{center}\n${lines.join(' \\\\\n')}\n\\end{center}`
}

function renderSummary(summary) {
  const items = parseItems(summary)
  if (!items.length) return ''
  return `\\section{${SECTION_TITLES.basics}}
\\resumeItemListStart
${items.map((t) => `  \\resumeItem{${escapeLatex(t)}}`).join('\n')}
\\resumeItemListEnd`
}

function renderEducation(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const body = list
    .map((e) => {
      const degree = DEGREE_LABELS[e.degree] || escapeLatex(e.degree || '')
      const detail = joinNonEmpty([
        degree,
        escapeLatex(e.area),
        e.score ? `成绩：${escapeLatex(e.score)}` : '',
      ])
      const items = parseItems(e.summary)
      return `    \\resumeSubheading
      {${escapeLatex(e.institution || e.name || '')}}{}
      {${detail}}{${escapeLatex(dateRange(e))}}
${items.length ? `    \\resumeItemListStart\n${items.map((t) => `      \\resumeItem{${escapeLatex(t)}}`).join('\n')}\n    \\resumeItemListEnd` : ''}`
    })
    .join('\n')
  return `\\section{${SECTION_TITLES.education}}
\\resumeSubHeadingListStart
${body}
\\resumeSubHeadingListEnd`
}

function renderWork(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const body = list
    .map((e) => {
      const items = parseItems(e.summary)
      return `    \\resumeSubheading
      {${escapeLatex(e.position || '')}}{${escapeLatex(dateRange(e))}}
      {${escapeLatex(e.name || e.company || '')}}{${escapeLatex(e.url || '')}}
${items.length ? `    \\resumeItemListStart\n${items.map((t) => `      \\resumeItem{${escapeLatex(t)}}`).join('\n')}\n    \\resumeItemListEnd` : ''}`
    })
    .join('\n')
  return `\\section{${SECTION_TITLES.work}}
\\resumeSubHeadingListStart
${body}
\\resumeSubHeadingListEnd`
}

// 项目名中的「[github|owner/repo|4.2k]」标记 → GitHub Logo + 地址 + stars 数
function projectTitleLatex(name) {
  const raw = String(name || '')
  const github = raw.match(/\s*\[github\|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\|([0-9]+(?:\.[0-9]+)?[km]?)?\]/)
  const brand = raw.match(/\s*\[brand\|([a-z0-9-]+)\]/)
  let base = raw
  let badge = ''
  if (github) {
    base = `${raw.slice(0, github.index)}${raw.slice((github.index || 0) + github[0].length)}`.trim()
    badge = `\\githubbadge{${github[1]}}{${github[2] || ''}}`
  } else if (brand) {
    base = `${raw.slice(0, brand.index)}${raw.slice((brand.index || 0) + brand[0].length)}`.trim()
    badge = `\\brandbadge{${escapeLatex(brandLabel(brand[1]))}}`
  }
  const title = `\\textbf{${escapeLatex(base)}}${badge}`
  return github ? `\\href{https://github.com/${github[1]}}{${title}}` : title
}

function renderProjects(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const body = list
    .map((e) => {
      const techs = (Array.isArray(e.keywords) ? e.keywords : []).map((k) => escapeLatex(k)).join('、')
      const heading = `{${projectTitleLatex(e.name || '')}${techs ? ` $|$ \\emph{${techs}}` : ''}}{${escapeLatex(dateRange(e))}}`
      const background = escapeLatex(e.description || '')
      const points = renderProjectMarkdown(e.summary)
      return `    \\resumeProjectHeading
      ${heading}
${background ? `    {\\small ${background}\\par}\n` : ''}${points ? `    ${points}` : ''}`
    })
    .join('\n')
  return `\\section{${SECTION_TITLES.projects}}
\\resumeProjectListStart
${body}
\\resumeProjectListEnd`
}

function renderSkills(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const lines = list.map((s) => `      ${boldLabel(s.name || '')}`).join(' \\\\\n')
  return `\\section{${SECTION_TITLES.skills}}
\\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
${lines}
    }}
\\end{itemize}`
}

function renderCertificates(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const body = list
    .map((e) => `    \\resumeSubheading
      {${escapeLatex(e.name || '')}}{${escapeLatex(e.date ? formatDate(e.date) : '')}}
      {${escapeLatex(e.issuer || '')}}{${escapeLatex(e.url || '')}}`)
    .join('\n')
  return `\\section{${SECTION_TITLES.certificates}}
\\resumeSubHeadingListStart
${body}
\\resumeSubHeadingListEnd`
}

function renderInterests(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const line = list.map((e) => escapeLatex(e.name || '')).filter(Boolean).join('、')
  if (!line) return ''
  return `\\section{${SECTION_TITLES.interests}}
\\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{ ${line} }}
\\end{itemize}`
}

// 从组合后的 YAML 对象生成完整 .tex
export function renderJakeOriginal(resume) {
  const content = resume?.content || {}
  const basics = content.basics || {}
  const order = resume?.layouts?.[0]?.sections?.order || Object.keys(content)

  const sections = []
  for (const key of order) {
    if (key === 'basics') {
      const s = renderSummary(basics.summary)
      if (s) sections.push(s)
    } else if (key === 'education') {
      const s = renderEducation(content.education)
      if (s) sections.push(s)
    } else if (key === 'work') {
      const s = renderWork(content.work)
      if (s) sections.push(s)
    } else if (key === 'projects') {
      const s = renderProjects(content.projects)
      if (s) sections.push(s)
    } else if (key === 'skills') {
      const s = renderSkills(content.skills)
      if (s) sections.push(s)
    } else if (key === 'certificates') {
      const s = renderCertificates(content.certificates)
      if (s) sections.push(s)
    } else if (key === 'interests') {
      const s = renderInterests(content.interests)
      if (s) sections.push(s)
    }
  }

  return `${PREAMBLE}

\\begin{document}

${renderHeader(basics)}

${sections.join('\n\n')}

\\end{document}
`
}
