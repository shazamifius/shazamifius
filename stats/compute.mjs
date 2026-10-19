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
//  │  Ce compteur doit être JUSTE : rien deux fois, et rien d'oublié.                     │
//  │  Seul ce qu'on ne sait pas MESURER se tranche vers le bas, faute de mieux.           │
//  └──────────────────────────────────────────────────────────────────────────────────────┘
//
//  (Jusqu'au 19 octobre 2026, la règle disait « le droit de sous-estimer », et on oubliait
//  sans scrupule : une branche entière, un fichier renommé. Mais un chiffre trop bas n'est pas
//  plus vrai qu'un chiffre trop haut. Ce qui se mesure se mesure : les lignes déplacées sont
//  retirées parce que git sait les reconnaître, les branches comptent parce qu'on sait
//  reconnaître leurs copies.)
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
//  ── LES SIX FILETS ─────────────────────────────────────────────────────────────────────
//   1. LISTE BLANCHE d'extensions — seul du code source connu est compté.
//   2. DOSSIERS de dépendances et de génération — écartés quelle que soit l'extension.
//      2 bis. Et tout ce que le dépôt marque lui-même `linguist-vendored` / `linguist-generated`.
//   3. PLAFOND par fichier et par commit — au-delà de 50 000 lignes remuées d'un coup, c'est
//      une machine qui a écrit. Ce filet ne regarde aucune extension : c'est lui qui reste
//      debout quand les deux premiers ont tort.
//   4. AJOUTS SEULS — une suppression n'est pas une écriture.
//   5. LIGNES NEUVES SEULES — un copier-coller d'un fichier à l'autre n'est pas une écriture.
//   6. RIEN DEUX FOIS — une version de fichier ou une ligne déjà comptée ne se recompte pas.
//
//  ── ET DEUX SÉPARATIONS HONNÊTES ───────────────────────────────────────────────────────
//   · les ROBOTS D'ENTRETIEN ne comptent pas (dependabot, github-actions…) : ils ne
//     travaillent pas pour moi. Les AGENTS qui écrivent le projet à ma demande, eux, comptent ;
//   · les ÉCRITS (documentation) sont comptés À PART. C'est du vrai travail, mais ce n'est
//     pas du code, et les additionner rendrait le nombre moins vrai.
//
//  Sortie : stats/stats.json.  Lecture seule côté GitHub (clone temporaire, effacé ensuite).
//  Requiert STATS_TOKEN (PAT fine-grained : Contents + Metadata, lecture seule).
// ════════════════════════════════════════════════════════════════════════════════════════

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

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

// ── FILET 2 bis — ce que le dépôt lui-même déclare « pas de moi » ────────────────────────
// Né le 19 octobre 2026. `site-atelier-enila-tityad` affichait 142 847 lignes, dont ~131 000
// venaient de DEUX copies de l'ancien site : l'aspiration du site en ligne (`site-original/`)
// et la sauvegarde du serveur (`sauvegarde-serveur-…/`), toutes deux fabriquées par le
// logiciel WebAcappella. Du vrai `.html`, du vrai `.css`, en fichiers de quelques centaines de
// lignes : la liste blanche ne pouvait rien, le plafond non plus, et aucun nom de dossier
// générique ne les désignait. 16 % du total publié, en silence.
//
// Ajouter ces deux noms au filet 2 aurait été une règle par accident, qui n'attrape que le
// passé. On lit plutôt la convention que GitHub applique déjà à sa propre barre de langages :
// les attributs `linguist-vendored` et `linguist-generated` du `.gitattributes` de chaque
// dépôt. C'est le dépôt qui dit ce qui n'est pas de moi, à un seul endroit, et GitHub en tient
// compte aussi. Ce filet ne connaît que ce qu'on a marqué : il complète le filet 2, il ne le
// remplace pas.
const ATTRIBUTS_PAS_DE_MOI = ['linguist-vendored', 'linguist-generated'];

