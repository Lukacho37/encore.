// Paramètres : décisions de modération, membres bloqués, sécurité du compte, export des données, suppression du
// compte — chantier P0-F (PLAN.md 2.5, 4.1.6, 4.1.8, 9.2). Props (contrat, ne pas les renommer) : aucune ; montée par la
// page Paramètres (P0-D), après ses propres réglages. Chaque bloc est un .panel indépendant (chargé à part, avec son
// erreur et son « Réessayer ») :
//   Décisions de modération  seulement s'il y en a (ou si le compte est suspendu) : motif, exposé des motifs, « Contester » ;
//   Membres bloqués          GET /api/blocks, « Débloquer » ;
//   Sécurité du compte       POST /api/account/password (les autres sessions sont fermées), POST /api/account/sessions/revoke ;
//   Exporter mes données     GET /api/account/export → fichier albummania-<pseudo>-<date>.json (3 par jour) ;
//   Supprimer mon compte     DELETE /api/account { password, confirm: <pseudo> }, puis retour à la connexion.
import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, get, post } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { validatePassword } from '@shared/rules.js';
import { Avatar, Icon, Modal, Spinner, useToast } from '../ui.jsx';
import { ErrorBox } from '../feedback.jsx';
import { setBlocked } from '../safety/SafetyMenu.jsx';
import { AppealDialog, useItemTitle } from '../safety/NotificationRow.jsx';
import '../../styles/safety.css';

/** Lecture d'une adresse de l'API : { data, error, reload, setData }. */
function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null });
  const reload = useCallback(() => {
    setState((s) => ({ data: s.data, error: null }));
    get(path).then((data) => setState({ data, error: null })).catch((error) => setState({ data: null, error }));
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: fn(s.data) })), []);
  return { ...state, reload, setData };
}

// ---------- décisions de modération ----------

/** Une décision sur un de mes contenus : ce qui a été fait, pourquoi, et la contestation. */
function DecisionRow({ d, onAppealed }) {
  const { t, date } = useI18n();
  const [appealing, setAppealing] = useState(false);
  const title = useItemTitle(d.item);
  const type = d.item?.type || d.targetType;
  let item;
  if (type === 'review') item = title ? t('notify.item.review', { title }) : t('notify.item.reviewNoTitle');
  else if (['post', 'comment', 'list', 'user'].includes(type)) item = t(`notify.item.${type}`);
  else item = t('notify.item.content');
  const appeal = d.appeal;
  return (
    <li className="sf-decision">
      <p className="sf-decision__title">{t(`safety.decision.${d.action}`, { item })}</p>
      <p className="small muted">
        {t('safety.decisionOn', { d: date(d.createdAt) })}
        {d.ground && d.ground !== 'rules:none' ? ` · ${t(`safety.grounds.${d.ground}`)}` : ''}
      </p>
      {d.statement && (
        <blockquote className="sf-quote">
          <span className="label">{t('notify.statement')}</span>
          <span className="sf-quote__text">{d.statement}</span>
        </blockquote>
      )}
      {d.item?.excerpt && <p className="small muted sf-excerpt">{t('safety.excerptLine', { text: d.item.excerpt })}</p>}
      {appeal ? (
        <span className={`chip chip--sm ${appeal.decision === 'reversed' ? 'chip--ok' : appeal.decision ? 'chip--quiet' : 'chip--cue'}`}>
          {appeal.decision === 'reversed' ? t('notify.appealReversed') : appeal.decision ? t('notify.appealUpheld') : t('notify.appealPending', { d: date(appeal.at) })}
        </span>
      ) : d.appealable ? (
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => setAppealing(true)}>{t('notify.appeal')}</button>
      ) : null}
      {d.appealable && <AppealDialog actionId={d.id} open={appealing} onClose={() => setAppealing(false)} onDone={onAppealed} />}
    </li>
  );
}

