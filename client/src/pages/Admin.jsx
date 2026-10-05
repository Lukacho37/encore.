import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { get, post, api } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { apiPath, getTrack, registerCatalog, useAlbum, useTrack } from '../state/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import PackOpening from '../components/PackOpening.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { Avatar, ConfirmButton, Icon, Progress, Spinner, useToast } from '../components/ui.jsx';
import { RARITIES, RARITY } from '@shared/rules.js';
import '../styles/admin.css';

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;

const PROVIDERS = { spotify: 'Spotify', deezer: 'Deezer' };
const CATALOG_POLL_MS = 5000; // actualisation de l'état de l'import pendant qu'il tourne
const PICKER_LIMIT = 8;

/** Valeur qui suit `value` après `delay` ms sans changement (recherche tapée au clavier). */
function useDebounced(value, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/**
 * Critiques à modérer. Les anciennes réponses (démo) étaient une liste nue ; les nouvelles sont { items, catalog } :
 * un album ou un morceau absent du catalogue de la réponse a été retiré du catalogue du serveur.
 */
function reviewList(res) {
  if (Array.isArray(res)) return { items: res, known: null };
  const refs = res?.catalog;
  const known = refs ? new Set([...(refs.albums || []), ...(refs.tracks || [])].map((x) => x.id)) : null;
  return { items: res?.items || [], known };
}

/** État des vraies pochettes : source réelle, trouvées, introuvables, en attente, actualisation. */
function CoversPanel({ status, onRefresh }) {
  const { t, date } = useI18n();
  const active = !status.demo && status.providers.length > 0;
  const served = Object.entries(status.served || {}).map(([p, n]) => `${n} ${PROVIDERS[p] || p}`).join(' · ');
  let summary;
  if (status.demo) summary = <p className="small muted">{t('admin.coversDemo')}</p>;
  else if (status.modeInvalid) summary = <p className="small">{t('admin.coversInvalid', { v: status.modeInvalid })}</p>;
  else if (status.mode === 'off') summary = <p className="small">{t('admin.coversOff')}</p>;
  else if (!active) summary = <p className="small">{t('admin.coversNoKeys')}</p>;
  else {
    summary = (
      <p className="mono small">
        {t('admin.coversStatus', { found: status.found, total: status.total, p: served || status.providers.map((p) => PROVIDERS[p]).join(' → ') })}
        {status.lastRun ? ` · ${date(status.lastRun)}` : ''}
      </p>
    );
  }
  return (
    <section className="panel">
      <h2 className="panel__title">{t('admin.covers')}</h2>
      {summary}
      {active && status.mode === 'auto' && !status.spotifyKeys && <p className="small muted">{t('admin.coversSpotifyHint')}</p>}
      {active && status.pending > 0 && <p className="small muted">{t('admin.coversPending', { n: status.pending })}</p>}
      {active && status.missing.length > 0 && (
        <details className="small">
          <summary>{t('admin.coversMissing', { n: status.missing.length })}</summary>
          <ul className="covers-missing">{status.missing.map((m) => <li key={m.key}>{m.artist} · {m.title}</li>)}</ul>
        </details>
      )}
      {status.spotifyPremium && (
        <p className="small">
          {t('admin.coversPremium')}
          {status.providers.includes('deezer') && status.served?.deezer > 0 ? ` ${t('admin.coversPremiumDeezer')}` : ''}
        </p>
      )}
      {status.lastError && <p className="small muted mono">{t('admin.coversError', { e: status.lastError })}</p>}
      {active && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRefresh} disabled={status.running}>
          {status.running ? t('admin.coversRunning') : t('admin.coversRefresh')}
        </button>
      )}
    </section>
  );
}