// ── FILET 3 — le plafond ────────────────────────────────────────────────────────────────
// Aucun être humain ne remue cinquante mille lignes dans UN fichier en UN commit. Ce filet
// se juge sur ajouts + suppressions (le « remuement »), et non sur les seuls ajouts : c'est
// ce qui le garde serré. Il ne regarde pas l'extension — c'est ce qui le rend utile le jour
// où la liste blanche a tort.
const PLAFOND_PAR_FICHIER = 50_000;

// Les auteurs qui ne travaillent pas pour moi.
//
// Les AGENTS qui écrivent le projet à ma demande — Claude, Jules, Copilot, Devin… — comptent :
// décision du 19 octobre 2026. Jusque-là, le code écrit avec Claude était signé de mon nom et
// comptait, et celui de Jules, signé `google-labs-jules[bot]`, ne comptait pas (~17 700 lignes) :
// même travail, frontière tracée par une signature. La vraie frontière sépare ceux qui
// travaillent SUR le projet de ceux qui l'ENTRETIENNENT (dependabot, renovate, github-actions),
// et ceux-là ne comptent pas.
// Un `[bot]` inconnu reste exclu tant qu'on ne l'a pas rangé ici — et le journal du job le nomme,
// dépôt par dépôt, pour que l'oubli se voie.
const AGENTS = /^(google-labs-jules|copilot-swe-agent|copilot|claude|devin-ai-integration|cursor-agent|codex|openhands-agent)(\[bot\])?$/i;
const EST_UN_BOT = (auteur) => !AGENTS.test(auteur) &&
  (/\[bot\]/i.test(auteur) || /^(dependabot|github-actions|renovate)\b/i.test(auteur));

const SEPT_JOURS = 7 * 24 * 3600;
const CHRONO = 15 * 60 * 1000; // aucun git ne doit tenir le job en otage (plafond 6 h chez GitHub)

const extension = (chemin) => {
  const base = chemin.slice(chemin.lastIndexOf('/') + 1);
  const point = base.lastIndexOf('.');
  return point <= 0 ? '' : base.slice(point).toLowerCase();
};

// Un renommage s'écrit `src/{ancien.rs => nouveau.rs}` ou `ancien.rs => nouveau.rs` dans
// `--numstat`. Sans ce dépliage, l'extension lue était `.rs}` : les lignes modifiées pendant un
// renommage tombaient hors de la liste blanche, sans bruit. On garde le chemin d'ARRIVÉE.
const cheminFinal = (c) => c
  .replace(/\{[^{}]* => ([^{}]*)\}/g, '$1')
  .replace(/^.* => /, '')
  .replace(/\/{2,}/g, '/')
  .replace(/^\//, '');

const pathspec = [
  '--',
  ...CODE.map(e => `:(glob)**/*${e}`),
  ...ECRITS.map(e => `:(glob)**/*${e}`),
  ...DOSSIERS_EXCLUS.map(e => `:(exclude,glob)${e}`),
];
const pathspecCode = pathspec.filter(p => !ECRITS.some(e => p === `:(glob)**/*${e}`));

const API = { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'stats-bot', Accept: 'application/vnd.github+json' } };

async function listerDepots() {
  let page = 1, tous = [];
  for (;;) {
    const r = await fetch(
      `https://api.github.com/user/repos?affiliation=owner&per_page=100&page=${page}`, API);
    if (!r.ok) throw new Error(`API ${r.status} : ${await r.text()}`);
    const a = await r.json();
    tous = tous.concat(a);
    if (a.length < 100) break;
    page++;
  }
  return tous;
}

