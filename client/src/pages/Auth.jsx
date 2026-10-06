import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { get, post } from '../api.js';
import { useI18n, LANGS } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { Icon, Logo, Spinner, useToast } from '../components/ui.jsx';
import Card, { CardBack } from '../components/Card.jsx';
import { validateUsername, PASSWORD_MIN } from '@shared/rules.js';
import { PROVIDER_NAMES, useCovers } from '../state/CoversContext.jsx';
import { requestTracks, useTracks } from '../state/catalog.js';

// Éventail de l'écran de connexion : trois cartes du catalogue, lisibles sans compte (GET /api/catalog/tracks).
const FAN = [
  { trackId: 'the-college-dropout:07', seed: 'the-college-dropout', back: 'legendary' },
  { trackId: 'promo:hey-jude', seed: 'promo:hey-jude', variant: 'holo', back: 'promo' },
  { trackId: 'discovery:01', seed: 'discovery', back: 'ultra' },
];
const FAN_IDS = FAN.map((c) => c.trackId);
// Au-delà de ce délai sans les cartes (réseau lent, serveur injoignable), l'éventail montre leur dos.
const FAN_WAIT = 1200;

/**
 * Cartes demandées dès l'affichage de la page. Pendant le chargement, l'emplacement reste vide (sa hauteur est
 * gardée) ; si les cartes n'arrivent pas, on montre leur dos plutôt que des cartes vides.
 * Renvoie true quand les vraies cartes sont affichées.
 */
function useFan() {
  const tracks = useTracks(FAN_IDS);
  const ready = tracks.every(Boolean);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let alive = true;
    const settle = () => {
      if (alive) setSettled(true);
    };
    requestTracks(FAN_IDS).then(settle);
    const timer = setTimeout(settle, FAN_WAIT);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return { ready, backs: !ready && settled };
}

function AuthLayout({ children }) {
  const { t, lang, setLang } = useI18n();
  const covers = useCovers();
  const fan = useFan();
  // Crédit des pochettes affichées : seulement quand les vraies cartes sont là.
  const shown = fan.ready ? FAN.map((c) => covers.items[c.seed]).filter(Boolean) : [];
  const sources = shown.filter((item, i) => shown.findIndex((x) => x.provider === item.provider) === i);
  return (
    <div className="auth">
      <aside className="auth__stage">
        <Link to="/login" className="auth__logo" aria-label="AlbumMania"><Logo className="logo--lg" /></Link>
        <div className="auth__fan" aria-hidden="true">
          {FAN.map((c, i) => {
            const className = `auth__fan-card auth__fan-card--${i + 1}`;
            if (fan.ready) return <Card key={c.trackId} trackId={c.trackId} variant={c.variant} className={className} />;
            return fan.backs ? <CardBack key={c.trackId} rarity={c.back} className={className} /> : null;
          })}
        </div>
        {sources.length > 0 && (
          <p className="auth__credit small muted">
            {t('covers.creditMany')}{' '}
            {sources.map((item, i) => (
              <span key={item.provider}>
                {i > 0 && ' / '}
                <a href={item.url} target="_blank" rel="noreferrer noopener">{PROVIDER_NAMES[item.provider]}</a>
              </span>
            ))}
          </p>
        )}
        <h1 className="auth__tagline">{t('auth.tagline')}</h1>
        <ul className="auth__pitch">
          {t('auth.pitch').map((line) => <li key={line}>{line}</li>)}
        </ul>
      </aside>
      <section className="auth__panel">
        <div className="auth__lang seg" role="group" aria-label={t('nav.language')}>
          {LANGS.map((l) => (
            <button key={l.id} type="button" className={`seg__btn${lang === l.id ? ' is-on' : ''}`} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.label}</button>
          ))}
        </div>
        <div className="auth__form-wrap">
          {__DEMO__ && (
            <p className="demo-banner"><strong>{t('common.demo')}</strong> · {t('auth.demoHint')}</p>
          )}
          {children}
        </div>
      </section>
    </div>
  );
}

