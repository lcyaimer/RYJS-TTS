/**
 * Windows 语音引擎共用的 PowerShell 调用工具。
 * 脚本以独立文件执行，避免命令行引号和中文转义问题。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { join } from 'node:path'

export const SCRIPT_TIMEOUT = 10 * 60_000

export function getPowerShellPath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const candidate = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : 'powershell.exe'
}

export function runPowerShell(scriptPath, args, options = {}) {
  const {
    signal,
    timeoutMs = SCRIPT_TIMEOUT,
    timeoutMessage = '语音组件执行超时'
  } = options

  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''

    const child = spawn(
      getPowerShellPath(),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        ...args
      ],
      {
        windowsHide: true,
        signal
      }
    )

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(reject, new Error(timeoutMessage))
    }, timeoutMs)

    function finish(fn, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 16_384) stdout += chunk.toString('utf8')
    })

    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      if (error?.name === 'AbortError' || signal?.aborted) {
        finish(reject, createAbortError())
        return
      }
      finish(reject, new Error(`无法启动 Windows 语音组件：${error.message}`))
    })

    child.on('close', (code) => {
      if (signal?.aborted) {
        finish(reject, createAbortError())
        return
      }
      if (code === 0) {
        finish(resolve, { stdout, stderr })
        return
      }
      const detail = stderr.trim() || stdout.trim()
      finish(reject, new Error(detail || `Windows 语音组件异常退出（代码 ${code}）`))
    })
  })
}

export async function writeScriptIfChanged(filePath, content) {
  // 带 BOM，确保 Windows PowerShell 5.1 正确识别脚本中的 UTF-8 字符
  const data = '\uFEFF' + content
  try {
    const existing = await fsp.readFile(filePath, 'utf8')
    if (existing === data) return
  } catch {
    // 文件不存在时继续写入
  }
  await fsp.writeFile(filePath, data, 'utf8')
}

export function cleanPowerShellError(raw) {
  if (!raw) return ''
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r/g, '')
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return ''

  const useful =
    lines.find((line) => !/^At line:/i.test(line) && !line.startsWith('+') && !/^CategoryInfo/i.test(line)) ||
    lines[0]

  return useful
    .replace(/^Exception calling .*?:\s*/i, '')
    .replace(/^.*?Exception:\s*/i, '')
    .replace(/^"+|"+$/g, '')
    .slice(0, 300)
}

export function createAbortError() {
  const error = new Error('已取消')
  error.name = 'AbortError'
  return error
}