// La version de Glucose affichée sur la page. Elle était écrite à la main dans le gabarit, et
// elle est restée à `v1.0.1-beta.24` pendant que Glucose 2 sortait : ce qu'on ne recalcule pas
// se périme. On la lit donc à la source, comme le reste.
async function derniereVersion(depot) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${depot}/releases?per_page=10`, API);
  if (!r.ok) throw new Error(`API ${r.status} (releases de ${depot}) : ${await r.text()}`);
  const publiee = (await r.json()).find(v => !v.draft);
  if (!publiee) throw new Error(`aucune release publiée sur ${depot}`);
  return publiee.tag_name;
}

// Les chemins que le dépôt marque lui-même comme n'étant pas de moi (filet 2 bis). Les
// attributs se lisent dans le `.gitattributes` d'aujourd'hui (`--source=HEAD`) et s'appliquent
// à tout l'historique : un dossier marqué l'est pour tous les commits qui l'ont touché.
function declaresPasDeMoi(dossier, chemins) {
  const uniques = [...new Set(chemins)];
  if (!uniques.length) return new Set();
  const sortie = execFileSync('git',
    ['-C', dossier, 'check-attr', '-z', '--stdin', '--source=HEAD', ...ATTRIBUTS_PAS_DE_MOI],
    { input: uniques.join('\0') + '\0', encoding: 'utf8', maxBuffer: 1 << 28, timeout: CHRONO });
  const champs = sortie.split('\0');   // chemin, attribut, valeur — trois par trois
  const marques = new Set();
  for (let i = 0; i + 2 < champs.length; i += 3)
    if (champs[i + 2] === 'set' || champs[i + 2] === 'true') marques.add(champs[i]);
  return marques;
}

// ── FILET 5 — une ligne déplacée n'est pas une ligne écrite ──────────────────────────────
// Né le 19 octobre 2026. Découper `app.rs` en modules, c'est couper du code d'un fichier et le
// coller dans un autre : `--numstat` voyait des lignes retirées ici et AJOUTÉES là, et le
// compteur les comptait une seconde fois. Mesuré sur Glucose : ~15 700 lignes, écrites une fois,
// comptées deux.
//
// Git sait reconnaître ce texte déplacé (`--color-moved`), mais il ne le dit qu'en COULEUR. On
// lui impose donc nos couleurs, et on lit la couleur de chaque ligne ajoutée : verte, elle est
// neuve ; cyan ou bleue, git a retrouvé le même texte retiré ailleurs dans le même commit.
// `zebra` n'appelle « déplacé » qu'un bloc d'au moins 20 caractères alphanumériques : une
// accolade seule reste neuve. `allow-indentation-change` reconnaît aussi un bloc ré-indenté.
const COULEURS = [
  '-c', 'color.diff.new=green',
  '-c', 'color.diff.newMoved=cyan', '-c', 'color.diff.newMovedAlternative=blue',
];
const ANSI = /\x1b\[[0-9;]*m/g;
const estDeplacee = (brute) => /^\x1b\[(?:[0-9;]*;)?3[46](?:;[0-9;]*)?m/.test(brute);

// ── FILET 6 — ce qui a déjà été compté ne se recompte pas ────────────────────────────────
// Né le 19 octobre 2026, sur VRchat-tracking : ses quatre branches n'ont AUCUN ancêtre commun
// avec `main`. Le projet y a été redéposé, historique par historique — 28 fichiers strictement
// identiques à ceux de `main` sur une seule branche. Autant de commits différents, à d'autres
// dates : ni l'empreinte ni `--color-moved` (qui ne regarde qu'UN commit) ne pouvaient les voir.
// Il faut regarder le CONTENU.
//
// La règle : dans un fichier, une ligne compte autant de fois qu'elle a été présente EN MÊME
// TEMPS, au plus, dans une version de ce fichier. Deux exemplaires côte à côte : deux lignes.
// Retirée puis remise, réécrite à l'identique parce que le diff s'est mal aligné, redéposée sur
// une autre branche : toujours une. Pour la tenir, le diff est demandé avec un contexte
// illimité — il montre alors chaque version entière du fichier — et l'on garde, par fichier, le
// plus grand nombre d'exemplaires déjà compté pour chaque ligne. Une ligne se compare sans son
// indentation : ré-indenter un bloc n'est pas l'écrire.
//
// Une première version tenait une simple liste des lignes déjà vues, et laissait de côté les
// lignes courtes (moins de 20 caractères alphanumériques) pour ne pas confondre deux `}`. Elle
// comptait MOINS de lignes écrites que de lignes présentes dans des dépôts écrits d'un seul jet :
// la seconde de deux lignes identiques passait pour une redite. Compter les exemplaires règle
// les deux à la fois, et le seuil a disparu.
//
// Et une version de fichier exactement identique à une version déjà comptée, AILLEURS (une
// copie, une sauvegarde sous un autre nom), n'apporte aucune ligne : on la reconnaît à son
// identifiant git, le « blob ».

// Le contexte illimité, tel que git l'écrit : au-delà de la plus longue version de fichier.
const CONTEXTE_ILLIMITE = '--unified=1000000000';

/**
 * UNE seule traversée de l'historique, qui remplit les deux compteurs (tout-temps et 7 jours).
 *
 * Le format demandé à git fait précéder le diff de chaque commit d'une ligne
 * « \0auteur\x1fdate-d'auteur\x1fsujet ». On sait ainsi À QUI appartiennent les lignes qui
 * suivent, et DE QUAND elles datent.
 *
 * Cette date est celle de l'AUTEUR, délibérément — pas celle du commit. `git log --since`
 * filtre sur la date du commit, et un `rebase`, un `--amend` ou un « squash and merge » la
 * remet à aujourd'hui : du travail vieux de plusieurs mois se serait affiché comme écrit cette
 * semaine. La date d'auteur, elle, survit à la réécriture d'historique.
 *
 * TOUTES LES BRANCHES (`--all`), depuis le 19 octobre 2026 : du travail resté sur une branche
 * est du travail écrit (tout `glucose-brain` vivait sur `rnd`, et comptait zéro). Un commit
 * partagé par deux branches est un seul objet, git ne le sort qu'une fois. Restent les COPIES
 * (un `cherry-pick`, un `rebase` dont l'original survit sur une autre branche) : nouvel
 * identifiant, même travail. Elles gardent leur auteur, leur date d'auteur et leur sujet — c'est
 * cette empreinte qui les reconnaît, et seule la première rencontrée compte.
 *
 * DU PLUS ANCIEN AU PLUS RÉCENT (`--reverse --author-date-order`) : face à deux copies, c'est
 * la première écrite qui compte, et un vieux fichier redéposé hier n'entre pas dans les 7 jours.
 *
 * L'HISTORIQUE COMPLET (`--full-history`) : filtré par chemin, `git log` « simplifie » par
 * défaut, et cache les commits d'une branche fusionnée sans effet sur ces chemins. Ce qu'il
 * cachait dépendait de la LONGUEUR de la liste de chemins — mesuré le 19 octobre 2026 : 4 ou 6
 * commits pour le même `styles.css` selon la façon de demander. Un compteur ne doit pas
 * dépendre de la façon dont on lui pose la question ; les doublons, eux, sont l'affaire du
 * filet 6.
 */
async function parcourir(dossier, maintenant) {
  // Les attributs du dépôt d'abord (filet 2 bis), pour décider de chaque fichier dès qu'il passe
  // au lieu de garder tout l'historique en mémoire.
  const pasDeMoi = declaresPasDeMoi(dossier, execFileSync('git',
    ['-C', dossier, '-c', 'core.quotePath=false', 'log', '--all', '--full-history', '--no-merges',
      '--no-renames', '--name-only', '--format=', ...pathspec],
    { encoding: 'utf8', maxBuffer: 1 << 28, timeout: CHRONO }).split('\n').filter(Boolean));

  // `core.quotePath=false` : sans lui, git écrit un nom accentué entre guillemets et en octal
  // (`"src/caf\303\251.rs"`), dont l'extension lue devient `.rs"` — hors liste blanche.
  // `--full-index` : l'identifiant complet de chaque version de fichier, pour le filet 6.
  const args = ['-C', dossier, '-c', 'core.quotePath=false', ...COULEURS,
    'log', '--all', '--full-history', '--no-merges', '--reverse', '--author-date-order',
    '-p', CONTEXTE_ILLIMITE, '--full-index', '--color=always',
    '--color-moved=zebra', '--color-moved-ws=allow-indentation-change',
    '--format=%x00%an%x1f%at%x1f%s', ...pathspec];

  // Le diff complet de tout un historique peut peser des centaines de Mo : on le lit en flux,
  // ligne à ligne, au lieu de l'attendre en entier.
  const git = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let erreur = '';
  git.stderr.on('data', d => { erreur += d; });
  const chrono = setTimeout(() => git.kill(), CHRONO);
  const fin = new Promise(ok => git.on('close', (code, signal) => ok({ code, signal })));

  let code = 0, ecrits = 0, code7d = 0, ecrits7d = 0, ecartes = 0, declares = 0, deplacees = 0;
  let recopiees = 0;
  const versionsVues = new Set();      // les blobs déjà comptés
  const exemplaires = new Map();       // chemin → (ligne → plus grand nombre d'exemplaires compté)

  const decider = (f) => {
    // Filet 2 bis : le dépôt l'a marqué comme n'étant pas de moi.
    if (pasDeMoi.has(f.chemin)) { declares += f.ajouts; return; }
    // Filet 3 : le plafond se juge sur le REMUEMENT, déplacements compris.
    if (f.ajouts + f.retraits > PLAFOND_PAR_FICHIER) { ecartes += f.ajouts + f.retraits; return; }
    const ext = extension(f.chemin);
    if (!CODE.includes(ext) && !ECRITS.includes(ext)) return;
    // Filet 5 : une ligne déplacée n'est pas écrite.
    deplacees += f.deplacees;

    // Filet 6. Un fichier renommé emporte sa mémoire : son contenu n'est pas neuf sous un
    // nouveau nom.
    if (!exemplaires.has(f.chemin)) exemplaires.set(f.chemin, new Map(f.renommeDe && exemplaires.get(f.renommeDe)));
    const deja = exemplaires.get(f.chemin);
    const copie = f.version !== null && versionsVues.has(f.version);
    let neuves = 0;
    for (const [texte, n] of f.apres) {
      const avant = deja.get(texte) || 0;
      if (n <= avant) continue;
      deja.set(texte, n);
      if (!copie) neuves += Math.max(0, n - avant - (f.deplaceesParTexte.get(texte) || 0));
    }
    if (f.version !== null) versionsVues.add(f.version);
    // Jamais plus que ce que ce commit a ajouté : ce qu'il n'a pas touché, il ne l'a pas écrit
    // (un fichier renommé depuis un chemin hors liste blanche arrive sans mémoire).
    neuves = Math.min(neuves, f.ajouts - f.deplacees);
    recopiees += f.ajouts - f.deplacees - neuves;

    // Filet 4 : on ne COMPTE que des ajouts — et, depuis les filets 5 et 6, des ajouts NEUFS.
    if (CODE.includes(ext)) { code += neuves; if (f.recent) code7d += neuves; }
    else { ecrits += neuves; if (f.recent) ecrits7d += neuves; }
  };

  const empreintes = new Set(), robotsExclus = new Set();
  let ignorer = true;      // tant qu'on n'a pas vu d'en-tête, on ne compte rien
  let recent = false, enTete = false, avant = null, fichier = null;
  const clore = () => { if (fichier?.chemin) decider(fichier); fichier = null; };

  for await (const brute of readline.createInterface({ input: git.stdout, crlfDelay: Infinity })) {
    if (brute.startsWith('\0')) {
      clore();
      const [auteur = '', horodatage, sujet] = brute.slice(1).split('\x1f');
      const empreinte = `${auteur}\x1f${horodatage}\x1f${sujet}`;
      const robot = EST_UN_BOT(auteur);
      if (robot) robotsExclus.add(auteur);
      ignorer = robot || empreintes.has(empreinte);
      empreintes.add(empreinte);
      const t = parseInt(horodatage, 10);
      recent = Number.isFinite(t) && (maintenant - t) <= SEPT_JOURS;
      continue;
    }
    if (ignorer) continue;

    const ligne = brute.replace(ANSI, '');
    if (ligne.startsWith('diff --git ')) {
      clore();
      fichier = {
        chemin: null, renommeDe: null, version: null, recent,
        ajouts: 0, retraits: 0, deplacees: 0,
        apres: new Map(),              // la version d'arrivée : ligne → nombre d'exemplaires
        deplaceesParTexte: new Map(),
      };
      enTete = true; avant = null;
      continue;
    }
    if (!fichier) continue;
    if (enTete) {
      // Le chemin d'ARRIVÉE ; pour un fichier supprimé (`+++ /dev/null`), celui de départ.
      // Git ajoute une tabulation après un nom qui contient une espace.
      if (ligne.startsWith('index ')) {
        const v = /\.\.([0-9a-f]+)/.exec(ligne)?.[1];
        if (v && !/^0+$/.test(v)) fichier.version = v;   // que des zéros : le fichier est supprimé
      }
      else if (ligne.startsWith('rename from ')) fichier.renommeDe = ligne.slice(12);
      else if (ligne.startsWith('--- a/')) avant = ligne.slice(6).replace(/\t$/, '');
      else if (ligne.startsWith('+++ ')) fichier.chemin = ligne.startsWith('+++ b/') ? ligne.slice(6).replace(/\t$/, '') : avant;
      else if (ligne.startsWith('@@')) enTete = false;
      continue;
    }
    if (ligne.startsWith('@@')) continue;
    const signe = ligne[0], texte = ligne.slice(1).trim();
    if (signe === '-') { fichier.retraits++; continue; }
    if (signe !== '+' && signe !== ' ') continue;          // `\ No newline at end of file`
    fichier.apres.set(texte, (fichier.apres.get(texte) || 0) + 1);
    if (signe === '+') {
      fichier.ajouts++;
      if (estDeplacee(brute)) {
        fichier.deplacees++;
        fichier.deplaceesParTexte.set(texte, (fichier.deplaceesParTexte.get(texte) || 0) + 1);
      }
    }
  }
  clore();
  clearTimeout(chrono);

  // Pas de `try` ici, délibérément. L'ancienne version rendait ZÉRO quand git échouait (délai
  // dépassé, tampon plein) : le dépôt disparaissait du total, et le job restait vert. Un
  // historique illisible n'est pas un dépôt vide — on préfère un job rouge, visible, à un
  // chiffre amputé que personne ne remarque.
  const { code: sortie, signal } = await fin;
  if (sortie !== 0) throw new Error(`git log a échoué sur ${dossier} (${signal || sortie}) : ${erreur.trim()}`);

  return { code, ecrits, code7d, ecrits7d, ecartes, declares, deplacees, recopiees, robotsExclus: [...robotsExclus] };
}

