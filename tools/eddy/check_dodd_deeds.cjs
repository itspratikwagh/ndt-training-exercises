#!/usr/bin/env node
// Checks the Dodd and Deeds model used by the eddy current lessons, and every number their narration relies on.
//
//   node tools/eddy/check_dodd_deeds.cjs
//
// 1. Each lesson page carries an exact copy of tools/eddy/dodd_deeds_core.js in its <script id="physics"> block.
// 2. The model passes independent checks: an image-coil filament sum (elliptic integrals), the thick-plate and
//    thin-sheet limits, zero thickness = air, and passivity (resistance never negative, reactance never above air).
// 3. The claims each lesson makes still hold. Run this after changing the model, the coil or the lesson numbers.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const core = fs.readFileSync(path.join(__dirname, 'dodd_deeds_core.js'), 'utf8').trim();
let fails = 0;
const ck = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); if (!ok) fails++; };
function load(page, exports) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const src = html.match(/<script id="physics">([\s\S]*?)<\/script>/)[1];
  ck(page + ': physics block carries the shared core unchanged', src.includes(core));
  return new Function(src + ';return {' + exports + '};')();
}
const L1 = load('ET-Impedance-Plane.html', 'Zplate,depthMM,COIL,MU0,SIGMA_IACS,Zn,fOf,sepAngle,XPC,P_PEAK,FMIN,liftOfEta');
const L2 = load('ET-Frequency-and-Thickness.html', 'Zplate,Zm,Zp,deltaMils,sepDirs,THICK,MIL');
const { Zplate, COIL, MU0 } = L1;
const air = { R: 0, X: 1 }, dist = (a, b) => Math.hypot(a.R - b.R, a.X - b.X), IACS = 5.8e7;

console.log('\n--- model checks');
{
  const s = 0.28 * IACS, f = 1e5, thick = Zplate(s, f, Infinity, 0), d10 = Zplate(s, f, 10, 0), d0 = Zplate(s, f, 1e-6, 0);
  ck('plate 25 standard depths thick equals the half-space formula', dist(thick, d10) < 1e-9);
  ck('vanishing thickness gives the air point', dist(d0, air) < 1e-4 * dist(thick, air));
  const MU = MU0, A = (al, l) => { const a = Math.exp(-al * (COIL.wear + l)) - Math.exp(-al * (COIL.wear + l + COIL.h)); return a * a; };
  const DD = new Function(fs.readFileSync(path.join(__dirname, 'dodd_deeds_core.js'), 'utf8') + ';return DD;')();
  function Zthin(sig, f, d) { const k2 = 2 * Math.PI * f * MU * sig * 1e-6; let sr = 0, si = 0; for (let i = 0; i < DD.a.length; i++) { const al = DD.a[i], g = DD.w[i] * A(al, 0), dr = 2 * al, di = k2 * d, dd = dr * dr + di * di; sr += g * (-k2 * d * di) / dd; si += g * (-k2 * d * dr) / dd; } return { R: -si / DD.I0, X: 1 + sr / DD.I0 }; }
  const errs = [0.005, 0.0005, 0.00005].map(d => { const a = Zplate(s * 0.005 / d, 1e4, d, 0), b = Zthin(s * 0.005 / d, 1e4, d); return dist(a, b) / dist(b, air); });
  ck('converges to the thin-sheet (sigma x d) formula', errs[1] < errs[0] / 5 && errs[2] < errs[1] / 5 && errs[2] < 1e-3, errs.map(e => e.toExponential(1)).join(' -> '));
  let pass = true;
  for (const p of [0.1, 1, 10, 100]) for (const f2 of [1e2, 1e4, 1e6, 1e7]) for (const d of [0.001, 0.05, 1, Infinity]) for (const l of [0, 0.5]) { const z = Zplate(p / 100 * IACS, f2, d, l); if (z.R < -1e-12 || z.X > 1 + 1e-12) pass = false; }
  ck('resistance never negative and reactance never above air', pass);
  // independent: reactance drop for a perfect conductor = M(coil, image coil) / L(coil), by summing filament loops
  function ellipK(m) { let a = 1, b = Math.sqrt(1 - m); for (let i = 0; i < 30; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; } return Math.PI / (2 * a); }
  function ellipE(m) { let a = 1, b = Math.sqrt(1 - m), sum = m / 2, p = 1; for (let i = 0; i < 30; i++) { const t = (a + b) / 2, c = (a - b) / 2; b = Math.sqrt(a * b); a = t; p *= 2; sum += p * c * c / 2; } return Math.PI / (2 * a) * (1 - sum); }
  const Mloops = (r1, r2, z) => { const k2 = 4 * r1 * r2 / ((r1 + r2) ** 2 + z * z), k = Math.sqrt(k2); return MU * Math.sqrt(r1 * r2) * ((2 / k - k) * ellipK(k2) - 2 / k * ellipE(k2)); };
  const n = 24, fil = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) fil.push([COIL.r1 + (COIL.r2 - COIL.r1) * (i + 0.5) / n, COIL.h * (j + 0.5) / n]);
  let M = 0, L = 0; const side = (COIL.r2 - COIL.r1) / n;
  for (const p of fil) for (const q of fil) {
    M += Mloops(p[0] * 1e-3, q[0] * 1e-3, (p[1] + q[1] + 2 * COIL.wear) * 1e-3);
    L += p === q ? MU * p[0] * 1e-3 * (Math.log(8 * p[0] / (0.44705 * side)) - 2) : Mloops(p[0] * 1e-3, q[0] * 1e-3, Math.abs(p[1] - q[1]) * 1e-3);
  }
  const pc = Zplate(1e15, 1e7, Infinity, 0);
  ck('perfect-conductor drop matches the image-coil filament sum within 1%', Math.abs((1 - pc.X) / (M / L) - 1) < 0.01, `model ${(1 - pc.X).toFixed(4)}, filaments ${(M / L).toFixed(4)}`);
}

