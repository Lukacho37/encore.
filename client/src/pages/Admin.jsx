import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { get, post, api } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import PackOpening from '../components/PackOpening.jsx';
import { Avatar, ConfirmButton, Icon, Spinner, useToast } from '../components/ui.jsx';
import { ALBUMS, ALBUM_BY_ID, TRACK_BY_ID } from '@shared/catalog.js';
import { RARITIES, RARITY } from '@shared/rules.js';

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;

const PROVIDERS = { spotify: 'Spotify', deezer: 'Deezer' };

/** État des vraies pochettes : source, nombre trouvé, albums introuvables, actualisation. */
function CoversPanel({ status, onRefresh }) {
  const { t, date } = useI18n();
  const source = status.providers.map((p) => PROVIDERS[p]).join(' → ');
  return (
    <section className="panel">
      <h2 className="panel__title">{t('admin.covers')}</h2>
      {status.demo ? <p className="small muted">{t('admin.coversDemo')}</p>
        : !status.providers.length ? <p className="small">{t('admin.coversOff')}</p>
          : <p className="mono small">{t('admin.coversStatus', { found: status.found, total: status.total, p: source })}{status.lastRun ? ` · ${date(status.lastRun)}` : ''}</p>}
      {!status.demo && status.providers.length > 0 && !status.spotifyKeys && <p className="small muted">{t('admin.coversSpotifyHint')}</p>}
      {status.missing.length > 0 && status.providers.length > 0 && (
        <details className="small">
          <summary>{t('admin.coversMissing', { n: status.missing.length })}</summary>
          <ul className="covers-missing">{status.missing.map((m) => <li key={m.key}>{m.artist} · {m.title}</li>)}</ul>
        </details>
      )}
      {status.lastError && <p className="small muted mono">{t('admin.coversError', { e: status.lastError })}</p>}
      {!status.demo && status.providers.length > 0 && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRefresh} disabled={status.running}>
          {status.running ? t('admin.coversRunning') : t('admin.coversRefresh')}
        </button>
      )}
    </section>
  );
}

export default function Admin() {
  const { t, error, date, num } = useI18n();
  const { isAdmin, applyState } = useGame();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [coverStatus, setCoverStatus] = useState(null);
  const [opening, setOpening] = useState(null);
  const [albumId, setAlbumId] = useState(ALBUMS[0].id);

  const load = useCallback(() => {
    get('/admin/overview').then(setData).catch((err) => toast(error(err.code), 'error'));
    get('/admin/reviews').then(setReviews).catch(() => setReviews([]));
    get('/admin/covers').then(setCoverStatus).catch(() => setCoverStatus(null));
  }, [toast, error]);
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

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

  const open = (count) => setOpening({ promise: post('/packs/open', { count }), count, key: Date.now() });

  return (
    <div className="admin">
      <header className="page-head">
        <div>
          <span className="eyebrow"><Icon name="shield" size={14} /> {t('nav.admin')}</span>
          <h1>{t('admin.title')}</h1>
          {data && <p className="muted small mono">{t('admin.totals', data.totals)}</p>}
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
          <button type="button" className="btn btn--ghost" onClick={() => run('/admin/me/complete', {}, t('common.done'))}>{t('admin.complete')}</button>
          <ConfirmButton confirmLabel={t('admin.resetConfirm')} onConfirm={() => run('/admin/me/reset', {}, t('common.done'))}>{t('admin.reset')}</ConfirmButton>
        </div>
        <div className="admin-tools admin-tools--row">
          <label className="select">
            <span className="sr-only">{t('card.album')}</span>
            <select id="admin-album" value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
              {ALBUMS.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn--ghost" onClick={() => run('/admin/me/almost', { albumId },
            (res) => t('admin.almostDone', { title: TRACK_BY_ID[res.missing].title, album: ALBUM_BY_ID[albumId].title }))}>
            {t('admin.almost')}
          </button>
          <Link to={`/album/${albumId}`} className="btn btn--ghost btn--sm"><Icon name="disc" /> {ALBUM_BY_ID[albumId].title}</Link>
        </div>
      </section>

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
                      <td className="num mono">{u.unique}</td>
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
            {!reviews?.length ? <p className="empty">{t('admin.reviewsEmpty')}</p> : (
              <ul className="mod-list">
                {reviews.map((r) => {
                  const title = r.type === 'album' ? ALBUM_BY_ID[r.id]?.title : TRACK_BY_ID[r.id]?.title;
                  return (
                    <li key={`${r.user.id}-${r.type}-${r.id}`} className="mod-item">
                      <div className="mod-item__head">
                        <Link to={`/u/${r.user.username}`} className="table__user"><Avatar user={r.user} size={24} /> {r.user.username}</Link>
                        <span className="muted small">· {title} · <span className="mono">{r.score}/10</span> · {date(r.updatedAt)}</span>
                      </div>
                      <p className="mod-item__text">{r.review}</p>
                      <ConfirmButton className="btn btn--ghost btn--xs" confirmLabel={t('admin.deleteConfirm')}
                        onConfirm={async () => {
                          try {
                            setReviews(await api('DELETE', `/admin/reviews/${r.user.id}/${r.type}/${encodeURIComponent(r.id)}`));
                            toast(t('common.done'), 'success');
                          } catch (err) {
                            toast(error(err.code), 'error');
                          }
                        }}>{t('admin.deleteReview')}</ConfirmButton>
                    </li>
                  );
                })}
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
            <p className="small muted">{t('admin.catalogSize', { n: num(Object.keys(TRACK_BY_ID).length), m: ALBUMS.length })}</p>
          </section>
        </>
      )}

      {opening && (
        <PackOpening key={opening.key} promise={opening.promise} count={opening.count}
          onClose={(err) => { setOpening(null); if (err) toast(error(err.code), 'error'); load(); }}
          onAgain={() => open(opening.count)} />
      )}
    </div>
  );
}