// Le second chiffre : ce qui est ENCORE LÀ, aujourd'hui, sur la branche principale. Il ne
// répond pas à la même question que le premier — « quelle taille fait le projet », et non
// « combien j'en ai écrit » : Glucose 1, réécrit en Rust, compte dans l'un et plus dans l'autre.
// Les deux sont vrais ; c'est pourquoi la page montre les deux. Mêmes règles que le premier :
// liste blanche, dossiers exclus, attributs du dépôt, plafond par fichier.
function presentes(dossier) {
  let sortie;
  try {
    sortie = execFileSync('git',
      ['-C', dossier, '-c', 'core.quotePath=false', 'grep', '-c', '-I', '-e', '', 'HEAD', ...pathspecCode],
      { encoding: 'utf8', maxBuffer: 1 << 28, timeout: CHRONO });
  } catch (e) {
    if (e.status === 1) return 0;   // `git grep` sort 1 quand rien ne correspond : aucun fichier de code
    throw e;
  }
  const fichiers = sortie.split('\n').filter(Boolean).map(l => {
    const sansRef = l.slice('HEAD:'.length), i = sansRef.lastIndexOf(':');
    return { chemin: sansRef.slice(0, i), lignes: parseInt(sansRef.slice(i + 1), 10) };
  });
  const pasDeMoi = declaresPasDeMoi(dossier, fichiers.map(f => f.chemin));
  return fichiers
    .filter(f => !pasDeMoi.has(f.chemin) && f.lignes <= PLAFOND_PAR_FICHIER)
    .reduce((s, f) => s + f.lignes, 0);
}

