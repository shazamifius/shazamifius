// compute.mjs — combien de lignes de code j'ai réellement écrites, sur tous mes dépôts.
//
// ════════════════════════════════════════════════════════════════════════════════════════
//  POURQUOI CE FICHIER A ÉTÉ RÉÉCRIT LE 24 JUILLET 2026
// ════════════════════════════════════════════════════════════════════════════════════════
//
//  La version précédente annonçait 1 562 409 lignes. C'était FAUX, et de très loin :
//  1 235 586 de ces lignes — 79 % du total, 97 % de la semaine — venaient de TROIS fichiers,
//  `ClaudePont/terrain/{continent,ile,terrain}.obj` : 43,5 Mo de maillage 3D. Un `.obj`
//  stocke une ligne par sommet et par face. Exporter un terrain « écrit » donc un million de
//  lignes en une seconde, sans que personne n'ait tapé quoi que ce soit.
//
//  Le vrai code C++ du même projet Unreal pèse 76 Ko.
//
//  La cause n'était pas la liste d'exclusions — elle était le PRINCIPE de la liste
//  d'exclusions. Une liste de choses à exclure ne protège que de ce qu'on a déjà vu. Le jour
//  où un format inconnu arrive, le chiffre gonfle EN SILENCE, et rien ne le signale.
//
//  ┌─ LA RÈGLE ──────────────────────────────────────────────────────────────────────────┐
//  │  On ne dit plus « compte tout, sauf… ». On dit « ne compte QUE… ».                   │
//  │  Ce compteur a le droit de SOUS-estimer. Il n'a pas le droit de SUR-estimer.         │
//  │  Toute décision douteuse se tranche donc vers le bas, sans hésiter.                  │
//  └──────────────────────────────────────────────────────────────────────────────────────┘
//
//  ── CE QU'UNE REVUE ADVERSE A CORRIGÉ, LE JOUR MÊME ────────────────────────────────────
//  La première version de cette réécriture affirmait qu'une liste blanche « ne peut plus
//  sur-estimer ». C'était trop sûr, et faux. Neuf défauts confirmés, dont quatre graves :
//
//   1. Une liste blanche protège des FORMATS inconnus, pas du CODE SOURCE écrit par
//      quelqu'un d'autre. Mesuré sur ce disque : un dossier `.venv/…/site-packages` contient
//      1 504 593 lignes de `.py` en 2 995 fichiers, aucun n'atteignant le plafond. `.py` est
//      dans la liste blanche, aucun dossier `venv` n'était exclu, et le plafond ne tire pas :
//      les trois filets passaient à côté. `node_modules` (JS) et `vendor` (Go/PHP) étaient
//      exclus ; l'équivalent Python ne l'était pas. C'était une incohérence, pas un oubli
//      théorique — d'où la règle posée plus bas sur les dépendances embarquées.
//   2. Un `pnpm-lock.yaml` (extension `.yaml`, donc « du code ») passait aussi.
//   3. « Lignes ÉCRITES » alors qu'on additionnait ajouts + suppressions. Une ligne supprimée
//      n'a jamais été écrite. Mesuré : sur un seul dépôt, l'écart était de +27 %. Le mot avait
//      changé, pas le calcul — exactement le genre de mensonge involontaire qu'on corrige ici.
//   4. `--since` filtre sur la date du COMMIT : un `rebase` ou un `--amend` faisait rentrer
//      dans « les 7 derniers jours » des lignes vieilles de plusieurs mois.
//
//  Les quatre sont corrigés ci-dessous. On garde la leçon : la règle protège du bruit, elle
//  ne dispense pas de vérifier.
//
//  ── LES QUATRE FILETS ──────────────────────────────────────────────────────────────────
//   1. LISTE BLANCHE d'extensions — seul du code source connu est compté.
//   2. DOSSIERS de dépendances et de génération — écartés quelle que soit l'extension.
//   3. PLAFOND par fichier et par commit — au-delà de 50 000 lignes remuées d'un coup, c'est
//      une machine qui a écrit. Ce filet ne regarde aucune extension : c'est lui qui reste
//      debout quand les deux premiers ont tort.
//   4. AJOUTS SEULS — une suppression n'est pas une écriture.
//
//  ── ET DEUX SÉPARATIONS HONNÊTES ───────────────────────────────────────────────────────
//   · les BOTS ne comptent pas (dependabot, github-actions…) : ce n'est pas moi qui écris ;
//   · les ÉCRITS (documentation) sont comptés À PART. C'est du vrai travail, mais ce n'est
//     pas du code, et les additionner rendrait le nombre moins vrai.
//
//  Sortie : stats/stats.json.  Lecture seule côté GitHub (clone temporaire, effacé ensuite).
//  Requiert STATS_TOKEN (PAT fine-grained : Contents + Metadata, lecture seule).
// ════════════════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN = process.env.STATS_TOKEN;
if (!TOKEN) { console.error('STATS_TOKEN manquant'); process.exit(1); }
const OWNER = 'shazamifius';

