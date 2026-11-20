/**
 * PowerShell 脚本内容。
 * 以独立脚本文件执行，避免命令行转义问题；文稿通过 UTF-8 文本文件传入。
 * 使用 Windows 自带的 System.Speech（SAPI），不依赖任何第三方组件或网络。
 */

export const VOICES_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $list = @()
    foreach ($voice in $synth.GetInstalledVoices()) {
      $info = $voice.VoiceInfo
      $list += [PSCustomObject]@{
        name        = $info.Name
        culture     = $info.Culture.Name
        gender      = $info.Gender.ToString()
        age         = $info.Age.ToString()
        description = $info.Description
        enabled     = [bool]$voice.Enabled
      }
    }
    $json = ConvertTo-Json -InputObject @($list) -Depth 4 -Compress
    if ($list.Count -eq 0) { $json = '[]' }
    [System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  }
  finally {
    $synth.Dispose()
  }
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

exit 0
`

export const SYNTH_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$VoiceName = '',
  [int]$Rate = 0,
  [int]$Volume = 100
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  Add-Type -AssemblyName System.Speech
  $text = [System.IO.File]::ReadAllText($TextFile, (New-Object System.Text.UTF8Encoding($false)))
  if ([string]::IsNullOrWhiteSpace($text)) {
    [Console]::Error.WriteLine('The text to synthesize is empty.')
    exit 2
  }

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    if (-not [string]::IsNullOrWhiteSpace($VoiceName)) {
      $synth.SelectVoice($VoiceName)
    }
    $synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
    $synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))

    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
      22050,
      [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
      [System.Speech.AudioFormat.AudioChannel]::Mono
    )

    $synth.SetOutputToWaveFile($OutFile, $format)
    $synth.Speak($text)
  }
  finally {
    $synth.Dispose()
  }

  if (-not (Test-Path -LiteralPath $OutFile)) {
    [Console]::Error.WriteLine('No audio file was generated.')
    exit 3
  }
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

exit 0
`
