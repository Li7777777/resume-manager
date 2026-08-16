import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const CACHE_TTL_MS = 60_000
const MAX_FONT_NAME_LENGTH = 160
const FONT_NAME_RE = /^[\p{L}\p{M}\p{N} .()'_+&-]+$/u
const FALLBACK_FAMILIES = [
  'Arial',
  'Consolas',
  'Microsoft YaHei',
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'SimSun',
  'Times New Roman',
]

const execFileAsync = promisify(execFile)

let cachedCatalog = null
let cachedAt = 0
let pendingCatalog = null

export function normalizeFontFamilyName(value) {
  if (typeof value !== 'string' || value.length > MAX_FONT_NAME_LENGTH || /[\r\n\t]/.test(value)) return null
  const normalized = value.normalize('NFC').trim().replace(/ {2,}/g, ' ')
  if (!normalized || normalized.length > MAX_FONT_NAME_LENGTH || !FONT_NAME_RE.test(normalized) || !/[\p{L}\p{N}]/u.test(normalized)) return null
  return normalized
}

function uniqueFontNames(values) {
  const seen = new Set()
  const result = []
  for (const value of values || []) {
    const family = normalizeFontFamilyName(value)
    const key = family?.toLocaleLowerCase('en-US')
    if (!family || seen.has(key)) continue
    seen.add(key)
    result.push(family)
  }
  return result.sort((a, b) => a.localeCompare(b, 'en-US', { numeric: true, sensitivity: 'base' }))
}

async function run(command, args, timeout = 20_000) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
  })
  return stdout.replace(/^\uFEFF/, '')
}

function expandCoveredFamilies(families, coveredBaseFamilies) {
  const bases = coveredBaseFamilies.map((family) => family.toLocaleLowerCase('en-US'))
  return families.filter((family) => {
    const lower = family.toLocaleLowerCase('en-US')
    return bases.some((base) => lower === base || lower.startsWith(`${base} `))
  })
}

async function readWindowsFonts() {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore
$families = @((New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name } | Sort-Object -Unique)
$cjk = New-Object System.Collections.Generic.List[string]
$latin = New-Object System.Collections.Generic.List[string]
foreach ($family in [Windows.Media.Fonts]::SystemFontFamilies) {
  $supportsCjk = $false
  $supportsLatin = $false
  foreach ($typeface in $family.GetTypefaces()) {
    $glyph = $null
    if ($typeface.TryGetGlyphTypeface([ref]$glyph)) {
      if ($glyph.CharacterToGlyphMap.ContainsKey(0x4E2D)) { $supportsCjk = $true }
      if ($glyph.CharacterToGlyphMap.ContainsKey(0x0041) -and $glyph.CharacterToGlyphMap.ContainsKey(0x0061)) { $supportsLatin = $true }
    }
    if ($supportsCjk -and $supportsLatin) { break }
  }
  if ($supportsCjk) { $cjk.Add($family.Source) }
  if ($supportsLatin) { $latin.Add($family.Source) }
}
[PSCustomObject]@{
  families = @($families)
  cjk = @($cjk | Sort-Object -Unique)
  latin = @($latin | Sort-Object -Unique)
} | ConvertTo-Json -Compress
`
  const raw = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 45_000)
  const parsed = JSON.parse(raw)
  const families = uniqueFontNames(parsed.families)
  if (!families.length) throw new Error('Windows font catalog is empty')
  return {
    source: 'windows',
    families,
    cjkFamilies: uniqueFontNames(expandCoveredFamilies(families, uniqueFontNames(parsed.cjk))),
    latinFamilies: uniqueFontNames(expandCoveredFamilies(families, uniqueFontNames(parsed.latin))),
  }
}

async function readFontconfigFamilies(pattern = ':') {
  const output = await run('fc-list', [pattern, '-f', '%{family[0]}\n'])
  return uniqueFontNames(output.split(/\r?\n/))
}

async function readFontconfigFonts() {
  const [families, cjkFamilies, latinFamilies] = await Promise.all([
    readFontconfigFamilies(':'),
    readFontconfigFamilies(':charset=4e2d'),
    readFontconfigFamilies(':charset=0041'),
  ])
  if (!families.length) throw new Error('fontconfig catalog is empty')
  return { source: 'fontconfig', families, cjkFamilies, latinFamilies }
}

function fallbackCatalog() {
  return {
    source: 'fallback',
    families: uniqueFontNames(FALLBACK_FAMILIES),
    cjkFamilies: uniqueFontNames(['Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Serif CJK SC', 'SimSun']),
    latinFamilies: uniqueFontNames(['Arial', 'Consolas', 'Times New Roman']),
  }
}

async function detectSystemFonts() {
  const readers = process.platform === 'win32'
    ? [readWindowsFonts, readFontconfigFonts]
    : [readFontconfigFonts]
  for (const reader of readers) {
    try {
      const catalog = await reader()
      const cjkFamilies = catalog.cjkFamilies.length ? catalog.cjkFamilies : catalog.families
      const latinFamilies = catalog.latinFamilies.length ? catalog.latinFamilies : catalog.families
      return { ...catalog, cjkFamilies, latinFamilies, detectedAt: new Date().toISOString() }
    } catch {
      // Try the next local enumeration mechanism.
    }
  }
  return { ...fallbackCatalog(), detectedAt: new Date().toISOString() }
}

export async function getSystemFontCatalog({ refresh = false } = {}) {
  const now = Date.now()
  if (!refresh && cachedCatalog && now - cachedAt < CACHE_TTL_MS) return cachedCatalog
  if (pendingCatalog) return pendingCatalog
  pendingCatalog = detectSystemFonts()
  try {
    cachedCatalog = await pendingCatalog
    cachedAt = Date.now()
    return cachedCatalog
  } finally {
    pendingCatalog = null
  }
}
