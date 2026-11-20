/**
 * 启动 electron-vite CLI 的小包装：
 * 某些 IDE / 终端会注入 ELECTRON_RUN_AS_NODE=1，这会让 Electron 以纯 Node 模式运行，
 * 无法打开桌面窗口。这里在启动子进程前移除该变量，保证 pnpm dev / pnpm start 可用。
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

delete process.env.ELECTRON_RUN_AS_NODE

const require = createRequire(import.meta.url)
const packagePath = require.resolve('electron-vite/package.json')
const electronVitePackage = require(packagePath)
const relativeBin =
  typeof electronVitePackage.bin === 'string'
    ? electronVitePackage.bin
    : electronVitePackage.bin?.['electron-vite']

if (!relativeBin) {
  console.error('无法定位 electron-vite CLI')
  process.exit(1)
}

const cliPath = join(dirname(packagePath), relativeBin)
const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
