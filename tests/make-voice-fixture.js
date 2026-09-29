// 声の入力のテスト用音声 tests/fixtures/voice.wav を作る（Windows の音声合成「Haruka」を使う）
// 内容：無音 → 「快度、七」→ 無音 → 「三秒、覚醒度、二」→ 無音。ブラウザの偽のマイク入力として流す
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const OUT = path.join(__dirname, 'fixtures', 'voice.wav');
if (process.platform !== 'win32') { console.log('Windows 以外では作れません（音声合成に Windows の SAPI を使うため）'); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">
<break time="1500ms"/>快度、七。<break time="2500ms"/>三秒、覚醒度、二。<break time="3000ms"/></speak>`;
const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | Select-Object -First 1
if (-not $v) { Write-Error '日本語の音声（Haruka など）が入っていません'; exit 1 }
$s.SelectVoice($v.VoiceInfo.Name)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${OUT.replace(/'/g, "''")}', $fmt)
$s.SpeakSsml(@'
${ssml}
'@)
$s.Dispose()
`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
if (r.status !== 0 || !fs.existsSync(OUT)) process.exit(1);
console.log('作りました:', OUT, `（${(fs.statSync(OUT).size / 1024).toFixed(0)}KB）`);