console.log('\n--- Lesson 1 (The Impedance Plane) claims, thick plates at 100 kHz');
{
  const { Zn, fOf, sepAngle } = L1, E = 0.9, at = (iacs, kHz) => Zn(fOf(iacs, kHz || 100), E);
  const al = at(43), cu = at(100);
  ck('on aluminum the dot sits down and right of air', al.X < 1 && al.R > 0);
  ck('copper sits lower and further left than 6061 aluminum', cu.X < al.X && cu.R < al.R);
  const ang = { cu: sepAngle(fOf(100, 100)), al: sepAngle(fOf(43, 100)), ss: sepAngle(fOf(2.4, 100)), ti: sepAngle(fOf(1, 100)) };
  ck('"about forty five degrees" at copper and aluminum', ang.cu > 41 && ang.cu < 48 && ang.al > 40 && ang.al < 48, `Cu ${ang.cu.toFixed(1)}, Al ${ang.al.toFixed(1)}`);
  ck('"about twenty five to thirty degrees" at titanium and stainless', ang.ti > 22 && ang.ti < 28 && ang.ss > 27 && ang.ss < 33, `Ti ${ang.ti.toFixed(1)}, SS ${ang.ss.toFixed(1)}`);
  const t30 = sepAngle(fOf(1, 30)), t100 = ang.ti, t1M = sepAngle(fOf(1, 1000));
  ck('titanium: lower frequency closes the angle, higher opens it', t30 < t100 && t1M > t100 + 8, `${t30.toFixed(1)} < ${t100.toFixed(1)} < ${t1M.toFixed(1)}`);
  ck('titanium standard depth: about 2 mm at 100 kHz, under 1 mm at 1 MHz', Math.abs(L1.depthMM(1, 100) - 2.09) < 0.05 && L1.depthMM(1, 1000) < 1);
  let lo = L1.FMIN, hi = fOf(43, 100); const P = Zn(fOf(43, 100), 0.6), r = Math.hypot(P.R, P.X);
  for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi), z = Zn(m, E); if (Math.hypot(z.R, z.X) > r) lo = m; else hi = m; }
  const Q = Zn(Math.sqrt(lo * hi), E);
  ck('magnitude-only demo: lift-off and a conductivity drop reach the same |Z| at clearly different points', dist(P, Q) > 0.03, `end points ${dist(P, Q).toFixed(3)} apart`);
  ck('perfect conductor sits on the reactance axis below air', L1.XPC > 0.5 && L1.XPC < 0.7, `X = ${L1.XPC.toFixed(4)}`);
}

