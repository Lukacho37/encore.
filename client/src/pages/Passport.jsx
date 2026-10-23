// Passeport musical (/passport, /u/:username/passport) — chantier P2-A (PLAN.md 2.5, 4.3, 5.8, 8.3 P2.1).
// GET /api/passport (ou /api/users/:username/passport) → { totals, favorites, distributions, timeline, evolution,
// memberSince, computedAt, owner, self, retro, catalog } (cache d'une heure côté serveur).
// La page, dans l'identité actuelle (panneaux, blocs de statistiques .stat-grid, puces, pilules ivoires) :
//   1. en-tête : surtitre, « Ton passeport musical » / « Le passeport de @x », membre depuis, Partager (image composée
//      dans le navigateur par le moteur de P1-C, vraies pochettes par défaut) et le Rétro (ou sa date d'ouverture) ;
//   2. En chiffres : morceaux, vinyles, artistes, notes, critiques, listes, duels, boosters ; genres ; raretés ;
//   3. favoris : artiste favori (et pourquoi), artistes les plus présents, albums les mieux notés et les plus
//      collectionnés, genre, décennie et pays n° 1 ;
//   4. discothèque en détail : genres, décennies, pays (« données partielles » tant que le pays n'est pas connu pour
//      tout), notes, raretés — barres et colonnes en SVG (charts.jsx) ;
//   5. 12 derniers mois : cartes, notes ou vinyles par mois (depuis l'arrivée du joueur, 6 mois au moins) ;
//   6. évolution des goûts : genres des découvertes, trimestre par trimestre, et la phrase qui la résume.
// Confidentialité appliquée par le serveur : un passeport privé ou réservé aux amis répond 403 passport_private (la
// page le dit, avec un lien vers le Studio), un joueur bloqué ou inconnu 404.
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useAlbum, useApi, useArtist } from '../state/catalog.js';
import { Icon } from '../components/ui.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { ArtistBadge } from '../components/search/ArtistBadge.jsx';
import { Columns, HBars, StackedBars } from '../components/passport/charts.jsx';
import {
  ago, decadeLabel, genreColors, genreName, monthLabel, monthOf, OTHER_COLOR, pct, quarterLabel, RARITY_COLORS, scoreLabel,
} from '../components/passport/format.js';
import { passportShareSpec } from '../components/passport/model.js';
import '../styles/passport.css';

// Feuille de partage chargée seulement quand on partage.
const ShareSheet = lazy(() => import('../share/ShareSheet.jsx'));

const enc = encodeURIComponent;
const RARITY_ORDER = ['legendary', 'promo', 'ultra', 'super', 'rare', 'uncommon', 'common'];
const SERIES = { cards: 'var(--cue)', ratings: 'var(--gold)', completions: 'var(--r-super)' };
const MIN_MONTHS = 6;

export default function Passport() {
  const { username } = useParams();
  const { t } = useI18n();
  const { user } = useGame();
  const self = !username || user?.username?.toLowerCase() === username.toLowerCase();
  const path = self ? '/passport' : `/users/${enc(username)}/passport`;
  const { data, error, loading, reload } = useApi(path, { keep: false });

  if (loading) return <PassportSkeleton />;
  if (error) {
    if (error.code === 'passport_private') {
      return (
        <div className="pp-page" data-page="passport" data-passport="private">
          <EmptyState icon="lock" title={t('passport.private.title')}
            body={t(error.data?.visibility === 'friends' ? 'passport.private.friends' : 'passport.private.private', { name: username })}
            action={{ label: t('passport.private.cta'), to: `/u/${enc(username)}`, primary: false }} />
        </div>
      );
    }
    if (error.code === 'user_not_found') {
      return (
        <div className="pp-page" data-page="passport" data-passport="missing">
          <EmptyState icon="user" body={t('passport.notFound')} action={{ label: t('nav.friends'), to: '/friends', primary: false }} />
        </div>
      );
    }
    return <div className="pp-page" data-page="passport"><ErrorBox error={error} onRetry={reload} /></div>;
  }
  if (!data) return null;
  return <PassportView p={data} />;
}

function PassportSkeleton() {
  return (
    <div className="pp-page" data-page="passport" aria-busy="true">
      <div className="pp-skel pp-skel--head skeleton" />
      <div className="stat-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="pp-skel skeleton" />)}</div>
      <div className="pp-skel pp-skel--panel skeleton" />
    </div>
  );
}

