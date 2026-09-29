// 動画の音声の F0：YIN の精度、動画からの計算、表示（評価グラフの3段目・今の F0）、表示のオン／オフ、書き出し
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const { URL, VID, BROWSER, OUT } = require('./_env');
const check = (name, ok, detail = '') => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  await ctx.addInitScript(() => localStorage.removeItem('ahann_f0'));
  const errs = [];
  const open = async (video = VID) => {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss());
    await p.goto(URL); await p.selectOption('#mode', 'emujoy');
    await p.setInputFiles('#file', video); await p.waitForFunction(() => AH.S.meta.duration > 0);
    await p.waitForFunction(() => ['ready', 'error'].includes(AH._.F0.status), null, { timeout: 60000 });
    return p;
  };

  // 1. YIN：合成した音で
  {
    const p = await ctx.newPage(); await p.goto(URL);
    const r = await p.evaluate(() => {
      const sr = 16000, mk = (f, n = 640, harm = false) => Float32Array.from({ length: n }, (_x, i) => Math.sin(2 * Math.PI * f * i / sr) + (harm ? 0.6 * Math.sin(4 * Math.PI * f * i / sr) + 0.3 * Math.sin(6 * Math.PI * f * i / sr) : 0));
      const Y = AH._.yin;
      return { f120: Y(mk(120), 0), f220h: Y(mk(220, 640, true), 0), f440: Y(mk(440), 0), f800: Y(mk(800), 0), silence: Y(new Float32Array(640), 0) };
    });
    const near = (x, f) => Math.abs(x - f) / f < 0.01;
    check('YIN：120・440・800Hz の純音', near(r.f120, 120) && near(r.f440, 440) && near(r.f800, 800), JSON.stringify(r));
    check('YIN：倍音のある 220Hz を 220 と読む（倍・半分に間違えない）', near(r.f220h, 220), r.f220h);
    check('YIN：無音は声なし', Number.isNaN(r.silence), r.silence);
    await p.close();
  }

  // 2. テスト動画（440Hz の音）から計算し、評価グラフと今の F0 に出す
  {
    const p = await open();
    const r = await p.evaluate(() => {
      const F = AH._.F0, v = Array.from(F.f0).filter(x => x > 0).sort((a, b) => a - b);
      return { status: F.status, n: F.f0.length, voiced: v.length, med: v[Math.floor(v.length / 2)], now: document.getElementById('f0Val').textContent, box: !document.getElementById('f0Now').hidden };
    });
    check('動画の音声から F0 を計算する（440Hz の音 → 440Hz）', r.status === 'ready' && r.n > 1100 && r.voiced / r.n > 0.95 && Math.abs(r.med - 440) < 3, JSON.stringify(r));
    check('今の F0 を数値で表示する', r.box && /^44\d Hz$/.test(r.now), r.now);
    await p.evaluate(() => AH._.setTimeline(true)); await p.waitForTimeout(200);
    const lane = await p.evaluate(() => {
      const c = document.getElementById('tl'), d = devicePixelRatio || 1, g = c.getContext('2d');
      const h = c.clientHeight, y = Math.round((h - 18 - 56 + 8 + (56 - 12) / 2) * d);   // F0 の欄の中ほど
      let ink = 0; for (let x = 60; x < c.clientWidth - 20; x += 5) if (g.getImageData(Math.round(x * d), 0, 1, c.height).data.some((v, i) => i % 4 === 3 && v > 0 && Math.abs(i / 4 - y) < 30 * d)) ink++;
      return { h, ink };
    });
    check('評価グラフの3段目に F0 の欄がある', lane.h === 206 && lane.ink > 50, JSON.stringify(lane));
    // 表示を切ると欄と数値が消え、操作ログに残る
    await p.click('#setBtn'); await p.uncheck('#f0Show'); await p.click('#setBtn'); await p.waitForTimeout(200);
    const off = await p.evaluate(() => ({ box: document.getElementById('f0Now').hidden, h: document.getElementById('tl').clientHeight, log: AH.S.log.filter(l => l.type === 'f0_display').map(l => l.value).join(), saved: localStorage.getItem('ahann_f0') }));
    check('設定で F0 の表示を切れる（操作ログに残る）', off.box && off.h === 150 && off.log === 'off' && off.saved === '0', JSON.stringify(off));
    await p.click('#setBtn'); await p.check('#f0Show'); await p.click('#setBtn');
    // 書き出し
    const dls = []; p.on('download', d => dls.push(d));
    await p.click('#exportBtn'); await p.waitForTimeout(1500);
    const f0dl = dls.find(d => d.suggestedFilename().endsWith('_f0.csv'));
    let head = '';
    if (f0dl) { const fp = path.join(OUT, 'f0.csv'); await f0dl.saveAs(fp); head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 3).join(' | '); }
    check('F0 を _f0.csv に書き出す', !!f0dl && /t,f0_hz,rms \| 0\.020,44\d\.\d,/.test(head.replace(/^﻿/, '')), head);
    await p.close();
  }

  // 3. 人の声（合成音声「快度、七」「三秒、覚醒度、二」）の動画：声のあるところだけ F0 が出る
  {
    const wav = path.join(__dirname, 'fixtures', 'voice.wav'), mp4 = path.join(OUT, 'voice.mp4');
    const ok = fs.existsSync(wav) && spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=15', '-i', wav, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]).status === 0;
    if (!ok) console.log('skip  人の声の F0（tests/fixtures/voice.wav か ffmpeg がありません）');
    else {
      const p = await open(mp4);
      const r = await p.evaluate(() => {
        const F = AH._.F0, v = Array.from(F.f0).filter(x => x > 0).sort((a, b) => a - b);
        const at = t => AH._.f0At(t);
        return { voiced: +(v.length / F.f0.length).toFixed(2), p10: Math.round(v[Math.floor(v.length * 0.1)]), p90: Math.round(v[Math.floor(v.length * 0.9)]), silentStart: at(0.5), lo: Math.round(F.lo), hi: Math.round(F.hi) };
      });
      check('人の声：声のあるところだけ F0 が出て、範囲が声の高さ（100〜500Hz）に収まる', r.voiced > 0.1 && r.voiced < 0.7 && r.p10 > 100 && r.p90 < 500 && Number.isNaN(r.silentStart), JSON.stringify(r));
      await p.close();
    }
  }

  console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