console.log('\n--- Lesson 2 (Frequency and Thickness) claims');
{
  const { Zm, deltaMils, sepDirs, THICK } = L2, Z = (iacs, kHz, mils) => Zm(iacs, kHz, mils, 0);
  // Check 1: thickness curve shape
  for (const f of [20, 50, 100]) {
    const s = 28, end = Z(s, f, THICK), dl = deltaMils(s, f), span = dist(air, end);
    const cond = []; for (let e = 3; e <= 10.5; e += 0.02) cond.push(L2.Zp(Math.pow(10, e), 0));
    const poly = cond.concat([{ R: 0, X: cond[cond.length - 1].X }, { R: 0, X: 1 }]);
    const inside = p => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.X > p.X) !== (b.X > p.X) && p.R < (b.R - a.R) * (p.X - a.X) / (b.X - a.X) + a.R) c = !c; } return c; };
    const pts = []; for (let k = 1; k <= 400; k++) pts.push(Z(s, f, k * 0.0125 * dl));
    const outside = pts.filter(p => !inside(p) && dist(p, end) > 1e-4).length;
    const A2 = L2.Zp(s * f * 1000 * 1.001, 0), t = { R: A2.R - end.R, X: A2.X - end.X };
    const proj = pts.map(p => (p.R - end.R) * t.R + (p.X - end.X) * t.X); let crossings = 0;
    for (let i = 1; i < proj.length; i++) if (Math.sign(proj[i]) !== Math.sign(proj[i - 1])) crossings++;
    const start = Z(s, f, 0.002 * dl);
    ck(`check 1, brass ${f} kHz: starts near air, swings outside the conductivity curve, hooks, settles`, dist(start, air) < 0.01 * span && outside > 20 && crossings >= 1 && dist(Z(s, f, 2 * dl), end) < 0.012 * span,
      `${outside}/400 points outside; crosses the end point's tangent ${crossings}x`);
  }
  // Check 2: equal steps shrink, nothing changes past ~3 standard depths
  {
    const f = 50, dl = deltaMils(28, f), end = Z(28, f, THICK), span = dist(air, end), pts = [Z(28, f, 1e-4)];
    for (let k = 1; k <= 24; k++) pts.push(Z(28, f, k * 0.25 * dl));
    const gaps = pts.slice(1).map((p, k) => dist(p, pts[k]) / span);
    ck('check 2: equal steps shrink and change under 0.2% per step past 3 standard depths', gaps.slice(3).every((g, k, a) => k === 0 || g <= a[k - 1] * 1.0001) && gaps.slice(12).every(g => g < 0.002) && dist(pts[12], end) / span < 0.002,
      `still to go at 1, 2, 3 depths: ${[4, 8, 12].map(k => (dist(pts[k], end) / span * 100).toFixed(2) + '%').join(', ')}`);
  }
  // Check 3: lower frequency spreads thickness points and needs more thickness to settle
  {
    const rows = [12.5, 25, 50, 100, 200].map(f => { const end = Z(28, f, THICK), span = dist(air, end); let settle = 0; for (let m = 0.5; m < 300; m += 0.5) if (dist(Z(28, f, m), end) < 0.01 * span) { settle = m; break; } let crowd = 0; for (let m = 2; m <= 60; m += 2) if (dist(Z(28, f, m), end) < 0.01 * span) crowd++; return { f, settle, crowd }; });
    ck('check 3: halving the frequency always needs more thickness to settle and piles up fewer points', rows.every((r, i) => i === 0 || (r.settle < rows[i - 1].settle && r.crowd >= rows[i - 1].crowd)), rows.map(r => `${r.f} kHz: ${r.settle} mils, ${r.crowd}/30 piled`).join('; '));
  }
  // Check 4: spread of high and low conductivity groups
  {
    const spread = (ks, f) => { let m = 0; for (let i = 1; i < ks.length; i++) m += dist(Z(ks[i], f, THICK), Z(ks[i - 1], f, THICK)); return m; };
    const hi = [100, 59, 30], lo = [2.4, 1.0, 0.11], near = f => Math.max(...lo.map(k => dist(Z(k, f, THICK), air)));
    ck('check 4: 10 kHz spreads Cu/Al 1100/Al 2024 and bunches 304/Ti/graphite at air; 1 MHz the reverse', spread(hi, 10) > 3 * spread(hi, 1000) && spread(lo, 1000) > 3 * spread(lo, 10) && near(10) < 0.03);
    const a = dist(Z(30, 10, THICK), Z(59, 10, THICK)), b = dist(Z(30, 1000, THICK), Z(59, 1000, THICK));
    ck('Step 2: "almost three times further apart" at 10 kHz than at 1 MHz', a / b > 2.5 && a / b < 3.2, `${(a / b).toFixed(2)}x`);
  }
  // Step 1 angles at 100 kHz
  {
    const g = k => sepDirs(k, 100).deg, v = { cu: g(100), al: g(59), ss: g(2.4), ti: g(1.0) };
    ck('Step 1: "about 44 on copper, 43 on pure aluminum, about 30 on 304, 25 on titanium"', Math.abs(v.cu - 44) < 1.5 && Math.abs(v.al - 43) < 1.5 && Math.abs(v.ss - 30) < 1.5 && Math.round(v.ti) === 25,
      Object.entries(v).map(([k, x]) => k + ' ' + x.toFixed(1)).join(', '));
  }
  // Step 3: 2-mil brass sheet at 50 kHz
  {
    const T = Z(28, 50, THICK), s2 = Z(28, 50, 2);
    ck('Step 3: standard depth of brass at 50 kHz is about 22 mils', Math.abs(deltaMils(28, 50) - 22) < 0.5, deltaMils(28, 50).toFixed(1));
    ck('Step 3: a 2-mil sheet is further left, higher and closer to air than thick brass', s2.R < T.R && s2.X > T.X && dist(s2, air) < dist(T, air));
    let mx = { R: 0 }; for (let m = 1; m <= 40; m += 0.5) { const z = Z(28, 50, m); if (z.R > mx.R) mx = { R: z.R, m }; }
    ck('Step 3: "by about ten mils it has swung out to the right"', mx.m >= 8 && mx.m <= 12 && mx.R > T.R + 0.03, `furthest right at ${mx.m} mils`);
    const span = dist(air, T);
    ck('Step 3: within 1% by 44 mils, nothing visible past 66 mils', dist(Z(28, 50, 44), T) < 0.0105 * span && dist(Z(28, 50, 66), T) < 0.002 * span);
  }
  // Step 4: brass vs 304 at 30 mils, 200 kHz
  {
    const mb = dist(Z(28, 200, 30), Z(28, 200, 31)), ms = dist(Z(2.4, 200, 30), Z(2.4, 200, 31));
    ck('Step 4: one more mil moves 304 about 11 times as far as brass', ms / mb > 8 && ms / mb < 14, `${(ms / mb).toFixed(1)}x`);
    ck('Step 4: standard depths "about thirty eight mils, against eleven for brass"', Math.abs(deltaMils(2.4, 200) - 37.5) < 1 && Math.abs(deltaMils(28, 200) - 11) < 0.5, `${deltaMils(2.4, 200).toFixed(1)} and ${deltaMils(28, 200).toFixed(1)}`);
  }
  // Step 5: 200 vs 400 kHz for 10 to 14 mils of brass
  {
    const g = f => dist(Z(28, f, 10), Z(28, f, 14)), e400 = Z(28, 400, THICK);
    ck('Step 5: 10 to 14 mils spread over about twice as much curve at 200 kHz as at 400 kHz', g(200) / g(400) > 1.8, `${(g(200) / g(400)).toFixed(2)}x`);
    ck('Step 5: at 400 kHz the 14-mil point is within about 1% of thick brass', dist(Z(28, 400, 14), e400) / dist(air, e400) < 0.015);
    ck('Step 5: standard depth about 11 mils at 200 kHz and under 8 at 400 kHz', Math.abs(deltaMils(28, 200) - 11) < 0.5 && deltaMils(28, 400) < 8);
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
