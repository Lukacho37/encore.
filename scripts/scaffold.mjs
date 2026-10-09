// Squelettes de la refonte (PLAN.md 9.1, K0) : modules du serveur, jumeaux de la démo, zones de textes et
// composants « emplacements » que les chantiers P0 à P2 remplissent ensuite. Idempotent : un fichier qui existe
// déjà n'est JAMAIS réécrit (il appartient alors à son chantier).
//   node scripts/scaffold.mjs          crée les fichiers manquants
//   node scripts/scaffold.mjs --check  liste les fichiers manquants sans rien écrire (code de sortie 1 s'il en manque)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

// ---------- modules du serveur (ordre de server/modules.js) ----------

// [nom, chantier, section du plan, description, corps de init(deps) ou null pour `return {}`]
const SERVER = [
  ['moderation', 'P0-F', '4.1.6', 'signalements, blocages, file de modération, décisions, appels, suspensions', `
  // Règles d'accès permissives tant que P0-F n'a pas rempli le module (deps.access).
  const access = {
    /** Joueurs à masquer pour \`viewerId\` (bloqués dans un sens ou dans l'autre). */
    hiddenIds: (_viewerId) => new Set(),
    isBlocked: (_a, _b) => false,
    /** Visibilité d'un contenu de \`ownerId\` pour \`viewerId\` : 'public' | 'friends' | 'private'. */
    canSee: (viewerId, ownerId, visibility) => visibility === 'public' || viewerId === ownerId,
    /** Lève 403 suspended / terms_required pour une écriture de contenu ; sans effet ici. */
    assertActive: (_user) => {},
    /** Politique des liens d'un texte publié ; renvoie le texte tel quel ici. */
    linkPolicy: (text) => text,
  };
  return {
    access,
    /** Supprime tout ce qui dépend d'un contenu retiré (notifications, signalements…). */
    purgeTarget: (_type, _id) => {},
    /** Copie figée d'un contenu signalé (pour la décision de modération). */
    snapshot: (_type, _id) => null,
  };`],
  ['notifications', 'P0-F', '4.1.7', 'notifications (demandes d\'ami, décisions de modération, puis sociales en P1)', `
  return {
    /** Crée (ou regroupe) une notification ; sans effet ici. */
    notify: (_userId, _kind, _data) => {},
    unreadCount: (_userId) => 0,
  };`],
  ['search', 'P0-E', '4.1.4, 5.1', 'recherche globale avec autocomplétion', `
  return {
    /** Ajoute ou met à jour un document de recherche (album, morceau, artiste, membre, liste). */
    upsert: (_doc) => {},
    remove: (_kind, _id) => {},
    /** Recalcule l'index après un import du catalogue. */
    refresh: () => {},
  };`],
  ['ratings', 'P0-C', '4.1.2', 'notes et critiques v2 (identifiants, statistiques, amis puis communauté)', `
  return {
    /** Enregistre une note : pas encore disponible (501 not_ready) tant que P0-C n'a pas rempli le module. */
    rate: () => {
      throw new deps.HttpError(501, 'not_ready');
    },
    /** Résumé des notes d'un album ou d'un morceau ({ count, avg… }) ; null ici. */
    summaryOf: (_type, _id) => null,
  };`],
  ['tracks', 'P0-C', '4.1.3', 'page morceau', null],
  ['legal', 'P0-D', '4.1.5', 'informations légales et CGU', null],
  ['account', 'P0-F', '4.1.8', 'droits sur les données : export, suppression du compte', null],
  ['lists', 'P1-C', '4.2.4', 'listes et « Mes 9 albums »', `
  return {
    /** Remplace la grille « Mes 9 albums » d'un joueur (onboarding) ; sans effet ici. */
    setGrid9: (_userId, _albumIds) => {},
  };`],
  ['collection', 'P1-D', '4.2.5, 6', 'jeu de collection : liste d\'envies, focus, paliers de niveau, cosmétiques', `
  return {
    /** Ajoute de l'XP (P1-D y ajoutera les récompenses de niveau et l'événement level.up). */
    addXp: (userId, xp) => {
      deps.db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(xp, userId);
    },
    grantBooster: (_userId, _kind, _data) => {},
    grantCosmetic: (_userId, _key) => {},
    unlockedCosmetics: (_userId) => [],
  };`],
  ['social', 'P1-A', '4.2.1', 'posts, commentaires, j\'aime, permaliens de critiques', null],
  ['feed', 'P1-A', '4.2.2, 5.2', 'fil d\'actualité', null],
  ['studio', 'P1-B', '4.2.3', 'Studio (profil) : blocs, confidentialité, favoris', null],
  ['match', 'P1-E', '4.2.7, 5.3', 'Taste Match', `
  return {
    /** Score de goûts en cache entre deux joueurs ; null ici. */
    cachedScore: (_a, _b) => null,
  };`],
  ['onboarding', 'P1-E', '4.2.7, 5.9', 'premiers pas (profil musical)', null],
  ['discover', 'P1-E', '4.2.7, 5.5', 'Découvrir personnalisé', null],
  ['quests', 'P1-F', '4.2.6, 5.6', 'quêtes quotidiennes et hebdomadaires', null],
  ['badges', 'P1-F', '4.2.6, 5.7', 'badges', null],
  ['battles', 'P1-F', '4.2.6, 5.4', 'duels et classements', null],
  ['passport', 'P2-A', '4.3, 5.8', 'passeport musical et Rétro', null],
  ['sets', 'P2-B', '4.3, 6.8', 'coffrets', null],
  ['events', 'P2-B', '4.3, 6.9', 'événements', null],
  ['enrich', 'P2-C', '4.3', 'provenance et enrichissement du catalogue', null],
  ['workshop', 'P2-D', '4.3, 6.3, 6.11', 'atelier : édition deluxe, Vernir, Comptoir', null],
];

