// Pied de page — chantier P0-D (PLAN.md 7.1) : une seule ligne sur ordinateur (deux lignes courtes sur téléphone) :
// « Données et pochettes : Deezer · AlbumMania n'est affilié à aucun artiste, label ni plateforme · Mentions · CGU ·
// Confidentialité · Signaler ». Les plateformes viennent de GET /api/legal/info (public, en cache) : celles des
// pochettes réellement servies et du catalogue importé ; sans aucune, le pied de page dit que les visuels sont générés.
import { useI18n } from '../../i18n/index.jsx';
import { Logo } from '../ui.jsx';
import { useApi } from '../../state/catalog.js';
import { PROVIDER_NAMES } from '../../state/CoversContext.jsx';
import { LegalLinks } from './LegalLinks.jsx';
import '../../styles/shell.css';

export function Footer() {
  const { t } = useI18n();
  const info = useApi('/legal/info').data;
  const names = (info?.providers || []).map((p) => PROVIDER_NAMES[p] || p);
  return (
    <footer className="footer sh-footer">
      <Logo className="logo--sm" />
      <p className="sh-footer__line">
        <span className="sh-footer__part">{names.length ? t('footer.data', { p: names.join(' / ') }) : t('footer.generated')}</span>
        <span className="sh-footer__sep" aria-hidden="true"> · </span>
        <span className="sh-footer__part">{t('footer.notAffiliated')}</span>
        <span className="sh-footer__sep sh-footer__sep--links" aria-hidden="true"> · </span>
        <LegalLinks className="sh-footer__links" />
      </p>
      {__DEMO__ && <p className="footer__demo">{t('common.demoNote')}</p>}
    </footer>
  );
}

export default Footer;
