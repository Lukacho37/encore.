// Bouton « Partager » — chantier P1-A (PLAN.md 2.3 : « Partager » sur les critiques, les listes et les albums complétés
// mène aux posts). Props : { path, title?, label? (texte à côté de l'icône), item?, preview?, onPosted?(post) }.
// - sans `item` : feuille de partage du système sur téléphone, sinon lien copié (« Lien copié ») ;
// - avec `item` ({ type: review | list | album | track | artist, id }) : petit menu « Publier dans le fil » (fenêtre avec
//   l'aperçu de ce qui est partagé et le compositeur : le post cite l'élément) · « Copier le lien ». Le post publié est
//   annoncé à la page (announcePosted) : le fil de l'accueil le met en tête sans recharger.
// `preview` : rendu de l'élément dans la fenêtre (par défaut sa carte de mention ; une critique passe la sienne).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/index.jsx';
import { Icon, Modal, useToast } from '../ui.jsx';
import { Composer } from './Composer.jsx';
import { MentionCard } from './MentionCard.jsx';
import { announcePosted, shareLink } from './util.js';
import '../../styles/social.css';

const SHAREABLE = ['review', 'list', 'album', 'track', 'artist'];
// Largeur du menu (px, .so-share__pop) : ouvert vers la gauche quand il sortirait de l'écran.
const MENU_WIDTH = 220;

/** Fenêtre « Publier dans le fil » : aperçu de l'élément, compositeur (texte facultatif, visibilité). */
function ShareToFeed({ item, preview, onClose, onPosted }) {
  const { t } = useI18n();
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    // La fenêtre place d'abord le focus sur son premier bouton : le champ le prend juste après.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setFocus(1));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return (
    <Modal open onClose={onClose} title={t('social.shareToFeedTitle')} className="so-share-modal">
      <div className="so-share__preview" data-share-preview={item.type}>
        {preview || (item.type === 'list' ? null : <MentionCard item={item} size="sm" linked={false} />)}
      </div>
      <Composer item={item} compact focusSignal={focus} placeholder={t('social.sharePlaceholder')}
        onPosted={(post) => {
          announcePosted(post);
          onPosted?.(post);
          onClose();
        }} />
      <p className="small muted so-share__hint">{t('social.shareHint')}</p>
    </Modal>
  );
}

export function ShareButton({ path, title, label = true, item = null, preview = null, onPosted }) {
  const { t } = useI18n();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [left, setLeft] = useState(false);
  const [dialog, setDialog] = useState(false);
  const ref = useRef(null);
  // Fermeture stable : la fenêtre ne replace pas le focus à chaque nouveau rendu de la carte.
  const closeDialog = useCallback(() => setDialog(false), []);
  const canPost = !!item && SHAREABLE.includes(item.type) && item.id != null && item.id !== '';

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setMenu(false);
    const onKey = (e) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const copy = async () => {
    setMenu(false);
    const done = await shareLink(path, title || t('social.shareText'));
    if (done === 'copied') toast(t('social.shareCopied'), 'success');
  };

  const toggle = () => {
    if (!canPost) {
      copy();
      return;
    }
    if (!menu) {
      // Ouvert à droite du bouton, sauf s'il sortirait de l'écran (bouton en bout de rangée, téléphone).
      const box = ref.current?.getBoundingClientRect();
      setLeft(!!box && box.left + MENU_WIDTH > window.innerWidth - 16);
    }
    setMenu((m) => !m);
  };

  const button = (
    <button type="button" className={`act-btn${menu ? ' is-on' : ''}`} onClick={toggle} aria-label={t('social.share')} title={t('social.share')}
      data-share={canPost ? item.type : 'link'} {...(canPost ? { 'aria-haspopup': 'menu', 'aria-expanded': menu } : {})}>
      <Icon name="share" size={18} />{label && <span>{t('social.share')}</span>}
    </button>
  );
  if (!canPost) return button;
  return (
    <span className="so-share" ref={ref}>
      {button}
      {menu && (
        <span className={`menu so-share__pop${left ? ' so-share__pop--left' : ''}`} role="menu">
          <button type="button" className="menu__item" role="menuitem" data-share-action="feed" onClick={() => { setMenu(false); setDialog(true); }}>
            <Icon name="edit" /> {t('social.shareToFeed')}
          </button>
          <button type="button" className="menu__item" role="menuitem" data-share-action="link" onClick={copy}>
            <Icon name="share" /> {t('social.shareCopy')}
          </button>
        </span>
      )}
      {dialog && <ShareToFeed item={item} preview={preview} onClose={closeDialog} onPosted={onPosted} />}
    </span>
  );
}

export default ShareButton;
