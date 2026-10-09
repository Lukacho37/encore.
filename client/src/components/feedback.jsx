// États d'attente, de vide et d'erreur partagés — chantier P0-B (PLAN.md 9.2). Les props sont le contrat :
//   <EmptyState icon title body action />       liste vide, avec une prochaine action (lien ou bouton) ;
//   <ErrorBox error onRetry />                   chargement raté, avec « Réessayer » ;
//   <LoadMore hasMore loading onClick />         « Voir plus » en bas d'une liste (options : remaining, error, onRetry,
//                                                capped, auto : chargement automatique à l'approche du bas de page) ;
//   <Skeleton kind="tile"|"row"|"card" count />  emplacements de chargement (même reflet que les cartes).
// Rendu de l'existant : boîte en pointillés (.empty), bouton fantôme centré, reflet des cartes (styles dans app.css).
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Icon, Spinner } from './ui.jsx';
import { AlbumTileSkeleton } from './AlbumTile.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * Prochaine action d'un état vide : un élément React tel quel, ou { label, to?, onClick?, icon?, primary? }
 * (bouton pilule ivoire par défaut, fantôme avec primary: false).
 */
function Action({ action }) {
  if (!action) return null;
  if (!action.label) return action;
  const cls = `btn ${action.primary === false ? 'btn--ghost' : 'btn--primary'} btn--sm`;
  const inner = <>{action.icon && <Icon name={action.icon} size={16} />}{action.label}</>;
  return action.to
    ? <Link to={action.to} className={cls}>{inner}</Link>
    : <button type="button" className={cls} onClick={action.onClick}>{inner}</button>;
}

/** Liste vide : icône, titre, texte et une prochaine action (toujours en proposer une). */
export function EmptyState({ icon, title, body, action, className = '' }) {
  return (
    <div className={`empty empty-state ${className}`}>
      {icon && <span className="empty-state__icon" aria-hidden="true"><Icon name={icon} size={22} /></span>}
      {title && <p className="empty-state__title">{title}</p>}
      {body && <p className="empty-state__body">{body}</p>}
      <Action action={action} />
    </div>
  );
}

/** Chargement raté : message (code d'erreur traduit quand il est connu) et « Réessayer ». */
export function ErrorBox({ error, onRetry, className = '' }) {
  const { t, error: errorText } = useI18n();
  const code = error?.code;
  // Un code connu (« compte suspendu »…) a son message ; les erreurs réseau, serveur ou inconnues gardent le message
  // générique, qui dit quoi faire.
  const known = code && !['network', 'server_error'].includes(code) ? errorText(code) : null;
  const message = known && known !== errorText('server_error') ? known : t('feedback.loadError');
  return (
    <div className={`empty empty-state ${className}`} role="alert">
      <p className="empty-state__body">{message}</p>
      {onRetry && <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>{t('feedback.retry')}</button>}
    </div>
  );
}

/**
 * « Voir plus » en bas d'une liste. `remaining` ajoute « · N restants » ; `capped` remplace le bouton par « affine ta
 * recherche » ; `error` (page suivante ratée) affiche le message et `onRetry`. `auto` : charge aussi tout seul quand le
 * bouton approche de l'écran (le bouton reste pour le clavier et quand l'observateur manque).
 */
export function LoadMore({ hasMore, loading = false, onClick, remaining, capped = false, error, onRetry, auto = false, label }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const handler = useRef(onClick);
  useEffect(() => {
    handler.current = onClick;
  });
  useEffect(() => {
    const el = ref.current;
    if (!auto || !el || !hasMore || loading || error || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) handler.current?.();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [auto, hasMore, loading, error]);
  if (error) {
    return (
      <div className="load-more" role="alert">
        <span className="muted small">{t('feedback.loadError')}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry || onClick}>{t('feedback.retry')}</button>
      </div>
    );
  }
  if (capped) return <p className="load-more muted small">{t('feedback.refine')}</p>;
  if (!hasMore) return null;
  return (
    <div className="load-more" ref={ref}>
      <button type="button" className="btn btn--ghost" onClick={onClick} disabled={loading}>
        {loading ? <Spinner /> : <Icon name="plus" size={16} />}
        {label || t('feedback.loadMore')}
        {remaining > 0 && <span className="load-more__n">· {t('feedback.remaining', { n: remaining })}</span>}
      </button>
    </div>
  );
}

const TILE = (i) => <AlbumTileSkeleton key={i} />;
const CARD = (i) => <div key={i} className="card-cell"><span className="card card--loading" aria-hidden="true" /></div>;
const ROW = (i) => <div key={i} className="skel-row" aria-hidden="true" />;

/**
 * Emplacements de chargement : `count` vignettes d'album (`tile`), cartes (`card`, dans leur case) ou lignes (`row`).
 * Ils se posent dans la grille de la liste attendue (album-grid, card-grid, rows…), qui garde ainsi sa hauteur.
 */
export function Skeleton({ kind = 'tile', count = 6 }) {
  const make = kind === 'card' ? CARD : kind === 'row' ? ROW : TILE;
  return <>{Array.from({ length: count }, (_, i) => make(i))}</>;
}
