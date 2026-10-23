// Puce « AlbumMania Rétro » de l'accueil — chantier P2-A (PLAN.md 2.3, 2.5 point 4, 8.3 P2.2). Montée par P2-B dans la
// rangée de puces sous le héros et sa rangée (Home.jsx) : <RetroChip />. Elle ne s'affiche qu'en décembre et en
// janvier (heure de Paris) et mène au Rétro de l'année : celle en cours en décembre, la précédente en janvier ; rien
// pour un compte créé après cette année-là. Même allure que les puces de quêtes et d'événement (.quest-chip de P1-F).
// Exporte aussi isRetroSeason(now) et retroYear(now) (components/passport/format.js).
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { parisDate } from '@shared/periods.js';
import { isRetroSeason, retroYear } from './format.js';
import '../../styles/play.css';
import '../../styles/passport.css';

export { isRetroSeason, retroYear };

export function RetroChip({ now = Date.now() }) {
  const { t } = useI18n();
  const { user } = useGame();
  if (!isRetroSeason(now)) return null;
  const year = retroYear(now);
  if (user?.createdAt && parisDate(user.createdAt).y > year) return null;
  return (
    <Link to={`/retro/${year}`} className="quest-chip quest-chip--event pp-retro-chip" data-chip="retro">
      <span className="quest-chip__dot" aria-hidden="true" />
      <span className="quest-chip__label">{t('retro.chip.label', { year: String(year) })}</span>
      <span className="quest-chip__task">{t('retro.chip.body')}</span>
    </Link>
  );
}

export default RetroChip;