const serverStub = ([name, owner, section, desc, body]) => `// Module « ${name} » : ${desc} (PLAN.md ${section}). Chantier : ${owner}.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.${name}). Contrat de module : voir server/modules.js.
export const name = '${name}';

export function init(${body ? 'deps' : '_deps'}) {${body || '\n  return {};'}
}

export function routes(_r, _deps) {}
`;

// ---------- jumeaux de la démo (client/src/demo/mock/<module>.js) ----------

const mockStub = ([name, owner, section]) => `// Jumeau de démo du module « ${name} » (server/${name}.js, ${owner}, PLAN.md ${section}) : mêmes routes, mêmes formes.
// Squelette posé par K0 (scripts/scaffold.mjs). Contrat : voir client/src/demo/mock/index.js.
export const name = '${name}';

export const routes = [];

export function seed() {}

export function migrate() {}
`;

// ---------- zones de textes (client/src/i18n/areas/<zone>.js) ----------

const AREAS = [
  ['track', 'P0-C', 'page morceau'],
  ['shell', 'P0-D', 'coque du site : barres de navigation, paramètres, page introuvable'],
  ['legal', 'P0-D', 'pages légales'],
  ['search', 'P0-E', 'recherche globale'],
  ['safety', 'P0-F', 'signalements, blocages, notifications, compte'],
  ['social', 'P1-A', 'posts, commentaires, fil'],
  ['studio', 'P1-B', 'Studio et amis'],
  ['lists', 'P1-C', 'listes, « Mes 9 albums », images à partager'],
  ['game', 'P1-D', 'jeu de collection'],
  ['discover', 'P1-E', 'Découvrir, Taste Match, premiers pas'],
  ['play', 'P1-F', 'quêtes, badges, duels, classements'],
  ['passport', 'P2-A', 'passeport et Rétro'],
  ['sets', 'P2-B', 'coffrets et événements'],
  ['enrich', 'P2-C', 'provenance du catalogue, écoute'],
  ['workshop', 'P2-D', 'atelier'],
];

