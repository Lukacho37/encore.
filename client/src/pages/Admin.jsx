// Espace admin (propriétaire seulement : adresse dans ADMIN_EMAILS) — onglets /admin/:tab (PLAN.md 2.1, 4.1.1, 4.1.6) :
//   overview    totaux, joueurs (50 par page, « Voir plus »), dons, suspension, probabilités, réglages serveur ;
//   moderation  file des signalements, contestations, critiques récentes, suspensions, journal (ModerationTab, P0-F) ;
//   catalog     import du catalogue depuis Deezer ;
//   covers      état des vraies pochettes et retrait d'une pochette (CoverTakedown) ;
//   tools       outils de test (boosters par lots, albums complets ou presque, booster d'album).
// Les ouvertures de boosters passent par useBoosterFlow (même écran d'ouverture que l'accueil).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { get, post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { getTrack } from '../state/catalog.js';
import { useBoosterFlow } from '../state/boosterFlow.js';
import { useI18n } from '../i18n/index.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { Avatar, ConfirmButton, Icon, Progress, Spinner, useToast } from '../components/ui.jsx';
import { LoadMore } from '../components/feedback.jsx';
import { AlbumPicker } from '../components/admin/AlbumPicker.jsx';
import { ModerationTab } from '../components/admin/ModerationTab.jsx';
import { CoverTakedown } from '../components/admin/CoverTakedown.jsx';
import { DecisionDialog } from '../components/admin/DecisionForm.jsx';
import { RARITIES, RARITY } from '@shared/rules.js';
import '../styles/admin.css';
import '../styles/safety.css';

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;

const PROVIDERS = { spotify: 'Spotify', deezer: 'Deezer' };
const CATALOG_POLL_MS = 5000; // actualisation de l'état de l'import pendant qu'il tourne
const TABS = ['overview', 'moderation', 'catalog', 'covers', 'tools'];
const TAB_ICONS = { overview: 'grid', moderation: 'shield', catalog: 'disc', covers: 'external', tools: 'pack' };

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

