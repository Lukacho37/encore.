// Taste Match (/match/:username) — chantier P1-E (PLAN.md 2.5, 4.2.7, 5.3 ; design-system-current §4.5).
// GET /api/match/:username → { score, confidence, estimate, components, shared, differences, recommendsToMe,
// recommendsToThem, user, computedAt, catalog }. La page : grand « 87 % » (Archivo 900), paire d'avatars, confiance
// (« Estimation » quand il y a trop peu de notes en commun), barres des composantes avec leur explication en clair,
// albums, artistes, morceaux et genres en commun, « Différences intéressantes », « @x te recommande » et « Tu
// recommandes à @x », et « Partager » : une image composée dans le navigateur (ShareSheet de P1-C, vraies pochettes
// par défaut, visuel généré en repli). Indisponible (403 match_unavailable) entre joueurs bloqués, pour un Studio privé
// ou réservé aux amis d'un non-ami.
import { lazy, Suspense, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useAlbum, useAlbums, useApi, useArtists, useTracks } from '../state/catalog.js';
import { Avatar, Icon } from '../components/ui.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { AlbumTile } from '../components/AlbumTile.jsx';
import { useFormatScore } from '../components/Rating.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { ArtistBadge } from '../components/search/ArtistBadge.jsx';
import { Shelf } from '../components/discover/Shelf.jsx';
import { genreName, MatchBars } from '../components/match/parts.jsx';
import '../styles/discover.css';

// Feuille de partage chargée seulement quand on partage.
const ShareSheet = lazy(() => import('../share/ShareSheet.jsx'));

const enc = encodeURIComponent;
const TILE_SIZES = '(max-width: 640px) 45vw, 150px';

/** Spécification de l'image à partager (renderImage) : score, pseudos, barres, pochettes en commun. */
function shareSpec(t, m, me) {
  const albums = m.shared.albums.length ? m.shared.albums : [...m.recommendsToMe, ...m.recommendsToThem];
  return {
    format: 'portrait',
    theme: 'ink',
    title: t('match.shareImageTitle', { score: m.score }),
    subtitle: t('match.shareSubtitle', { me, them: m.user.username }),
    tiles: [...new Set(albums)].slice(0, 9).map((albumId) => ({ albumId })),
    blocks: [{
      kind: 'bars',
      items: m.components.filter((c) => c.value != null).map((c) => ({ label: t(`match.components.${c.key}`), value: c.value / 100 })),
    }],
    footer: 'AlbumMania',
  };
}

function Head({ m, onShare }) {
  const { t } = useI18n();
  const { user } = useGame();
  const name = m.user.username;
  const tone = m.confidence === 'high' ? 'chip--cue' : m.confidence === 'medium' ? 'chip--quiet' : 'chip--gold';
  return (
    <section className="panel dc-match-head" data-match-score={m.score} data-confidence={m.confidence}>
      <span className="match-card__pair">
        <Avatar user={user} size={64} />
        <Avatar user={m.user} size={64} />
      </span>
      <div>
        <p className="eyebrow">{t('match.eyebrow')}</p>
        <p className="dc-match-head__pct">{t('match.pct', { n: m.score })}</p>
        <p className="dc-match-head__who">
          {withName(t('match.with', { name: '\u0000' }), <Link to={`/u/${enc(name)}`}>@{name}</Link>)}
        </p>
        <div className="dc-match-head__chips">
          <span className={`chip chip--sm ${tone}`}>{t(`match.confidence.${m.confidence}`)}</span>
        </div>
      </div>
      <div className="dc-match-head__actions">
        <button type="button" className="btn btn--primary" onClick={onShare} data-match-share="">
          <Icon name="share" size={16} /> {t('match.share')}
        </button>
        <Link to={`/u/${enc(name)}`} className="btn btn--ghost">{t('match.seeStudio')}</Link>
      </div>
    </section>
  );
}

/** « Compatibilité musicale avec @x » : le pseudo (marqué \0 dans le texte traduit) devient un lien. */
function withName(text, node) {
  const [before, after = ''] = text.split('\u0000');
  return <>{before.replace(/@$/, '')}{node}{after}</>;
}