function PassportView({ p }) {
  const { t, lang } = useI18n();
  const [sharing, setSharing] = useState(false);
  const name = p.owner?.username || '';
  const self = !!p.self;
  const empty = !p.totals.cards && !p.totals.ratings;
  const colors = useMemo(() => genreColors(p), [p]);
  const spec = self ? passportShareSpec({ t, lang, p, username: name }) : null;
  const section = (key) => t(`passport.sections.${key}${self ? '' : 'Other'}`);

  return (
    <div className="pp-page" data-page="passport" data-passport={self ? 'self' : 'other'}>
      <header className="page-head pp-head">
        <div>
          <span className="eyebrow">{t('passport.kicker')}</span>
          <h1>{self ? t('passport.title') : t('passport.titleOther', { name })}</h1>
          <p className="pp-head__intro">{self ? t('passport.intro') : t('passport.introOther', { name })}</p>
          <div className="pp-head__meta">
            <span className="chip chip--sm chip--quiet">{t('passport.memberSince', { date: monthOf(p.memberSince, lang) })}</span>
            {p.favorites?.genre && <span className="chip chip--sm chip--cue">{genreName(t, p.favorites.genre)}</span>}
          </div>
        </div>
        <div className="pp-head__actions">
          {self ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => setSharing(true)} disabled={!spec}
                title={spec ? undefined : t('passport.shareNone')} data-passport-share="">
                <Icon name="share" size={16} /> {t('passport.share')}
              </button>
              <RetroLink retro={p.retro} />
            </>
          ) : (
            <>
              <Link to={`/u/${enc(name)}`} className="btn btn--ghost">{t('passport.seeStudio')}</Link>
              <Link to={`/match/${enc(name)}`} className="btn btn--ghost"><Icon name="users" size={16} /> {t('passport.compare')}</Link>
            </>
          )}
        </div>
      </header>

      {empty && (
        <section className="panel" data-pp="empty">
          <EmptyState icon="disc" title={self ? t('passport.empty.title') : null}
            body={self ? t('passport.empty.body') : t('passport.favorites.noneOther', { name })}
            action={self ? { label: t('passport.empty.cta'), to: '/', icon: 'pack' } : null} />
        </section>
      )}

      <Totals p={p} colors={colors} section={section} />
      {!empty && (
        <>
          <Favorites p={p} self={self} section={section} />
          <Distributions p={p} colors={colors} section={section} />
          <Timeline p={p} section={section} />
          <Evolution p={p} colors={colors} section={section} />
        </>
      )}

      <p className="pp-foot">{t('passport.updated', { when: ago(lang, p.computedAt) })}</p>

      {sharing && spec && (
        <Suspense fallback={null}>
          <ShareSheet spec={spec} title={t('passport.shareTitle')} fileName={t('passport.image.title')} onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Lien vers le dernier Rétro disponible, ou la date d'ouverture de celui de l'année. */
function RetroLink({ retro }) {
  const { t } = useI18n();
  if (!retro) return null;
  const last = retro.years?.[0];
  if (last) {
    return <Link to={`/retro/${last}`} className="btn btn--ghost" data-retro-link=""><Icon name="star" size={16} /> {t('passport.retro', { year: String(last) })}</Link>;
  }
  if (retro.current?.status === 'locked') {
    return <Link to={`/retro/${retro.current.year}`} className="btn btn--ghost" data-retro-link="">{t('passport.retroSoon', { year: String(retro.current.year) })}</Link>;
  }
  return null;
}

// ----- en chiffres ---------------------------------------------------------------------------------------------

function Totals({ p, colors, section }) {
  const { t, lang, num } = useI18n();
  const { ratingScale } = useGame();
  const s = p.totals;
  const genres = (p.distributions.genres || []).slice(0, 4);
  const top = genres[0]?.share || 1;
  const rarities = RARITY_ORDER.map((id) => p.distributions.rarities.find((r) => r.id === id))
    .filter((r) => r && (r.cards > 0 || (r.id !== 'promo' && r.id !== 'common')));
  const blocks = [
    { id: 'cards', value: s.cards, small: s.holo ? t('passport.totals.holo', { n: s.holo }) : null },
    { id: 'albums', value: s.albumsCompleted, small: s.albumsStarted ? t('passport.totals.albumsOf', { n: s.albumsStarted }) : null },
    { id: 'artists', value: s.artists, small: s.artistsMastered ? t('passport.totals.mastered', { n: s.artistsMastered }) : null },
    { id: 'ratings', value: s.ratings, small: s.average != null ? t('passport.totals.average', { avg: scoreLabel(t, lang, s.average, ratingScale) }) : null },
    { id: 'reviews', value: s.reviews },
    { id: 'lists', value: s.lists },
    { id: 'battles', value: s.battleVotes },
    { id: 'boosters', value: s.boosters, small: t('passport.totals.boostersWhen') },
  ];
  return (
    <section className="panel" data-pp="totals" aria-labelledby="pp-totals">
      <h2 className="panel__title" id="pp-totals"><Icon name="grid" /> {section('totals')}</h2>
      <dl className="stat-grid">
        {blocks.map((b) => (
          <div key={b.id} className="stat-block" data-total={b.id}>
            <dt>{t(`passport.totals.${b.id}`)}</dt>
            <dd>{num(b.value || 0)}{b.small && <> <small>{b.small}</small></>}</dd>
          </div>
        ))}
        <div className="stat-block stat-block--wide">
          <dt>{t('passport.totals.genres')}</dt>
          <dd className="pp-dd">
            {genres.length ? (
              <ul className="stat-bars">
                {genres.map((g) => (
                  <li key={g.id}>
                    <span>{genreName(t, g.id)}</span>
                    <span className="progress progress--sm" style={{ '--pc': colors.get(g.id) || OTHER_COLOR }} aria-hidden="true">
                      <span className="progress__fill" style={{ width: `${(g.share / top) * 100}%` }} />
                    </span>
                    <span className="mono">{pct(lang, g.share)}</span>
                  </li>
                ))}
              </ul>
            ) : <span className="pp-hint">{t('passport.totals.genresNone')}</span>}
          </dd>
        </div>
        <div className="stat-block stat-block--wide">
          <dt>{t('passport.totals.rarities')}</dt>
          <dd className="pp-dd">
            {s.cards ? (
              <ul className="pp-rarities">
                {rarities.map((r) => (
                  <li key={r.id} style={{ '--pp-c': RARITY_COLORS[r.id] }}>
                    <b>{num(r.cards)}</b>
                    <span>{t(`rarity.${r.id}`)}</span>
                  </li>
                ))}
              </ul>
            ) : <span className="pp-hint">{t('passport.totals.raritiesNone')}</span>}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ----- favoris -------------------------------------------------------------------------------------------------

function Favorites({ p, self, section }) {
  const { t, lang, country } = useI18n();
  const { ratingScale } = useGame();
  const fav = p.favorites;
  const a = fav.artist;
  const artist = useArtist(a?.id || null);
  const why = a ? [
    a.cards ? t('passport.favorites.cards', { n: a.cards }) : null,
    a.rated ? t('passport.favorites.rated', { n: a.rated }) : null,
    a.favorite ? t(self ? 'passport.favorites.inFavorites' : 'passport.favorites.inFavoritesOther') : null,
  ].filter(Boolean).join(' · ') : '';
  return (
    <section className="panel" data-pp="favorites" aria-labelledby="pp-favorites">
      <h2 className="panel__title" id="pp-favorites"><Icon name="star" /> {section('favorites')}</h2>
      <div className="pp-fav">
        <div className="pp-card">
          <span className="label">{t('passport.favorites.artist')}</span>
          {a ? (
            <div className="pp-artist" data-favorite-artist={a.id}>
              <ArtistBadge artist={artist || { id: a.id, name: '?' }} size={72} />
              <div>
                <Link to={`/artist/${enc(a.id)}`} className="pp-artist__name">{artist?.name || '…'}</Link>
                {why && <p className="pp-artist__why">{why}</p>}
              </div>
            </div>
          ) : <p className="pp-hint">{self ? t('passport.favorites.none') : t('passport.favorites.noneOther', { name: p.owner?.username })}</p>}
          <div className="pp-chips">
            {fav.genre && <span className="chip chip--sm chip--quiet">{t('passport.favorites.genre')} · {genreName(t, fav.genre)}</span>}
            {fav.decade != null && <span className="chip chip--sm chip--quiet">{t('passport.favorites.decade')} · {decadeLabel(t, fav.decade)}</span>}
            {fav.country && <span className="chip chip--sm chip--quiet">{t('passport.favorites.country')} · {country(fav.country)}</span>}
          </div>
        </div>
        <div className="pp-card">
          <span className="label">{t('passport.favorites.topArtists')}</span>
          {fav.artists.length ? (
            <ol className="pp-rank">
              {fav.artists.map((x, i) => <ArtistRow key={x.id} x={x} i={i} />)}
            </ol>
          ) : <p className="pp-hint">{t('passport.dist.empty')}</p>}
        </div>
      </div>
      <div className="pp-card">
        <span className="label">{t('passport.favorites.best')}</span>
        {fav.albums.length ? (
          <div className="pp-tiles">
            {fav.albums.map((x) => <AlbumMini key={x.id} id={x.id} meta={scoreLabel(t, lang, x.score, ratingScale, 1)} />)}
          </div>
        ) : (
          <p className="pp-hint">
            {t('passport.favorites.noBest')}{' '}
            {self && <Link to="/discover" className="section__link">{t('passport.favorites.rateCta')}</Link>}
          </p>
        )}
      </div>
      <div className="pp-card">
        <span className="label">{t('passport.favorites.collected')}</span>
        {fav.collected.length ? (
          <div className="pp-tiles">
            {fav.collected.map((x) => <AlbumMini key={x.id} id={x.id} meta={`${x.owned}/${x.total}`} mono />)}
          </div>
        ) : <p className="pp-hint">{t('passport.favorites.noCollected')}</p>}
      </div>
    </section>
  );
}

function ArtistRow({ x, i }) {
  const { t } = useI18n();
  const artist = useArtist(x.id);
  const meta = x.cards ? t('passport.favorites.cards', { n: x.cards }) : t('passport.favorites.rated', { n: x.rated });
  return (
    <li>
      <Link to={`/artist/${enc(x.id)}`}>
        <span className="pp-rank__n">{i + 1}</span>
        <ArtistBadge artist={artist || { id: x.id, name: '?' }} size={32} />
        <span className="pp-rank__name">{artist?.name || '…'}</span>
        <span className="pp-rank__meta mono">{meta}</span>
      </Link>
    </li>
  );
}

/** Petite vignette d'album : vraie pochette (repli généré), titre, artiste, une valeur (note ou progression). */
function AlbumMini({ id, meta, mono = false }) {
  const album = useAlbum(id);
  return (
    <Link to={`/album/${enc(id)}`} className="pp-album" data-album={id}>
      <span className="pp-album__cover">{album ? <CoverArt art={album.art} title={album.title} sizes="(max-width: 520px) 45vw, 180px" /> : null}</span>
      <span className="pp-album__title">{album?.title || '…'}</span>
      <span className="pp-album__meta">
        <span className="pp-album__artist">{album?.artist || ''}</span>
        <span className={mono ? 'mono' : 'pp-album__score'}>{meta}</span>
      </span>
    </Link>
  );
}

// ----- discothèque en détail -----------------------------------------------------------------------------------

function Distributions({ p, colors, section }) {
  const { t, lang, num, country } = useI18n();
  const { ratingScale } = useGame();
  const d = p.distributions;
  const cardsOf = (n) => t('passport.dist.cards', { n });

  // Genres : 7 lignes au plus, le reste dans « Autres ».
  const genreRows = d.genres.slice(0, 7).map((g) => ({
    key: g.id, label: genreName(t, g.id), value: g.cards, display: pct(lang, g.share), color: colors.get(g.id) || OTHER_COLOR,
  }));
  const rest = d.genres.slice(7);
  if (rest.length) {
    const cards = rest.reduce((s, g) => s + g.cards, 0);
    const share = rest.reduce((s, g) => s + g.share, 0);
    genreRows.push({ key: 'other', label: t('passport.dist.other'), value: cards, display: pct(lang, share), color: OTHER_COLOR });
  }
  const decades = d.decades.map((x) => ({
    key: String(x.decade), label: decadeLabel(t, x.decade), short: x.decade < 2000 ? `${String(x.decade % 100).padStart(2, '0')}` : String(x.decade),
    value: x.cards, tip: `${cardsOf(x.cards)} · ${pct(lang, x.share)}`,
  }));
  const countries = d.countries.map((c) => ({ key: c.code, label: country(c.code), value: c.cards, display: pct(lang, c.share) }));
  const ratingCount = d.ratings.reduce((s, n) => s + n, 0);
  const ratings = d.ratings.map((n, i) => ({
    key: String(i),
    label: scoreLabel(t, lang, i, ratingScale, 1),
    short: ratingScale === 'points' ? String(i) : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(i / 2),
    value: n,
    tip: t('passport.dist.notes', { n }),
  }));
  const rarities = RARITY_ORDER.map((id) => d.rarities.find((r) => r.id === id)).filter((r) => r && (r.cards > 0 || r.id !== 'promo')).map((r) => ({
    key: r.id, label: t(`rarity.${r.id}`), value: r.cards, display: num(r.cards), color: RARITY_COLORS[r.id],
  }));
  return (
    <section className="panel" data-pp="distributions" aria-labelledby="pp-dist">
      <h2 className="panel__title" id="pp-dist"><Icon name="disc" /> {section('distributions')}</h2>
      <div className="pp-split">
        <div className="pp-card" data-dist="genres">
          <h3 className="pp-card__title">{t('passport.dist.genres')}</h3>
          <p className="pp-hint">{t('passport.dist.genresHint')}</p>
          {genreRows.length ? <HBars items={genreRows} label={t('passport.dist.genres')} /> : <p className="pp-hint">{t('passport.dist.empty')}</p>}
        </div>
        <div className="pp-card" data-dist="decades">
          <h3 className="pp-card__title">{t('passport.dist.decades')}</h3>
          <p className="pp-hint">{t('passport.dist.decadesHint')}</p>
          {decades.length ? <Columns points={decades} color="var(--r-rare)" label={t('passport.dist.decades')} format={(v) => num(v)} height={176} />
            : <p className="pp-hint">{t('passport.dist.empty')}</p>}
        </div>
        <div className="pp-card" data-dist="countries">
          <h3 className="pp-card__title">{t('passport.dist.countries')}</h3>
          {countries.length ? (
            <>
              <HBars items={countries} color="var(--cue)" label={t('passport.dist.countries')} />
              {d.countriesKnown < 0.995 && (
                <p className="pp-note" data-partial=""><Icon name="globe" size={14} /> {t('passport.dist.partial', { pct: pct(lang, d.countriesKnown) })}</p>
              )}
            </>
          ) : <p className="pp-note" data-partial=""><Icon name="globe" size={14} /> {t('passport.dist.noCountry')}</p>}
        </div>
        <div className="pp-card" data-dist="ratings">
          <h3 className="pp-card__title">{t('passport.dist.ratings')}</h3>
          {ratingCount ? (
            <>
              <p className="pp-hint">{t('passport.dist.ratingsHint', { n: ratingCount, avg: scoreLabel(t, lang, p.totals.average, ratingScale) })}</p>
              <Columns points={ratings} color="var(--gold)" label={t('passport.dist.ratings')} format={(v) => num(v)} height={176} />
            </>
          ) : <p className="pp-hint">{t('passport.dist.empty')}</p>}
        </div>
        <div className="pp-card pp-card--wide" data-dist="rarities">
          <h3 className="pp-card__title">{t('passport.dist.rarities')}</h3>
          <p className="pp-hint">{t('passport.dist.raritiesHint')}</p>
          <HBars items={rarities} label={t('passport.dist.rarities')} />
        </div>
      </div>
    </section>
  );
}

// ----- 12 derniers mois ----------------------------------------------------------------------------------------

function Timeline({ p, section }) {
  const { t, lang, num } = useI18n();
  const [series, setSeries] = useState('cards');
  // Depuis l'arrivée du joueur (son mois d'inscription), avec 6 mois au moins.
  const joined = p.timeline.findIndex((m) => m.start + 32 * 86_400_000 > p.memberSince);
  const from = Math.min(Math.max(0, joined), p.timeline.length - MIN_MONTHS);
  const months = p.timeline.slice(Math.max(0, from));
  const points = months.map((m) => ({
    key: m.month,
    label: monthLabel(m.month, lang),
    short: monthLabel(m.month, lang, { short: true }).replace(/\.$/, ''),
    value: m[series],
    tip: t(`passport.timeline.unit.${series}`, { n: m[series] }),
  }));
  const total = p.timeline.reduce((s, m) => s + m[series], 0);
  const best = months.reduce((b, m) => (m[series] > (b?.[series] || 0) ? m : b), null);
  return (
    <section className="panel" data-pp="timeline" aria-labelledby="pp-timeline">
      <div className="pp-section__head">
        <h2 className="panel__title" id="pp-timeline"><Icon name="flag" /> {section('timeline')}</h2>
        <span className="seg" role="group" aria-label={t('passport.timeline.series')}>
          {Object.keys(SERIES).map((k) => (
            <button key={k} type="button" className={`seg__btn seg__btn--wide${series === k ? ' is-on' : ''}`} aria-pressed={series === k}
              onClick={() => setSeries(k)} data-series={k}>
              {t(`passport.timeline.${k}`)}
            </button>
          ))}
        </span>
      </div>
      <p className="pp-hint">
        {t(`passport.timeline.total.${series}`, { n: total })}
        {best && <> · {t('passport.timeline.best', { month: monthLabel(best.month, lang) })}</>}
      </p>
      <Columns points={points} color={SERIES[series]} label={t('passport.timeline.chart', { series: t(`passport.timeline.${series}`) })}
        format={(v) => num(v)} height={200} empty={t('passport.timeline.empty')} />
    </section>
  );
}

// ----- évolution des goûts -------------------------------------------------------------------------------------

function Evolution({ p, colors, section }) {
  const { t, lang } = useI18n();
  const evo = p.evolution;
  const filled = evo.quarters.filter((q) => q.total > 0);
  // Trimestres assez remplis pour parler d'évolution (même seuil que le serveur, SHIFT_MIN).
  const solid = evo.quarters.filter((q) => q.total >= 5).length;
  const shown = new Set();
  const rows = evo.quarters.map((q) => {
    const segments = [];
    let other = 0;
    for (const [g, n] of Object.entries(q.genres || {})) {
      if (colors.has(g)) {
        segments.push({ key: g, label: genreName(t, g), value: n, color: colors.get(g), tip: t('passport.evolution.total', { n }) });
        shown.add(g);
      } else other += n;
    }
    segments.sort((a, b) => [...colors.keys()].indexOf(a.key) - [...colors.keys()].indexOf(b.key));
    if (other) {
      segments.push({ key: 'other', label: t('passport.dist.other'), value: other, color: OTHER_COLOR, tip: t('passport.evolution.total', { n: other }) });
      shown.add('other');
    }
    return { key: q.key, label: quarterLabel(t, q.key), total: q.total, totalLabel: t('passport.evolution.total', { n: q.total }), segments };
  });
  const legend = [...colors].filter(([g]) => shown.has(g)).map(([g, c]) => ({ key: g, label: genreName(t, g), color: c }));
  if (shown.has('other')) legend.push({ key: 'other', label: t('passport.dist.other'), color: OTHER_COLOR });
  const shift = evo.shift;
  const sentence = shift
    ? t('passport.evolution.shift', {
      genre: genreName(t, shift.genre), from: pct(lang, shift.from), to: pct(lang, shift.to),
      fromQ: quarterLabel(t, shift.fromKey), toQ: quarterLabel(t, shift.toKey),
    })
    : solid >= 2 ? t('passport.evolution.stable') : t('passport.evolution.tooEarly');
  return (
    <section className="panel" data-pp="evolution" aria-labelledby="pp-evolution">
      <h2 className="panel__title" id="pp-evolution"><Icon name="compass" /> {section('evolution')}</h2>
      <p className="pp-hint">{t('passport.evolution.intro')}</p>
      <p className="pp-evolution__sentence" data-evolution={shift ? 'shift' : solid >= 2 ? 'stable' : 'early'}>{sentence}</p>
      {filled.length > 0 && (
        <StackedBars rows={rows} legend={legend} label={t('passport.evolution.chart')} percent={(s) => pct(lang, s)}
          emptyLabel={t('passport.evolution.none')} />
      )}
    </section>
  );
}
