// build.mjs — réinjecte la page README (texte centré + spécimens ASCII) dans hero.svg,
// avec les chiffres frais de stats/stats.json. Reproduit la même mise en page que le visuel.
import fs from 'node:fs';

const HERO = 'hero.svg';
const ASSETS = 'stats/assets/';
const MONO = "Consolas,'DejaVu Sans Mono','Liberation Mono','Courier New',monospace";
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PAGE_CX = 1050;
const rd = f => fs.readFileSync(f, 'utf8');

function blk(text, x, y, font, fill, extra = '') {
  let lines = text.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const lh = font * 1.28;
  if (x === null) {
    const cols = Math.max(1, ...lines.map(l => l.length));
    x = Math.round(PAGE_CX - (cols * font * 0.6) / 2);
  }
  const t = lines.map((l, i) =>
    `    <text x="${x}" y="${(y + (i + 0.9) * lh).toFixed(1)}" xml:space="preserve">${esc(l)}</text>`).join('\n');
  return `  <g clip-path="url(#winClip)" font-family="${MONO}" font-size="${font}" fill="${fill}" xml:space="preserve"${extra}>\n${t}\n  </g>`;
}

// nb de lignes utiles d'un bloc ASCII (après rognage des lignes vides)
function rowCount(text) {
  let l = text.split('\n');
  while (l.length && !l[0].trim()) l.shift();
  while (l.length && !l[l.length - 1].trim()) l.pop();
  return l.length;
}

// ---- chiffres -> texte ----
const S = JSON.parse(rd('stats/stats.json'));
const grp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');   // 196000 -> "196 000"
const kk = n => '~' + Math.round(n / 1000) + 'k';
const SHORT = {
  'VRchatFACE-HAND-ARM-tracking': 'VRchat-tracking',
  'Simulateur-d-emergence-D-eterministe': 'simulateur',
  'GlucoseGit': 'Glucose',
  'Luma-app-documentation': 'Luma-doc',
};
const disp = n => SHORT[n] || n;

const pub = S.repos.filter(r => !r.private && r.all >= 1000);   // liste : on masque le négligeable (le total, lui, garde tout)
const priv = S.repos.filter(r => r.private);
const privAll = priv.reduce((s, r) => s + r.all, 0);

// enroule les projets publics en lignes <= ~52 caractères
function wrapPublic(items, width = 52) {
  const parts = items.map(r => `${disp(r.name)} ${kk(r.all)}`);
  const lines = []; let cur = '';
  for (const p of parts) {
    if (cur && (cur + ' · ' + p).length > width) { lines.push(cur); cur = p; }
    else cur = cur ? cur + ' · ' + p : p;
  }
  if (cur) lines.push(cur);
  return lines.map(l => `  │     ${l}`).join('\n');
}

let content = rd('stats/content.tmpl.txt')
  .replace('{{TOTAL_ALL}}', grp(S.totalAll))
  .replace('{{TOTAL_7D}}', grp(S.total7d))
  .replace('{{PUBLIC_LINES}}', wrapPublic(pub))
  .replace('{{N_PRIV}}', priv.length + (priv.length > 1 ? ' repos' : ' repo'))
  .replace('{{PRIV_ALL}}', grp(privAll))
  .replace('{{DATE}}', S.generatedAt);

// ---- spécimens ASCII (mêmes positions que le visuel) ----
const G = '#333333';
const layout = [
  { f: 'a-flower.txt', x: 1575, y: 210,  font: 14 },            // fleur détaillée, haut-droite
  { f: 'a-fern.txt',   x: 1715, y: 1690, font: 12 },            // fougère, enracinée en bas
  { f: 'a-wheat.txt',  x: 1575, y: 1000, font: 11, fade: 0.58 },// épi de blé, remonté + tige fondue en bas
  { f: 'a-branch.txt', x: 70,   y: 360,  font: 12 },            // branche, marge gauche haut
  { f: 'a-flower.txt', x: 110,  y: 2050, font: 12 },            // petite fleur, bas-gauche
];
let fadeDefs = '';
const specs = layout.map((s, idx) => {
  const txt = rd(ASSETS + s.f);
  let extra = '';
  if (s.fade) {                                    // masque dégradé : opaque en haut -> transparent en bas (fondu de la tige)
    const top = s.y, bot = s.y + rowCount(txt) * s.font * 1.28, id = `fade${idx}`;
    fadeDefs +=
      `  <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${top.toFixed(0)}" x2="0" y2="${bot.toFixed(0)}">` +
      `<stop offset="0" stop-color="#fff"/><stop offset="${s.fade}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>\n` +
      `  <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="2100" height="2970"><rect width="2100" height="2970" fill="url(#${id})"/></mask>\n`;
    extra = ` mask="url(#${id}m)"`;
  }
  return blk(txt, s.x, s.y, s.font, G, extra);
}).join('\n');
const text = blk(content, null, 300, 24, '#1a1a1a');
const payload = `  <!-- README page -->\n${fadeDefs}${specs}\n${text}\n  <!-- /README page -->`;

// ---- injection dans hero.svg ----
let h = rd(HERO);
h = h.replace(/\n\s*<!-- README page -->[\s\S]*?<!-- \/README page -->\n?/, '\n');
const i = h.lastIndexOf('</svg>');
h = h.slice(0, i) + '\n' + payload + '\n' + h.slice(i);
fs.writeFileSync(HERO, h);
console.error('hero.svg mis à jour (page README réinjectée avec les chiffres frais)');