(async () => {
  // Pas de filtre sur `r.size` : GitHub met des HEURES à calculer la taille d'un dépôt neuf. Le
  // 19 octobre 2026, six dépôts poussés le jour même (dont un de 18 821 fichiers) s'annonçaient
  // à 0 Ko, et le compteur les sautait en silence. Qu'un dépôt soit vide, on le demande à git,
  // après le clone.
  const depots = (await listerDepots()).filter(r => !r.fork && r.name !== OWNER);
  // Toutes les questions à l'API AVANT les clones. Posée après dix minutes de `git clone`, la
  // même requête réutilisait une connexion que GitHub avait fermée entre-temps (« other side
  // closed », vu le 19 octobre 2026) : un échec sans rapport avec la question.
  const glucoseVersion = await derniereVersion('GlucoseGit');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-'));
  const lignes = [];
  const maintenant = Math.floor(Date.now() / 1000);

  try {
    for (const r of depots) {
      const dossier = path.join(tmp, r.name + '.git');
      const url = `https://x-access-token:${TOKEN}@github.com/${r.full_name}.git`;
      // Un clone `--bare` : l'historique seul, sans fichiers déballés, et TOUTES les branches.
      // On ne lit que `git log`, `git grep HEAD` et les attributs (`--source=HEAD`), et un
      // dépôt aux chemins très longs ne peut plus échouer au déballage.
      // Un clone raté, lui non plus, n'est plus sauté en silence : l'ancienne version passait
      // au suivant, et le dépôt manquait au total publié ce jour-là. Le job échoue et on garde
      // les chiffres de la veille, qui étaient justes.
      try {
        execFileSync('git', ['clone', '--quiet', '--bare', url, dossier],
          { stdio: 'ignore', timeout: CHRONO });
      } catch { throw new Error(`clone échoué : ${r.full_name} — rien n'est publié aujourd'hui`); }

      // Vraiment vide : aucune branche, donc aucun commit.
      if (!execFileSync('git', ['-C', dossier, 'for-each-ref', '--count=1', 'refs/heads'], { encoding: 'utf8' }).trim()) {
        console.error(`${r.name.padEnd(38)} (dépôt vide)`);
        continue;
      }

      const m = await parcourir(dossier, maintenant);
      const present = presentes(dossier);
      lignes.push({
        name: r.name, private: r.private, lang: r.language || null,
        all: m.code, d7: m.code7d,              // « all » = le CODE : c'est le chiffre affiché
        present,                                // ce qui en reste aujourd'hui, branche principale
        ecrits: m.ecrits, ecrits7d: m.ecrits7d,
        ecartes: m.ecartes, declares: m.declares, deplacees: m.deplacees, recopiees: m.recopiees,
      });
      console.error(
        `${r.name.padEnd(38)} code=${String(m.code).padStart(8)}  présent=${String(present).padStart(7)}` +
        `  écrits=${String(m.ecrits).padStart(7)}  7j=${String(m.code7d).padStart(7)}` +
        `${m.deplacees ? `  (déplacées : ${m.deplacees})` : ''}` +
        `${m.recopiees ? `  (déjà comptées : ${m.recopiees})` : ''}` +
        `${m.ecartes ? `  (écartés : ${m.ecartes} lignes générées)` : ''}` +
        `${m.declares ? `  (déclarés pas de moi : ${m.declares})` : ''}` +
        `${m.robotsExclus.length ? `  (robots exclus : ${m.robotsExclus.join(', ')})` : ''}`);
    }

    const somme = (k, f = () => true) => lignes.filter(f).reduce((s, x) => s + (x[k] || 0), 0);
    const data = {
      generatedAt: new Date().toISOString().slice(0, 10),
      totalAll: somme('all'), total7d: somme('d7'),
      publicAll: somme('all', r => !r.private), privateAll: somme('all', r => r.private),
      public7d: somme('d7', r => !r.private), private7d: somme('d7', r => r.private),
      ecritsAll: somme('ecrits'), ecrits7d: somme('ecrits7d'),
      presentAll: somme('present'),
      ecartesAll: somme('ecartes'), declaresAll: somme('declares'),
      deplaceesAll: somme('deplacees'), recopieesAll: somme('recopiees'),
      glucoseVersion,
      // La méthode voyage AVEC le chiffre : un nombre qu'on ne peut pas auditer ne vaut rien.
      methode: {
        regle: 'liste blanche — seules les extensions de code listées sont comptées',
        comptage: 'ajouts neufs seuls — ni ligne supprimée, ni ligne déplacée, ni version ou ligne déjà comptée',
        exemplaires: 'dans un fichier, une ligne compte autant de fois qu\'elle a été présente en même temps, au plus',
        branches: 'toutes ; un commit partagé ou recopié (même auteur, date d\'auteur, sujet) ne compte qu\'une fois',
        present: 'lignes de code encore présentes sur la branche principale, mêmes règles',
        fenetre: 'date d\'AUTEUR, insensible aux rebases',
        plafondParFichier: PLAFOND_PAR_FICHIER,
        robots: 'robots d\'entretien exclus (dependabot, renovate, github-actions…) ; agents IA travaillant à ma demande comptés (Claude, Jules, Copilot, Devin…)',
        ecritsComptesAPart: true,
        declaresParLeDepot: ATTRIBUTS_PAS_DE_MOI.join(' + ') + ' (.gitattributes) ne sont jamais comptés',
        note: 'assets 3D, images, données, journaux, dépendances embarquées et fichiers générés ne sont jamais comptés',
      },
      repos: lignes.sort((a, b) => b.all - a.all),
    };
    fs.mkdirSync('stats', { recursive: true });
    fs.writeFileSync('stats/stats.json', JSON.stringify(data, null, 2));
    console.error(
      `\nOK -> stats/stats.json  ·  code ${data.totalAll} (7j ${data.total7d})` +
      `  ·  présent ${data.presentAll}  ·  déplacées ${data.deplaceesAll}  ·  déjà comptées ${data.recopieesAll}` +
      `  ·  écrits ${data.ecritsAll}  ·  écartés comme générés ${data.ecartesAll}` +
      `  ·  déclarés pas de moi ${data.declaresAll}  ·  Glucose ${data.glucoseVersion}`);
  } finally {
    // Les clones portent le jeton dans leur `.git/config`. Sur un runner éphémère c'est sans
    // conséquence ; lancé à la main sur une vraie machine, ça laisserait treize copies du
    // secret en clair dans le dossier temporaire. On efface, quoi qu'il arrive.
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* rien à sauver ici */ }
  }
})();