// ── FILET 1 — la liste blanche ──────────────────────────────────────────────────────────
// Du CODE : des fichiers dont chaque ligne a été pensée. Pour en ajouter un, il suffit
// d'écrire l'extension ici — et tant qu'on ne l'a pas fait, ces lignes ne sont pas comptées.
// C'est voulu : l'oubli coûte un chiffre trop bas, jamais trop haut.
//
// `.sql` en est volontairement ABSENT : dans la vraie vie un gros `.sql` est un dump de base,
// pas une requête écrite à la main. Le jour où un vrai fichier SQL travaillé existe ici, on
// l'ajoutera — dans ce sens-là, l'erreur ne coûte qu'un chiffre trop modeste.
const CODE = [
  '.rs', '.go', '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cs', '.java', '.kt', '.swift',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.ejs',
  '.py', '.rb', '.php', '.lua', '.pl', '.jl',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.nix', '.cmake', '.gradle', '.mk',
  '.html', '.css', '.scss', '.sass', '.less',
  '.toml', '.yml', '.yaml',
  '.glsl', '.hlsl', '.wgsl', '.usf', '.ush', '.shader', '.metal',
];

// Des ÉCRITS : la documentation, les notes, le récit du projet. Compté, mais À PART.
// `.txt` en est volontairement absent : mes propres générateurs produisent des .txt (les
// spécimens ASCII de cette page, par exemple) — les compter serait me flatter.
const ECRITS = ['.md', '.rst', '.adoc'];

// ── FILET 2 — les dossiers et fichiers que personne n'écrit à la main ────────────────────
//
// ⚠ RÈGLE, née de la revue adverse du 24 juillet : la liste blanche ne protège QUE des
// formats inconnus. Contre du code source écrit par QUELQU'UN D'AUTRE et embarqué dans le
// dépôt (les dépendances « vendored »), elle ne peut rien : c'est du vrai `.py`, du vrai
// `.js`. Seule cette liste-ci les arrête. Donc : **toute nouvelle famille de dossier de
// dépendances s'ajoute ici AVANT de la rencontrer, jamais après l'avoir comptée.**
const DOSSIERS_EXCLUS = [
  // Dépendances embarquées, par écosystème. `site-packages` porte l'essentiel côté Python :
  // il attrape toutes les dispositions d'environnement (.venv/Lib/…, venv/lib/pythonX/…, env/…).
  '**/node_modules/**', '**/vendor/**', '**/third_party/**', '**/ThirdParty/**',
  '**/site-packages/**', '**/.venv/**', '**/venv/**', '**/.tox/**', '**/.direnv/**',
  '**/__pypackages__/**', '**/Pods/**', '**/bower_components/**', '**/.terraform/**',
  // Sorties d'outils.
  '**/dist/**', '**/build/**', '**/Build/**', '**/target/**', '**/out/**',
  '**/.next/**', '**/.nuxt/**', '**/.svelte-kit/**', '**/.output/**',
  '**/coverage/**', '**/htmlcov/**', '**/storybook-static/**', '**/__pycache__/**',
  // Unreal fabrique ces quatre-là à chaque compilation, et il y met du C++ généré.
  '**/Intermediate/**', '**/Saved/**', '**/DerivedDataCache/**', '**/Binaries/**',
  // Fichiers produits par un outil, quelle que soit leur extension. Les fichiers de
  // VERROU sont nommés un par un : plusieurs portent une extension « de code »
  // (`pnpm-lock.yaml` est un `.yaml`), donc un motif générique les manque.
  '**/*.min.js', '**/*.min.css', '**/*.map',
  '**/*.lock', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/pnpm-lock.yaml',
  '**/yarn.lock', '**/poetry.lock', '**/Gemfile.lock', '**/composer.lock', '**/go.sum',
  '**/flake.lock', '**/bun.lockb',
  '**/*.generated.*', '**/*.gen.*', '**/*.pb.go', '**/*_pb2.py',
];

