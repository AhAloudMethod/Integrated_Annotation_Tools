// テスト動画 tests/fixtures/test.mp4（12秒・640x360・30fps・音声つき）を ffmpeg で作り直す
// 使い方：npm run fixture（ffmpeg が PATH にあること）
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { VID } = require('./_env');

fs.mkdirSync(path.dirname(VID), { recursive: true });
const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=12',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=12',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', '-movflags', '+faststart', VID], { stdio: 'inherit' });
if (r.error || r.status !== 0) { console.error('ffmpeg で動画を作れませんでした', r.error ? r.error.message : ''); process.exit(1); }
console.log('作成しました:', VID);
