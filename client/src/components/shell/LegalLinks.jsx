// Liens légaux (Mentions · CGU · Confidentialité · Signaler) — chantier P0-D (PLAN.md 7.1). Utilisés par le pied de
// page, l'écran de connexion et les Paramètres ; ouverts à tous, même sans compte (routes /legal/:page et /report).
import { Fragment } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';

// Formulaire public de signalement (P0-F) : le lien n'apparaît que si sa page existe (même règle que routes.jsx).
const REPORT_PAGE = import.meta.glob('../../pages/Report.jsx');
export const hasReportPage = Object.keys(REPORT_PAGE).length > 0;

/** Les cinq pages légales, dans l'ordre des onglets de /legal/:page. */
export const LEGAL_PAGES = ['mentions', 'terms', 'privacy', 'rules', 'cookies'];

/**
 * `pages` : pages à lister (défaut : celles du pied de page) ; `report` : ajoute « Signaler » ; `sep` : séparateur
 * affiché entre deux liens ; `newTab` : ouvre dans un nouvel onglet (formulaire d'inscription en cours).
 */
export function LegalLinks({ pages = ['mentions', 'terms', 'privacy'], report = true, sep = ' · ', newTab = false, className = '' }) {
  const { t } = useI18n();
  const target = newTab ? { target: '_blank', rel: 'noopener' } : {};
  const items = pages.map((p) => ({ to: `/legal/${p}`, label: t(`footer.links.${p}`) }));
  if (report && hasReportPage) items.push({ to: '/report', label: t('footer.links.report') });
  return (
    <span className={className}>
      {items.map((it, i) => (
        <Fragment key={it.to}>
          {i > 0 && <span aria-hidden="true">{sep}</span>}
          <Link to={it.to} {...target}>{it.label}</Link>
        </Fragment>
      ))}
    </span>
  );
}

export default LegalLinks;
