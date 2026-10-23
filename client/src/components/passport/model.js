// Contenu des images à partager du passeport et des cinq images du Rétro — chantier P2-A (PLAN.md 5.8, 7.1).
// Une seule source pour l'écran et pour l'image : retroSlides() décrit chaque image (données affichées par Retro.jsx)
// et sa spécification pour le moteur de partage de P1-C (share/renderImage.js : vraies pochettes par défaut, repli
// vignette par vignette sur le visuel généré, logo « AlbumMania » en pied). Format story par défaut (1080 × 1920) ;
// la feuille de partage propose aussi 4:5 et carré : chaque image garde au plus un chiffre, une ligne de texte ou
// quatre barres, pour tenir dans les trois formats. Une image sans pochette à montrer n'a pas de spécification
// (le site désactive alors « Partager » et dit pourquoi).
// Les titres d'albums, de morceaux et les noms d'artistes viennent du catalogue du site (champ `catalog` de la réponse).
import { getAlbum, getArtist, getTrack } from '../../catalogStore.js';
import { decadeLabel, genreName, GENRE_COLORS, monthLabel, pct, scoreLabel } from './format.js';

export const SLIDE_IDS = ['intro', 'artist', 'albums', 'moments', 'genres'];

const uniq = (list) => [...new Set(list.filter(Boolean))];
const albumTitle = (id) => getAlbum(id)?.title || '…';
const artistName = (id) => getArtist(id)?.name || '…';

/** Image du passeport : chiffre des morceaux, trois genres, trois albums préférés (vraies pochettes). */
export function passportShareSpec({ t, lang, p, username }) {
  const albums = uniq([...(p.favorites?.albums || []).map((a) => a.id), ...(p.favorites?.collected || []).map((a) => a.id)]).slice(0, 3);
  if (!albums.length) return null;
  const genres = (p.distributions?.genres || []).slice(0, 3);
  const top = genres[0]?.share || 1;
  const blocks = [{ kind: 'stat', value: new Intl.NumberFormat(lang).format(p.totals.cards), label: t('passport.image.cards') }];
  if (genres.length) {
    blocks.push({ kind: 'bars', items: genres.map((g) => ({ label: `${genreName(t, g.id)} · ${pct(lang, g.share)}`, value: g.share / top })) });
  } else {
    blocks.push({
      kind: 'text',
      text: t('passport.image.summary', {
        vinyls: t('passport.image.vinyls', { n: p.totals.albumsCompleted }),
        ratings: t('passport.image.ratings', { n: p.totals.ratings }),
        artists: t('passport.image.artists', { n: p.totals.artists }),
      }),
    });
  }
  return {
    format: 'portrait',
    theme: 'ink',
    title: t('passport.image.title'),
    subtitle: username ? `@${username}` : '',
    tiles: albums.map((albumId) => ({ albumId })),
    blocks,
    footer: 'AlbumMania',
  };
}

/**
 * Les cinq images du Rétro d'une année : [{ id, name, empty, spec, …données }]. `scale` : échelle de notation du
 * joueur ('stars' | 'points').
 */
