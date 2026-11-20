/**
 * DeepSeek 在线语音引擎测试（本地 mock，不消耗真实 API 额度）。
 * 运行：pnpm test:deepseek
 */

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeepSeekTtsEngine } from '../src/main/tts/deepseek-engine.mjs'
import { readWavInfo } from '../src/main/tts/wav.mjs'

function makeWav(seconds = 1, sampleRate = 24000) {
  const sampleCount = Math.floor(seconds * sampleRate)
  const data = Buffer.alloc(sampleCount * 2)

  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 0.25
    data.writeInt16LE(Math.round(value * 32767), index * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}

function rms(buffer, info) {
  const data = buffer.subarray(info.dataOffset, info.dataOffset + info.dataSize)
  let sum = 0
  let count = 0

  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    const value = data.readInt16LE(offset) / 32768
    sum += value * value
    count += 1
  }

  return count ? Math.sqrt(sum / count) : 0
}

const wav = makeWav()
let lastRequest = null
let server = null
let workDir = null

async function main() {
  workDir = await fsp.mkdtemp(join(tmpdir(), 'ryjs-deepseek-test-'))

  server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString('utf8')

    let payload = {}
    try { payload = JSON.parse(body) } catch {}

    lastRequest = {
      url: request.url,
      authorization: request.headers.authorization,
      payload
    }

    if (request.headers.authorization !== 'Bearer test-key') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid key' } }))
      return
    }

    const text = String(payload.text || '')

    if (text.includes('ratelimit')) {
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'too many requests' } }))
      return
    }

    if (text.includes('busy')) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'busy' } }))
      return
    }

    if (text.includes('risk')) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Content Exists Risk' } }))
      return
    }

    if (text.includes('json200')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'bad response' } }))
      return
    }

    if (request.url === '/slow') {
      response.writeHead(200, { 'content-type': 'audio/wav' })
      response.write(wav.subarray(0, 44))
      const chunks = wav.subarray(44)
      let offset = 0
      const timer = setInterval(() => {
        if (offset >= chunks.length) {
          clearInterval(timer)
          response.end()
          return
        }
        response.write(chunks.subarray(offset, offset + 8000))
        offset += 8000
      }, 40)
      response.on('close', () => clearInterval(timer))
      return
    }

    response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length })
    response.end(wav)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const keyStatus = async () => ({
    hasKey: true,
    persisted: true,
    source: 'test',
    encryptionAvailable: true
  })

  const engine = new DeepSeekTtsEngine({
    ttsUrl: `${base}/v1/tools/tts`,
    getApiKey: () => 'test-key',
    getKeyStatus: keyStatus
  })

  assert.equal((await engine.getStatus()).ready, true)
  assert.deepEqual(
    (await engine.listVoices()).map((voice) => voice.name),
    ['stella', 'tide']
  )

  const fullFile = join(workDir, 'full.wav')
  await engine.synthesize({
    text: '你好，这是 DeepSeek 测试。',
    outFile: fullFile,
    voiceName: 'stella',
    volume: 100
  })
  const fullInfo = await readWavInfo(fullFile)
  assert.equal(fullInfo.sampleRate, 24000)
  assert.ok(fullInfo.dataSize > 0)
  assert.equal(lastRequest.payload.voice_id, 'stella')
  assert.equal(lastRequest.payload.format, 'wav')
  assert.equal(lastRequest.authorization, 'Bearer test-key')

  const fullRms = rms(await fsp.readFile(fullFile), fullInfo)
  const quietFile = join(workDir, 'quiet.wav')
  await engine.synthesize({
    text: '你好',
    outFile: quietFile,
    voiceName: 'tide',
    volume: 30
  })
  const quietInfo = await readWavInfo(quietFile)
  assert.equal(lastRequest.payload.voice_id, 'tide')
  assert.ok(rms(await fsp.readFile(quietFile), quietInfo) < fullRms * 0.7)

  await assert.rejects(
    () =>
      engine.synthesize({
        text: '中'.repeat(5001),
        outFile: join(workDir, 'long.wav'),
        voiceName: 'stella'
      }),
    /计费字符/
  )
  await assert.rejects(
    () =>
      engine.synthesize({
        text: 'ratelimit',
        outFile: join(workDir, 'rate.wav'),
        voiceName: 'stella'
      }),
    /请求过于频繁/
  )
  await assert.rejects(
    () =>
      engine.synthesize({
        text: 'busy',
        outFile: join(workDir, 'busy.wav'),
        voiceName: 'stella'
      }),
    /服务繁忙/
  )
  await assert.rejects(
    () =>
      engine.synthesize({
        text: 'risk',
        outFile: join(workDir, 'risk.wav'),
        voiceName: 'stella'
      }),
    /内容审核/
  )
  await assert.rejects(
    () =>
      engine.synthesize({
        text: 'json200',
        outFile: join(workDir, 'json.wav'),
        voiceName: 'stella'
      }),
    /返回异常/
  )

  const noKeyEngine = new DeepSeekTtsEngine({
    ttsUrl: `${base}/v1/tools/tts`,
    getApiKey: () => '',
    getKeyStatus: async () => ({ hasKey: false })
  })
  assert.equal((await noKeyEngine.getStatus()).ready, false)
  await assert.rejects(
    () =>
      noKeyEngine.synthesize({
        text: '你好',
        outFile: join(workDir, 'nokey.wav'),
        voiceName: 'stella'
      }),
    /API Key/
  )

  const testEngine = new DeepSeekTtsEngine({
    ttsUrl: `${base}/v1/tools/tts`,
    getApiKey: () => 'test-key',
    getKeyStatus: keyStatus
  })
  assert.equal((await testEngine.testConnection()).ok, true)

  const slowEngine = new DeepSeekTtsEngine({
    ttsUrl: `${base}/slow`,
    getApiKey: () => 'test-key',
    getKeyStatus: keyStatus
  })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 120)
  const slowFile = join(workDir, 'slow.wav')
  await assert.rejects(
    () =>
      slowEngine.synthesize({
        text: '慢速',
        outFile: slowFile,
        voiceName: 'stella',
        signal: controller.signal
      }),
    (error) => error.name === 'AbortError'
  )
  assert.equal(await fsp.stat(slowFile).then(() => true, () => false), false)

  console.log('DeepSeek 引擎 mock 测试通过（未使用真实 API Key）')
}

main()
  .catch((error) => {
    console.error('\nDeepSeek 测试失败：')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    server?.close()
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {})
  })
