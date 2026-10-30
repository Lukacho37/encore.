// Bouton « Presser · Gratuit » d'une carte manquante, pour l'admin seulement (usePressCost) : les joueurs n'achètent
// jamais une carte précise. Props : { track: { id, rarity }, onPress(trackId) } ; ne rend rien pour un joueur.
// La grille décide de l'afficher seulement pour une carte manquante.
//   {!mine && onPress && <PressButton track={tr} onPress={onPress} />}
import { Icon } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { usePressCost } from './press.js';

export function PressButton({ track, onPress }) {
  const { t } = useI18n();
  const { cost } = usePressCost(track);
  if (!track || cost == null || !onPress) return null;
  return (
    <button type="button" className="press-btn press-btn--free" onClick={() => onPress(track.id)}>
      <Icon name="press" size={14} />
      {/* Sur un écran étroit, le libellé se raccourcit mais « Gratuit » reste lisible. */}
      <span className="press-btn__label">{t('album.press')} ·</span>
      <span className="press-btn__cost">{t('album.pressFreeShort')}</span>
    </button>
  );
}

export default PressButton;
