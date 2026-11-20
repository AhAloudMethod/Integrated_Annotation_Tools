// Krippendorff の α（分析者間の一致度）．ブラウザでは AH._.alpha，Node では module.exports．
// 式は Krippendorff (2011) "Computing Krippendorff's Alpha-Reliability" の一致行列（coincidence matrix）による．
// 単位（units）は値の配列の配列．欠損は入れない（null・NaN は捨てる）．値が 2 つ以上ある単位だけが計算に入る．
// ブートストラップのため，単位の塊（cluster）ごとに要約（stats）を作り，要約を足し合わせて α を出す．
//   間隔尺度：Σ値・Σ値²・単位内の差の和だけで足りるので，値の種類が多い連続の評価でも速い
//   名義・順序・比率：値ごとの一致行列（疎）を持つ．値は 1e-3 に丸めて同じ値として数える
(() => {
  const SCALES = ['interval', 'ordinal', 'nominal', 'ratio'];
  const key = v => Math.round(v * 1000) / 1000;
  const clean = u => u.filter(v => v != null && Number.isFinite(v));

  // 単位の塊の要約
  function clusterStats(units, scale) {
    if (!SCALES.includes(scale)) throw new Error(`尺度が分かりません：${scale}`);
    const st = { scale, n: 0, units: 0, sum: 0, sum2: 0, dIn: 0, o: new Map() };
    for (const raw of units) {
      const u = clean(raw), m = u.length;
      if (m < 2) continue;
      st.units++; st.n += m;
      if (scale === 'interval') {
        let s = 0, s2 = 0; for (const v of u) { s += v; s2 += v * v; }
        st.sum += s; st.sum2 += s2;
        st.dIn += 2 * (m * s2 - s * s) / (m - 1);   // 単位内の順序つきの対の (a−b)² の和 ÷ (m−1)
      } else {
        const w = 1 / (m - 1);
        for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
          if (i === j) continue;
          const a = key(u[i]), b = key(u[j]);
          let row = st.o.get(a); if (!row) st.o.set(a, row = new Map());
          row.set(b, (row.get(b) || 0) + w);
        }
      }
    }
    return st;
  }

  // 要約を足し合わせる（同じ塊を 2 回使ってよい）
  function merge(list) {
    const scale = list.length ? list[0].scale : 'interval';
    const out = { scale, n: 0, units: 0, sum: 0, sum2: 0, dIn: 0, o: new Map() };
    for (const st of list) {
      out.n += st.n; out.units += st.units; out.sum += st.sum; out.sum2 += st.sum2; out.dIn += st.dIn;
      for (const [a, row] of st.o) {
        let r = out.o.get(a); if (!r) out.o.set(a, r = new Map());
        for (const [b, w] of row) r.set(b, (r.get(b) || 0) + w);
      }
    }
    return out;
  }

  // 要約から α．値が 1 種類しか無い（期待される不一致が 0）か，対が無ければ NaN
  function fromStats(st) {
    const n = st.n;
    if (n < 2) return NaN;
    if (st.scale === 'interval') {
      const De = 2 * (n * st.sum2 - st.sum * st.sum) / (n * (n - 1));
      const Do = st.dIn / n;
      return De > 1e-12 ? 1 - Do / De : NaN;
    }
    const vals = [...st.o.keys()].sort((a, b) => a - b);
    const nc = new Map(vals.map(v => [v, [...st.o.get(v).values()].reduce((p, c) => p + c, 0)]));
    const cum = new Map(); { let c = 0; for (const v of vals) { c += nc.get(v); cum.set(v, c); } }   // 値 v までの n_g の和
    const delta = (a, b) => {
      if (a === b) return 0;
      if (st.scale === 'nominal') return 1;
      if (st.scale === 'ratio') { const s = a + b; return s === 0 ? 0 : ((a - b) / s) ** 2; }
      const lo = Math.min(a, b), hi = Math.max(a, b);   // 順序：lo から hi までの n_g の和 − (n_lo + n_hi)/2
      return (cum.get(hi) - cum.get(lo) + nc.get(lo) - (nc.get(lo) + nc.get(hi)) / 2) ** 2;
    };
    let Do = 0; for (const [a, row] of st.o) for (const [b, w] of row) Do += w * delta(a, b);
    let De = 0; for (const a of vals) for (const b of vals) if (a !== b) De += nc.get(a) * nc.get(b) * delta(a, b);
    Do /= n; De /= n * (n - 1);
    return De > 1e-12 ? 1 - Do / De : NaN;
  }

  const alpha = (units, scale = 'interval') => fromStats(clusterStats(units, scale));

  // 再現できる乱数（mulberry32）
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // 塊を単位に再標本化した α の 95% 区間（百分位法）．塊が 2 つ未満なら null
  function bootstrap(clusters, { iters = 1000, seed = 1, level = 0.95 } = {}) {
    const k = clusters.length;
    if (k < 2 || iters < 1) return null;
    const rand = rng(seed), xs = [];
    for (let i = 0; i < iters; i++) {
      const pick = []; for (let j = 0; j < k; j++) pick.push(clusters[Math.floor(rand() * k)]);
      const a = fromStats(merge(pick));
      if (Number.isFinite(a)) xs.push(a);
    }
    if (!xs.length) return null;
    xs.sort((a, b) => a - b);
    const q = p => { const h = (xs.length - 1) * p, i = Math.floor(h); return xs[i] + (xs[Math.min(i + 1, xs.length - 1)] - xs[i]) * (h - i); };
    return { lo: q((1 - level) / 2), hi: q(1 - (1 - level) / 2), n: xs.length };
  }

  const api = { SCALES, alpha, clusterStats, merge, fromStats, bootstrap };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else AH._.alpha = api;
})();