function Decisions() {
  const { t, date } = useI18n();
  const { data, reload } = useLoad('/moderation/mine');
  if (!data || (!data.items?.length && !data.suspendedUntil)) return null;
  return (
    <section className="panel sf-set" id="decisions" aria-labelledby="sf-decisions-title">
      {data.suspendedUntil && (
        <p className="sf-banner" role="status">
          <Icon name="lock" size={16} />
          <span>{t('safety.suspendedBanner', { d: date(data.suspendedUntil) })}</span>
        </p>
      )}
      <h2 className="panel__title" id="sf-decisions-title"><Icon name="shield" /> {t('safety.decisionsTitle')}</h2>
      <p className="small muted">{t('safety.decisionsHint')}</p>
      {data.items.length > 0 && (
        <ul className="sf-decisions">
          {data.items.map((d) => <DecisionRow key={d.id} d={d} onAppealed={reload} />)}
        </ul>
      )}
    </section>
  );
}

// ---------- membres bloqués ----------

function BlockedMembers() {
  const { t, date, error } = useI18n();
  const toast = useToast();
  const { data, error: loadError, reload, setData } = useLoad('/blocks');
  const [busy, setBusy] = useState(null);

  const unblock = async (user) => {
    setBusy(user.id);
    try {
      await setBlocked(user.id, false);
      setData((d) => ({ ...d, items: d.items.filter((x) => x.user.id !== user.id) }));
      toast(t('safety.unblocked', { name: user.username }), 'success');
    } catch (ex) {
      toast(error(ex.code), 'error');
    } finally {
      setBusy(null);
    }
  };

  let body;
  if (loadError) body = <ErrorBox error={loadError} onRetry={reload} />;
  else if (!data) body = <div className="sf-panel-state"><Spinner /></div>;
  else if (!data.items.length) body = <p className="sf-empty small muted">{t('safety.blockedEmpty')}</p>;
  else {
    body = (
      <ul className="sf-rows">
        {data.items.map(({ user, blockedAt }) => (
          <li key={user.id} className="sf-row">
            <Avatar user={user} size={36} />
            <span className="sf-row__main">
              <strong className="sf-row__name">{user.username}</strong>
              <span className="small muted">{t('safety.blockedSince', { d: date(blockedAt) })}</span>
            </span>
            <button type="button" className="btn btn--ghost btn--xs" disabled={busy === user.id} onClick={() => unblock(user)}>
              {t('safety.unblockShort')}
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="panel sf-set" id="blocked" aria-labelledby="sf-blocked-title">
      <h2 className="panel__title" id="sf-blocked-title"><Icon name="lock" /> {t('safety.blockedTitle')}</h2>
      <p className="small muted">{t('safety.blockedHint')}</p>
      {body}
    </section>
  );
}

// ---------- sécurité du compte ----------

function AccountSecurity() {
  const { t, error } = useI18n();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const [form, setForm] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const change = async (e) => {
    e.preventDefault();
    if (busy) return;
    const invalid = validatePassword(form.next);
    if (!form.current) {
      setErr(error('password_missing'));
      return;
    }
    if (invalid) {
      setErr(error(invalid));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await post('/account/password', form);
      setForm({ current: '', next: '' });
      toast(t('account.changed', { n: res.revoked || 0 }), 'success');
    } catch (ex) {
      setErr(error(ex.code));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setRevoking(true);
    try {
      const res = await post('/account/sessions/revoke');
      toast(t('account.revoked', { n: res.revoked || 0 }), 'success');
    } catch (ex) {
      toast(error(ex.code), 'error');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <section className="panel sf-set" id="security" aria-labelledby="sf-security-title">
      <h2 className="panel__title" id="sf-security-title"><Icon name="shield" /> {t('safety.securityTitle')}</h2>
      <form className="sf-set__form" onSubmit={change}>
        <h3 className="sf-set__sub">{t('account.passwordTitle')}</h3>
        <div className="sf-set__fields">
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-current`}>{t('account.current')}</label>
            <input id={`${uid}-current`} className="input" type="password" autoComplete="current-password" value={form.current}
              onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-next`}>{t('account.next')}</label>
            <input id={`${uid}-next`} className="input" type="password" autoComplete="new-password" value={form.next}
              onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))} />
            <p className="field__hint">{t('account.nextHint')}</p>
          </div>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="sf-set__actions">
          <button type="submit" className="btn btn--ghost btn--sm" disabled={busy || !form.current || !form.next}>{t('account.change')}</button>
        </div>
      </form>
      <div className="sf-set__line">
        <div>
          <h3 className="sf-set__sub">{t('account.revokeTitle')}</h3>
          <p className="small muted">{t('account.revokeBody')}</p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={revoking} onClick={revoke}>{t('account.revoke')}</button>
      </div>
    </section>
  );
}

// ---------- export ----------

/** Fait télécharger un objet JSON sous ce nom de fichier. */
function download(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ExportData() {
  const { t, error } = useI18n();
  const { user } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const data = await get('/account/export');
      const day = new Date().toISOString().slice(0, 10);
      download(data, `albummania-${String(user?.username || 'export').replace(/[^\w.-]/g, '_')}-${day}.json`);
      toast(t('account.exported'), 'success');
    } catch (ex) {
      toast(ex.code === 'quota_exceeded' ? t('account.exportQuota') : error(ex.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel sf-set" id="export" aria-labelledby="sf-export-title">
      <h2 className="panel__title" id="sf-export-title"><Icon name="share" /> {t('account.exportTitle')}</h2>
      <p className="small muted">{t('account.exportBody')}</p>
      <div className="sf-set__actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={run}>
          {busy ? <Spinner /> : null}
          {busy ? t('account.exporting') : t('account.exportButton')}
        </button>
      </div>
    </section>
  );
}

// ---------- suppression du compte ----------

function DeleteAccount() {
  const { t, error } = useI18n();
  const { user, logout } = useGame();
  const toast = useToast();
  const navigate = useNavigate();
  const uid = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const name = user?.username || '';
  const ready = !!form.password && form.confirm.trim().toLowerCase() === name.toLowerCase();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setForm({ password: '', confirm: '' });
    setErr(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api('DELETE', '/account', { password: form.password, confirm: form.confirm.trim() });
      toast(t('account.deleted'), 'success');
      setOpen(false);
      await logout();
      navigate('/login', { replace: true });
    } catch (ex) {
      setErr(error(ex.code));
      setBusy(false);
    }
  };

  return (
    <section className="panel sf-set sf-set--danger" id="delete" aria-labelledby="sf-delete-title">
      <h2 className="panel__title" id="sf-delete-title"><Icon name="close" /> {t('account.deleteTitle')}</h2>
      <p className="small muted">{t('account.deleteBody')}</p>
      <div className="sf-set__actions">
        <button type="button" className="btn btn--ghost btn--sm sf-danger-btn" onClick={() => setOpen(true)}>{t('account.deleteButton')}</button>
      </div>
      <Modal open={open} onClose={close} title={t('account.deleteModal')} className="modal--narrow sf-dialog">
        <form className="sf-dialog__form" onSubmit={submit}>
          <p className="sf-banner sf-banner--danger"><Icon name="lock" size={16} /><span>{t('account.deleteWarn')}</span></p>
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-password`}>{t('account.password')}</label>
            <input id={`${uid}-password`} className="input" type="password" autoComplete="current-password" value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} data-autofocus />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${uid}-confirm`}>{t('account.confirm', { name })}</label>
            <input id={`${uid}-confirm`} className="input" autoComplete="off" spellCheck="false" autoCapitalize="none" value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
          </div>
          {err && <p className="form-error" role="alert">{err}</p>}
          <div className="modal__actions sf-dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn--danger" disabled={!ready || busy}>{t('account.deleteConfirm')}</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export function SafetySettings() {
  return (
    <div className="sf-settings">
      <Decisions />
      <BlockedMembers />
      <AccountSecurity />
      <ExportData />
      <DeleteAccount />
    </div>
  );
}

export default SafetySettings;
