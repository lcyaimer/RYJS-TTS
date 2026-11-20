/**
 * Windows OneCore 语音脚本。
 * OneCore 是 Windows 10/11 为 Edge、讲述人和浏览器 Web Speech API 提供本地语音的同一套声音，
 * 通常比经典 SAPI（System.Speech）多出更多音色。这里直接调用 WinRT 合成并输出 WAV。
 */

export const ONECORE_VOICES_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null

  $list = @()
  foreach ($voice in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    $list += [PSCustomObject]@{
      name        = $voice.DisplayName
      culture     = $voice.Language
      gender      = [string]$voice.Gender
      description = $voice.Description
      id          = $voice.Id
      enabled     = $true
    }
  }

  $json = ConvertTo-Json -InputObject @($list) -Depth 4 -Compress
  if ($list.Count -eq 0) { $json = '[]' }
  [System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

exit 0
`

export const ONECORE_SYNTH_SCRIPT = `
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
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
  })[0]

  function Await($operation, $resultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
    $netTask = $asTask.Invoke($null, @($operation))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  $text = [System.IO.File]::ReadAllText($TextFile, (New-Object System.Text.UTF8Encoding($false)))
  if ([string]::IsNullOrWhiteSpace($text)) {
    [Console]::Error.WriteLine('The text to synthesize is empty.')
    exit 2
  }

  $synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
  try {
    if (-not [string]::IsNullOrWhiteSpace($VoiceName)) {
      $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
        Where-Object { $_.DisplayName -eq $VoiceName } |
        Select-Object -First 1

      if (-not $voice) {
        [Console]::Error.WriteLine("Voice not found: $VoiceName")
        exit 4
      }
      $synth.Voice = $voice
    }

    $rateValue = [Math]::Max(-10, [Math]::Min(10, $Rate))
    if ($rateValue -ge 0) {
      $speed = 1.0 + ($rateValue * 0.16)
    }
    else {
      $speed = [Math]::Max(0.5, 1.0 + ($rateValue * 0.06))
    }

    $volumeValue = [Math]::Max(0, [Math]::Min(100, $Volume))
    $synth.Options.SpeakingRate = [Math]::Round($speed, 3)
    $synth.Options.AudioVolume = [Math]::Round($volumeValue / 100.0, 3)

    $stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    try {
      $fileStream = [System.IO.File]::Create($OutFile)
      try {
        $netStream.CopyTo($fileStream)
      }
      finally {
        $fileStream.Dispose()
      }
    }
    finally {
      $netStream.Dispose()
    }
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
