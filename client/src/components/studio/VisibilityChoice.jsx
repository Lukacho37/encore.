// Choix de la confidentialité du Studio (Public / Amis / Privé) — chantier P1-B (PLAN.md 2.5, 7.2). Partagé par
// l'éditeur du Studio et les Paramètres (StudioPrivacy). Props : { value, onChange(v), name, disabled }.
import { useI18n } from '../../i18n/index.jsx';
import { Icon } from '../ui.jsx';
import '../../styles/studio.css';

export const VISIBILITIES = ['public', 'friends', 'private'];
const ICONS = { public: 'globe', friends: 'users', private: 'lock' };

export function VisibilityChoice({ value, onChange, name = 'st-visibility', disabled = false }) {
  const { t } = useI18n();
  return (
    <div className="st-choices" role="radiogroup" aria-label={t('studio.privacy.label')}>
      {VISIBILITIES.map((v) => (
        <label key={v} className={`st-choice${value === v ? ' is-on' : ''}`} data-visibility={v}>
          <input type="radio" name={name} value={v} checked={value === v} disabled={disabled} onChange={() => onChange(v)} />
          <span className="st-choice__label"><Icon name={ICONS[v]} size={16} /> {t(`studio.privacy.options.${v}.label`)}</span>
          <span className="st-choice__hint">{t(`studio.privacy.options.${v}.hint`)}</span>
        </label>
      ))}
    </div>
  );
}

export default VisibilityChoice;
