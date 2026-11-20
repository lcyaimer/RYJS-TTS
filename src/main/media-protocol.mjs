/**
 * 自定义媒体协议 ryjs-media://
 * 只允许读取合成缓存目录内的 WAV 文件，支持 Range 请求以便播放器拖动进度。
 */

import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import { Readable } from 'node:stream'
import { resolveJobFile } from './tts/cache.mjs'

export const MEDIA_SCHEME = 'ryjs-media'

export function registerMediaSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

export function buildMediaUrl(jobId, fileName) {
  return `${MEDIA_SCHEME}://media/${encodeURIComponent(jobId)}/${encodeURIComponent(fileName)}`
}

export function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'media') return notFound()

      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2) return notFound()

      const jobId = decodeURIComponent(parts[0])
      const fileName = decodeURIComponent(parts[1])

      const filePath = await resolveJobFile(jobId, fileName)
      const stat = await fsp.stat(filePath)
      if (!stat.isFile()) return notFound()

      const baseHeaders = {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }

      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(stat.size) }
        })
      }

      const rangeHeader = request.headers.get('range')
      if (!rangeHeader) {
        return new Response(Readable.toWeb(createReadStream(filePath)), {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(stat.size) }
        })
      }

      const range = parseRange(rangeHeader, stat.size)
      if (!range) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` }
        })
      }

      const { start, end } = range
      return new Response(
        Readable.toWeb(createReadStream(filePath, { start, end })),
        {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`
          }
        }
      )
    } catch {
      return notFound()
    }
  })
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null
  if (!size) return null

  let start
  let end

  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || start >= size || end < start) return null

  return { start, end }
}

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
