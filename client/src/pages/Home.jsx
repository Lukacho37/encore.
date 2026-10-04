import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get, post } from '../api.js';
import { RarityGuideButton } from '../components/RarityGuide.jsx';
import { RatingValue } from '../components/Rating.jsx';
import { Avatar } from '../components/ui.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import PackOpening, { PackArt } from '../components/PackOpening.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Icon, Progress, Royalties, RoyaltyIcon, formatDuration, useNow, useToast } from '../components/ui.jsx';
import { ALBUMS, ALBUM_BY_ID, ARTIST_BY_ID, TRACK_BY_ID } from '@shared/catalog.js';
import { ECONOMY, recycleValue } from '@shared/rules.js';
import { sound } from '../sound.js';

export function AlbumTile({ album, progress, compact = false }) {
  const { t } = useI18n();
  const done = progress.pct === 1;
  return (
    <Link to={`/album/${album.id}`} className={`album-tile${done ? ' album-tile--done' : ''}${compact ? ' album-tile--compact' : ''}`}>
      <span className="album-tile__cover">
        <CoverArt art={{ ...album.art, seed: album.id }} />
        {done && <span className="album-tile__badge"><Icon name="disc" size={14} /> {t('collection.completed')}</span>}
      </span>
      <span className="album-tile__meta">
        <span className="album-tile__title">{album.title}</span>
        <span className="album-tile__artist">{ARTIST_BY_ID[album.artist].name} · <span className="mono">{album.year}</span></span>
        <span className="album-tile__progress">
          <Progress value={progress.owned} max={progress.total} color={album.art.palette[1]} size="sm" />
          <span className="mono small">{progress.owned}/{progress.total}</span>
        </span>
      </span>
    </Link>
  );
}

/** Dernières notes données par les amis (façon fil Letterboxd). */
function FriendsFeed() {
  const { t, date } = useI18n();
  const [items, setItems] = useState(null);
  useEffect(() => {
    get('/ratings/feed').then(setItems).catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section className="section">
      <header className="section__head"><h2>{t('home.feed')}</h2></header>
      <ul className="feed">
        {items.slice(0, 8).map((f) => {
          const album = f.type === 'album' ? ALBUM_BY_ID[f.id] : ALBUM_BY_ID[TRACK_BY_ID[f.id]?.albumId];
          const title = f.type === 'album' ? album?.title : TRACK_BY_ID[f.id]?.title;
          if (!title) return null;
          const art = album ? { ...album.art, seed: album.id } : { ...TRACK_BY_ID[f.id].art, seed: f.id };
          return (
            <li key={`${f.user.id}-${f.type}-${f.id}`} className="feed__item">
              <Link to={album ? `/album/${album.id}` : '/collection/promos'} className="feed__cover"><CoverArt art={art} /></Link>
              <div className="feed__body">
                <p className="feed__line">
                  <Link to={`/u/${f.user.username}`} className="feed__user"><Avatar user={f.user} size={20} /> {f.user.username}</Link>
                  <span className="muted"> {t('home.feedRated')} </span>
                  <Link to={album ? `/album/${album.id}` : '/collection/promos'} className="feed__title">{title}</Link>
                </p>
                <div className="feed__meta"><RatingValue value={f.score} size={13} /><span className="small muted">{date(f.updatedAt)}</span></div>
                {f.review && <p className="feed__review">{f.review.length > 180 ? `${f.review.slice(0, 170).trimEnd()}…` : f.review}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Home() {
  const { t, error } = useI18n();
  const { packs, user, stats, cards, duplicates, isAdmin, now, applyState } = useGame();
  const openCard = useCardModal();
  const toast = useToast();
  const [opening, setOpening] = useState(null);
  const [busy, setBusy] = useState(false);
  useNow(1000);

  const open = useCallback((count = 1) => {
    sound.unlock();
    setOpening({ promise: post('/packs/open', { count }), count, key: Date.now() });
  }, []);

  const closeOpening = useCallback((err) => {
    setOpening(null);
    if (err) toast(error(err.code), 'error');
  }, [toast, error]);

  const remaining = packs.nextAt ? packs.nextAt - now() : null;
  const canOpen = packs.unlimited || packs.available > 0;

  const dupValue = useMemo(
    () => cards.reduce((sum, c) => sum + (c.c > 1 ? recycleValue(c.t, c.v) * (c.c - 1) : 0), 0),
    [cards],
  );

  const recent = useMemo(() => {
    const seen = new Set();
    return [...cards].sort((a, b) => b.at - a.at).filter((c) => !seen.has(c.t) && seen.add(c.t)).slice(0, 8);
  }, [cards]);

  const almost = useMemo(
    () => ALBUMS.map((a) => ({ album: a, p: stats.albums[a.id] }))
      .filter((x) => x.p.owned > 0 && x.p.pct < 1)
      .sort((a, b) => b.p.pct - a.p.pct || a.p.total - b.p.total)
      .slice(0, 4),
    [stats],
  );

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
          {!packs.unlimited && (
            <p className="hero__timer">
              {remaining != null && remaining > 0
                ? <>{t('home.next', { time: '' })}<span className="mono timer">{formatDuration(remaining)}</span></>
                : t('home.full', { max: packs.max })}
            </p>
          )}
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
          <p className="muted">{duplicates ? t('home.dupBody', { n: duplicates, v: dupValue }) : t('home.dupNone')}</p>
          <p className="small muted">{t('home.dupHint')}</p>
          <button type="button" className="btn btn--ghost" disabled={busy || !duplicates}
            onClick={() => action('/collection/recycle', (r) => t('home.recycled', { v: r.royalties, n: r.recycled }))}>
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
          <header className="section__head">
            <h2>{t('home.almost')}</h2>
            <Link to="/collection" className="section__link">{t('home.seeAll')}</Link>
          </header>
          <div className="album-row">
            {almost.map(({ album, p }) => <AlbumTile key={album.id} album={album} progress={p} compact />)}
          </div>
        </section>
      )}

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

      <FriendsFeed />

      {opening && (
        <PackOpening key={opening.key} promise={opening.promise} count={opening.count} onClose={closeOpening} onAgain={() => open(opening.count)} />
      )}
    </div>
  );
}