// ── FILET 3 — le plafond ────────────────────────────────────────────────────────────────
// Aucun être humain ne remue cinquante mille lignes dans UN fichier en UN commit. Ce filet
// se juge sur ajouts + suppressions (le « remuement »), et non sur les seuls ajouts : c'est
// ce qui le garde serré. Il ne regarde pas l'extension — c'est ce qui le rend utile le jour
// où la liste blanche a tort.
const PLAFOND_PAR_FICHIER = 50_000;

// Les auteurs qui ne sont pas moi.
const EST_UN_BOT = (auteur) =>
  /\[bot\]/i.test(auteur) || /^(dependabot|github-actions|renovate)\b/i.test(auteur);

const SEPT_JOURS = 7 * 24 * 3600;
const CHRONO = 15 * 60 * 1000; // aucun git ne doit tenir le job en otage (plafond 6 h chez GitHub)

const extension = (chemin) => {
  const base = chemin.slice(chemin.lastIndexOf('/') + 1);
  const point = base.lastIndexOf('.');
  return point <= 0 ? '' : base.slice(point).toLowerCase();
};

const pathspec = [
  '--',
  ...CODE.map(e => `:(glob)**/*${e}`),
  ...ECRITS.map(e => `:(glob)**/*${e}`),
  ...DOSSIERS_EXCLUS.map(e => `:(exclude,glob)${e}`),
];

