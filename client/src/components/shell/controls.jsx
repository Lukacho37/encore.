// Petites commandes de la coquille (chantier P0-D), partagées par la barre du haut, le menu du compte et la page
// Paramètres : sélecteur de langue FR/EN, effets sonores (bouton et interrupteur), icône des paramètres.
import { useEffect, useState } from 'react';
import { useI18n, LANGS } from '../../i18n/index.jsx';
import { Icon } from '../ui.jsx';
import { sound } from '../../sound.js';

/** État des effets sonores : [coupés ?, basculer]. */
export function useSound() {
  const [muted, setMuted] = useState(sound.isMuted());
  useEffect(() => sound.subscribe(setMuted), []);
  return [muted, () => sound.setMuted(!muted)];
}

/** Sélecteur FR/EN (segments, Martian Mono) : change la langue du site et, par GameContext, celle du compte. */
export function LangSwitch({ className = '' }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`seg ${className}`} role="group" aria-label={t('nav.language')}>
      {LANGS.map((l) => (
        <button key={l.id} type="button" className={`seg__btn${lang === l.id ? ' is-on' : ''}`} aria-pressed={lang === l.id} onClick={() => setLang(l.id)} title={l.name}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Bouton rond du son (barre du haut, grand écran). */
export function SoundButton({ className = '' }) {
  const { t } = useI18n();
  const [muted, toggle] = useSound();
  const label = muted ? t('header.soundOff') : t('header.soundOn');
  return (
    <button type="button" className={`icon-btn ${className}`} onClick={toggle} aria-label={label} title={label}>
      <Icon name={muted ? 'mute' : 'sound'} />
    </button>
  );
}

/** Interrupteur du son (menu du compte, Paramètres). */
export function SoundSwitch({ className = 'menu__item', role = 'menuitemcheckbox', label }) {
  const { t } = useI18n();
  const [muted, toggle] = useSound();
  return (
    <button type="button" className={className} role={role} aria-checked={!muted} onClick={toggle}>
      <Icon name={muted ? 'mute' : 'sound'} /> {label ?? t('nav.sound')}
      <span className={`switch${muted ? '' : ' is-on'}`} aria-hidden="true" />
    </button>
  );
}

/** Roue dentée des paramètres (absente du jeu d'icônes commun). */
export function GearIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
