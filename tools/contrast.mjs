// The brief: "real contrast — the amber failed WCAG once already".
// Every foreground/background pair the design actually uses, measured.
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
// alpha over an opaque backdrop
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAPER = hex('#FAF8F4'), CARD = hex('#FFFDF9'), INK = hex('#1E2A38'), AMBER = hex('#C87A1E');

const pairs = [
  ['ink on paper',            INK,                     PAPER, 'body'],
  ['ink on card',             INK,                     CARD,  'body'],
  ['ink .78 on card',         over(INK, .78, CARD),    CARD,  'body'],
  ['ink .76 on card',         over(INK, .76, CARD),    CARD,  'body'],
  ['ink .74 on card',         over(INK, .74, CARD),    CARD,  'small'],
  ['ink .74 on paper',        over(INK, .74, PAPER),   PAPER, 'small'],
  ['amber on paper',          AMBER,                   PAPER, 'body'],
  ['amber on card',           AMBER,                   CARD,  'body'],
  ['paper on ink (button)',   PAPER,                   INK,   'body'],
  ['amber savings 19-24px',   AMBER,                   CARD,  'large'],
];
let fail = 0;
for (const [name, fg, bg, kind] of pairs) {
  const r = ratio(fg, bg);
  const need = kind === 'large' ? 3.0 : 4.5;
  const ok = r >= need;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  (needs ${need})  ${name}`);
}
// what amber would need to pass as normal text
if (fail) {
  console.log('\nDarker amber candidates on #FFFDF9:');
  for (const c of ['#C87A1E','#B86E18','#A96214','#9A5710','#8B4D0D','#7C440B']) {
    console.log(`  ${c}  ${ratio(hex(c), CARD).toFixed(2)}:1`);
  }
}
process.exitCode = 0;
