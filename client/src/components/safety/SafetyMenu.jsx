// Menu ⋯ « Signaler / Bloquer » — chantier P0-F (PLAN.md 4.1.6, 9.2). Props (contrat, ne pas les renommer) :
// { target: { type: 'review' | 'post' | 'comment' | 'list' | 'user', id }, user?: UserSummary }.
// « Signaler » ouvre la fenêtre des motifs (ReportDialog) ; « Bloquer @x » demande confirmation (PUT /api/blocks/:id),
// « Débloquer » agit tout de suite. Après un blocage, les réponses gardées en cache sont oubliées et l'événement
// `albummania:blocks` ({ userId, blocked }) est diffusé sur window : une page peut s'y abonner pour retirer tout de suite
// les contenus du joueur bloqué (sinon ils disparaissent au prochain chargement).
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { clearApiCache } from '../../state/catalog.js';
import { useI18n } from '../../i18n/index.jsx';
import { Icon, Modal, useToast } from '../ui.jsx';
import { ReportDialog } from './ReportDialog.jsx';
import '../../styles/safety.css';

export const BLOCKS_EVENT = 'albummania:blocks';

/** Bloque ou débloque un joueur ; prévient les pages ouvertes. Renvoie la réponse de l'API. */
export async function setBlocked(userId, blocked) {
  const res = await api(blocked ? 'PUT' : 'DELETE', `/blocks/${encodeURIComponent(userId)}`);
  clearApiCache('');
  window.dispatchEvent(new CustomEvent(BLOCKS_EVENT, { detail: { userId, blocked } }));
  return res;
}

export function SafetyMenu({ target, user }) {
  const { user: me } = useGame();
  const { t, error } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // 'report' | 'block'
  const [blocked, setBlockedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => setOpen(false), [location.pathname]);
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

  if (!target || target.id == null || !me) return null;
  const self = !!user && (user.relation === 'self' || user.id === me.id);
  // Son propre contenu : rien à signaler ni à bloquer.
  if (self || (target.type === 'user' && Number(target.id) === me.id)) return null;
  const name = user?.username || '';

  const toggleBlock = async (next) => {
    setBusy(true);
    try {
      await setBlocked(user.id, next);
      setBlockedState(next);
      toast(t(next ? 'safety.blocked' : 'safety.unblocked', { name }), 'success');
      setDialog(null);
    } catch (ex) {
      toast(error(ex.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-menu" ref={ref}>
      <button type="button" className="icon-btn sf-menu__btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('safety.more')}
        title={t('safety.more')} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div className="menu sf-menu__pop" role="menu">
          <button type="button" className="menu__item" role="menuitem" onClick={() => { setOpen(false); setDialog('report'); }}>
            <Icon name="flag" /> {t('safety.report')}
          </button>
          {user && (blocked ? (
            <button type="button" className="menu__item" role="menuitem" disabled={busy} onClick={() => { setOpen(false); toggleBlock(false); }}>
              <Icon name="lock" /> {t('safety.unblock', { name })}
            </button>
          ) : (
            <button type="button" className="menu__item menu__item--danger" role="menuitem" onClick={() => { setOpen(false); setDialog('block'); }}>
              <Icon name="lock" /> {t('safety.block', { name })}
            </button>
          ))}
        </div>
      )}
      <ReportDialog open={dialog === 'report'} target={target} user={user} onClose={() => setDialog(null)} />
      {user && (
        <Modal open={dialog === 'block'} onClose={() => setDialog(null)} title={t('safety.blockTitle', { name })} className="modal--narrow sf-dialog">
          <p className="sf-dialog__text">{t('safety.blockBody', { name })}</p>
          <div className="modal__actions sf-dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setDialog(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => toggleBlock(true)}>{t('safety.blockConfirm')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default SafetyMenu;
