// Retrait d'une vraie pochette (demande d'un ayant droit, PLAN.md 4.1.6, 7.1) — chantier P0-F. L'album garde ses cartes
// et ses pages ; partout sur le site, sa pochette laisse la place au visuel généré d'AlbumMania (cat_albums.cover_blocked,
// que CoverArt respecte). Chaque retrait et chaque retour est journalisé (admin_audit) avec sa note.
//   GET  /api/admin/albums/blocked-covers   pochettes retirées (les plus récentes d'abord) ;
//   POST /api/admin/albums/:id/cover        { blocked, note } (référence de la demande, nom de l'ayant droit…).
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { get, post } from '../../api.js';
import { useAlbum } from '../../state/catalog.js';
import { useI18n } from '../../i18n/index.jsx';
import CoverArt from '../CoverArt.jsx';
import { ConfirmButton, Icon, Spinner, useToast } from '../ui.jsx';
import { ErrorBox } from '../feedback.jsx';
import { AlbumPicker } from './AlbumPicker.jsx';
import '../../styles/safety.css';

const enc = encodeURIComponent;

/** Pochette d'un album (déjà générée quand elle est retirée), titre, artiste. */
function AlbumLine({ albumId, album: given, meta, children }) {
  const loaded = useAlbum(given ? null : albumId);
  const album = given || loaded;
  return (
    <li className="sf-row">
      <span className="sf-row__cover">{album?.art ? <CoverArt art={{ ...album.art, seed: album.art.seed || album.id }} sizes="44px" /> : null}</span>
      <span className="sf-row__main">
        <Link to={`/album/${enc(albumId)}`} className="sf-row__name">{album?.title || albumId}</Link>
        <span className="small muted">{[album?.artist, meta].filter(Boolean).join(' · ')}</span>
      </span>
      {children}
    </li>
  );
}

export function CoverTakedown() {
  const { t, date, error } = useI18n();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const [data, setData] = useState(null); // { items } | { error }
  const [pending, setPending] = useState(null); // album choisi, en attente de confirmation
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get('/admin/albums/blocked-covers').then(setData).catch((err) => setData({ error: err }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setBlocked = async (albumId, blocked, text = '') => {
    setBusy(true);
    try {
      await post(`/admin/albums/${enc(albumId)}/cover`, { blocked, note: text.trim() });
      toast(t(blocked ? 'admin.mod.coverBlocked' : 'admin.mod.coverRestored'), 'success');
      setPending(null);
      setNote('');
      load();
    } catch (ex) {
      toast(error(ex.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  let list;
  if (data?.error) list = <ErrorBox error={data.error} onRetry={load} />;
  else if (!data) list = <div className="sf-panel-state"><Spinner /></div>;
  else if (!data.items.length) list = <p className="sf-empty small muted">{t('admin.mod.coversEmpty')}</p>;
  else {
    list = (
      <ul className="sf-rows">
        {data.items.map(({ albumId, at }) => (
          <AlbumLine key={albumId} albumId={albumId} meta={at ? t('admin.mod.blockedOn', { d: date(at) }) : null}>
            <ConfirmButton className="btn btn--ghost btn--xs" confirmLabel={t('admin.mod.restoreConfirm')} onConfirm={() => setBlocked(albumId, false)} disabled={busy}>
              {t('admin.mod.restoreCover')}
            </ConfirmButton>
          </AlbumLine>
        ))}
      </ul>
    );
  }

  return (
    <section className="panel sf-covers" aria-labelledby={`${uid}-title`}>
      <h2 className="panel__title" id={`${uid}-title`}><Icon name="shield" /> {t('admin.mod.coversTitle')}</h2>
      <p className="small muted">{t('admin.mod.coversBody')}</p>
      <AlbumPicker onPick={(album) => { setPending(album); setNote(''); }} placeholder={t('admin.mod.coversSearch')} label={t('admin.mod.coversSearch')} />
      {pending && (
        <div className="sf-covers__confirm">
          <ul className="sf-rows"><AlbumLine albumId={pending.id} album={pending} /></ul>
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-note`}>{t('admin.mod.coverNote')}</label>
            <textarea id={`${uid}-note`} className="input textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field__hint">{t('admin.mod.coverNoteHint')}</p>
          </div>
          <div className="sf-decide__foot">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPending(null)} disabled={busy}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setBlocked(pending.id, true, note)} disabled={busy}>{t('admin.mod.blockCover')}</button>
          </div>
        </div>
      )}
      <h3 className="sf-set__sub">{t('admin.mod.coversList')}</h3>
      {list}
    </section>
  );
}

export default CoverTakedown;
