// 通用类型定义
export type Category =
  | 'basics'
  | 'work'
  | 'education'
  | 'projects'
  | 'skills'
  | 'certificates'
  | 'interests'

export interface Entry {
  id?: string
  tags?: string[]
  notes?: string
  [key: string]: unknown
}

export interface Settings {
  repoPath?: string
  token?: string
  gitUsername?: string
  gitEmail?: string
  // 编译开关：本地编译默认开启，GitHub 编译默认关闭
  localPdfBuild?: boolean
  githubPdfBuild?: boolean
  // Git 同步开关：默认开启；关闭时折叠 git 配置、隐藏看板、时间线只显示正式版
  gitSyncEnabled?: boolean
  // GitHub star 徽章：默认开启；仅正式发布时拉取 star 数，预览只用缓存
  starsEnabled?: boolean
}

export interface Variant {
  name: string
  label?: string
  branch?: string
  locale?: string
  layout?: { engine?: string; template?: string; typography?: { fontSize?: string } }
  htmlLayout?: { engine?: string; template?: string; typography?: { fontSize?: string } }
  sectionOrder?: string[]
  blocks?: Record<string, { include?: string | boolean; tags?: string[]; ids?: string[] }>
  matched?: Record<string, number>
}

export interface GitFileStatus {
  path: string
  badge: 'added' | 'modified' | 'deleted' | 'untracked'
}

export interface Commit {
  oid: string
  short: string
  message: string
  author: string
  timestamp: number
}

export interface ProjectStatus {
  configured: boolean
  gitSyncEnabled?: boolean
  isRepo?: boolean
  branch?: string | null
  remoteUrl?: string | null
  head?: string | null
  dirty?: number
  ahead?: number
  behind?: number
  recentCommits?: Commit[]
  error?: string
}
