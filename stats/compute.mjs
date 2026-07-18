// compute.mjs — calcule le churn git (lignes ajoutées + supprimées) sur TOUS les
// repos possédés (publics + privés, hors forks), tout-temps et 7 derniers jours.
// Sortie : stats/stats.json.  Lecture seule côté GitHub (clone temporaire).
//
// Requiert la variable d'env STATS_TOKEN (fine-grained PAT, All repositories,
// Contents: Read-only + Metadata: Read-only).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN = process.env.STATS_TOKEN;
if (!TOKEN) { console.error('STATS_TOKEN manquant'); process.exit(1); }
const OWNER = 'shazamifius';

// fichiers générés/vendored à NE PAS compter (bruit qui gonfle les chiffres)
const EX = [
  '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/Cargo.lock',
  '**/poetry.lock', '**/composer.lock', '**/go.sum',
  '**/*.min.js', '**/*.min.css', '**/*.map',
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**',
  '**/out/**', '**/vendor/**', '**/.next/**', '**/coverage/**',
  '**/*.svg', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.ico',
  '**/*.pdf', '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.otf',
  '**/*.wasm', '**/*.bin', '**/*.zip', '**/*.gz', '**/*.7z',
  '**/*.mp4', '**/*.wav', '**/*.mp3', '**/*.glb', '**/*.gltf', '**/*.fbx',
];
const pathspec = ['--', '.', ...EX.map(e => `:(exclude,glob)${e}`)];

async function listRepos() {
  let page = 1, all = [];
  for (;;) {
    const r = await fetch(`https://api.github.com/user/repos?affiliation=owner&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'stats-bot', Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`API ${r.status} : ${await r.text()}`);
    const a = await r.json();
    all = all.concat(a);
    if (a.length < 100) break;
    page++;
  }
  return all;
}

function churn(dir, since) {
  const args = ['-C', dir, 'log', '--no-merges', '--numstat', '--pretty=tformat:'];
  if (since) args.push(`--since=${since}`);
  args.push(...pathspec);
  let out;
  try { out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch { return 0; }
  let sum = 0;
  for (const line of out.split('\n')) {
    const c = line.split('\t');
    if (c.length < 2) continue;
    const a = parseInt(c[0], 10), d = parseInt(c[1], 10);   // '-' (binaire) -> NaN, ignoré
    if (Number.isFinite(a)) sum += a;
    if (Number.isFinite(d)) sum += d;
  }
  return sum;
}

(async () => {
  const repos = (await listRepos()).filter(r => !r.fork && r.name !== OWNER && r.size > 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-'));
  const rows = [];
  for (const r of repos) {
    const dir = path.join(tmp, r.name);
    const url = `https://x-access-token:${TOKEN}@github.com/${r.full_name}.git`;
    try { execFileSync('git', ['clone', '--quiet', '--single-branch', url, dir], { stdio: 'ignore' }); }
    catch { console.error('clone échoué :', r.full_name); continue; }
    const all = churn(dir, null);
    const d7 = churn(dir, '7 days ago');
    rows.push({ name: r.name, private: r.private, lang: r.language || null, all, d7 });
    console.error(`${r.name.padEnd(38)} all=${String(all).padStart(8)}  7j=${d7}`);
  }
  const sum = (k, f = () => true) => rows.filter(f).reduce((s, x) => s + x[k], 0);
  const data = {
    generatedAt: new Date().toISOString().slice(0, 10),
    totalAll: sum('all'), total7d: sum('d7'),
    publicAll: sum('all', r => !r.private), privateAll: sum('all', r => r.private),
    public7d: sum('d7', r => !r.private), private7d: sum('d7', r => r.private),
    repos: rows.sort((a, b) => b.all - a.all),
  };
  fs.mkdirSync('stats', { recursive: true });
  fs.writeFileSync('stats/stats.json', JSON.stringify(data, null, 2));
  console.error(`\nOK -> stats/stats.json  (total tout-temps ${data.totalAll}, 7j ${data.total7d})`);
})();