async function listerDepots() {
  let page = 1, tous = [];
  for (;;) {
    const r = await fetch(
      `https://api.github.com/user/repos?affiliation=owner&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'stats-bot', Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`API ${r.status} : ${await r.text()}`);
    const a = await r.json();
    tous = tous.concat(a);
    if (a.length < 100) break;
    page++;
  }
  return tous;
}

/**
 * UNE seule traversée de l'historique, qui remplit les deux compteurs (tout-temps et 7 jours).
 *
 * Le format demandé à git fait précéder les statistiques de chaque commit d'une ligne
 * « \0auteur\x1fdate-d'auteur ». On sait ainsi À QUI appartiennent les lignes qui suivent, et
 * DE QUAND elles datent.
 *
 * Cette date est celle de l'AUTEUR, délibérément — pas celle du commit. `git log --since`
 * filtre sur la date du commit, et un `rebase`, un `--amend` ou un « squash and merge » la
 * remet à aujourd'hui : du travail vieux de plusieurs mois se serait affiché comme écrit cette
 * semaine. La date d'auteur, elle, survit à la réécriture d'historique. Et si jamais elle
 * bougeait, elle ne pourrait que faire SORTIR des lignes de la fenêtre : le bon sens d'erreur.
 */
function parcourir(dossier, maintenant) {
  const args = ['-C', dossier, 'log', '--no-merges', '--numstat', '--pretty=tformat:%x00%an%x1f%at', ...pathspec];

  let sortie;
  try { sortie = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: CHRONO }); }
  catch { return { code: 0, ecrits: 0, code7d: 0, ecrits7d: 0, ecartes: 0 }; }

  let code = 0, ecrits = 0, code7d = 0, ecrits7d = 0, ecartes = 0;
  let ignorer = true;      // tant qu'on n'a pas vu d'en-tête, on ne compte rien
  let recent = false;

  for (const ligne of sortie.split('\n')) {
    if (ligne.startsWith('\0')) {
      const [auteur, horodatage] = ligne.slice(1).split('\x1f');
      ignorer = EST_UN_BOT(auteur || '');
      const t = parseInt(horodatage, 10);
      recent = Number.isFinite(t) && (maintenant - t) <= SEPT_JOURS;
      continue;
    }
    if (ignorer) continue;

    const champs = ligne.split('\t');
    if (champs.length < 3) continue;
    const ajouts = parseInt(champs[0], 10);      // '-' pour un binaire → NaN, ignoré
    const retraits = parseInt(champs[1], 10);
    if (!Number.isFinite(ajouts) || !Number.isFinite(retraits)) continue;

    // Filet 3 : le plafond se juge sur le REMUEMENT, filet 4 : on ne COMPTE que les ajouts.
    if (ajouts + retraits > PLAFOND_PAR_FICHIER) { ecartes += ajouts + retraits; continue; }
    if (ajouts === 0) continue;

    const ext = extension(champs[2]);
    if (CODE.includes(ext)) { code += ajouts; if (recent) code7d += ajouts; }
    else if (ECRITS.includes(ext)) { ecrits += ajouts; if (recent) ecrits7d += ajouts; }
  }
  return { code, ecrits, code7d, ecrits7d, ecartes };
}

(async () => {
  const depots = (await listerDepots()).filter(r => !r.fork && r.name !== OWNER && r.size > 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-'));
  const lignes = [];
  const maintenant = Math.floor(Date.now() / 1000);

  try {
    for (const r of depots) {
      const dossier = path.join(tmp, r.name);
      const url = `https://x-access-token:${TOKEN}@github.com/${r.full_name}.git`;
      try {
        execFileSync('git', ['clone', '--quiet', '--single-branch', url, dossier],
          { stdio: 'ignore', timeout: CHRONO });
      } catch { console.error('clone échoué :', r.full_name); continue; }

      const m = parcourir(dossier, maintenant);
      lignes.push({
        name: r.name, private: r.private, lang: r.language || null,
        all: m.code, d7: m.code7d,              // « all » = le CODE : c'est le chiffre affiché
        ecrits: m.ecrits, ecrits7d: m.ecrits7d,
        ecartes: m.ecartes,
      });
      console.error(
        `${r.name.padEnd(38)} code=${String(m.code).padStart(8)}  écrits=${String(m.ecrits).padStart(7)}` +
        `  7j=${String(m.code7d).padStart(7)}${m.ecartes ? `  (écartés : ${m.ecartes} lignes générées)` : ''}`);
    }

    const somme = (k, f = () => true) => lignes.filter(f).reduce((s, x) => s + (x[k] || 0), 0);
    const data = {
      generatedAt: new Date().toISOString().slice(0, 10),
      totalAll: somme('all'), total7d: somme('d7'),
      publicAll: somme('all', r => !r.private), privateAll: somme('all', r => r.private),
      public7d: somme('d7', r => !r.private), private7d: somme('d7', r => r.private),
      ecritsAll: somme('ecrits'), ecrits7d: somme('ecrits7d'),
      ecartesAll: somme('ecartes'),
      // La méthode voyage AVEC le chiffre : un nombre qu'on ne peut pas auditer ne vaut rien.
      methode: {
        regle: 'liste blanche — seules les extensions de code listées sont comptées',
        comptage: 'ajouts seuls — une ligne supprimée n\'a pas été écrite',
        fenetre: 'date d\'AUTEUR, insensible aux rebases',
        plafondParFichier: PLAFOND_PAR_FICHIER,
        botsExclus: true,
        ecritsComptesAPart: true,
        note: 'assets 3D, images, données, journaux, dépendances embarquées et fichiers générés ne sont jamais comptés',
      },
      repos: lignes.sort((a, b) => b.all - a.all),
    };
    fs.mkdirSync('stats', { recursive: true });
    fs.writeFileSync('stats/stats.json', JSON.stringify(data, null, 2));
    console.error(
      `\nOK -> stats/stats.json  ·  code ${data.totalAll} (7j ${data.total7d})` +
      `  ·  écrits ${data.ecritsAll}  ·  écartés comme générés ${data.ecartesAll}`);
  } finally {
    // Les clones portent le jeton dans leur `.git/config`. Sur un runner éphémère c'est sans
    // conséquence ; lancé à la main sur une vraie machine, ça laisserait treize copies du
    // secret en clair dans le dossier temporaire. On efface, quoi qu'il arrive.
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* rien à sauver ici */ }
  }
})();
