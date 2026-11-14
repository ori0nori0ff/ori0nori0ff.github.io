/* Drawing helpers shared by the cockpit instruments and the screen HUD (docs/flight-plan.md, step S4). Own code; every face and symbol is
   drawn here from scratch (no traced or copied artwork). */

export const D2R = Math.PI / 180;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const FONT = 'Inter, system-ui, sans-serif';
export const MONO = 'ui-monospace, Consolas, "DejaVu Sans Mono", monospace';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// a number with a fixed count of decimals, '–' when unknown
export const fmt = (x, d = 0) => x == null || !isFinite(x) ? '–' : x.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pad = (x, n) => { const s = String(Math.round(Math.abs(x))); return (x < 0 ? '-' : '') + s.padStart(n, '0'); };

// round dial: ticks from a value -> angle map. o = { cx, cy, r, from, to, step, major, label(v) -> string|null, ang(v) -> rad clockwise from 12 o'clock, col }
export function dial(x, o) {
  const col = o.col || '#E8ECF0'; x.strokeStyle = col; x.fillStyle = col; x.lineCap = 'butt';
  for (let v = o.from; v <= o.to + 1e-9; v += o.step) {
    const a = o.ang(v), mj = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6, l = mj ? o.r * .17 : o.r * .09;
    x.lineWidth = mj ? o.r * .035 : o.r * .02; x.beginPath();
    x.moveTo(o.cx + Math.sin(a) * o.r, o.cy - Math.cos(a) * o.r); x.lineTo(o.cx + Math.sin(a) * (o.r - l), o.cy - Math.cos(a) * (o.r - l)); x.stroke();
    const t = mj && o.label ? o.label(v) : null;
    if (t != null) { const rr = o.r - l - o.r * .16; x.font = `600 ${Math.round(o.r * (o.fs || .2))}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(t, o.cx + Math.sin(a) * rr, o.cy - Math.cos(a) * rr); } }
}

// instrument case: dark face with a bezel ring
export function face(x, w, h, round = true) {
  x.clearRect(0, 0, w, h);
  if (round) { const r = Math.min(w, h) / 2; x.fillStyle = '#26292d'; x.beginPath(); x.arc(w / 2, h / 2, r, 0, 7); x.fill();
    x.fillStyle = '#0c0d0f'; x.beginPath(); x.arc(w / 2, h / 2, r * .9, 0, 7); x.fill(); }
  else { x.fillStyle = '#26292d'; x.fillRect(0, 0, w, h); x.fillStyle = '#0c0d0f'; const m = Math.min(w, h) * .06; x.fillRect(m, m, w - 2 * m, h - 2 * m); }
}

// a needle drawn pointing up from the centre (rotated as a mesh later): length k·r, tail, hub
export function needle(x, s, o = {}) {
  const c = s / 2, L = s * (o.len || .42), W = s * (o.w || .035);
  x.clearRect(0, 0, s, s); x.fillStyle = o.col || '#F2F4F6';
  x.beginPath(); x.moveTo(c - W / 2, c + s * .08); x.lineTo(c - W / 2, c - L + W * 1.5); x.lineTo(c, c - L); x.lineTo(c + W / 2, c - L + W * 1.5); x.lineTo(c + W / 2, c + s * .08); x.closePath(); x.fill();
  x.fillStyle = '#3a3d42'; x.beginPath(); x.arc(c, c, s * .055, 0, 7); x.fill();
}

// small digital window text (drum counters, numeric displays)
export function windowText(x, w, h, txt, o = {}) {
  x.clearRect(0, 0, w, h); x.fillStyle = o.bg || '#050607'; x.fillRect(0, 0, w, h);
  x.fillStyle = o.col || '#F2F4F6'; x.font = `${o.weight || 600} ${Math.round(h * (o.fs || .7))}px ${o.font || MONO}`; x.textAlign = o.align || 'center'; x.textBaseline = 'middle';
  x.fillText(txt, o.align === 'left' ? w * .06 : o.align === 'right' ? w * .94 : w / 2, h * .54);
}