const areaStub = ([name, owner, desc]) => `// Textes de la zone « ${name} » (${owner}) : ${desc}. Fusionnés dans fr.js / en.js au chargement
// (i18n/index.jsx) ; une clé d'ici peut aussi préciser une clé existante. Chaque clé existe en FR et en EN
// (tutoiement, espace fine insécable avant ; : ! ? % et dans « »). Squelette posé par K0 (scripts/scaffold.mjs).
export default { fr: {}, en: {} };
`;

// ---------- composants « emplacements » (PLAN.md 9.2) ----------

const header = (owner, what, props, extra = '') => `// ${what} — chantier ${owner} (PLAN.md 9.2). Props (contrat, ne pas les renommer) : ${props}.
// Squelette posé par K0 (scripts/scaffold.mjs) : ne rend rien tant que ${owner} ne l'a pas rempli.${extra}
`;

const nullSlot = (fn, props) => `export function ${fn}(${props}) {
  return null;
}
`;

const SLOTS = [
  // P0
  ['client/src/components/search/GlobalSearch.jsx', `${header('P0-E', 'Recherche globale de la barre du haut', 'aucune ; montée par la coque')}
${nullSlot('GlobalSearch', '')}
export default GlobalSearch;
`],
  ['client/src/components/safety/SafetyMenu.jsx', `${header('P0-F', 'Menu ⋯ Signaler / Bloquer', '{ target: { type, id }, user?: UserSummary }')}
${nullSlot('SafetyMenu', '_props')}
export default SafetyMenu;
`],
  ['client/src/components/UgcText.jsx', `// Texte publié par un joueur (critique, post, commentaire) — chantier P0-F (PLAN.md 9.2). Props : { text, clamp? }.
// Squelette posé par K0 (scripts/scaffold.mjs) : le texte tel quel, retours à la ligne gardés. P0-F ajoute les liens
// autorisés et la coupure « Lire la suite ».
export function UgcText({ text }) {
  return <span style={{ whiteSpace: 'pre-line' }}>{text}</span>;
}

export default UgcText;
`],
  ['client/src/components/shell/NotificationBell.jsx', `// Cloche des notifications — chantier P0-F (PLAN.md 9.2). Props : aucune ; montée par la coque (P0-D).
// Squelette posé par K0 (scripts/scaffold.mjs) : bouton cloche vers /friends avec le nombre de demandes d'ami en
// attente, en attendant la page /notifications et le menu déroulant de P0-F.
import { Link } from 'react-router';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';

export function NotificationBell() {
  const { pendingFriends } = useGame();
  const { t } = useI18n();
  return (
    <Link to="/friends" className="icon-btn bell" aria-label={t('nav.friends')} title={t('nav.friends')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
      </svg>
      {pendingFriends > 0 && <span className="count-badge">{pendingFriends}</span>}
    </Link>
  );
}

export default NotificationBell;
`],
  ['client/src/components/settings/SafetySettings.jsx', `${header('P0-F', 'Paramètres : membres bloqués, export des données, suppression du compte', 'aucune ; montée par la page Paramètres (P0-D)')}
${nullSlot('SafetySettings', '')}
export default SafetySettings;
`],
  ['client/src/components/AlbumTile.jsx', `// Vignette d'album partagée — chantier P0-B (PLAN.md 9.2). Props (contrat) : { album, progress?, to?, compact?, onClick? }.
// Squelette posé par K0 (scripts/scaffold.mjs) : reprend la vignette actuelle de l'accueil. P0-B y réunit les deux
// vignettes (accueil et collection) et Home.jsx la réexportera pour ArtistPage.
export { AlbumTile, AlbumTileSkeleton } from '../pages/Home.jsx';
export { AlbumTile as default } from '../pages/Home.jsx';
`],
  ['client/src/state/boosterFlow.js', `// Ouverture des boosters (machine d'états partagée) — chantier P0-B (PLAN.md 9.2).
// useBoosterFlow() → { openFree(count), openAlbum(albumId), openSpecial(id), buy(), recycle(), overlay }
// (\`overlay\` rend le PackOpening inchangé). Squelette posé par K0 (scripts/scaffold.mjs) : actions sans effet et
// pas d'overlay, en attendant que P0-B y déplace la logique d'aujourd'hui (Home.jsx, AlbumPage.jsx, Admin.jsx).
const noop = async () => {};

export function useBoosterFlow() {
  return { openFree: noop, openAlbum: noop, openSpecial: noop, buy: noop, recycle: noop, overlay: null };
}

export default useBoosterFlow;
`],
  // P1
  ['client/src/components/social/Discussions.jsx', `${header('P1-A', 'Discussions d\'un album, d\'un morceau ou d\'un artiste', '{ itemType, itemId }')}
${nullSlot('Discussions', '_props')}
export default Discussions;
`],
  ['client/src/components/social/UserPosts.jsx', `${header('P1-A', 'Posts d\'un joueur (onglet Posts du Studio)', '{ username }')}
${nullSlot('UserPosts', '_props')}
export default UserPosts;
`],
  ['client/src/components/social/LikeButton.jsx', `${header('P1-A', 'Bouton J\'aime', '{ targetType, targetId, liked, count }')}
${nullSlot('LikeButton', '_props')}
export default LikeButton;
`],
  ['client/src/components/lists/AddToList.jsx', `${header('P1-C', 'Ajouter à une liste (bouton + feuille) et listes qui contiennent un album', 'AddToListButton { item: { type, id } } ; AlbumListsBlock { albumId }')}
${nullSlot('AddToListButton', '_props')}
${nullSlot('AlbumListsBlock', '_props')}
export default AddToListButton;
`],
  ['client/src/components/lists/Grid9.jsx', `${header('P1-C', '« Mes 9 albums » : grille et bloc du Studio', 'Grid9Block { username, editable } ; Grid9 (grille, props définies par P1-C)')}
${nullSlot('Grid9', '_props')}
${nullSlot('Grid9Block', '_props')}
export default Grid9;
`],
  ['client/src/components/lists/UserLists.jsx', `${header('P1-C', 'Listes d\'un joueur (Studio)', '{ username, editable }')}
${nullSlot('UserLists', '_props')}
export default UserLists;
`],
  ['client/src/share/ShareSheet.jsx', `${header('P1-C', 'Feuille de partage d\'une image (aperçu, partager, télécharger)', '<ShareSheet spec title onClose />')}
${nullSlot('ShareSheet', '_props')}
export default ShareSheet;
`],
  ['client/src/share/renderImage.js', `// Image à partager (PNG) — chantier P1-C (PLAN.md 9.2, règles 7.1 : visuels générés par défaut).
// renderImage(spec) → Promise<{ blob, usedCovers }> ; spec = { format: 'portrait'|'square'|'story', theme: 'ink'|'ivory',
// title, subtitle?, tiles: [{ albumId | trackId, label?, sub? }], blocks?: [...], footer: 'AlbumMania' }.
// Squelette posé par K0 (scripts/scaffold.mjs) : refuse avec le code \`not_ready\`.
export function renderImage(_spec) {
  const err = new Error('not_ready');
  err.code = 'not_ready';
  return Promise.reject(err);
}

export default renderImage;
`],
  ['client/src/components/game/WishlistToggle.jsx', `${header('P1-D', 'Liste d\'envies : bouton « Recherché » et bloc du Studio', 'WishlistToggle { albumId } ; WishlistBlock { username }')}
${nullSlot('WishlistToggle', '_props')}
${nullSlot('WishlistBlock', '_props')}
export default WishlistToggle;
`],
  ['client/src/components/game/SpecialBoosters.jsx', `${header('P1-D', 'Panneau « Boosters spéciaux » (accueil, sous la rangée)', 'aucune')}
${nullSlot('SpecialBoosters', '')}
export default SpecialBoosters;
`],
  ['client/src/components/discover/SimilarAlbums.jsx', `${header('P1-E', 'Albums proches (page album)', '{ albumId }')}
${nullSlot('SimilarAlbums', '_props')}
export default SimilarAlbums;
`],
  ['client/src/components/match/MatchFigure.jsx', `${header('P1-E', 'Pourcentage Taste Match (en-tête du Studio, cartes de joueurs)', '{ username }')}
${nullSlot('MatchFigure', '_props')}
export default MatchFigure;
`],
  ['client/src/components/match/HomeCards.jsx', `${header('P1-E', 'Cartes Taste Match et amis suggérés (colonne de l\'accueil, Amis)', 'TasteMatchCard : aucune ; SuggestedFriends { limit }')}
${nullSlot('TasteMatchCard', '')}
${nullSlot('SuggestedFriends', '_props')}
`],
  ['client/src/components/play/slots.jsx', `${header('P1-F', 'Quêtes, duels, trophées et classements d\'un album', 'QuestStrip : aucune ; BattleWidget : aucune ; TrophyShelf { username } ; AlbumRankings { albumId }')}
${nullSlot('QuestStrip', '')}
${nullSlot('BattleWidget', '')}
${nullSlot('TrophyShelf', '_props')}
${nullSlot('AlbumRankings', '_props')}`],
  ['client/src/components/settings/StudioPrivacy.jsx', `${header('P1-B', 'Paramètres : confidentialité du Studio', 'aucune ; montée par la page Paramètres (P0-D)')}
${nullSlot('StudioPrivacy', '')}
export default StudioPrivacy;
`],
  ['client/src/components/settings/MusicProfileSettings.jsx', `${header('P1-E', 'Paramètres : « Refaire mon profil musical »', 'aucune ; montée par la page Paramètres (P0-D)')}
${nullSlot('MusicProfileSettings', '')}
export default MusicProfileSettings;
`],
  // P2
  ['client/src/components/passport/StudioStats.jsx', `${header('P2-A', 'Bloc statistiques du Studio (passeport)', '{ username }')}
${nullSlot('StudioStats', '_props')}
export default StudioStats;
`],
  ['client/src/components/sets/SetsTab.jsx', `${header('P2-B', 'Onglet « Coffrets » de la collection', 'aucune')}
${nullSlot('SetsTab', '')}
export default SetsTab;
`],
  ['client/src/components/sets/EventChip.jsx', `${header('P2-B', 'Pastille de l\'événement en cours (accueil)', 'aucune')}
${nullSlot('EventChip', '')}
export default EventChip;
`],
  ['client/src/components/game/VernirButton.jsx', `${header('P2-D', 'Bouton « Vernir » (fiche de carte, page morceau)', '{ trackId }')}
${nullSlot('VernirButton', '_props')}
export default VernirButton;
`],
];

