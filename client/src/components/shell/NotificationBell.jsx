// Cloche des notifications — chantier P0-F (PLAN.md 9.2). Props : aucune ; montée par la coque (P0-D).
// Squelette posé par K0 (scripts/scaffold.mjs) : bouton cloche vers /friends avec le nombre de demandes d'ami en
// attente, en attendant la page /notifications et le menu déroulant de P0-F.
import { Link } from 'react-router';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';

export function NotificationBell() {
  const { pendingFriends } = useGame();
  const { t } = useI18n();
  return (
    <Link to="/friends" className="icon-btn bell" aria-label={t('nav.friends')} title={t('nav.friends')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
      </svg>
      {pendingFriends > 0 && <span className="count-badge">{pendingFriends}</span>}
    </Link>
  );
}

export default NotificationBell;