/** Import du catalogue depuis Deezer : avancement, file d'artistes, lancement et pause. */
function CatalogPanel({ status, failed, pauseAsked, busy, onStart, onPause, onRetry }) {
  const { t, lang } = useI18n();
  const when = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);
  if (!status) {
    return (
      <section className="panel adm-catalog" aria-busy={!failed || undefined}>
        <h2 className="panel__title"><Icon name="disc" /> {t('admin.catalog')}</h2>
        <p className="small muted">{t('admin.catalogAuto')}</p>
        {failed ? (
          <p className="small">
            {t('admin.catalogLoadError')}{' '}
            <button type="button" className="btn btn--ghost btn--xs" onClick={onRetry}>{t('admin.retry')}</button>
          </p>
        ) : <Spinner />}
      </section>
    );
  }
  const { artists = {} } = status;
  const phase = status.running ? 'running' : status.phase || 'idle';
  const target = status.target || 0;
  return (
    <section className="panel adm-catalog">
      <div className="adm-catalog__head">
        <h2 className="panel__title"><Icon name="disc" /> {t('admin.catalog')}</h2>
        <span className={`adm-phase adm-phase--${phase}`} role="status">
          {phase === 'running' && <span className="adm-phase__dot" aria-hidden="true" />}
          {t(`admin.catalogPhase.${phase}`)}
        </span>
      </div>
      {status.demo ? (
        <p className="small muted">{t('admin.catalogDemo', { albums: status.totalAlbums })}</p>
      ) : (
        <>
          <p className="small muted">{t('admin.catalogAuto')}</p>
          <p className="small">{t(`admin.catalogMode.${status.mode === 'off' ? 'off' : 'deezer'}`)}</p>
        </>
      )}
      {!status.demo && (
      <div className="adm-catalog__progress">
        <Progress value={Math.min(status.albums, target)} max={target} size="lg" color="var(--cue)" label={t('admin.catalogProgress', { n: status.albums, m: target })} />
        <span className="mono small">{t('admin.catalogProgress', { n: status.albums, m: target })}</span>
      </div>
      )}
      <ul className="adm-facts mono small">
        <li>{t('admin.catalogTotals', { albums: status.totalAlbums, tracks: status.tracks, promos: status.promos })}</li>
        <li>{t('admin.catalogQueue', { pending: artists.pending || 0, done: artists.done || 0, skipped: artists.skipped || 0, error: artists.error || 0 })}</li>
        <li>{t('admin.catalogRequests', { n: status.requests || 0 })}</li>
        {status.startedAt && <li>{t('admin.catalogStarted', { d: when.format(new Date(status.startedAt)) })}</li>}
        {status.finishedAt && <li>{t('admin.catalogFinished', { d: when.format(new Date(status.finishedAt)) })}</li>}
      </ul>
      {status.lastError && <p className="small muted mono adm-error">{t('admin.catalogError', { e: status.lastError })}</p>}
      {!status.demo && (
      <div className="admin-tools">
        <button type="button" className="btn btn--primary btn--sm" onClick={onStart} disabled={busy || status.running}>
          {t('admin.catalogStart')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPause} disabled={busy || !status.running || pauseAsked}>
          {t('admin.catalogPause')}
        </button>
      </div>
      )}
    </section>
  );
}

/**
 * Recherche d'un album du catalogue (titre ou artiste), en liste déroulante accessible au clavier :
 * flèches pour parcourir, Entrée pour choisir, Échap pour fermer.
 */
