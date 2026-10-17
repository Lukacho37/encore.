// Page /badges — chantier P1-F (PLAN.md 2.5 Badges, 5.7). Les médailles du joueur par rubrique : gagnées (avec la
// date, au meilleur palier : bronze, argent, or, platine holo) ou à gagner (verrouillées, avec la progression « 7/10 »
// du prochain palier) ; un clic ouvre le détail des paliers. Lien vers les quêtes.
import { Link } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../state/catalog.js';
import { Icon } from '../components/ui.jsx';
import { BadgeGrid } from '../components/play/slots.jsx';
import '../styles/play.css';

export default function Badges() {
  const { t } = useI18n();
  // Même adresse que la grille : la réponse est partagée (une seule requête).
  const { data } = useApi('/badges', { keep: false });
  return (
    <div className="pl-page" data-page="badges">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('badges.kicker')}</span>
          <h1>{t('badges.title')}</h1>
          <p className="pl-page__intro">{t('badges.intro')}</p>
        </div>
        <div className="pl-modes">
          {data && <span className="chip chip--gold" data-count={data.earned}>{t('badges.count', { n: data.earned, total: data.total })}</span>}
          <Link to="/quests" className="btn btn--ghost btn--sm"><Icon name="flag" size={16} /> {t('quests.title')}</Link>
        </div>
      </header>
      <BadgeGrid />
    </div>
  );
}
