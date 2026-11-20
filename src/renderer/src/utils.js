import { formatDuration } from '@shared/text-splitter.mjs'

export { formatDuration }

export function humanDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  if (value < 60) return `${value} 秒`

  const minutes = Math.floor(value / 60)
  const restSeconds = value % 60
  if (minutes < 60) {
    return restSeconds ? `${minutes} 分 ${restSeconds} 秒` : `${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`
}

export function toErrorMessage(error) {
  let message = String(error?.message || error || '未知错误').trim()
  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .trim()
  return message || '未知错误'
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`
  if (value < 1024 ** 3) {
    const megabytes = value / 1024 ** 2
    return `${megabytes < 10 ? megabytes.toFixed(1) : megabytes.toFixed(0)} MB`
  }
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}
