// Page introuvable (adresse inconnue, ou page d'un chantier pas encore livrée : voir routes.jsx) — chantier P0-D.
// « Cette face n'existe pas » + une recherche (album, morceau, artiste) et deux sorties : les boosters, la collection.
import { Link } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { Icon } from '../components/ui.jsx';
import { SearchBox } from '../components/shell/SearchBox.jsx';
import '../styles/shell.css';

export default function NotFound() {
  const { t } = useI18n();
  const { status } = useGame();
  const player = status === 'ready';
  return (
    <div className="empty-page catalog-missing sh-404">
      <Icon name="disc" size={40} />
      <h1 className="catalog-missing__title">{t('shell.notFound.title')}</h1>
      <p>{t('shell.notFound.body')}</p>
      {player && (
        <>
          <p className="sh-404__label">{t('shell.notFound.searchLabel')}</p>
          <SearchBox />
        </>
      )}
      <div className="catalog-missing__actions">
        <Link to="/" className="btn btn--primary"><Icon name="pack" /> {t('shell.notFound.back')}</Link>
        {player && <Link to="/collection" className="btn btn--ghost"><Icon name="grid" /> {t('shell.notFound.collection')}</Link>}
      </div>
    </div>
  );
}
