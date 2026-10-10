// Paramètres — chantier P0-D (PLAN.md 2.5) : langue, échelle de notation, effets sonores, plateforme d'écoute
// préférée, lecteurs intégrés (« Toujours charger »), puis les emplacements des autres chantiers : membres bloqués,
// export et suppression du compte (SafetySettings, P0-F), confidentialité du Studio (StudioPrivacy, P1-B), profil
// musical (MusicProfileSettings, P1-E) ; enfin les liens légaux et la déconnexion. Ouverte depuis le menu du compte.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Icon, useToast } from '../components/ui.jsx';
import { ScaleSwitch } from '../components/Rating.jsx';
import { embedChoices, resetEmbedChoices } from '../components/ListenPanel.jsx';
import { LangSwitch, useSound } from '../components/shell/controls.jsx';
import { LEGAL_PAGES, hasReportPage } from '../components/shell/LegalLinks.jsx';
import { SafetySettings } from '../components/settings/SafetySettings.jsx';
import { StudioPrivacy } from '../components/settings/StudioPrivacy.jsx';
import { MusicProfileSettings } from '../components/settings/MusicProfileSettings.jsx';
import '../styles/shell.css';

// Plateformes proposées pour l'écoute (mêmes identifiants que users.prefs.listen côté serveur).
const PLATFORMS = [
  { id: 'deezer', name: 'Deezer' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'apple', name: 'Apple Music' },
];

function Row({ id, label, hint, children }) {
  return (
    <div className="sh-set__row">
      <div className="sh-set__label" id={id}>
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="sh-set__control">{children}</div>
    </div>
  );
}

function ListenChoice() {
  const { prefs } = useGame();
  const { t, error } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const current = prefs?.listen || 'deezer';
  const choose = async (listen) => {
    if (listen === current || busy) return;
    setBusy(true);
    try {
      await post('/profile/settings', { prefs: { listen } });
      toast(t('settings.saved'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="seg" role="group" aria-labelledby="set-listen">
      {PLATFORMS.map((p) => (
        <button key={p.id} type="button" className={`seg__btn seg__btn--wide${current === p.id ? ' is-on' : ''}`} aria-pressed={current === p.id}
          onClick={() => choose(p.id)} disabled={busy && current !== p.id}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

function EmbedsRow() {
  const { t } = useI18n();
  const toast = useToast();
  const [always, setAlways] = useState(() => embedChoices().deezer === 'always');
  const reset = () => {
    resetEmbedChoices();
    setAlways(false);
    toast(t('settings.embedsDone'), 'success');
  };
  return (
    <Row id="set-embeds" label={t('settings.embeds')} hint={always ? t('settings.embedsAlways') : t('settings.embedsAsk')}>
      {always && <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>{t('settings.embedsReset')}</button>}
    </Row>
  );
}

function SoundRow() {
  const { t } = useI18n();
  const [muted, toggle] = useSound();
  return (
    <Row id="set-sound" label={t('settings.sound')} hint={t('settings.soundHint')}>
      <button type="button" className="sh-set__switch" role="switch" aria-checked={!muted} aria-labelledby="set-sound" onClick={toggle}>
        <span className={`switch${muted ? '' : ' is-on'}`} aria-hidden="true" />
      </button>
    </Row>
  );
}

export default function Settings() {
  const { user, logout } = useGame();
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="sh-settings">
      <header className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          <p className="muted">{t('settings.intro')}</p>
        </div>
      </header>

      <section className="panel sh-set" aria-labelledby="set-display">
        <header className="sh-set__head"><h2 id="set-display" className="panel__title"><Icon name="globe" /> {t('settings.display')}</h2></header>
        <Row id="set-lang" label={t('settings.language')} hint={t('settings.languageHint')}>
          <LangSwitch />
        </Row>
        <Row id="set-scale" label={t('settings.scale')} hint={t('settings.scaleHint')}>
          <ScaleSwitch />
        </Row>
        <SoundRow />
      </section>

      <section className="panel sh-set" aria-labelledby="set-listening">
        <header className="sh-set__head"><h2 id="set-listening" className="panel__title"><Icon name="headphones" /> {t('settings.listening')}</h2></header>
        <Row id="set-listen" label={t('settings.listen')} hint={t('settings.listenHint')}>
          <ListenChoice />
        </Row>
        <EmbedsRow />
      </section>

      {/* Emplacements des autres chantiers (rien tant qu'ils ne sont pas livrés). */}
      <SafetySettings />
      <StudioPrivacy />
      <MusicProfileSettings />

      <section className="panel sh-set" aria-labelledby="set-legal">
        <header className="sh-set__head">
          <h2 id="set-legal" className="panel__title"><Icon name="flag" /> {t('settings.legal')}</h2>
          <p>{t('settings.legalHint')}</p>
        </header>
        <ul className="sh-set__links">
          {LEGAL_PAGES.map((p) => (
            <li key={p}><Link to={`/legal/${p}`}>{t(`legal.pages.${p}.title`)} <Icon name="chevron" size={16} /></Link></li>
          ))}
          {hasReportPage && <li><Link to="/report">{t('settings.report')} <Icon name="chevron" size={16} /></Link></li>}
        </ul>
      </section>

      <section className="panel sh-set" aria-labelledby="set-account">
        <header className="sh-set__head"><h2 id="set-account" className="panel__title"><Icon name="user" /> {t('settings.account')}</h2></header>
        <Row id="set-who" label={t('settings.signedAs', { name: user.username })} hint={user.email || null}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await logout(); navigate('/login'); }}>
            <Icon name="logout" /> {t('settings.logout')}
          </button>
        </Row>
      </section>
    </div>
  );
}
