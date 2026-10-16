// Bouton « Partager » d'une adresse du site — chantier P1-A : feuille de partage du système sur téléphone, sinon lien
// copié dans le presse-papiers (message « Lien copié »). Props : { path, title?, label? (texte à côté de l'icône) }.
import { useI18n } from '../../i18n/index.jsx';
import { Icon, useToast } from '../ui.jsx';
import { shareLink } from './util.js';
import '../../styles/social.css';

export function ShareButton({ path, title, label = true }) {
  const { t } = useI18n();
  const toast = useToast();
  const share = async () => {
    const done = await shareLink(path, title || t('social.shareText'));
    if (done === 'copied') toast(t('social.shareCopied'), 'success');
  };
  return (
    <button type="button" className="act-btn" onClick={share} aria-label={t('social.share')} title={t('social.share')}>
      <Icon name="share" size={18} />{label && <span>{t('social.share')}</span>}
    </button>
  );
}

export default ShareButton;
