// Menu ⋯ de ses propres contenus (post) — chantier P1-A : « Modifier », « Supprimer » (confirmation dans une fenêtre).
// Même allure que le menu « Signaler / Bloquer » des contenus des autres (SafetyMenu, classes .menu de app.css).
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/index.jsx';
import { Icon, Modal } from '../ui.jsx';
import '../../styles/social.css';

/** Props : { onEdit?, onDelete(), deleteTitle, deleteBody }. */
export function OwnMenu({ onEdit, onDelete, deleteTitle, deleteBody }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete();
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="so-menu" ref={ref}>
      <button type="button" className="icon-btn so-menu__btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('social.more')}
        title={t('social.more')} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div className="menu so-menu__pop" role="menu">
          {onEdit && (
            <button type="button" className="menu__item" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>
              <Icon name="edit" /> {t('social.edit')}
            </button>
          )}
          <button type="button" className="menu__item menu__item--danger" role="menuitem" onClick={() => { setOpen(false); setConfirm(true); }}>
            <Icon name="close" /> {t('social.delete')}
          </button>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={deleteTitle} className="modal--narrow">
        {deleteBody && <p className="muted">{deleteBody}</p>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={remove}>{t('social.delete')}</button>
        </div>
      </Modal>
    </div>
  );
}

export default OwnMenu;
