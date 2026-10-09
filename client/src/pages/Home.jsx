import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get } from '../api.js';
import { RarityGuideButton } from '../components/RarityGuide.jsx';
import { RatingValue, useRatedItem } from '../components/Rating.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { PackArt } from '../components/PackOpening.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { AlbumTile, AlbumTileSkeleton } from '../components/AlbumTile.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Avatar, Icon, Royalties, RoyaltyIcon, formatDuration, useNow } from '../components/ui.jsx';
import { ECONOMY, FOCUS_CHANCE } from '@shared/rules.js';
import { apiPath, useAlbums, useApi, useCatalogInfo } from '../state/catalog.js';
import { useBoosterFlow } from '../state/boosterFlow.js';
import '../styles/home.css';

// La vignette d'album vit dans components/AlbumTile.jsx (une seule pour tout le site) ; ces réexports gardent les
// anciens imports (`import { AlbumTile } from './Home.jsx'`) valables.
export { AlbumTile, AlbumTileSkeleton };

// Albums affichés dans les rangées « en cours » et « à découvrir ».
const ROW = 8;
const SHELF_SIZES = '(max-width: 640px) 42vw, 200px';

/** Une note d'ami : l'album ou le morceau noté vient du catalogue (la réponse du fil l'apporte). */
function FeedItem({ f }) {
  const { t, date } = useI18n();
  // Même lien que partout ailleurs pour un élément noté (page de l'album, ou du morceau).
  const item = useRatedItem(f.type, f.id);
  if (!item) return null;
  return (
    <li className="feed__item">
      <Link to={item.to} className="feed__cover" tabIndex={-1} aria-hidden="true"><CoverArt art={item.art} sizes="56px" /></Link>
      <div className="feed__body">
        <p className="feed__line">
          <Link to={`/u/${f.user.username}`} className="feed__user"><Avatar user={f.user} size={20} /> {f.user.username}</Link>
          <span className="muted"> {t('home.feedRated')} </span>
          <Link to={item.to} className="feed__title">{item.title}</Link>
        </p>
        <div className="feed__meta"><RatingValue value={f.score} size={13} /><span className="small muted">{date(f.updatedAt)}</span></div>
        {f.review && <p className="feed__review">{f.review.length > 180 ? `${f.review.slice(0, 170).trimEnd()}…` : f.review}</p>}
      </div>
    </li>
  );
}

