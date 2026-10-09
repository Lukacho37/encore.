// Page /report : formulaire public de signalement (DSA art. 16) — chantier P0-F (PLAN.md 2.1, 4.1.6, 7.1).
// Ouverte à tous : sans compte, la page a sa propre mise en page (logo, langue) ; connecté, elle s'affiche dans la coque
// du site avec le nom et l'adresse e-mail déjà remplis. `?url=` pré-remplit l'adresse du contenu.
// Envoie POST /api/public/report { name, email, url, reason, details, goodFaith, lang } ; un accusé de réception part
// par e-mail, puis la décision.
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n, LANGS } from '../i18n/index.jsx';
import { pageExists } from '../routes.jsx';
import { Icon, Logo } from '../components/ui.jsx';
import { REPORT_REASONS } from '../components/safety/ReportDialog.jsx';
import '../styles/safety.css';

function ReportForm() {
  const { t, error, lang } = useI18n();
  const { user } = useGame();
  const [params] = useSearchParams();
  const uid = useId().replace(/:/g, '');
  const [form, setForm] = useState(() => ({
    name: user?.username || '',
    email: user?.email || '',
    url: params.get('url') || '',
    reason: '',
    details: '',
    goodFaith: false,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const ready = form.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email) && form.url.trim() && form.reason
    && form.details.trim().length >= 10 && form.goodFaith;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await post('/public/report', { ...form, name: form.name.trim(), email: form.email.trim(), url: form.url.trim(), details: form.details.trim(), lang });
      setDone(form.email.trim());
    } catch (ex) {
      setErr({ message: error(ex.code), field: ex.data?.field });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <section className="panel sf-report-done" role="status">
        <span className="sf-report-done__icon" aria-hidden="true"><Icon name="check" size={22} /></span>
        <h2>{t('report.page.doneTitle')}</h2>
        <p>{t('report.page.doneBody', { email: done })}</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => {
          setDone(null);
          setForm((f) => ({ ...f, url: '', reason: '', details: '', goodFaith: false }));
        }}>{t('report.page.another')}</button>
      </section>
    );
  }

  const fieldClass = (k) => `field${err?.field === k ? ' field--error' : ''}`;
  return (
    <form className="panel sf-report-form" onSubmit={submit} noValidate>
      <div className="sf-report-form__row">
        <div className={fieldClass('name')}>
          <label className="field__label" htmlFor={`${uid}-name`}>{t('report.page.name')}</label>
          <input id={`${uid}-name`} className="input" autoComplete="name" maxLength={100} value={form.name} onChange={set('name')} required />
        </div>
        <div className={fieldClass('email')}>
          <label className="field__label" htmlFor={`${uid}-email`}>{t('report.page.email')}</label>
          <input id={`${uid}-email`} className="input" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={set('email')} required />
        </div>
      </div>
      <p className="field__hint sf-report-form__hint">{t('report.page.emailHint')}</p>
      <div className={fieldClass('url')}>
        <label className="field__label" htmlFor={`${uid}-url`}>{t('report.page.url')}</label>
        <input id={`${uid}-url`} className="input" inputMode="url" maxLength={500} value={form.url} onChange={set('url')} required
          placeholder="https://…/album/…#review-…" />
        <p className="field__hint">{t('report.page.urlHint')}</p>
      </div>
      <div className={fieldClass('reason')}>
        <label className="field__label" htmlFor={`${uid}-reason`}>{t('report.page.reason')}</label>
        <span className="select sf-select">
          <select id={`${uid}-reason`} value={form.reason} onChange={set('reason')} required>
            <option value="" disabled>{t('report.page.reasonPick')}</option>
            {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`report.reasons.${r}`)}</option>)}
          </select>
        </span>
      </div>
      <div className={fieldClass('details')}>
        <label className="field__label" htmlFor={`${uid}-details`}>{t('report.page.details')}</label>
        <textarea id={`${uid}-details`} className="input textarea" rows={5} maxLength={2000} value={form.details} onChange={set('details')} required />
        <p className="field__hint">{t('report.page.detailsHint')}</p>
      </div>
      <label className={`sf-check${err?.field === 'goodFaith' ? ' sf-check--error' : ''}`}>
        <input type="checkbox" checked={form.goodFaith} onChange={set('goodFaith')} />
        <span>{t('report.page.goodFaith')}</span>
      </label>
      {err && <p className="form-error" role="alert">{err.message}</p>}
      <div className="sf-report-form__actions">
        <button type="submit" className="btn btn--primary" disabled={!ready || busy}><Icon name="flag" size={16} /> {t('report.page.submit')}</button>
      </div>
      <p className="small muted sf-report-form__urgent">{t('report.page.urgent')}</p>
    </form>
  );
}

function Intro() {
  const { t } = useI18n();
  return (
    <header className="page-head sf-report-head">
      <div>
        <span className="eyebrow"><Icon name="flag" size={14} /> {t('report.page.kicker')}</span>
        <h1>{t('report.page.title')}</h1>
        <p className="muted">{t('report.page.intro')}</p>
      </div>
    </header>
  );
}

export default function Report() {
  const { status } = useGame();
  const { t, lang, setLang } = useI18n();
  if (status === 'ready') {
    return (
      <div className="sf-report">
        <Intro />
        <ReportForm />
      </div>
    );
  }
  // Sans compte : mise en page à part (pas de coque), comme les pages de connexion.
  return (
    <div className="sf-guest">
      <header className="sf-guest__bar">
        <Link to="/login" aria-label="AlbumMania"><Logo /></Link>
        <div className="seg" role="group" aria-label={t('nav.language')}>
          {LANGS.map((l) => (
            <button key={l.id} type="button" className={`seg__btn${lang === l.id ? ' is-on' : ''}`} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.label}</button>
          ))}
        </div>
      </header>
      <main className="sf-guest__main sf-report">
        <Intro />
        <ReportForm />
        <p className="sf-guest__links small">
          <Link to="/login" className="link-btn">{t('report.page.back')}</Link>
          {pageExists('Legal') && <Link to="/legal/rules" className="link-btn">{t('report.page.rules')}</Link>}
        </p>
      </main>
    </div>
  );
}
