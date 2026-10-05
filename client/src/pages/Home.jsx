import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get, post } from '../api.js';
import { RarityGuideButton } from '../components/RarityGuide.jsx';
import { RatingValue } from '../components/Rating.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import PackOpening, { PackArt } from '../components/PackOpening.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Avatar, Icon, Progress, Royalties, RoyaltyIcon, formatDuration, useNow, useToast } from '../components/ui.jsx';
import { ECONOMY, FOCUS_CHANCE } from '@shared/rules.js';
import { apiPath, useAlbum, useAlbums, useApi, useCatalogInfo, useTrack } from '../state/catalog.js';
import { sound } from '../sound.js';
import { useCovers, realCover } from '../state/CoversContext.jsx';
import '../styles/home.css';

// Albums affichés dans les rangées « en cours » et « à découvrir ».
const ROW = 8;
const SHELF_SIZES = '(max-width: 640px) 42vw, 200px';

/** Vignette d'album pas encore chargée : même place que la vraie. */
export function AlbumTileSkeleton() {
  return (
    <span className="album-tile album-tile--loading" aria-hidden="true">
      <span className="album-tile__cover" />
      <span className="album-tile__meta">
        <span className="album-tile__skel" />
        <span className="album-tile__skel album-tile__skel--short" />
      </span>
    </span>
  );
}

/**
 * Vignette d'album (vue d'album de l'API). `progress` : { owned, total } ; sans lui, on lit le nombre de cartes
 * possédées des résultats de recherche (album.owned). `discover` affiche le genre et le nombre de cartes à la place.
 */
