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

function joinNonEmpty(parts, sep = ' · ') {
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
\\IfFontExistsTF{Noto Serif CJK SC}{\\setCJKmainfont{Noto Serif CJK SC}}{}
\\IfFontExistsTF{Noto Sans CJK SC}{\\setCJKsansfont{Noto Sans CJK SC}}{}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

\\definecolor{rmbadgeleft}{HTML}{24292F}
\\definecolor{rmbadgeright}{HTML}{0969DA}
% GitHub 徽章：Logo + owner/repo 地址 + star 数量
\\newcommand{\\githubbadge}[2]{\\leavevmode\\begingroup\\setlength{\\fboxsep}{1pt}\\raisebox{-1.5pt}{\\colorbox{rmbadgeleft}{\\textcolor{white}{\\fontsize{6.2}{7}\\selectfont\\faGithub\\ \\texttt{#1}}}\\colorbox{rmbadgeright}{\\textcolor{white}{\\fontsize{6.5}{7}\\selectfont\\faStar\\ #2}}}\\endgroup}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]


% Custom commands
\\newcommand{\\resumeItem}[1]{\\item\\small{{#1 \\vspace{-2pt}}}}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & #2 \\\\
      \\textit{\\small#3} & \\textit{\\small #4} \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\small#1 & #2 \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
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
  const match = raw.match(/\s*\[github\|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\|([0-9]+(?:\.[0-9]+)?[km]?)\]/)
  const base = match ? `${raw.slice(0, match.index)}${raw.slice((match.index || 0) + match[0].length)}`.trim() : raw
  const title = `\\textbf{${escapeLatex(base)}}${match ? `\\githubbadge{${match[1]}}{${match[2]}}` : ''}`
  return match ? `\\href{https://github.com/${match[1]}}{${title}}` : title
}

function renderProjects(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return ''
  const body = list
    .map((e) => {
      const techs = (Array.isArray(e.keywords) ? e.keywords : []).map((k) => escapeLatex(k)).join('、')
      const heading = `{${projectTitleLatex(e.name || '')}${techs ? ` $|$ \\emph{${techs}}` : ''}}{${escapeLatex(dateRange(e))}}`
      const description = escapeLatex(e.description || '')
      const items = parseItems(e.summary)
      const itemLines = []
      if (description) itemLines.push(`      \\resumeItem{\\textit{${description}}}`)
      for (const t of items) itemLines.push(`      \\resumeItem{${escapeLatex(t)}}`)
      return `    \\resumeProjectHeading
      ${heading}
${itemLines.length ? `    \\resumeItemListStart\n${itemLines.join('\n')}\n    \\resumeItemListEnd` : ''}`
    })
    .join('\n')
  return `\\section{${SECTION_TITLES.projects}}
\\resumeSubHeadingListStart
${body}
\\resumeSubHeadingListEnd`
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