export function retroSlides({ t, lang, r, username, scale }) {
  const num = (n) => new Intl.NumberFormat(lang).format(n || 0);
  const year = r.year;
  const handle = username ? `@${username}` : '';
  const totals = r.totals || {};
  const top = r.top || {};
  const m = r.moments || {};
  const base = (spec) => ({ format: 'story', theme: 'ink', subtitle: handle, footer: 'AlbumMania', ...spec });

  // 1. Mon année : le grand chiffre, quelques faits, les albums les plus collectionnés.
  const facts = [
    totals.completed ? t('retro.intros.vinyls', { n: totals.completed }) : null,
    totals.ratings ? t('retro.intros.ratings', { n: totals.ratings }) : null,
    totals.boosters ? t('retro.intros.boosters', { n: totals.boosters }) : null,
    totals.battleVotes ? t('retro.intros.battles', { n: totals.battleVotes }) : null,
  ].filter(Boolean);
  const introCovers = uniq([...(top.collected || []).map((a) => a.id), ...(top.albums || []).map((a) => a.id)]).slice(0, 4);
  const thinText = totals.cards || totals.ratings ? t('retro.intros.thin') : t('retro.intros.empty');
  const intro = {
    id: 'intro',
    name: t('retro.intros.name'),
    title: t('retro.intros.title', { year }),
    cards: totals.cards || 0,
    cardsLabel: t('retro.intros.cards', { n: totals.cards || 0 }),
    facts,
    thin: r.thin ? thinText : null,
    covers: introCovers,
    empty: !totals.cards && !totals.ratings,
  };
  intro.spec = introCovers.length ? base({
    title: intro.title,
    tiles: introCovers.map((albumId) => ({ albumId })),
    blocks: [
      { kind: 'stat', value: num(intro.cards), label: intro.cardsLabel },
      { kind: 'text', text: facts.length ? facts.join(' · ') : thinText },
    ],
  }) : null;

  // 2. Mon artiste de l'année : la pochette de son album le plus collectionné, son nom, ses chiffres.
  const a = top.artist;
  const artistFacts = a ? [
    a.cards ? t('retro.artist.cards', { n: a.cards, year }) : null,
    a.albums ? t('retro.artist.albums', { n: a.albums }) : null,
    a.rated ? t('retro.artist.rated', { n: a.rated }) : null,
    a.favorite ? t('retro.artist.favorite') : null,
  ].filter(Boolean) : [];
  const artist = {
    id: 'artist',
    name: t('retro.artist.name'),
    title: t('retro.artist.title'),
    artistId: a?.id || null,
    artist: a ? artistName(a.id) : null,
    albumId: a?.albumId || null,
    facts: artistFacts,
    runnersUp: (top.artists || []).slice(1, 4).map((x) => artistName(x.id)),
    empty: !a,
  };
  artist.spec = a?.albumId ? base({
    title: artist.artist,
    subtitle: `${t('retro.artist.title')} · ${year}`,
    tiles: [{ albumId: a.albumId }],
    blocks: artistFacts.length ? [{ kind: 'text', text: artistFacts.join(' · ') }] : [],
  }) : null;

  // 3. Mes albums de l'année : les mieux notés, sinon les plus collectionnés.
  const rated = top.albums || [];
  const byRating = rated.length > 0;
  const albumItems = (byRating ? rated : top.collected || []).slice(0, 5).map((x) => ({
    albumId: x.id,
    title: albumTitle(x.id),
    artist: getAlbum(x.id)?.artist || '',
    sub: byRating ? scoreLabel(t, lang, x.score, scale, 1) : t('retro.albums.cardsSub', { n: x.cards }),
  }));
  const albumsTitle = byRating ? t('retro.albums.title', { n: albumItems.length, year }) : t('retro.albums.collectedTitle');
  const albums = {
    id: 'albums',
    name: t('retro.albums.name'),
    title: albumsTitle,
    caption: byRating ? t('retro.albums.rated', { year }) : t('retro.albums.collected', { year }),
    items: albumItems,
    empty: !albumItems.length,
  };
  albums.spec = albumItems.length ? base({
    title: albumsTitle,
    tiles: albumItems.map((x) => ({ albumId: x.albumId, label: x.title, sub: x.sub })),
  }) : null;

  // 4. Mes moments : première carte, premier vinyle (n° de pressage), pépite, plus petit pressage, mois le plus actif.
  const items = [];
  if (m.firstCard) {
    const tr = getTrack(m.firstCard.trackId);
    items.push({ kind: 'firstCard', label: t('retro.moments.firstCard'), trackId: m.firstCard.trackId, title: tr?.title || '…', sub: `${tr?.artist || ''} · ${dateLabel(lang, m.firstCard.at)}` });
  }
  if (m.firstCompletion) {
    items.push({
      kind: 'firstVinyl', label: t('retro.moments.firstVinyl'), albumId: m.firstCompletion.albumId, title: albumTitle(m.firstCompletion.albumId),
      sub: [m.firstCompletion.rank ? t('retro.moments.pressing', { n: m.firstCompletion.rank }) : null, dateLabel(lang, m.firstCompletion.at)].filter(Boolean).join(' · '),
    });
  }
  if (m.rarestPull && m.rarestPull.trackId !== m.firstCard?.trackId) {
    const tr = getTrack(m.rarestPull.trackId);
    items.push({ kind: 'rarest', label: t('retro.moments.rarest'), trackId: m.rarestPull.trackId, rarity: m.rarestPull.rarity, title: tr?.title || '…', sub: `${t(`rarity.${m.rarestPull.rarity}`)} · ${tr?.artist || ''}` });
  } else if (m.rarestPull) {
    items[0].rarity = m.rarestPull.rarity;
  }
  if (m.lowestPressing && m.lowestPressing.albumId !== m.firstCompletion?.albumId) {
    items.push({ kind: 'lowest', label: t('retro.moments.lowest'), albumId: m.lowestPressing.albumId, title: albumTitle(m.lowestPressing.albumId), sub: t('retro.moments.pressing', { n: m.lowestPressing.rank }) });
  }
  const busiest = m.busiestMonth
    ? (m.busiestMonth.cards
      ? t('retro.moments.busiestValue', { month: monthLabel(m.busiestMonth.month, lang, { year: false }), n: m.busiestMonth.cards })
      : t('retro.moments.busiestRatings', { month: monthLabel(m.busiestMonth.month, lang, { year: false }), n: m.busiestMonth.ratings }))
    : null;
  const moments = {
    id: 'moments',
    name: t('retro.moments.name'),
    title: t('retro.moments.title', { year }),
    items: items.slice(0, 4),
    busiest,
    empty: !items.length && !busiest,
  };
  moments.spec = items.length ? base({
    title: moments.title,
    tiles: items.slice(0, 4).map((x) => (x.trackId ? { trackId: x.trackId, label: x.label, sub: x.title } : { albumId: x.albumId, label: x.label, sub: x.sub })),
    blocks: busiest ? [{ kind: 'text', text: `${t('retro.moments.busiest')} : ${busiest}`.replace(' :', lang === 'fr' ? ' :' : ':') }] : [],
  }) : null;

  // 5. Mon année en genres : barres des genres, genre et époque de l'année, un album par genre.
  const genresList = (top.genres || []).slice(0, 4);
  const topShare = genresList[0]?.share || 1;
  const bars = genresList.map((g, i) => ({ id: g.id, label: genreName(t, g.id), share: g.share, value: g.share / topShare, color: GENRE_COLORS[i], pct: pct(lang, g.share) }));
  const decade = top.decades?.[0]?.decade;
  const genres = {
    id: 'genres',
    name: t('retro.genres.name'),
    title: t('retro.genres.title'),
    top: genresList[0] ? t('retro.genres.top', { genre: genreName(t, genresList[0].id) }) : null,
    decade: decade ? t('retro.genres.decade', { decade: decadeLabel(t, decade) }) : null,
    bars,
    covers: uniq(genresList.map((g) => g.albumId)).slice(0, 4),
    empty: !genresList.length,
  };
  genres.spec = genres.covers.length ? base({
    title: genres.title,
    subtitle: genres.top || handle,
    tiles: genres.covers.map((albumId) => ({ albumId })),
    blocks: [{ kind: 'bars', items: bars.map((b) => ({ label: `${b.label} · ${b.pct}`, value: b.value })) }],
  }) : null;

  return [intro, artist, albums, moments, genres];
}

/** « 14 mars » (« 14 March »), heure de Paris. */
export function dateLabel(lang, at) {
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date(at));
}