function Field({ id, label, hint, error, children, status }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id} className="field__label">
        {label}
        {status}
      </label>
      {children}
      {error ? <p className="field__error" role="alert">{error}</p> : hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

function FormError({ code, children }) {
  const { error } = useI18n();
  if (!code) return null;
  return (
    <div className="form-error" role="alert">
      <span>{error(code)}</span>
      {children}
    </div>
  );
}

export function Login() {
  const { t } = useI18n();
  const { applyState } = useGame();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const state = await post('/auth/login', { identifier, password });
      applyState(state);
      navigate('/');
    } catch (error) {
      setErr(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="auth__form" onSubmit={submit} noValidate>
        <h2>{t('auth.login.title')}</h2>
        <FormError code={err?.code}>
          {err?.code === 'email_unverified' && (
            <button type="button" className="link-btn" onClick={() => navigate('/check-email', { state: { email: err.data.email, resend: true } })}>
              {t('auth.login.resend')}
            </button>
          )}
        </FormError>
        <Field id="login-id" label={t('auth.login.identifier')}>
          <input id="login-id" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
        </Field>
        <Field id="login-pw" label={t('auth.login.password')}>
          <input id="login-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Link to="/forgot" className="auth__aside-link">{t('auth.login.forgot')}</Link>
        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !identifier || !password}>
          {busy ? <Spinner /> : t('auth.login.submit')}
        </button>
        <p className="auth__switch">{t('auth.login.noAccount')} <Link to="/signup">{t('auth.login.signup')}</Link></p>
      </form>
    </AuthLayout>
  );
}

function useUsernameCheck(username) {
  const [state, setState] = useState({ status: 'idle' });
  useEffect(() => {
    if (!username) return setState({ status: 'idle' });
    const local = validateUsername(username);
    if (local) return setState({ status: 'invalid', reason: local });
    setState({ status: 'checking' });
    const id = setTimeout(async () => {
      try {
        const res = await get(`/auth/username-available?u=${encodeURIComponent(username)}`);
        setState(res.available ? { status: 'ok' } : { status: 'invalid', reason: res.reason });
      } catch {
        setState({ status: 'idle' });
      }
    }, 350);
    return () => clearTimeout(id);
  }, [username]);
  return state;
}

export function Signup() {
  const { t, error, lang } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', password: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({});
  const check = useUsernameCheck(form.username.trim());
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const touch = (k) => () => setTouched((x) => ({ ...x, [k]: true }));

  const mismatch = touched.confirm && form.confirm && form.confirm !== form.password;
  const shortPw = touched.password && form.password && form.password.length < PASSWORD_MIN;
  const canSubmit = form.email && form.username && form.password.length >= PASSWORD_MIN && form.password === form.confirm && check.status !== 'invalid';

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setErr({ code: 'password_mismatch' });
    setBusy(true);
    setErr(null);
    try {
      const res = await post('/auth/signup', { email: form.email, username: form.username.trim(), password: form.password, lang });
      navigate('/check-email', { state: { email: res.email, devMailbox: res.devMailbox, demoEmail: res.demoEmail } });
    } catch (error2) {
      setErr(error2);
    } finally {
      setBusy(false);
    }
  };

  const usernameStatus = check.status === 'ok' ? <span className="field__ok"><Icon name="check" size={14} /> {t('auth.signup.available')}</span>
    : check.status === 'checking' ? <span className="field__pending">{t('auth.signup.checking')}</span> : null;

  return (
    <AuthLayout>
      <form className="auth__form" onSubmit={submit} noValidate>
        <h2>{t('auth.signup.title')}</h2>
        <FormError code={err?.code} />
        <Field id="su-email" label={t('auth.signup.email')}>
          <input id="su-email" className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} required autoFocus />
        </Field>
        <Field id="su-user" label={t('auth.signup.username')} status={usernameStatus}
          error={check.status === 'invalid' ? error(check.reason) : null} hint={t('auth.signup.usernameHint')}>
          <input id="su-user" className="input" autoComplete="username" value={form.username} onChange={set('username')} maxLength={20} required spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field id="su-pw" label={t('auth.signup.password')} hint={t('auth.signup.passwordHint')} error={shortPw ? error('password_short') : null}>
          <input id="su-pw" className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} onBlur={touch('password')} required />
        </Field>
        <Field id="su-confirm" label={t('auth.signup.confirm')} error={mismatch ? error('password_mismatch') : null}>
          <input id="su-confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} onBlur={touch('confirm')} required />
        </Field>
        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !canSubmit}>
          {busy ? <Spinner /> : t('auth.signup.submit')}
        </button>
        <p className="auth__switch">{t('auth.signup.hasAccount')} <Link to="/login">{t('auth.signup.login')}</Link></p>
      </form>
    </AuthLayout>
  );
}