function AlbumPicker({ onPick }) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, '');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [res, setRes] = useState({ q: null, items: [], loading: false, error: false });
  const q = useDebounced(text.trim());
  const ticket = useRef(0);
  const seen = useRef(new Map()); // réponses déjà reçues, par recherche

  useEffect(() => {
    if (!open) return;
    const n = ++ticket.current; // une réponse arrivée après une recherche plus récente est ignorée
    if (seen.current.has(q)) {
      const items = seen.current.get(q);
      setRes({ q, items, loading: false, error: false });
      setActive(items.length ? 0 : -1);
      return;
    }
    setRes((r) => ({ ...r, loading: true, error: false }));
    get(apiPath('/catalog/albums', { q, sort: 'popular', limit: PICKER_LIMIT }))
      .then((data) => {
        if (n !== ticket.current) return;
        const items = data.items || [];
        registerCatalog({ albums: items });
        seen.current.set(q, items);
        setRes({ q, items, loading: false, error: false });
        setActive(items.length ? 0 : -1);
      })
      .catch(() => {
        if (n === ticket.current) setRes((r) => ({ ...r, loading: false, error: true }));
      });
  }, [open, q]);

  const pick = (album) => {
    onPick(album);
    setOpen(false);
    setText('');
  };

  const onKeyDown = (e) => {
    const count = res.items.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (count) setActive((a) => (a + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) setActive((a) => (a <= 0 ? count - 1 : a - 1));
    } else if (e.key === 'Enter') {
      // Pas de choix tant que les résultats ne correspondent pas au texte tapé (recherche encore en attente).
      if (open && res.items[active] && res.q === text.trim()) {
        e.preventDefault();
        pick(res.items[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const stale = res.q !== text.trim();
  const listId = `${uid}-list`;
  let note = null;
  if (res.error) note = t('admin.albumSearchError');
  else if (res.loading && !res.items.length) note = t('admin.albumSearching');
  else if (!res.loading && !stale && res.q !== null && !res.items.length) note = t('admin.albumNone');

  return (
    <div className="adm-picker">
      <label htmlFor={`${uid}-input`} className="sr-only">{t('admin.albumSearchLabel')}</label>
      <div className="search">
        <Icon name="search" />
        <input id={`${uid}-input`} className="input" type="search" autoComplete="off" spellCheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && active >= 0 && res.items[active] ? `${uid}-opt-${active}` : undefined}
          placeholder={t('admin.albumSearch')} value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      </div>
      {open && (
        // La liste garde le focus dans le champ : un clic choisit l'album sans fermer la liste avant.
        <div className="adm-picker__pop" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={t('admin.albumSearchLabel')} aria-busy={res.loading || undefined}
            className={`adm-picker__list${stale || res.loading ? ' is-stale' : ''}`}>
            {res.items.map((a, i) => (
              <li key={a.id} id={`${uid}-opt-${i}`} role="option" aria-selected={i === active}
                className={`adm-option${i === active ? ' is-active' : ''}`} onClick={() => pick(a)} onMouseEnter={() => setActive(i)}>
                <span className="adm-option__cover"><CoverArt art={a.art} sizes="40px" /></span>
                <span className="adm-option__text">
                  <span className="adm-option__title">{a.title}</span>
                  <span className="small muted">{[a.artist, a.year, t('admin.albumTracks', { n: a.trackCount })].filter(Boolean).join(' · ')}</span>
                </span>
                {a.source === 'seed' && <span className="role-tag">{t('admin.albumBase')}</span>}
              </li>
            ))}
          </ul>
          {note && <p className="adm-picker__note small muted" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}

/** Album choisi pour les tests : progression du joueur et actions (presque complet, complet, booster d'album). */
function AlbumTools({ album, onAlmost, onComplete, onPack, onClear }) {
  const { t } = useI18n();
  const { albumProgress } = useGame();
  const p = albumProgress(album.id, album.trackCount);
  return (
    <div className="adm-album">
      <Link to={`/album/${album.id}`} className="adm-album__cover" aria-label={t('admin.albumSee')}>
        <CoverArt art={album.art} sizes="72px" />
      </Link>
      <div className="adm-album__info">
        <strong className="adm-album__title">
          {album.title}
          {album.source === 'seed' && <span className="role-tag">{t('admin.albumBase')}</span>}
        </strong>
        <span className="small muted">{[album.artist, album.year, t('admin.albumTracks', { n: album.trackCount })].filter(Boolean).join(' · ')}</span>
        <span className="adm-album__progress">
          <Progress value={p.owned} max={p.total || album.trackCount} size="sm" label={t('admin.albumOwned', { n: p.owned, total: p.total || album.trackCount })} />
          <span className="mono small">{t('admin.albumOwned', { n: p.owned, total: p.total || album.trackCount })}</span>
        </span>
      </div>
      <div className="admin-tools adm-album__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onAlmost}>{t('admin.almost')}</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onComplete}>{t('admin.completeAlbum')}</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPack}><Icon name="pack" size={16} /> {t('admin.albumPack')}</button>
        <Link to={`/album/${album.id}`} className="btn btn--ghost btn--sm"><Icon name="disc" size={16} /> {t('admin.albumSee')}</Link>
        <button type="button" className="btn btn--ghost btn--xs" onClick={onClear}>{t('admin.albumClear')}</button>
      </div>
    </div>
  );
}

/** Critique à modérer : titre de l'album ou du morceau tiré du catalogue (chargé au besoin). */
function ReviewItem({ review, missing, onDelete }) {
  const { t, date } = useI18n();
  const isAlbum = review.type === 'album';
  const album = useAlbum(isAlbum && !missing ? review.id : null);
  const track = useTrack(isAlbum || missing ? null : review.id);
  const item = isAlbum ? album : track;
  const albumId = missing ? null : isAlbum ? review.id : track?.albumId;
  let title = missing ? t('admin.reviewMissing') : item ? item.title : '…';
  if (item && !isAlbum && item.artist) title = `${item.title} · ${item.artist}`;
  return (
    <li className="mod-item">
      <div className="mod-item__head">
        <Link to={`/u/${review.user.username}`} className="table__user"><Avatar user={review.user} size={24} /> {review.user.username}</Link>
        <span className="muted small">
          · {albumId ? <Link to={`/album/${albumId}`} className="adm-link">{title}</Link> : title}
          {' '}· <span className="mono">{review.score}/10</span> · {date(review.updatedAt)}
        </span>
      </div>
      <p className="mod-item__text">{review.review}</p>
      <ConfirmButton className="btn btn--ghost btn--xs" confirmLabel={t('admin.deleteConfirm')} onConfirm={onDelete}>{t('admin.deleteReview')}</ConfirmButton>
    </li>
  );
}

export default function Admin() {
  const { t, error, date, num } = useI18n();
  const { isAdmin, applyState } = useGame();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [reviews, setReviews] = useState(null); // { items, known }
  const [coverStatus, setCoverStatus] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [pauseAsked, setPauseAsked] = useState(false);
  const [opening, setOpening] = useState(null);
  const [album, setAlbum] = useState(null); // album choisi pour les outils de test (vue album du serveur)

  const loadOverview = useCallback(() => {
    get('/admin/overview').then(setData).catch((err) => toast(error(err.code), 'error'));
  }, [toast, error]);
  const loadCatalog = useCallback(() => {
    get('/admin/catalog')
      .then((s) => {
        setCatalogStatus(s);
        setCatalogFailed(false);
      })
      .catch(() => setCatalogFailed(true));
  }, []);
  const load = useCallback(() => {
    loadOverview();
    get('/admin/reviews').then((res) => setReviews(reviewList(res))).catch(() => setReviews({ items: [], known: null }));
    get('/admin/covers').then(setCoverStatus).catch(() => setCoverStatus(null));
  }, [loadOverview]);

  // Pendant une recherche de pochettes, l'état se met à jour tout seul.
  useEffect(() => {
    if (!coverStatus?.running) return undefined;
    const id = setInterval(() => get('/admin/covers').then(setCoverStatus).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [coverStatus?.running]);

  // Pendant l'import du catalogue, l'état est relu toutes les 5 s ; à la fin, les totaux de la page aussi.
  const importRunning = !!catalogStatus?.running;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!importRunning) return undefined;
    const id = setInterval(loadCatalog, CATALOG_POLL_MS);
    return () => clearInterval(id);
  }, [importRunning, loadCatalog]);
  useEffect(() => {
    if (wasRunning.current && !importRunning) {
      setPauseAsked(false);
      loadOverview();
    }
    wasRunning.current = importRunning;
  }, [importRunning, loadOverview]);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    loadCatalog();
  }, [isAdmin, load, loadCatalog]);

  if (!isAdmin) return <Navigate to="/" replace />;

  const run = async (path, body, message) => {
    try {
      const res = await post(path, body);
      if (res.state) applyState(res.state);
      toast(typeof message === 'function' ? message(res) : message || t('common.done'), 'success');
      load();
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const catalogAction = async (path, message) => {
    setCatalogBusy(true);
    try {
      const s = await post(path);
      setCatalogStatus(s);
      setCatalogFailed(false);
      if (path.endsWith('/pause')) setPauseAsked(!!s.running);
      toast(message, 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setCatalogBusy(false);
    }
  };

  const open = (count) => setOpening({ promise: post('/packs/open', { count }), count, key: Date.now() });
  const openAlbum = (a) => setOpening({ promise: post('/packs/album', { albumId: a.id }), count: 1, album: a, key: Date.now() });

  const deleteReview = async (r) => {
    try {
      setReviews(reviewList(await api('DELETE', `/admin/reviews/${r.user.id}/${r.type}/${encodeURIComponent(r.id)}`)));
      toast(t('common.done'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const rarityTotals = data?.catalog?.rarity;

  return (
    <div className="admin">
      <header className="page-head">
        <div>
          <span className="eyebrow"><Icon name="shield" size={14} /> {t('nav.admin')}</span>
          <h1>{t('admin.title')}</h1>
          {data && <p className="muted small mono">{t('admin.totals', data.totals)}</p>}
          {data?.catalog && <p className="muted small mono">{t('admin.catalogLine', data.catalog)}</p>}
        </div>
      </header>

      <section className="panel admin-owner">
        <p><Icon name="shield" size={16} /> {t('admin.ownerOnly')}</p>
        <p className="muted small">{t('admin.powers')}</p>
      </section>

      <section className="panel">
        <h2 className="panel__title">{t('admin.tools')}</h2>
        <p className="muted">{t('admin.toolsBody')}</p>
        <div className="admin-tools">
          <button type="button" className="btn btn--primary" onClick={() => open(10)}>{t('admin.open', { n: 10 })}</button>
          <button type="button" className="btn btn--ghost" onClick={() => open(50)}>{t('admin.open', { n: 50 })}</button>
          <button type="button" className="btn btn--ghost" onClick={() => run('/admin/me/complete', {}, t('common.done'))}>{t('admin.completeSeed')}</button>
          <ConfirmButton confirmLabel={t('admin.resetConfirm')} onConfirm={() => run('/admin/me/reset', {}, t('common.done'))}>{t('admin.reset')}</ConfirmButton>
        </div>
        <p className="small muted">{t('admin.completeSeedHint')}</p>
        <div className="admin-tools--row adm-album-tools">
          <h3 className="eyebrow">{t('admin.albumTools')}</h3>
          <AlbumPicker onPick={setAlbum} />
          {album ? (
            <AlbumTools album={album} onClear={() => setAlbum(null)} onPack={() => openAlbum(album)}
              onAlmost={() => run('/admin/me/almost', { albumId: album.id },
                (res) => t('admin.almostDone', { title: getTrack(res.missing)?.title || res.missing, album: album.title }))}
              onComplete={() => run('/admin/me/complete', { albumId: album.id }, t('admin.completeAlbumDone', { album: album.title }))} />
          ) : <p className="small muted">{t('admin.albumPick')}</p>}
        </div>
      </section>

      {catalogStatus || !catalogFailed || !__DEMO__ ? (
        <CatalogPanel status={catalogStatus} failed={catalogFailed} pauseAsked={pauseAsked} busy={catalogBusy} onRetry={loadCatalog}
          onStart={() => catalogAction('/admin/catalog/import', t('admin.catalogLaunched'))}
          onPause={() => catalogAction('/admin/catalog/pause', t('admin.catalogPauseAsked'))} />
      ) : null}

      {!data ? <Spinner /> : (
        <>
          <section className="section">
            <header className="section__head"><h2>{t('admin.users')}</h2></header>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('admin.col.user')}</th>
                    <th>{t('admin.col.email')}</th>
                    <th>{t('admin.col.verified')}</th>
                    <th>{t('admin.col.role')}</th>
                    <th className="num">{t('admin.col.cards')}</th>
                    <th className="num">{t('admin.col.packs')}</th>
                    <th className="num">{t('admin.col.level')}</th>
                    <th>{t('admin.col.created')}</th>
                    <th>{t('admin.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td><Link to={`/u/${u.username}`} className="table__user"><Avatar user={{ username: u.username }} size={26} /> {u.username}</Link></td>
                      <td className="muted">{u.email}</td>
                      <td>{u.verified ? <span className="ok-text">{t('admin.yes')}</span> : <span className="muted">{t('admin.no')}</span>}</td>
                      <td>{u.role === 'admin' ? <span className="role-tag">{t('admin.roleAdmin')}</span> : t('admin.rolePlayer')}</td>
                      <td className="num mono">{num(u.unique)}</td>
                      <td className="num mono">{u.packs}</td>
                      <td className="num mono">{u.level}</td>
                      <td className="muted small">{date(u.createdAt)}</td>
                      <td className="table__actions">
                        <button type="button" className="btn btn--ghost btn--xs" onClick={() => run(`/admin/users/${u.id}/grant`, { packs: 5 })}>{t('admin.grantPacks')}</button>
                        <button type="button" className="btn btn--ghost btn--xs" onClick={() => run(`/admin/users/${u.id}/grant`, { royalties: 1000 })}>{t('admin.grantRoyalties')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <header className="section__head"><h2>{t('admin.reviews')}</h2></header>
            {reviews === null ? <Spinner /> : !reviews.items.length ? <p className="empty">{t('admin.reviewsEmpty')}</p> : (
              <ul className="mod-list">
                {reviews.items.map((r) => (
                  <ReviewItem key={`${r.user.id}-${r.type}-${r.id}`} review={r} missing={!!reviews.known && !reviews.known.has(r.id)}
                    onDelete={() => deleteReview(r)} />
                ))}
              </ul>
            )}
          </section>

          <section className="section">
            <header className="section__head"><h2>{t('admin.odds')}</h2></header>
            <div className="table-wrap">
              <table className="table table--odds">
                <thead>
                  <tr>
                    <th>{t('card.rarity')}</th>
                    {data.slots.map((_, i) => <th key={i} className="num">{t('admin.slot', { n: i + 1 })}</th>)}
                    <th className="num">{t('admin.atLeast')}</th>
                    {rarityTotals && <th className="num">{t('admin.inCatalog')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {RARITIES.map((r) => (
                    <tr key={r}>
                      <td><span className="rarity-dot" style={{ '--rc': RARITY[r].color }} /> {t(`rarity.${r}`)}</td>
                      {data.slots.map((slot, i) => {
                        const total = Object.values(slot).reduce((s, w) => s + w, 0);
                        return <td key={i} className="num mono">{slot[r] ? pct(slot[r] / total) : '·'}</td>;
                      })}
                      <td className="num mono strong">{pct(data.odds[r])}</td>
                      {rarityTotals && <td className="num mono">{num(rarityTotals[r] || 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {coverStatus && <CoversPanel status={coverStatus} onRefresh={async () => {
            try {
              setCoverStatus(await post('/admin/covers/refresh'));
              toast(t('admin.coversRunning'), 'success');
            } catch (err) {
              toast(error(err.code), 'error');
            }
          }} />}

          <section className="panel">
            <h2 className="panel__title">{t('admin.settings')}</h2>
            <p className="mono small">{t('admin.regen', { n: data.config.packRegenMinutes, m: data.config.packMaxStock })}</p>
            <p className="mono small">{t('admin.audio', { v: data.config.blindtestAudio })}</p>
            {__DEMO__ ? <p className="small muted">{t('admin.demoNote')}</p> : <Link to="/dev/mailbox" className="btn btn--ghost btn--sm"><Icon name="mail" /> {t('admin.mailbox')}</Link>}
            {data.catalog && <p className="small muted">{t('admin.catalogSize', { n: data.catalog.tracks, m: data.catalog.albums })}</p>}
          </section>
        </>
      )}

      {opening && (
        <PackOpening key={opening.key} promise={opening.promise} count={opening.count} album={opening.album}
          onClose={(err) => { setOpening(null); if (err) toast(error(err.code), 'error'); load(); }}
          onAgain={() => (opening.album ? openAlbum(opening.album) : open(opening.count))} />
      )}
    </div>
  );
}