// ---------- outillage ----------

const TOOLS = [
  ['scripts/css-lint.mjs', `// Contrôle des feuilles de style (PLAN.md 0.5 et 9.2) — chantier P0-B.
// Squelette posé par K0 (scripts/scaffold.mjs) : ne vérifie encore rien. P0-B y met les règles : pas de couleur
// hexadécimale ni de font-family hors de :root, pas de font-size sous 12 px (10 px pour les micro-étiquettes des
// cartes), préfixe de classe de chaque chantier (/* @prefix gs- */).
console.log('css-lint : règles pas encore écrites (P0-B).');
`],
];

// ---------- écriture ----------

const files = [
  ...SERVER.map((m) => [`server/${m[0]}.js`, serverStub(m)]),
  ...SERVER.map((m) => [`client/src/demo/mock/${m[0]}.js`, mockStub(m)]),
  ...AREAS.map((a) => [`client/src/i18n/areas/${a[0]}.js`, areaStub(a)]),
  ...SLOTS,
  ...TOOLS,
];

let created = 0;
const missing = [];
for (const [rel, content] of files) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) continue;
  missing.push(rel);
  if (check) continue;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // 'wx' : échoue plutôt que d'écraser un fichier apparu entre-temps.
  fs.writeFileSync(abs, content, { flag: 'wx' });
  created += 1;
}

if (check) {
  if (missing.length) console.log(`Squelettes manquants (${missing.length}) :\n  ${missing.join('\n  ')}`);
  else console.log(`Tous les squelettes existent (${files.length}).`);
  process.exitCode = missing.length ? 1 : 0;
} else {
  console.log(`Squelettes : ${created} créé(s), ${files.length - created} déjà présent(s).`);
}

