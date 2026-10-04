import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { get, post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import PackOpening from '../components/PackOpening.jsx';
import { Avatar, ConfirmButton, Icon, Spinner, useToast } from '../components/ui.jsx';
import { ALBUMS, ALBUM_BY_ID, TRACK_BY_ID } from '@shared/catalog.js';
import { RARITIES, RARITY } from '@shared/rules.js';

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;

export default function Admin() {
  const { t, error, date, num } = useI18n();
  const { isAdmin, applyState, user } = useGame();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [opening, setOpening] = useState(null);
  const [albumId, setAlbumId] = useState(ALBUMS[0].id);

  const load = useCallback(() => get('/admin/overview').then(setData).catch((err) => toast(error(err.code), 'error')), [toast, error]);
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
                      <td>{u.role === 'admin' ? <span className="role-tag">admin</span> : 'player'}</td>
                      <td className="num mono">{u.unique}</td>
                      <td className="num mono">{u.packs}</td>
                      <td className="num mono">{u.level}</td>
                      <td className="muted small">{date(u.createdAt)}</td>
                      <td className="table__actions">
                        <button type="button" className="btn btn--ghost btn--xs" onClick={() => run(`/admin/users/${u.id}/grant`, { packs: 5 })}>{t('admin.grantPacks')}</button>
                        <button type="button" className="btn btn--ghost btn--xs" onClick={() => run(`/admin/users/${u.id}/grant`, { royalties: 1000 })}>{t('admin.grantRoyalties')}</button>
                        {u.id !== user.id && (
                          <button type="button" className="btn btn--ghost btn--xs" onClick={() => run(`/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'player' : 'admin' })}>
                            {u.role === 'admin' ? t('admin.makePlayer') : t('admin.makeAdmin')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

          <section className="panel">
            <h2 className="panel__title">{t('admin.settings')}</h2>
            <p className="mono small">{t('admin.regen', { n: data.config.packRegenMinutes, m: data.config.packMaxStock })}</p>
            <p className="mono small">{t('admin.audio', { v: data.config.blindtestAudio })}</p>
            {!__DEMO__ && <Link to="/dev/mailbox" className="btn btn--ghost btn--sm"><Icon name="mail" /> {t('admin.mailbox')}</Link>}
            <p className="small muted">{num(Object.keys(TRACK_BY_ID).length)} cartes · {ALBUMS.length} albums</p>
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