export function AlbumTile({ album, progress, compact = false, discover = false, sizes }) {
  const { t } = useI18n();
  const covers = useCovers();
  if (!album) return <AlbumTileSkeleton />;
  const total = progress?.total || album.trackCount || 0;
  const owned = progress?.owned ?? album.owned ?? 0;
  const done = total > 0 && owned >= total;
  // Le badge « complété » ne se pose pas sur une vraie pochette : il passe sous l'image.
  const real = !!realCover(album.art, covers);
  const badge = done && <span className="album-tile__badge"><Icon name="disc" size={14} /> {t('collection.completed')}</span>;
  const genre = album.genre ? t(`genre.${album.genre}`) : null;
  return (
    <Link to={`/album/${encodeURIComponent(album.id)}`} className={`album-tile${done ? ' album-tile--done' : ''}${compact ? ' album-tile--compact' : ''}`}>
      <span className="album-tile__cover">
        <CoverArt art={album.art} sizes={sizes || (compact ? '(max-width: 700px) 45vw, (max-width: 1020px) 50vw, 270px' : '(max-width: 700px) 45vw, 270px')} />
        {!real && badge}
      </span>
      <span className="album-tile__meta">
        <span className="album-tile__title">{album.title}</span>
        <span className="album-tile__artist">{album.artist}{album.year ? <> · <span className="mono">{album.year}</span></> : null}</span>
        {discover ? (
          <span className="album-tile__info">
            {genre && genre !== `genre.${album.genre}` ? `${genre} · ` : ''}{t('home.tracks', { n: total })}
          </span>
        ) : (
          <span className="album-tile__progress">
            <Progress value={owned} max={total} color={album.art?.palette?.[1]} size="sm" />
            <span className="mono small">{owned}/{total}</span>
            {real && badge}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Une note d'ami : l'album ou le morceau noté vient du catalogue (la réponse du fil l'apporte). */
function FeedItem({ f }) {
  const { t, date } = useI18n();
  const track = useTrack(f.type === 'track' ? f.id : null);
  const album = useAlbum(f.type === 'album' ? f.id : null);
  const item = f.type === 'album' ? album : track;
  if (!item) return null;
  const art = item.art;
  // Un single promo n'a pas d'album : il se retrouve sur la page de son artiste.
  const albumId = f.type === 'album' ? album.id : track.albumId;
  const to = albumId ? `/album/${encodeURIComponent(albumId)}` : `/artist/${encodeURIComponent(track.artistId)}`;
  return (
    <li className="feed__item">
      <Link to={to} className="feed__cover" tabIndex={-1} aria-hidden="true"><CoverArt art={art} sizes="56px" /></Link>
      <div className="feed__body">
        <p className="feed__line">
          <Link to={`/u/${f.user.username}`} className="feed__user"><Avatar user={f.user} size={20} /> {f.user.username}</Link>
          <span className="muted"> {t('home.feedRated')} </span>
          <Link to={to} className="feed__title">{item.title}</Link>
        </p>
        <div className="feed__meta"><RatingValue value={f.score} size={13} /><span className="small muted">{date(f.updatedAt)}</span></div>
        {f.review && <p className="feed__review">{f.review.length > 180 ? `${f.review.slice(0, 170).trimEnd()}…` : f.review}</p>}
      </div>
    </li>
  );
}

/** Dernières notes données par les amis (façon fil Letterboxd). */
function FriendsFeed() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    get('/ratings/feed')
      .then((res) => {
        if (alive) setItems(Array.isArray(res) ? res : res?.items || []);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!items?.length) return null;
  return (
    <section className="section">
      <header className="section__head"><h2>{t('home.feed')}</h2></header>
      <ul className="feed">
        {items.slice(0, 8).map((f) => <FeedItem key={`${f.user.id}-${f.type}-${f.id}`} f={f} />)}
      </ul>
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
  const { t, error, num } = useI18n();
  const { packs, user, stats, cards, duplicates, duplicatesValue, isAdmin, applyState } = useGame();
  const openCard = useCardModal();
  const toast = useToast();
  const [opening, setOpening] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback((count = 1) => {
    sound.unlock();
    setOpening({ promise: post('/packs/open', { count }), count, key: Date.now() });
  }, []);

  // Booster d'album : 5 cartes de cet album, celles qui manquent d'abord (payé en royalties).
  const openAlbum = useCallback((album) => {
    sound.unlock();
    setOpening({ promise: post('/packs/album', { albumId: album.id }), count: 1, album, key: Date.now() });
  }, []);

  const closeOpening = useCallback((err) => {
    setOpening(null);
    if (err) toast(error(err.code), 'error');
  }, [toast, error]);

  const canOpen = packs.unlimited || packs.available > 0;

  const recent = useMemo(() => {
    const seen = new Set();
    return [...cards].sort((a, b) => b.at - a.at).filter((c) => !seen.has(c.t) && seen.add(c.t)).slice(0, 8);
  }, [cards]);

  const started = useMemo(() => closestAlbums(stats), [stats]);
  const almost = useMemo(() => started.slice(0, ROW).map(([id, p]) => ({ id, p })), [started]);
  const almostAlbums = useAlbums(almost.map((x) => x.id));

  const action = async (path, success) => {
    setBusy(true);
    try {
      const res = await post(path);
      applyState(res.state);
      sound.coin();
      toast(success(res), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <section className="hero">
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
        <article className="panel">
          <h2 className="panel__title"><RoyaltyIcon size={18} /> {t('home.shopTitle')}</h2>
          <p className="muted">{t('home.buyBody')}</p>
          <div className="panel__row">
            <Royalties value={user.royalties} className="pill" />
            <button type="button" className="btn btn--ghost" disabled={busy || user.royalties < ECONOMY.packPrice}
              onClick={() => action('/shop/buy-pack', () => t('home.bought'))}>
              {t('home.buy')} · <RoyaltyIcon size={14} /> <span className="mono">{ECONOMY.packPrice}</span>
            </button>
          </div>
        </article>
        <article className="panel">
          <h2 className="panel__title"><Icon name="recycle" /> {t('home.dupTitle')}</h2>
          {/* Valeur calculée par GameContext à partir de la rareté de chaque ligne de carte. */}
          <p className="muted">{duplicates ? t('home.dupBody', { n: duplicates, v: num(duplicatesValue || 0) }) : t('home.dupNone')}</p>
          <p className="small muted">{t('home.dupHint')}</p>
          <button type="button" className="btn btn--ghost" disabled={busy || !duplicates}
            onClick={() => action('/collection/recycle', (r) => t('home.recycled', { v: num(r.royalties), n: r.recycled }))}>
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

      {opening && (
        <PackOpening key={opening.key} promise={opening.promise} count={opening.count} album={opening.album} onClose={closeOpening}
          onAgain={() => (opening.album ? openAlbum(opening.album) : open(opening.count))} />
      )}
    </div>
  );
}
