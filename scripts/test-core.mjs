/**
 * 核心链路测试（不启动 Electron 界面）：
 * 文本切分 → 本地合成 → WAV 合并 → 时长校验。
 * 同时验证 SAPI 与 OneCore（浏览器同源音色）两个引擎。
 *
 * 运行：pnpm test:core
 */

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import { join } from 'node:path'
import {
  splitText,
  countChars,
  formatDuration
} from '../src/shared/text-splitter.mjs'
import { SapiEngine } from '../src/main/tts/sapi-engine.mjs'
import { OneCoreEngine } from '../src/main/tts/onecore-engine.mjs'
import { normalizeForNeuralTts } from '../src/main/tts/neural-text.mjs'
import { mergeWavFiles, readWavInfo } from '../src/main/tts/wav.mjs'

const workDir = join(process.cwd(), '.tmp-test')
const runtimeDir = join(workDir, 'runtime')
const jobDir = join(workDir, 'job')

async function main() {
  await fsp.rm(workDir, { recursive: true, force: true })
  await fsp.mkdir(jobDir, { recursive: true })

  testSplitter()
  testChineseSplitCompaction()
  testNeuralTextNormalization()

  const engine = new SapiEngine({ runtimeDir })
  const voices = await engine.listVoices()
  console.log(`\n检测到 ${voices.length} 个系统语音：`)
  for (const voice of voices) {
    console.log(`  - ${voice.name} (${voice.culture}, ${voice.gender}, enabled=${voice.enabled})`)
  }

  const voice =
    voices.find((item) => item.enabled !== false && /^zh/i.test(item.culture)) ||
    voices.find((item) => item.enabled !== false)

  assert.ok(voice, '至少需要一个可用的系统语音')
  console.log(`\n使用声音：${voice.name}`)

  const pieces = ['你好，这是第一段本地语音测试。', '第二段测试，包含数字 2026。']
  const results = []

  for (let index = 0; index < pieces.length; index += 1) {
    const text = pieces[index]
    const textFile = join(jobDir, `input-${index}.txt`)
    const outFile = join(jobDir, `seg-${index}.wav`)
    await fsp.writeFile(textFile, text, 'utf8')

    const startedAt = Date.now()
    await engine.synthesize({
      text,
      textFile,
      outFile,
      voiceName: voice.name,
      rate: 0,
      volume: 100
    })

    const info = await readWavInfo(outFile)
    assert.ok(info.dataSize > 0, '分段音频应当包含数据')
    assert.ok(info.duration > 0, '分段音频时长应大于 0')

    console.log(
      `  第 ${index + 1} 段：${countChars(text)} 字 → ${info.duration.toFixed(2)} 秒，` +
        `${info.fileSize} 字节，${Date.now() - startedAt} ms`
    )
    results.push({ info, outFile, text })
  }

  const mergedFile = join(jobDir, 'merged.wav')
  const merged = await mergeWavFiles(
    results.map((item) => item.outFile),
    mergedFile,
    { gapMs: 300 }
  )

  const mergedInfo = await readWavInfo(mergedFile)
  const expected = results.reduce((total, item) => total + item.info.duration, 0) + 0.3

  assert.ok(
    Math.abs(mergedInfo.duration - expected) < 0.08,
    `合并时长应接近 ${expected.toFixed(2)} 秒，实际 ${mergedInfo.duration.toFixed(2)} 秒`
  )
  assert.equal(mergedInfo.sampleRate, results[0].info.sampleRate)
  assert.equal(mergedInfo.channels, results[0].info.channels)

  console.log(
    `\n合并完成：${mergedInfo.duration.toFixed(2)} 秒，` +
      `${mergedInfo.sampleRate} Hz / ${mergedInfo.channels} 声道 / ${mergedInfo.bitsPerSample} bit`
  )
  console.log(`预期时长：${expected.toFixed(2)} 秒（含 300ms 停顿）`)
  console.log(`合并文件：${mergedFile}`)

  await testOneCoreEngine()

  console.log('\n所有核心测试通过 ✓')

  await fsp.rm(workDir, { recursive: true, force: true })
}