/** Dernières notes données par les amis (façon fil Letterboxd) ; sans activité, une invitation à trouver des amis. */
function FriendsFeed() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    get('/ratings/feed')
      .then((res) => {
        if (alive) setItems(Array.isArray(res) ? res : res?.items || []);
      })
      .catch((err) => {
        if (alive) setError(err);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  // Rien tant que la réponse n'est pas là : la page ne saute pas.
  if (!items && !error) return null;
  return (
    <section className="section" aria-labelledby="home-feed-title">
      <header className="section__head"><h2 id="home-feed-title">{t('home.feed')}</h2></header>
      {error && !items ? (
        <ErrorBox error={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />
      ) : items.length ? (
        <ul className="feed">
          {items.slice(0, 8).map((f) => <FeedItem key={`${f.user.id}-${f.type}-${f.id}`} f={f} />)}
        </ul>
      ) : (
        <EmptyState icon="users" title={t('home.feedEmptyTitle')} body={t('home.feedEmptyBody')}
          action={{ label: t('home.feedEmptyCta'), to: '/friends', primary: false }} />
      )}
    </section>
  );
}

/** Minuteur du prochain booster gratuit (seul ce bloc se redessine chaque seconde). */
function PackTimer() {
  const { t } = useI18n();
  const { packs, now } = useGame();
  useNow(1000);
  const remaining = packs.nextAt ? packs.nextAt - now() : null;
  return (
    <p className="hero__timer">
      {remaining != null && remaining > 0
        ? <>{t('home.next', { time: '' })}<span className="mono timer">{formatDuration(remaining)}</span></>
        : t('home.full', { max: packs.max })}
    </p>
  );
}

/** Albums commencés les plus proches d'être complets, d'après les statistiques du serveur. */
function closestAlbums(stats) {
  return Object.entries(stats?.albums || {})
    .filter(([, p]) => p.owned > 0 && p.pct < 1)
    .sort(([a, pa], [b, pb]) => pb.pct - pa.pct || (pa.total - pa.owned) - (pb.total - pb.owned) || (a < b ? -1 : 1));
}

/** Les deux façons de finir un album : boosters gratuits orientés et booster d'album. */
function HowToFinish({ target, onAlbumPack }) {
  const { t, lang, num, error } = useI18n();
  const { user, isAdmin } = useGame();
  const focus = new Intl.NumberFormat(lang, { style: 'percent' }).format(FOCUS_CHANCE);
  const price = isAdmin ? 0 : ECONOMY.albumPackPrice;
  const affordable = user.royalties >= price;
  return (
    <section className="section home-how" aria-labelledby="home-how-title">
      <h2 id="home-how-title" className="home-how__title">{t('home.howTitle')}</h2>
      <div className="home-how__grid">
        <article className="home-how__item">
          <span className="home-how__icon" aria-hidden="true"><Icon name="pack" size={20} /></span>
          <div className="home-how__text">
            <h3>{t('home.howFocusTitle')}</h3>
            <p>{t('home.howFocusBody', { p: focus })}</p>
          </div>
        </article>
        <article className="home-how__item">
          <span className="home-how__icon home-how__icon--album" aria-hidden="true"><Icon name="disc" size={20} /></span>
          <div className="home-how__text">
            <h3>
              {t('home.howAlbumTitle')}
              <span className="home-how__price">
                {price ? <><RoyaltyIcon size={14} /> <span className="mono">{num(price)}</span></> : t('home.howAlbumFree')}
              </span>
            </h3>
            <p>{t('home.howAlbumBody')}</p>
            <div className="home-how__actions">
              {target && (
                <button type="button" className="btn btn--primary btn--sm home-how__quick" disabled={!affordable}
                  title={affordable ? undefined : error('not_enough_royalties')} onClick={() => onAlbumPack(target)}>
                  <Icon name="pack" size={16} /> <span className="home-how__quick-label">{t('home.howQuick', { title: target.title })}</span>
                </button>
              )}
              <Link to="/collection" className="btn btn--ghost btn--sm">{t('home.howCta')}</Link>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

/** Albums populaires pas encore commencés (les classiques du catalogue d'abord). */
function Discover() {
  const { t } = useI18n();
  const { stats } = useGame();
  const info = useCatalogInfo();
  const { data, error } = useApi(apiPath('/catalog/albums', { sort: 'popular', limit: 24 }));
  // Les statistiques sont à jour après chaque booster, contrairement au champ `owned` gardé en cache.
  const items = useMemo(() => (data?.items || []).filter((a) => !stats.albums[a.id]).slice(0, ROW), [data, stats]);
  if (error) return null;
  return (
    <section className="section">
      <header className="section__head home-head">
        <h2>{t('home.discover')}</h2>
        <Link to="/collection?sort=popular" className="section__link">{t('home.seeAll')}</Link>
      </header>
      {info?.totals && (
        <p className="home-hint small muted">{t('home.discoverHint', { albums: info.totals.albums, tracks: info.totals.tracks })}</p>
      )}
      {!data ? (
        <div className="home-shelf" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <AlbumTileSkeleton key={i} />)}
        </div>
      ) : items.length ? (
        <div className="home-shelf">
          {items.map((a) => <AlbumTile key={a.id} album={a} discover compact sizes={SHELF_SIZES} />)}
        </div>
      ) : (
        <p className="empty">{t('home.discoverEmpty')}</p>
      )}
    </section>
  );
}

export default function Home() {
  const { t, num } = useI18n();
  const { packs, user, stats, cards, duplicates, duplicatesValue, isAdmin } = useGame();
  const openCard = useCardModal();
  // Ouverture, achat et recyclage : la même machine que les autres pages (state/boosterFlow.js).
  const { openFree: open, openAlbum, buy, recycle, overlay, busy } = useBoosterFlow();

  const canOpen = packs.unlimited || packs.available > 0;

  const recent = useMemo(() => {
    const seen = new Set();
    return [...cards].sort((a, b) => b.at - a.at).filter((c) => !seen.has(c.t) && seen.add(c.t)).slice(0, 8);
  }, [cards]);

  const started = useMemo(() => closestAlbums(stats), [stats]);
  const almost = useMemo(() => started.slice(0, ROW).map(([id, p]) => ({ id, p })), [started]);
  const almostAlbums = useAlbums(almost.map((x) => x.id));

  return (
    <div className="home">
      {/* Héros Boosters et rangée Boutique / Doublons / Blind test : balisage et rendu inchangés (DESIGN-OVERRIDE). */}
      <section className="hero" id="booster">
        <button type="button" className="hero__pack" onClick={() => canOpen && open(1)} disabled={!canOpen} aria-label={t('home.open')}>
          <PackArt className="pack--float" />
        </button>
        <div className="hero__panel">
          <span className="eyebrow">{t('home.eyebrow')} · {t('home.content')}</span>
          <h1 className="hero__title">
            {packs.unlimited ? t('home.unlimited') : t('home.stock', { n: packs.available })}
          </h1>
          {!packs.unlimited && <PackTimer />}
          {!packs.unlimited && packs.bonus > 0 && <p className="muted small">{t('home.bonus', { n: packs.bonus })}</p>}
          <RarityGuideButton className="link-btn hero__help" />
          <div className="hero__actions">
            <button type="button" className="btn btn--primary btn--xl" onClick={() => open(1)} disabled={!canOpen}>
              <Icon name="pack" /> {canOpen ? t('home.open') : t('home.empty')}
            </button>
            {isAdmin && (
              <button type="button" className="btn btn--ghost btn--xl" onClick={() => open(10)}>{t('home.openN', { n: 10 })}</button>
            )}
          </div>
        </div>
      </section>

      <section className="home-panels">
        <article className="panel" id="boutique">
          <h2 className="panel__title"><RoyaltyIcon size={18} /> {t('home.shopTitle')}</h2>
          <p className="muted">{t('home.buyBody')}</p>
          <div className="panel__row">
            <Royalties value={user.royalties} className="pill" />
            <button type="button" className="btn btn--ghost" disabled={busy || user.royalties < ECONOMY.packPrice}
              onClick={buy}>
              {t('home.buy')} · <RoyaltyIcon size={14} /> <span className="mono">{ECONOMY.packPrice}</span>
            </button>
          </div>
        </article>
        <article className="panel">
          <h2 className="panel__title"><Icon name="recycle" /> {t('home.dupTitle')}</h2>
          {/* Valeur calculée par GameContext à partir de la rareté de chaque ligne de carte. */}
          <p className="muted">{duplicates ? t('home.dupBody', { n: duplicates, v: num(duplicatesValue || 0) }) : t('home.dupNone')}</p>
          <p className="small muted">{t('home.dupHint')}</p>
          <button type="button" className="btn btn--ghost" disabled={busy || !duplicates} onClick={recycle}>
            {t('home.recycle')}
          </button>
        </article>
        <Link to="/blindtest" className="panel panel--bt">
          <span className="panel--bt__eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <h2 className="panel__title"><Icon name="headphones" /> {t('nav.blindtest')}</h2>
          <p>{t('home.blindtest')}</p>
          <span className="btn btn--primary btn--sm">{t('home.blindtestCta')}</span>
        </Link>
      </section>

      {almost.length > 0 && (
        <section className="section">
          <header className="section__head home-head">
            <h2>
              {almost[0].p.pct >= 0.5 ? t('home.almost') : t('home.inProgress')}
              <span className="home-count">{t('home.started', { n: started.length })}</span>
            </h2>
            {/* Collection : albums commencés, triés par progression. */}
            <Link to="/collection?mine=1" className="section__link">{t('home.seeAll')}</Link>
          </header>
          <div className="home-shelf">
            {almost.map(({ id, p }, i) => <AlbumTile key={id} album={almostAlbums[i]} progress={p} compact sizes={SHELF_SIZES} />)}
          </div>
        </section>
      )}

      <HowToFinish target={almostAlbums[0]} onAlbumPack={openAlbum} />

      <section className="section">
        <header className="section__head">
          <h2>{t('home.recent')}</h2>
        </header>
        {recent.length ? (
          <div className="card-row">
            {recent.map((c) => (
              <Card key={c.t} trackId={c.t} variant={c.v} onClick={() => openCard(c.t)} />
            ))}
          </div>
        ) : (
          <p className="empty">{t('home.start')}</p>
        )}
      </section>

      <Discover />

      <FriendsFeed />

      {overlay}
    </div>
  );
}