function DemoEmail({ email }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (!email) return null;
  return (
    <div className="demo-mail">
      <p className="muted small">{t('auth.check.demoBody')}</p>
      <div className="demo-mail__msg">
        <div className="demo-mail__subject"><Icon name="mail" size={16} /> {email.subject}</div>
        <p>{email.text}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate(email.path)}>{email.cta}</button>
      </div>
    </div>
  );
}

export function CheckEmail() {
  const { t, error } = useI18n();
  const location = useLocation();
  const toast = useToast();
  const { email, devMailbox: dev0, demoEmail: demo0, resend } = location.state || {};
  const [cooldown, setCooldown] = useState(resend ? 0 : 60);
  const [devMailbox, setDevMailbox] = useState(dev0);
  const [demoEmail, setDemoEmail] = useState(demo0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const doResend = async () => {
    try {
      const res = await post('/auth/resend', { email });
      setDevMailbox(res.devMailbox);
      if (res.demoEmail) setDemoEmail(res.demoEmail);
      toast(t('auth.check.resent'), 'success');
      setCooldown(60);
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  return (
    <AuthLayout>
      <div className="auth__form">
        <span className="auth__icon"><Icon name="mail" size={28} /></span>
        <h2>{t('auth.check.title')}</h2>
        <p>{t('auth.check.body', { email: email || '…' })}</p>
        <p className="muted small">{t('auth.check.spam')}</p>
        {email && (
          <button type="button" className="btn btn--ghost btn--block" onClick={doResend} disabled={cooldown > 0}>
            {cooldown > 0 ? t('auth.check.wait', { s: cooldown }) : t('auth.check.resend')}
          </button>
        )}
        {devMailbox && (
          <div className="dev-note">
            <strong>{t('auth.check.devTitle')}</strong>
            <p className="small">{t('auth.check.devBody')}</p>
            <Link to="/dev/mailbox" className="btn btn--sm btn--ghost">{t('auth.check.devOpen')}</Link>
          </div>
        )}
        <DemoEmail email={demoEmail} />
        <Link to="/login" className="auth__aside-link">{t('auth.check.back')}</Link>
      </div>
    </AuthLayout>
  );
}

// Un jeton ne sert qu'une fois : on mémorise la requête pour éviter un double appel (StrictMode),
// et on ne traite le succès qu'une fois même si la page est remontée après la connexion.
const tokenRequests = new Map();
const handledTokens = new Set();

function useTokenAction(path, token, enabled = true) {
  const [state, setState] = useState({ status: token ? 'loading' : 'missing' });
  useEffect(() => {
    if (!token || !enabled) return;
    if (!tokenRequests.has(token)) tokenRequests.set(token, post(path, { token }));
    tokenRequests.get(token).then(
      (res) => setState({ status: 'ok', res }),
      (err) => setState({ status: 'error', err }),
    );
  }, [path, token, enabled]);
  return state;
}

export function Verify() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const { applyState } = useGame();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get('token');
  const first = useTokenAction('/auth/verify', token);
  const [withPassword, setWithPassword] = useState(null);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState(null);
  const [busy, setBusy] = useState(false);
  const state = withPassword || first;
  // Lien ouvert sur un autre appareil que celui de l'inscription : le serveur demande le mot de passe.
  const needsPassword = first.status === 'error' && first.err?.code === 'password_required' && !withPassword;

  useEffect(() => {
    if (state.status !== 'ok') return;
    if (!handledTokens.has(token)) {
      handledTokens.add(token);
      toast(t('auth.verify.welcome'), 'success');
      applyState(state.res);
    }
    navigate('/', { replace: true });
  }, [state, token, applyState, navigate, toast, t]);

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setPwError(null);
    try {
      setWithPassword({ status: 'ok', res: await post('/auth/verify', { token, password }) });
    } catch (err) {
      if (err.code === 'invalid_token') setWithPassword({ status: 'error', err });
      else setPwError(err.code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth__form">
        {needsPassword ? (
          <form className="auth__form" onSubmit={submitPassword}>
            <h2>{t('auth.verify.passwordTitle')}</h2>
            <p className="muted">{t('auth.verify.passwordBody')}</p>
            <FormError code={pwError} />
            <Field id="verify-pw" label={t('auth.login.password')}>
              <input id="verify-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </Field>
            <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !password}>
              {busy ? <Spinner /> : t('auth.verify.passwordSubmit')}
            </button>
          </form>
        ) : state.status === 'loading' || state.status === 'ok' ? (
          <p className="auth__loading"><Spinner /> {t('auth.verify.loading')}</p>
        ) : (
          <>
            <h2>{t('auth.check.title')}</h2>
            <div className="form-error" role="alert">{t('auth.verify.fail')}</div>
            <p className="muted">{t('auth.verify.resendHint')}</p>
            <Link to="/login" className="btn btn--primary btn--block">{t('auth.login.submit')}</Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

export function Forgot() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      setSent(await post('/auth/forgot', { email }));
    } catch (error) {
      setErr(error);
    }
  };
  return (
    <AuthLayout>
      <form className="auth__form" onSubmit={submit}>
        <h2>{t('auth.forgot.title')}</h2>
        {sent ? (
          <>
            <div className="form-ok" role="status">{t('auth.forgot.sent')}</div>
            {sent.devMailbox && <Link to="/dev/mailbox" className="btn btn--sm btn--ghost">{t('auth.check.devOpen')}</Link>}
            <DemoEmail email={sent.demoEmail} />
          </>
        ) : (
          <>
            <p className="muted">{t('auth.forgot.body')}</p>
            <FormError code={err?.code} />
            <Field id="fg-email" label={t('auth.signup.email')}>
              <input id="fg-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={!email}>{t('auth.forgot.submit')}</button>
          </>
        )}
        <Link to="/login" className="auth__aside-link">{t('auth.check.back')}</Link>
      </form>
    </AuthLayout>
  );
}

export function Reset() {
  const { t, error } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { applyState } = useGame();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setErr({ code: 'password_mismatch' });
    setBusy(true);
    setErr(null);
    try {
      const state = await post('/auth/reset', { token, password });
      toast(t('auth.reset.done'), 'success');
      applyState(state);
      navigate('/', { replace: true });
    } catch (error2) {
      setErr(error2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form className="auth__form" onSubmit={submit}>
        <h2>{t('auth.reset.title')}</h2>
        {!token ? (
          <div className="form-error">{t('auth.reset.missing')}</div>
        ) : (
          <>
            <FormError code={err?.code} />
            <Field id="rs-pw" label={t('auth.signup.password')} hint={t('auth.signup.passwordHint')}>
              <input id="rs-pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </Field>
            <Field id="rs-confirm" label={t('auth.signup.confirm')} error={confirm && confirm !== password ? error('password_mismatch') : null}>
              <input id="rs-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </Field>
            <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || password.length < PASSWORD_MIN || password !== confirm}>
              {t('auth.reset.submit')}
            </button>
          </>
        )}
        <Link to="/login" className="auth__aside-link">{t('auth.check.back')}</Link>
      </form>
    </AuthLayout>
  );
}
