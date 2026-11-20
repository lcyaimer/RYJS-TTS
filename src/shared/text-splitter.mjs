/**
 * 文字切分规则（主进程与渲染进程共用）
 * 目标：把任意长度的文稿切成适合单次语音合成的小段。
 * - 优先按段落、句末标点切分
 * - 单句过长时按逗号 / 空格 / 硬长度继续切
 * - 按单段上限合并相邻句子，减少合成次数
 */

export const DEFAULT_MAX_CHARS = 500
export const MIN_MAX_CHARS = 80
export const MAX_MAX_CHARS = 5000
export const MAX_TEXT_CHARS = 200000

const CHINESE_ENDERS = new Set(['。', '！', '？', '；', '…'])
const ALL_ENDERS = new Set(['。', '！', '？', '!', '?', '；', ';', '…'])
const CLOSERS = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '”', '’', '"', '』', '」', '）', ')', ']', '】'])
const LATIN_WORD_START = /^[A-Za-z0-9"'“(\[]/
const LATIN_WORD_END = /[A-Za-z0-9.,!?;:'"”’)\]]$/

export function countChars(text) {
  if (!text) return 0
  let count = 0
  // for...of 按码点迭代，避免拆坏 emoji 等代理对
  for (const _ of String(text)) count += 1
  return count
}

export function clampInt(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

export function splitText(rawText, options = {}) {
  const text = String(rawText ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim()

  if (!text) return []

  const maxChars = clampInt(options.maxChars, MIN_MAX_CHARS, MAX_MAX_CHARS, DEFAULT_MAX_CHARS)
  const mode = options.mode === 'single' ? 'single' : 'auto'

  if (mode === 'single') return [text]

  const units = []
  for (const paragraph of text.split(/\n+/)) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue
    for (const sentence of splitSentences(trimmed)) {
      const value = sentence.trim()
      if (!value) continue
      if (countChars(value) <= maxChars) {
        units.push(value)
      } else {
        units.push(...hardSplit(value, maxChars))
      }
    }
  }

  const chunks = []
  let current = ''
  let currentLength = 0

  for (const unit of units) {
    const unitLength = countChars(unit)

    if (!current) {
      current = unit
      currentLength = unitLength
      continue
    }

    const glue = needsSpace(current, unit) ? ' ' : ''
    if (currentLength + glue.length + unitLength <= maxChars) {
      current += glue + unit
      currentLength += glue.length + unitLength
    } else {
      chunks.push(current)
      current = unit
      currentLength = unitLength
    }
  }

  if (current) chunks.push(current)
  return chunks
}

function splitSentences(paragraph) {
  const chars = Array.from(paragraph)
  const result = []
  let buffer = ''

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]
    buffer += char

    const isBoundary = ALL_ENDERS.has(char) || isLatinPeriodBoundary(chars, i)
    if (!isBoundary) continue

    // 把紧跟其后的引号、括号、连续叹问号并入本句
    while (i + 1 < chars.length && CLOSERS.has(chars[i + 1])) {
      i += 1
      buffer += chars[i]
    }

    if (buffer.trim()) result.push(buffer)
    buffer = ''
  }

  if (buffer.trim()) result.push(buffer)
  return result
}

function isLatinPeriodBoundary(chars, index) {
  if (chars[index] !== '.') return false
  const previous = chars[index - 1] ?? ''
  if (!/[A-Za-z]/.test(previous)) return false

  let cursor = index + 1
  while (cursor < chars.length && '”’"\'』」）)]】'.includes(chars[cursor])) cursor += 1
  if (cursor >= chars.length) return true
  return /\s/.test(chars[cursor])
}

function needsSpace(current, next) {
  return LATIN_WORD_END.test(current) && LATIN_WORD_START.test(next)
}

function hardSplit(unit, maxChars) {
  const chars = Array.from(unit)
  const pieces = []

  while (chars.length > maxChars) {
    const minCut = Math.max(1, Math.floor(maxChars * 0.55))
    let cut = -1

    // 优先在逗号等次级标点后切
    for (let i = maxChars - 1; i >= minCut; i -= 1) {
      if ('，,、：:；;'.includes(chars[i])) {
        cut = i + 1
        break
      }
    }

    // 其次在空白处切（英文）
    if (cut === -1) {
      for (let i = maxChars - 1; i >= minCut; i -= 1) {
        if (/\s/.test(chars[i])) {
          cut = i + 1
          break
        }
      }
    }

    if (cut === -1) cut = maxChars

    const piece = chars.splice(0, cut).join('').trim()
    if (piece) pieces.push(piece)
  }

  const rest = chars.join('').trim()
  if (rest) pieces.push(rest)
  return pieces
}

/**
 * 粗略估算朗读时长（仅用于界面提示，不作为精确值）
 */
export function estimateDurationSeconds(text, rate = 0) {
  const chars = countChars(text)
  if (!chars) return 0
  const safeRate = clampInt(rate, -10, 10, 0)
  const speed = safeRate >= 0 ? 1 + safeRate * 0.16 : Math.max(0.45, 1 + safeRate * 0.055)
  // 中文 Huihui 实测约 3.7 字/秒；英文声音更快，这里只做粗略提示
  return chars / (3.8 * speed)
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
