// Décision de modération (DSA art. 17) — chantier P0-F (PLAN.md 4.1.6, 7.1). Un seul formulaire pour les trois usages
// de l'espace admin : décider d'un signalement, agir sur une critique sans signalement, suspendre un joueur.
//   <DecisionForm targetType reason itemLabel actions? defaultAction? suggestSuspend? submitLabel? onSubmit onCancel? />
//   onSubmit({ action, ground, statement, suspendDays }) renvoie une promesse ; une erreur s'affiche dans le formulaire.
// Le motif est prérempli d'après le motif du signalement, l'exposé des motifs d'après la décision et le motif (texte
// adressé à l'auteur, en tutoiement) ; dès que l'admin le modifie à la main, il n'est plus réécrit.
// <DecisionDialog open onClose title … /> : le même formulaire dans une fenêtre.
import { useEffect, useId, useState } from 'react';
import { useI18n } from '../../i18n/index.jsx';
import { Modal } from '../ui.jsx';
import '../../styles/safety.css';

/** Motifs proposés (mêmes clés que safety.grounds ; le serveur accepte rules:<section> et law:<texte>). */
export const GROUNDS = {
  rules: ['rules:respect', 'rules:hate', 'rules:threat', 'rules:spam', 'rules:sexual', 'rules:personal', 'rules:copyright', 'rules:offtopic', 'rules:username'],
  law: ['law:hate', 'law:harassment', 'law:threat', 'law:defamation', 'law:privacy', 'law:copyright'],
};
/** Motif proposé d'office pour chaque motif de signalement. */
export const GROUND_OF_REASON = {
  illegal_hate: 'rules:hate', harassment: 'rules:respect', threat: 'rules:threat', copyright: 'rules:copyright',
  personal_data: 'rules:personal', spam: 'rules:spam', sexual: 'rules:sexual', other: 'rules:offtopic',
};
export const SUSPEND_DAYS = [1, 7, 30, 365];
const STATEMENT_MAX = 2000;

/** Décisions possibles selon le contenu (comme server/moderation.js : un joueur ne se masque pas, une adresse se classe). */
export function actionsFor(targetType, { dismiss = true } = {}) {
  let list;
  if (targetType === 'url') list = ['dismiss'];
  else if (targetType === 'user') list = ['warn', 'suspend', 'dismiss'];
  else list = ['hide', 'delete', 'warn', 'suspend', 'dismiss'];
  return dismiss ? list : list.filter((a) => a !== 'dismiss');
}

export function DecisionForm({ targetType, reason, itemLabel, actions, defaultAction = null, suggestSuspend = false, submitLabel, onSubmit, onCancel }) {
  const { t, error } = useI18n();
  const uid = useId().replace(/:/g, '');
  const list = actions || actionsFor(targetType);
  const [action, setAction] = useState(defaultAction || (list.length === 1 ? list[0] : null));
  const [ground, setGround] = useState(GROUND_OF_REASON[reason] || (targetType === 'user' ? 'rules:username' : 'rules:respect'));
  const [days, setDays] = useState(7);
  const [statement, setStatement] = useState('');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Exposé des motifs prérempli (tant que l'admin ne l'a pas réécrit).
  useEffect(() => {
    if (edited || !action) return;
    if (action === 'dismiss') {
      setStatement('');
      return;
    }
    const label = t(`safety.grounds.${ground}`);
    const rule = label.includes(' · ') ? label.slice(label.indexOf(' · ') + 3) : label;
    const basis = t(`admin.mod.basis.${ground.startsWith('law:') ? 'law' : 'rules'}`, { rule });
    setStatement(t(`admin.mod.template.${action}`, { item: itemLabel || t('admin.mod.itemConduct'), basis, n: days }));
  }, [action, ground, days, edited, itemLabel, t]);

  const submit = async (e) => {
    e.preventDefault();
    if (!action || busy) return;
    if (action !== 'dismiss' && !statement.trim()) {
      setErr(error('statement_required'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        action,
        ground: action === 'dismiss' ? 'rules:none' : ground,
        statement: statement.trim(),
        ...(action === 'suspend' ? { suspendDays: days } : {}),
      });
    } catch (ex) {
      setErr(error(ex.code));
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <form className="sf-decide" onSubmit={submit}>
      {list.length > 1 && (
        <div className="sf-decide__choices" role="radiogroup" aria-label={t('admin.mod.decision')}>
          {list.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={action === a}
              className={`chip chip--toggle${action === a ? ' is-on' : ''}${a === 'suspend' && suggestSuspend ? ' sf-decide__suggest' : ''}`}
              onClick={() => setAction(a)}>
              {t(`admin.mod.actions.${a}`)}
            </button>
          ))}
        </div>
      )}
      {action && action !== 'dismiss' && (
        <div className="sf-decide__grid">
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-ground`}>{t('admin.mod.ground')}</label>
            <span className="select sf-select">
              <select id={`${uid}-ground`} value={ground} onChange={(e) => setGround(e.target.value)}>
                <optgroup label={t('admin.mod.groundRules')}>
                  {GROUNDS.rules.map((g) => <option key={g} value={g}>{t(`safety.grounds.${g}`)}</option>)}
                </optgroup>
                <optgroup label={t('admin.mod.groundLaw')}>
                  {GROUNDS.law.map((g) => <option key={g} value={g}>{t(`safety.grounds.${g}`)}</option>)}
                </optgroup>
              </select>
            </span>
          </div>
          {action === 'suspend' && (
            <div className="field">
              <label className="field__label" htmlFor={`${uid}-days`}>{t('admin.mod.duration')}</label>
              <span className="select sf-select">
                <select id={`${uid}-days`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {SUSPEND_DAYS.map((d) => <option key={d} value={d}>{t('admin.mod.days', { n: d })}</option>)}
                </select>
              </span>
            </div>
          )}
        </div>
      )}
      {action && (
        <div className="field">
          <label className="field__label" htmlFor={`${uid}-statement`}>{t(action === 'dismiss' ? 'admin.mod.noteLabel' : 'admin.mod.statementLabel')}</label>
          <textarea id={`${uid}-statement`} className="input textarea" rows={action === 'dismiss' ? 2 : 4} maxLength={STATEMENT_MAX} value={statement}
            onChange={(e) => {
              setStatement(e.target.value);
              setEdited(true);
            }} />
          <p className="field__hint">{t(action === 'dismiss' ? 'admin.mod.noteHint' : 'admin.mod.statementHint')}</p>
        </div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      {(action || onCancel) && (
        <div className="sf-decide__foot">
          {onCancel && <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>}
          {action && (
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy || (action !== 'dismiss' && !statement.trim())}>
              {submitLabel || t(`admin.mod.apply.${action}`)}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/** Le formulaire de décision dans une fenêtre (critique sans signalement, suspension depuis la liste des joueurs). */
export function DecisionDialog({ open, onClose, title, ...form }) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="sf-dialog sf-decide-dialog">
      {open && <DecisionForm {...form} onCancel={onClose} />}
    </Modal>
  );
}

export default DecisionForm;
