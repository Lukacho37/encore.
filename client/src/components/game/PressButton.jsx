// Bouton « Presser · N » d'une carte manquante — chantier P1-D (PLAN.md 6.4). Même rendu que celui des grilles de
// cartes (classes press-btn de la page d'album), mais le coût vient de usePressCost : une promo devient pressable
// (1 200 royalties) dès qu'un album de son artiste est complété, ce que seul le serveur sait.
// Props : { track: { id, rarity }, onPress(trackId) }. Ne rend rien si la carte n'est pas pressable (promo verrouillée,
// coût en cours de chargement) ; la grille décide de l'afficher seulement pour une carte manquante.
//   {!mine && onPress && <PressButton track={tr} onPress={onPress} />}
import { Icon } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { usePressCost } from './press.js';

export function PressButton({ track, onPress }) {
  const { t } = useI18n();
  const { isAdmin } = useGame();
  const { cost } = usePressCost(track);
  if (!track || cost == null || !onPress) return null;
  return (
    <button type="button" className={`press-btn${isAdmin ? ' press-btn--free' : ''}`} onClick={() => onPress(track.id)}>
      <Icon name="press" size={14} />
      {/* Sur un écran étroit, le libellé se raccourcit mais le prix reste lisible. */}
      <span className="press-btn__label">{t('album.press')} ·</span>
      <span className="press-btn__cost">{isAdmin ? t('album.pressFreeShort') : <span className="mono">{cost}</span>}</span>
    </button>
  );
}

export default PressButton;
