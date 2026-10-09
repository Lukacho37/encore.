// Fenêtre « Signaler » (motif, précisions) — chantier P0-F (PLAN.md 4.1.6, 7.1). Ouverte par le menu ⋯ (SafetyMenu) ;
// envoie POST /api/reports { targetType, targetId, reason, details }.
import { useEffect, useId, useState } from 'react';
import { post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { Modal, useToast } from '../ui.jsx';
import '../../styles/safety.css';

/** Motifs de signalement, dans l'ordre du serveur (server/moderation.js, REPORT_REASONS). */
export const REPORT_REASONS = ['illegal_hate', 'harassment', 'threat', 'copyright', 'personal_data', 'spam', 'sexual', 'other'];
const DETAILS_MAX = 2000;

export function ReportDialog({ open, target, user, onClose, onSent }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setDetails('');
    setErr(null);
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await post('/reports', { targetType: target.type, targetId: target.id, reason, details: details.trim() || undefined });
      toast(t('report.sent'), 'success');
      onSent?.();
      onClose();
    } catch (ex) {
      setErr(error(ex.code));
    } finally {
      setBusy(false);
    }
  };

  const title = t(`report.title.${target?.type || 'review'}`, { name: user?.username || '' });
  return (
    <Modal open={open} onClose={onClose} title={title} className="modal--narrow sf-dialog">
      <form className="sf-dialog__form" onSubmit={submit}>
        <fieldset className="sf-reasons">
          <legend className="field__label">{t('report.reasonLabel')}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className={`sf-reason${reason === r ? ' is-on' : ''}`}>
              <input type="radio" name={`${uid}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{t(`report.reasons.${r}`)}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label className="field__label" htmlFor={`${uid}-details`}>{t('report.details')}</label>
          <textarea id={`${uid}-details`} className="input textarea" rows={3} maxLength={DETAILS_MAX} value={details}
            onChange={(e) => setDetails(e.target.value)} />
          <p className="field__hint">{t('report.detailsHint')}</p>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <p className="small muted">{t('report.note')}</p>
        <div className="modal__actions sf-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--primary" disabled={!reason || busy}>{t('report.send')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default ReportDialog;