/** Joueurs (50 par page) : dons, suspension et levée de suspension. */
function UsersSection({ first, onGrant }) {
  const { t, date, num, error } = useI18n();
  const toast = useToast();
  const [pages, setPages] = useState({ users: first.users, nextCursor: first.nextCursor ?? null, loading: false, error: null });
  const [suspended, setSuspended] = useState(new Map()); // userId → fin de la suspension
  const [suspending, setSuspending] = useState(null);

  useEffect(() => {
    setPages({ users: first.users, nextCursor: first.nextCursor ?? null, loading: false, error: null });
  }, [first]);

  const loadSuspensions = useCallback(() => {
    get('/admin/suspensions')
      .then((res) => setSuspended(new Map((res.items || []).map((x) => [x.user.id, x.until]))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadSuspensions();
  }, [loadSuspensions]);

  const more = async () => {
    setPages((p) => ({ ...p, loading: true, error: null }));
    try {
      const res = await get(`/admin/overview?cursor=${encodeURIComponent(pages.nextCursor)}`);
      setPages((p) => {
        const seen = new Set(p.users.map((u) => u.id));
        return { users: [...p.users, ...res.users.filter((u) => !seen.has(u.id))], nextCursor: res.nextCursor ?? null, loading: false, error: null };
      });
    } catch (err) {
      setPages((p) => ({ ...p, loading: false, error: err }));
    }
  };

  const unsuspend = async (u) => {
    try {
      await post(`/admin/users/${u.id}/unsuspend`, {});
      toast(t('admin.mod.unsuspended', { name: u.username }), 'success');
      loadSuspensions();
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  return (
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
            {pages.users.map((u) => {
              const until = suspended.get(u.id);
              return (
                <tr key={u.id}>
                  <td><Link to={`/u/${u.username}`} className="table__user"><Avatar user={{ id: u.id, username: u.username }} size={26} /> {u.username}</Link></td>
                  <td className="muted">{u.email}</td>
                  <td>{u.verified ? <span className="ok-text">{t('admin.yes')}</span> : <span className="muted">{t('admin.no')}</span>}</td>
                  <td>
                    {u.role === 'admin' ? <span className="role-tag">{t('admin.roleAdmin')}</span> : t('admin.rolePlayer')}
                    {until && <span className="chip chip--sm chip--danger sf-user-chip">{t('admin.mod.suspendedUntil', { d: date(until) })}</span>}
                  </td>
                  <td className="num mono">{num(u.unique)}</td>
                  <td className="num mono">{u.packs}</td>
                  <td className="num mono">{u.level}</td>
                  <td className="muted small">{date(u.createdAt)}</td>
                  <td className="table__actions">
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => onGrant(u, { packs: 5 })}>{t('admin.grantPacks')}</button>
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => onGrant(u, { royalties: 1000 })}>{t('admin.grantRoyalties')}</button>
                    {u.role !== 'admin' && u.verified && (until ? (
                      <ConfirmButton className="btn btn--ghost btn--xs" confirmLabel={t('admin.mod.unsuspendConfirm')} onConfirm={() => unsuspend(u)}>
                        {t('admin.mod.unsuspend')}
                      </ConfirmButton>
                    ) : (
                      <button type="button" className="btn btn--ghost btn--xs" onClick={() => setSuspending(u)}>{t('admin.mod.suspend')}</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LoadMore hasMore={!!pages.nextCursor} loading={pages.loading} onClick={more} error={pages.error} onRetry={more} />
      <DecisionDialog open={!!suspending} onClose={() => setSuspending(null)} title={t('admin.mod.suspendTitle', { name: suspending?.username || '' })}
        targetType="user" actions={['suspend']} defaultAction="suspend" itemLabel={t('admin.mod.itemConduct')}
        onSubmit={async (body) => {
          await post(`/admin/users/${suspending.id}/suspend`, { days: body.suspendDays, ground: body.ground, statement: body.statement });
          toast(t('admin.mod.decided.suspend'), 'success');
          setSuspending(null);
          loadSuspensions();
        }} />
    </section>
  );
}

export default function Admin() {
  const { t, error, num } = useI18n();
  const { tab: rawTab } = useParams();
  const { isAdmin, applyState } = useGame();
  const toast = useToast();
  const tab = rawTab || 'overview';
  const [data, setData] = useState(null);
  const [coverStatus, setCoverStatus] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [pauseAsked, setPauseAsked] = useState(false);
  const [modCounts, setModCounts] = useState(null);
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
  const loadCovers = useCallback(() => {
    get('/admin/covers').then(setCoverStatus).catch(() => setCoverStatus(null));
  }, []);
  // Compteurs de la file de modération (pastille de l'onglet).
  const loadModCounts = useCallback(() => {
    get('/admin/reports?limit=1').then((res) => setModCounts(res.counts || null)).catch(() => {});
  }, []);
  const flow = useBoosterFlow({ onClose: loadOverview });

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
    loadOverview();
    loadCatalog();
    loadCovers();
    loadModCounts();
  }, [isAdmin, loadOverview, loadCatalog, loadCovers, loadModCounts]);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (!TABS.includes(tab)) return <Navigate to="/admin" replace />;

  const run = async (path, body, message) => {
    try {
      const res = await post(path, body);
      if (res.state) applyState(res.state);
      toast(typeof message === 'function' ? message(res) : message || t('common.done'), 'success');
      loadOverview();
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

  const rarityTotals = data?.catalog?.rarity;
  const modPending = (modCounts?.open || 0) + (modCounts?.appeals || 0);

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

      <nav className="tabs sf-admin-tabs" aria-label={t('admin.title')}>
        {TABS.map((id) => (
          <Link key={id} to={id === 'overview' ? '/admin' : `/admin/${id}`} className={`tabs__tab${tab === id ? ' active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}>
            <Icon name={TAB_ICONS[id]} size={16} /> {t(`admin.tabs.${id}`)}
            {id === 'moderation' && modPending > 0 && <span className="count-badge" aria-label={t('admin.mod.pendingLabel', { n: modPending })}>{modPending}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <section className="panel admin-owner">
            <p><Icon name="shield" size={16} /> {t('admin.ownerOnly')}</p>
            <p className="muted small">{t('admin.powers')}</p>
          </section>
          {!data ? <Spinner /> : (
            <>
              <UsersSection first={data} onGrant={(u, body) => run(`/admin/users/${u.id}/grant`, body)} />
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
              <section className="panel">
                <h2 className="panel__title">{t('admin.settings')}</h2>
                <p className="mono small">{t('admin.regen', { n: data.config.packRegenMinutes, m: data.config.packMaxStock })}</p>
                <p className="mono small">{t('admin.audio', { v: data.config.blindtestAudio })}</p>
                {__DEMO__ ? <p className="small muted">{t('admin.demoNote')}</p> : <Link to="/dev/mailbox" className="btn btn--ghost btn--sm"><Icon name="mail" /> {t('admin.mailbox')}</Link>}
                {data.catalog && <p className="small muted">{t('admin.catalogSize', { n: data.catalog.tracks, m: data.catalog.albums })}</p>}
              </section>
            </>
          )}
        </>
      )}

      {tab === 'moderation' && <ModerationTab counts={modCounts} onCounts={setModCounts} onChanged={loadModCounts} />}

      {tab === 'catalog' && (catalogStatus || !catalogFailed || !__DEMO__ ? (
        <CatalogPanel status={catalogStatus} failed={catalogFailed} pauseAsked={pauseAsked} busy={catalogBusy} onRetry={loadCatalog}
          onStart={() => catalogAction('/admin/catalog/import', t('admin.catalogLaunched'))}
          onPause={() => catalogAction('/admin/catalog/pause', t('admin.catalogPauseAsked'))} />
      ) : <p className="empty">{t('admin.catalogLoadError')}</p>)}

      {tab === 'covers' && (
        <>
          {coverStatus && <CoversPanel status={coverStatus} onRefresh={async () => {
            try {
              setCoverStatus(await post('/admin/covers/refresh'));
              toast(t('admin.coversRunning'), 'success');
            } catch (err) {
              toast(error(err.code), 'error');
            }
          }} />}
          <CoverTakedown />
        </>
      )}

      {tab === 'tools' && (
        <section className="panel">
          <h2 className="panel__title">{t('admin.tools')}</h2>
          <p className="muted">{t('admin.toolsBody')}</p>
          <div className="admin-tools">
            <button type="button" className="btn btn--primary" onClick={() => flow.openFree(10)}>{t('admin.open', { n: 10 })}</button>
            <button type="button" className="btn btn--ghost" onClick={() => flow.openFree(50)}>{t('admin.open', { n: 50 })}</button>
            <button type="button" className="btn btn--ghost" onClick={() => run('/admin/me/complete', {}, t('common.done'))}>{t('admin.completeSeed')}</button>
            <ConfirmButton confirmLabel={t('admin.resetConfirm')} onConfirm={() => run('/admin/me/reset', {}, t('common.done'))}>{t('admin.reset')}</ConfirmButton>
          </div>
          <p className="small muted">{t('admin.completeSeedHint')}</p>
          <div className="admin-tools--row adm-album-tools">
            <h3 className="eyebrow">{t('admin.albumTools')}</h3>
            <AlbumPicker onPick={setAlbum} />
            {album ? (
              <AlbumTools album={album} onClear={() => setAlbum(null)} onPack={() => flow.openAlbum(album)}
                onAlmost={() => run('/admin/me/almost', { albumId: album.id },
                  (res) => t('admin.almostDone', { title: getTrack(res.missing)?.title || res.missing, album: album.title }))}
                onComplete={() => run('/admin/me/complete', { albumId: album.id }, t('admin.completeAlbumDone', { album: album.title }))} />
            ) : <p className="small muted">{t('admin.albumPick')}</p>}
          </div>
        </section>
      )}

      {flow.overlay}
    </div>
  );
}
