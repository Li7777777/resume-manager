// 简历模板元数据（yamlresume 官网支持的全部模板）
export const TEMPLATES = [
  { id: 'moderncv-banking', engine: 'latex', name: 'ModernCV Banking', desc: '银行风格，左栏高亮 + 简洁两栏布局' },
  { id: 'moderncv-casual', engine: 'latex', name: 'ModernCV Casual', desc: '休闲风格，顶部个人信息栏' },
  { id: 'moderncv-classic', engine: 'latex', name: 'ModernCV Classic', desc: '经典风格，传统规范排版' },
  { id: 'jake', engine: 'latex', name: "Jake's Resume", desc: 'Jake 风格，现代单栏简约设计' },
  { id: 'calm', engine: 'html', name: 'Calm', desc: 'HTML 极简风，适合所有职业（简历定制页实时渲染）' },
  { id: 'vscode', engine: 'html', name: 'VS Code', desc: 'HTML 深色主题，开发者风（简历定制页实时渲染）' },
]

export const ENGINE_LABELS = { latex: 'LaTeX', html: 'HTML', docx: 'Word' }
