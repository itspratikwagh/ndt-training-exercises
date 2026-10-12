/* ===== Ferromagnetic plates: the Dodd and Deeds model with relative permeability (used by Lesson 3) =====
   Load after tools/eddy/dodd_deeds_core.js: same coil, grid and normalization, so air still sits at (0, 1).
   A plate with relative permeability mu_r changes only the reflection factor:
     a1 = sqrt(a^2 + j w mu0 mu_r sigma),   m = mu_r a
     Rf = (m - a1)(m + a1)(1 - e^(-2 a1 d)) / ((m + a1)^2 - (m - a1)^2 e^(-2 a1 d)),   thick plate: Rf = (m - a1) / (m + a1)
   With mu_r = 1 this is the core's Zplate exactly. At low frequency Rf tends to (mu_r - 1) / (mu_r + 1) > 0, so a magnetic
   plate raises the reactance above air (the image-coil limit). At high frequency it tends to -1, the perfect-conductor
   point, and the plate behaves like a nonmagnetic one with conductivity sigma / mu_r. mu_r is real: hysteresis loss
   is not modeled. tools/eddy/check_dodd_deeds.cjs checks both limits, passivity and the claims Lesson 3 makes. */
var muCache = {}, muCount = 0;
/* sigma in S/m, fHz in Hz, dmm = plate thickness in mm (Infinity = thick), lift = lift-off in mm, mur = relative
   permeability. Returns {R, X}, normalized and cached: do not modify the returned object. */
function ZplateMu(sigma, fHz, dmm, lift, mur) {
  if (!(mur > 1)) return Zplate(sigma, fHz, dmm, lift);
  if (!(lift < 1e4) || !(sigma > 0) || !(fHz > 0) || !(dmm > 0)) return { R: 0, X: 1 };
  var key = sigma + '|' + fHz + '|' + dmm + '|' + lift + '|' + mur, hit = muCache[key];
  if (hit) return hit;
  var k2 = 2 * Math.PI * fHz * MU0 * mur * sigma * 1e-6, l1 = COIL.wear + lift, l2 = l1 + COIL.h, thick = !(dmm < 1e5), sr = 0, si = 0;
  for (var i = 0; i < DD.a.length; i++) {
    var al = DD.a[i], m = mur * al, A = Math.exp(-al * l1) - Math.exp(-al * l2), g = DD.w[i] * A * A;
    var r = Math.hypot(al * al, k2), qr = Math.sqrt((r + al * al) / 2), qi = Math.sqrt(Math.max(0, (r - al * al) / 2));
    var Rr, Ri, nr, ni, dr, di, dd;
    if (thick) { /* (m - a1) / (m + a1) */
      nr = m - qr; ni = -qi; dr = m + qr; di = qi; dd = dr * dr + di * di;
      Rr = (nr * dr + ni * di) / dd; Ri = (ni * dr - nr * di) / dd;
    } else {
      var e = Math.exp(-2 * qr * dmm), ph = -2 * qi * dmm, er = e * Math.cos(ph), ei = e * Math.sin(ph);
      var c = m * m - al * al, Nr = c * (1 - er) - k2 * ei, Ni = -c * ei - k2 * (1 - er); /* (m^2 - a1^2)(1 - E) = (c - j k2)(1 - E) */
      var pr = m + qr, pi = qi, mr = m - qr, mi = -qi;
      var p2r = pr * pr - pi * pi, p2i = 2 * pr * pi, m2r = mr * mr - mi * mi, m2i = 2 * mr * mi;
      dr = p2r - (m2r * er - m2i * ei); di = p2i - (m2r * ei + m2i * er); dd = dr * dr + di * di;
      Rr = (Nr * dr + Ni * di) / dd; Ri = (Ni * dr - Nr * di) / dd;
    }
    sr += g * Rr; si += g * Ri;
  }
  var z = { R: -si / DD.I0, X: 1 + sr / DD.I0 };
  if (++muCount > 60000) { muCache = {}; muCount = 0; }
  muCache[key] = z;
  return z;
}
/* Standard depth in mm for relative permeability mu_r: delta = 503 / sqrt(f mu_r sigma) */
function depthMuMM(iacs, kHz, mur) { return depthMM(iacs, kHz) / Math.sqrt(mur > 1 ? mur : 1); }
