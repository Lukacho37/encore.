import { useEffect } from 'react';
import { Vinyl } from './Vinyl.jsx';
import { Icon, Modal } from './ui.jsx';
import { useAlbum, useArtist } from '../state/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { sound } from '../sound.js';

/** Un succès : album complété (vinyle) ou artiste maîtrisé. Les noms viennent du catalogue chargé. */
function Achievement({ a }) {
  const { t } = useI18n();
  const isAlbum = a.type === 'album';
  const album = useAlbum(isAlbum ? a.id : null);
  const artist = useArtist(isAlbum ? null : a.id);
  // Le temps du chargement, on affiche l'identifiant (les réponses de l'API apportent d'habitude ces données).
  const name = isAlbum ? album?.title ?? a.id : artist?.name ?? a.id;
  return (
    <div className={`achievement achievement--${a.type}`}>
      {isAlbum ? (
        <span className="achievement__vinyl">{album ? <Vinyl albumId={a.id} reveal /> : <Icon name="disc" size={28} />}</span>
      ) : (
        <span className="achievement__disc"><Icon name="star" size={28} /></span>
      )}
      <span className="achievement__text">
        <span className="eyebrow">{isAlbum ? t('open.albumDone') : t('open.artistDone')}</span>
        <strong>{isAlbum ? name : t('artist.master', { name })}</strong>
        <span className="muted">{t('open.reward', { r: a.royalties, x: a.xp })}</span>
        <span className="muted small">{isAlbum ? t('open.albumUnlocks') : t('open.artistUnlocks')}</span>
      </span>
    </div>
  );
}

export function AchievementList({ achievements }) {
  return achievements.map((a) => <Achievement key={a.key} a={a} />);
}

/** Modale de célébration (album complété hors booster, par ex. après un pressage). */
export function Celebration({ achievements, onClose }) {
  const { t } = useI18n();
  const open = achievements.length > 0;
  useEffect(() => {
    if (open) sound.complete();
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={t('open.albumDone')} className="modal--celebrate">
      <div className="celebrate">
        <AchievementList achievements={achievements} />
        <button type="button" className="btn btn--primary btn--block" onClick={onClose} data-autofocus>{t('common.close')}</button>
      </div>
    </Modal>
  );
}
