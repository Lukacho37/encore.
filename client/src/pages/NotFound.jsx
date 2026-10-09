// Page introuvable (adresse inconnue, ou page d'un chantier pas encore livrée : voir routes.jsx).
// Version minimale posée par K0 ; P0-D y ajoute la recherche (PLAN.md 2.1).
import { Link } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { Icon } from '../components/ui.jsx';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="empty-page catalog-missing">
      <Icon name="disc" size={40} />
      <h1 className="catalog-missing__title">{t('shell.notFound.title')}</h1>
      <p>{t('shell.notFound.body')}</p>
      <div className="catalog-missing__actions">
        <Link to="/" className="btn btn--primary"><Icon name="pack" /> {t('shell.notFound.back')}</Link>
      </div>
    </div>
  );
}
