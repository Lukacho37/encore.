import { useEffect } from 'react';
import CoverArt from './CoverArt.jsx';
import { Icon, Modal } from './ui.jsx';
import { ALBUM_BY_ID, ARTIST_BY_ID } from '@shared/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { sound } from '../sound.js';

export function AchievementList({ achievements }) {
  const { t } = useI18n();
  return achievements.map((a) => (
    <div key={a.key} className={`achievement achievement--${a.type}`}>
      <span className="achievement__disc">
        {a.type === 'album' ? <CoverArt art={{ ...ALBUM_BY_ID[a.id].art, seed: a.id }} /> : <Icon name="star" size={28} />}
      </span>
      <span className="achievement__text">
        <span className="eyebrow">{a.type === 'album' ? t('open.albumDone') : t('open.artistDone')}</span>
        <strong>{a.type === 'album' ? ALBUM_BY_ID[a.id].title : t('artist.master', { name: ARTIST_BY_ID[a.id].name })}</strong>
        <span className="muted">{t('open.reward', { r: a.royalties, x: a.xp })}</span>
        <span className="muted small">{a.type === 'album' ? t('open.albumUnlocks') : t('open.artistUnlocks')}</span>
      </span>
    </div>
  ));
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
