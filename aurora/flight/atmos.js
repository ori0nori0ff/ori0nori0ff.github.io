/* US Standard Atmosphere 1976 (NOAA / NASA / USAF, NOAA-S/T 76-1562), layers 0-86 km (geometric ~86 km = geopotential 84.852 km).
   Own code from the published layer constants. Above 84.852 km geopotential: an exponential continuation (scale height from the last layer),
   labelled as an estimate; the molecular-weight change above 80 km is ignored (< 0.1 % in T below 86 km).
   Input: altitude above mean sea level (m, geometric). Output: { T (K), p (Pa), rho (kg/m³), a (m/s) }. */
const R0 = 6356766;               // m, the effective Earth radius of the standard (geopotential conversion)
const RS = 287.05287;             // J/(kg·K), specific gas constant of dry air (R* / M0)
const G0 = 9.80665, GAMMA = 1.4;
// base geopotential height (m), base temperature (K), lapse rate (K/m), base pressure (Pa)
const L = [[0, 288.15, -.0065, 101325], [11000, 216.65, 0, 22632.06], [20000, 216.65, .001, 5474.889], [32000, 228.65, .0028, 868.0187],
  [47000, 270.65, 0, 110.9063], [51000, 270.65, -.0028, 66.93887], [71000, 214.65, -.002, 3.956420], [84852, 186.946, 0, .3733836]];

export function atmosphere(zMSL) {
  const z = Math.max(-5000, zMSL), h = R0 * z / (R0 + z);   // geopotential height
  let i = L.length - 1; while (i > 0 && h < L[i][0]) i--;
  const [hb, Tb, Lb, pb] = L[i], dh = h - hb; let T, p;
  if (i === L.length - 1) { T = Tb; p = pb * Math.exp(-G0 * dh / (RS * Tb)); }   // above 84.852 km: isothermal continuation (estimate)
  else if (Lb === 0) { T = Tb; p = pb * Math.exp(-G0 * dh / (RS * Tb)); }
  else { T = Tb + Lb * dh; p = pb * Math.pow(Tb / T, G0 / (RS * Lb)); }
  return { T, p, rho: p / (RS * T), a: Math.sqrt(GAMMA * RS * T) };
}

// calibrated airspeed from Mach and static pressure (subsonic isentropic pitot; supersonic Rayleigh pitot formula)
const P0 = 101325, A0 = 340.294;
export function casOf(mach, p) {
  const M = Math.max(0, mach);
  const qc = M < 1 ? p * (Math.pow(1 + .2 * M * M, 3.5) - 1) : p * (166.92158 * Math.pow(M, 7) / Math.pow(7 * M * M - 1, 2.5) - 1);
  // invert the subsonic formula at sea level; above qc/P0 = 0.893 (CAS > a0) use the Rayleigh form by bisection
  const sub = A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
  if (sub <= A0) return sub;
  let lo = 1, hi = 6; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, q = P0 * (166.92158 * Math.pow(m, 7) / Math.pow(7 * m * m - 1, 2.5) - 1); if (q > qc) hi = m; else lo = m; }
  return A0 * (lo + hi) / 2;
}
