/**
 * 神经语音引擎的文本规范化。
 * Piper / Kokoro 的中文词表不包含阿拉伯数字，直接合成会跳过数字；
 * 这里把常见数字、日期、时间、百分比等转成中文读法。
 */

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const SMALL_UNITS = ['', '十', '百', '千']
const BIG_UNITS = ['', '万', '亿', '万亿']

export function normalizeForNeuralTts(text) {
  let value = String(text ?? '')

  // 全角数字和百分号
  value = value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xfee0))
  value = value.replace(/％/g, '%')

  // 货币
  value = value.replace(/[¥￥]\s*(\d+(?:\.\d+)?)/g, (_, number) => `${numberToChineseText(number)}元`)
  value = value.replace(/\$\s*(\d+(?:\.\d+)?)/g, (_, number) => `${numberToChineseText(number)}美元`)

  // 完整日期：2026年11月19日 / 2026-11-19 / 2026/11/19
  value = value.replace(
    /(^|[^\d])(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g,
    (_, prefix, year, month, day) =>
      `${prefix}${digitsToChinese(year)}年${numberToChineseText(month)}月${numberToChineseText(day)}日`
  )
  value = value.replace(
    /(^|[^\d])(\d{4})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{1,2})(?!\d)/g,
    (_, prefix, year, month, day) =>
      `${prefix}${digitsToChinese(year)}年${numberToChineseText(month)}月${numberToChineseText(day)}日`
  )

  // 年份区间：2019-2020年
  value = value.replace(
    /(^|[^\d])(\d{4})\s*[-~至]\s*(\d{4})\s*年/g,
    (_, prefix, start, end) => `${prefix}${digitsToChinese(start)}年至${digitsToChinese(end)}年`
  )

  // 年份单独出现：2026年 → 二零二六年
  value = value.replace(/(^|[^\d])(\d{4})\s*(?=年)/g, (_, prefix, year) =>
    `${prefix}${digitsToChinese(year)}`
  )

  // 时间：8:30 / 08:30:15
  value = value.replace(
    /(^|[^\d])(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?!\d)/g,
    (_, prefix, hour, minute, second) => {
      const minuteNumber = Number(minute)
      let result = `${prefix}${numberToChineseText(hour)}点`
      result += minuteNumber === 0 ? '整' : `${numberToChineseText(minute)}分`
      if (second != null) result += `${numberToChineseText(second)}秒`
      return result
    }
  )

  // 百分比
  value = value.replace(/(\d+(?:\.\d+)?)%/g, (_, number) => `百分之${numberToChineseText(number)}`)

  // 常见单位符号
  value = value.replace(/℃|°C/g, '摄氏度').replace(/㎡/g, '平方米')

  // 电话号码、验证码等长数字逐位读
  value = value.replace(/(^|[^\dA-Za-z])\+?(\d{11,})(?![\dA-Za-z])/g, (_, prefix, digits) =>
    `${prefix}${digitsToChinese(digits)}`
  )

  // 普通数字
  value = value.replace(
    /(^|[^\dA-Za-z.])(-?)(\d+(?:\.\d+)?)(?![\dA-Za-z])/g,
    (_match, prefix, sign, number) =>
      `${prefix}${sign ? '负' : ''}${numberToChineseText(number)}`
  )

  return value
}

function digitsToChinese(value) {
  return String(value)
    .split('')
    .map((char) => DIGITS[Number(char)] ?? char)
    .join('')
}

function numberToChineseText(value) {
  const raw = String(value).trim()
  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const [integerPart, decimalPart] = unsigned.split('.')

  let result = integerToChinese(integerPart || '0')
  if (decimalPart) {
    result += '点' + digitsToChinese(decimalPart)
  }

  return `${negative ? '负' : ''}${result}`
}

function integerToChinese(value) {
  let number
  try {
    number = BigInt(String(value || '0'))
  } catch {
    return digitsToChinese(value)
  }

  if (number === 0n) return '零'

  const groups = []
  while (number > 0n) {
    groups.push(Number(number % 10000n))
    number /= 10000n
  }

  if (groups.length > BIG_UNITS.length) return digitsToChinese(value)

  let result = ''
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]

    if (group === 0) {
      if (result && !result.endsWith('零')) result += '零'
      continue
    }

    if (result && group < 1000 && !result.endsWith('零')) result += '零'
    result += fourDigitsToChinese(group) + BIG_UNITS[index]
  }

  result = result.replace(/零+$/g, '')
  result = result.replace(/^一十/, '十')

  return result
}

function fourDigitsToChinese(group) {
  let result = ''
  let pendingZero = false

  for (let position = 3; position >= 0; position -= 1) {
    const digit = Math.floor(group / 10 ** position) % 10

    if (digit === 0) {
      if (result) pendingZero = true
      continue
    }

    if (pendingZero) {
      result += '零'
      pendingZero = false
    }

    result += DIGITS[digit] + SMALL_UNITS[position]
  }

  return result
}