function SharedAlbums({ ids, total }) {
  const { t } = useI18n();
  const albums = useAlbums(ids);
  return (
    <section className="panel" data-match-block="albums">
      <h2 className="panel__title dc-section-title"><Icon name="disc" /> {t('match.shared.albums')}
        {total > ids.length && <span className="chip chip--sm chip--mono">{total}</span>}
      </h2>
      {ids.length ? (
        <div className="dc-grid dc-grid--small">
          {ids.map((id, i) => (albums[i] ? <AlbumTile key={id} album={albums[i]} discover compact sizes={TILE_SIZES} /> : null))}
        </div>
      ) : <p className="small muted">{t('match.shared.none')}</p>}
    </section>
  );
}

function SharedArtists({ ids, genres }) {
  const { t } = useI18n();
  const artists = useArtists(ids);
  return (
    <section className="panel" data-match-block="artists">
      <h2 className="panel__title dc-section-title"><Icon name="users" /> {t('match.shared.artists')}</h2>
      {ids.length ? (
        <ul className="dc-artists">
          {ids.map((id, i) => (
            <li key={id}>
              <Link to={`/artist/${enc(id)}`} className="dc-artist">
                <ArtistBadge artist={artists[i] || { id, name: '?' }} size={64} />
                <span>{artists[i]?.name || '…'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="small muted">{t('match.shared.none')}</p>}
      <h3 className="label">{t('match.shared.genres')}</h3>
      {genres.length ? (
        <div className="dc-chips">
          {genres.map((g) => <Link key={g} to={`/collection/albums?genre=${enc(g)}`} className="chip chip--toggle">{genreName(t, g)}</Link>)}
        </div>
      ) : <p className="small muted">{t('match.shared.none')}</p>}
    </section>
  );
}

function SharedTracks({ ids }) {
  const { t } = useI18n();
  const tracks = useTracks(ids);
  return (
    <section className="panel" data-match-block="tracks">
      <h2 className="panel__title dc-section-title"><Icon name="star" /> {t('match.shared.tracks')}</h2>
      {ids.length ? (
        <ul className="dc-rows">
          {ids.map((id, i) => {
            const tr = tracks[i];
            return (
              <li key={id} className="dc-row">
                <span className="dc-row__cover">{tr?.art && <CoverArt art={{ ...tr.art, seed: tr.art.seed || tr.albumId || tr.id }} sizes="48px" />}</span>
                <span className="dc-row__text">
                  <Link to={`/track/${enc(id)}`} className="dc-row__title">{tr?.title || '…'}</Link>
                  <span className="dc-row__sub">{tr ? `${tr.artist}${tr.album ? ` · ${tr.album}` : ''}` : ''}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="small muted">{t('match.shared.none')}</p>}
    </section>
  );
}

/** Une différence : « Tu as mis 5 ★ à Nevermind, @leo 1 ★ ». */
function DifferenceRow({ d, name }) {
  const { t } = useI18n();
  const format = useFormatScore();
  const album = useAlbum(d.type === 'album' ? d.id : null);
  const [track] = useTracks(d.type === 'track' ? [d.id] : []);
  const item = d.type === 'album' ? album : track;
  const to = d.type === 'album' ? `/album/${enc(d.id)}` : `/track/${enc(d.id)}`;
  const art = item?.art;
  const title = item?.title || '…';
  const [before, after = ''] = t('match.differences.line', { mine: '\u0001', theirs: '\u0002', title: '\u0000', name }).split('\u0000');
  const fill = (s) => s.split(/([\u0001\u0002])/).map((part, i) => (part === '\u0001' ? <b key={i}>{format(d.mine)}</b> : part === '\u0002' ? <b key={i}>{format(d.theirs)}</b> : part));
  return (
    <li className="dc-row" data-difference={d.id}>
      <span className="dc-row__cover">{art && <CoverArt art={{ ...art, seed: art.seed || d.id }} sizes="48px" />}</span>
      <span className="dc-row__text">
        <Link to={to} className="dc-row__title">{title}</Link>
        <span className="dc-row__sub">{fill(before)}<b>{title}</b>{fill(after)}</span>
      </span>
    </li>
  );
}

function Differences({ list, name }) {
  const { t } = useI18n();
  if (!list.length) return null;
  return (
    <section className="panel" data-match-block="differences">
      <h2 className="panel__title dc-section-title"><Icon name="quote" /> {t('match.differences.title')}</h2>
      <ul className="dc-rows">
        {list.map((d) => <DifferenceRow key={`${d.type}:${d.id}`} d={d} name={name} />)}
      </ul>
    </section>
  );
}

const UNAVAILABLE = ['match_unavailable', 'user_not_found', 'match_self'];

/** Message d'une page indisponible (bloqué, Studio fermé, inconnu, soi-même). */
function Unavailable({ error }) {
  const { t } = useI18n();
  const code = error?.code;
  if (code === 'match_unavailable') {
    return <EmptyState icon="lock" title={t('match.unavailableTitle')} body={t('match.unavailableBody')} action={{ label: t('match.back'), to: '/friends', primary: false }} />;
  }
  if (code === 'user_not_found') {
    return <EmptyState icon="search" title={t('match.notFoundTitle')} body={t('match.notFoundBody')} action={{ label: t('match.back'), to: '/friends', primary: false }} />;
  }
  return <EmptyState icon="user" title={t('match.selfTitle')} body={t('match.selfBody')} action={{ label: t('nav.friends'), to: '/friends', primary: false }} />;
}

export default function TasteMatch() {
  const { t } = useI18n();
  const { username = '' } = useParams();
  const { user } = useGame();
  const { data: m, error, reload } = useApi(`/match/${enc(username)}`, { keep: false });
  const [sharing, setSharing] = useState(false);

  if (error) {
    return (
      <div className="dc-match" data-match="unavailable">
        <header className="page-head"><div><p className="eyebrow">{t('match.eyebrow')}</p><h1>@{username}</h1></div></header>
        {UNAVAILABLE.includes(error.code) ? <Unavailable error={error} /> : <ErrorBox error={error} onRetry={reload} />}
      </div>
    );
  }
  if (!m) {
    return (
      <div className="dc-match" aria-busy="true">
        <span className="skeleton dc-match-skel" />
        <span className="skel-row" />
        <span className="skel-row" />
      </div>
    );
  }
  const name = m.user?.username || username;
  return (
    <div className="dc-match" data-match="page">
      <h1 className="sr-only">{t('match.title')} · @{name}</h1>
      <Head m={{ ...m, user: m.user || { username: name } }} onShare={() => setSharing(true)} />
      {(m.estimate || !m.hasData) && <p className="dc-match__note" role="note"><Icon name="star" size={14} /> {m.hasData ? t('match.estimate') : t('match.noData')}</p>}

      <section className="panel" data-match-block="components">
        <h2 className="panel__title">{t('match.componentsTitle')}</h2>
        <MatchBars components={m.components} explain />
      </section>

      <div className="dc-match__cols">
        <SharedAlbums ids={m.shared.albums} total={m.shared.counts?.albums || m.shared.albums.length} />
        <SharedArtists ids={m.shared.artists.slice(0, 8)} genres={m.shared.genres} />
      </div>
      <div className="dc-match__cols">
        <SharedTracks ids={m.shared.tracks.slice(0, 6)} />
        <Differences list={m.differences} name={name} />
      </div>

      {m.recommendsToMe.length > 0 && (
        <Shelf id="to-me" title={t('match.recommendsToMe', { name })} reason={t('match.recommendsToMeBody')} albumIds={m.recommendsToMe} />
      )}
      {m.recommendsToThem.length > 0 && (
        <Shelf id="to-them" title={t('match.recommendsToThem', { name })} reason={t('match.recommendsToThemBody', { name })} albumIds={m.recommendsToThem} />
      )}

      {sharing && (
        <Suspense fallback={null}>
          <ShareSheet spec={shareSpec(t, { ...m, user: m.user || { username: name } }, user?.username || '')} title={t('match.shareTitle')}
            onClose={() => setSharing(false)} fileName={`taste-match-${name}`} />
        </Suspense>
      )}
    </div>
  );
}