async function testOneCoreEngine() {
  console.log('\n--- OneCore（浏览器本地朗读同源音色）---')

  const engine = new OneCoreEngine({ runtimeDir: join(workDir, 'runtime-onecore') })
  const dir = join(workDir, 'onecore')
  await fsp.mkdir(dir, { recursive: true })

  const voices = await engine.listVoices()
  console.log(`检测到 ${voices.length} 个 OneCore 语音：`)
  for (const voice of voices) {
    console.log(`  - ${voice.name} (${voice.culture}, ${voice.gender})`)
  }

  const voice =
    voices.find((item) => item.enabled !== false && /^zh/i.test(item.culture)) ||
    voices.find((item) => item.enabled !== false)
  assert.ok(voice, '至少需要一个可用的 OneCore 语音')
  console.log(`\n使用声音：${voice.name}`)

  const pieces = ['你好，这是第一段 OneCore 语音测试。', '第二段测试，包含数字 2026。']
  const results = []

  for (let index = 0; index < pieces.length; index += 1) {
    const text = pieces[index]
    const textFile = join(dir, `input-${index}.txt`)
    const outFile = join(dir, `seg-${index}.wav`)
    await fsp.writeFile(textFile, text, 'utf8')

    const startedAt = Date.now()
    await engine.synthesize({
      text,
      textFile,
      outFile,
      voiceName: voice.name,
      rate: 0,
      volume: 100
    })

    const info = await readWavInfo(outFile)
    assert.ok(info.dataSize > 0, 'OneCore 分段音频应当包含数据')
    assert.ok(info.duration > 0, 'OneCore 分段音频时长应大于 0')

    console.log(
      `  第 ${index + 1} 段：${countChars(text)} 字 → ${info.duration.toFixed(2)} 秒，` +
        `${info.fileSize} 字节，${Date.now() - startedAt} ms`
    )
    results.push({ info, outFile })
  }

  const mergedFile = join(dir, 'merged.wav')
  const merged = await mergeWavFiles(
    results.map((item) => item.outFile),
    mergedFile,
    { gapMs: 300 }
  )

  const mergedInfo = await readWavInfo(mergedFile)
  const expected = results.reduce((total, item) => total + item.info.duration, 0) + 0.3

  assert.ok(
    Math.abs(mergedInfo.duration - expected) < 0.08,
    `OneCore 合并时长应接近 ${expected.toFixed(2)} 秒，实际 ${mergedInfo.duration.toFixed(2)} 秒`
  )

  console.log(
    `OneCore 合并完成：${mergedInfo.duration.toFixed(2)} 秒，` +
      `${mergedInfo.sampleRate} Hz / ${mergedInfo.channels} 声道 / ${mergedInfo.bitsPerSample} bit`
  )
  assert.ok(merged.duration > 0)
}

function testSplitter() {
  const text =
    '第一句。第二句！第三句？第四句……\n\n第二段有一个很长很长的句子，' +
    '里面包含逗号，也包含分号；还包含一些 English words. And another sentence! ' +
    '最后再来一句。'

  const chunks = splitText(text, { maxChars: 80, mode: 'auto' })
  assert.ok(chunks.length > 0, '切分结果不应为空')

  const total = chunks.reduce((sum, chunk) => sum + countChars(chunk), 0)
  assert.ok(total > 0, '切分内容不应为空')

  for (const chunk of chunks) {
    assert.ok(countChars(chunk) <= 80, `分段长度不应超过上限：${chunk}`)
    assert.ok(chunk.trim().length > 0, '分段不应为空白')
  }

  const single = splitText(text, { maxChars: 80, mode: 'single' })
  assert.equal(single.length, 1, '整篇模式应只返回一段')

  const longText = '这是一句用于测试超长文本切分的句子，包含标点。'.repeat(200)
  const limited = splitText(longText, { maxChars: 300, mode: 'auto' })
  for (const chunk of limited) {
    assert.ok(countChars(chunk) <= 300, '超长文本分段长度应受限')
  }

  console.log(
    `切分测试通过：${chunks.length} 段 / ${limited.length} 段（长文），` +
      `格式化时长 ${formatDuration(83)}`
  )
}

function testChineseSplitCompaction() {
  const text = '这是第一句。这是第二句。这是第三句。'
  const chunks = splitText(text, { maxChars: 500, mode: 'auto' })
  assert.equal(chunks.length, 1, '短句应合并为一段')
  assert.equal(chunks[0], text, '合并后应保持原文内容')
  console.log('短句合并测试通过')
}

function testNeuralTextNormalization() {
  const result = normalizeForNeuralTts(
    '今天是 2026 年 11 月 19 日，时间是 8:30，价格 88.5 元，完成度 50%，电话 13800138000。'
  )

  for (const expected of [
    '二零二六年十一月十九日',
    '八点三十分',
    '八十八点五',
    '百分之五十',
    '一三八零零一三八零零零'
  ]) {
    assert.ok(result.includes(expected), `神经语音规范化缺少「${expected}」：${result}`)
  }

  assert.equal(
    normalizeForNeuralTts('版本 v1.2.3 保持不变'),
    '版本 v1.2.3 保持不变',
    '版本号不应被拆开朗读'
  )

  console.log('神经语音文本规范化测试通过')
}

main().catch(async (error) => {
  console.error('\n核心测试失败：')
  console.error(error)
  process.exitCode = 1
})
