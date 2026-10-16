// Carte d'une liste — chantier P1-C (PLAN.md 2.5, design-system-current §4.5 `.list-card`). Props : { list (ListSummary),
// to? }. Trois pochettes en éventail (vraies pochettes : CoverArt), titre Archivo, ligne « par @melodie · 12 albums ·
// ♥ 31 » (ou « privée » / « amis » pour une liste à soi). Une grille « Mes 9 albums » mène à sa page de lecture.
import { Link } from 'react-router';
import CoverArt from '../CoverArt.jsx';
import { Icon } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbums } from '../../state/catalog.js';
import '../../styles/lists.css';

/** Page d'une liste : la grille « Mes 9 albums » se lit sur /u/:pseudo/nine, les autres sur /list/:id. */
export function listHref(list) {
  if (!list) return '/lists';
  if (list.kind === 'grid9' && list.user?.username) return `/u/${encodeURIComponent(list.user.username)}/nine`;
  return `/list/${encodeURIComponent(list.id)}`;
}

/** « 12 albums », « 3 morceaux », « 5 éléments » selon le type de la liste. */
export function useItemCount() {
  const { t } = useI18n();
  return (list) => {
    const n = list?.itemCount || 0;
    const type = list?.itemType === 'track' ? 'tracks' : list?.itemType === 'mixed' ? 'items' : 'albums';
    return t(`lists.count.${type}`, { n });
  };
}

/** Trois pochettes en éventail (ou des cases vides tant que la liste n'a rien). */
export function CoverStack({ albumIds = [], className = 'list-card__stack' }) {
  const albums = useAlbums(albumIds.slice(0, 3));
  return (
    <span className={className} aria-hidden="true">
      {[0, 1, 2].map((i) => {
        const a = albums[i];
        return (
          <span key={i} className={a ? undefined : 'ls-stack__empty'}>
            {a && <CoverArt art={{ ...a.art, seed: a.art?.seed || a.id }} sizes="72px" />}
          </span>
        );
      })}
    </span>
  );
}

export function ListCard({ list, to }) {
  const { t } = useI18n();
  const count = useItemCount();
  if (!list) return null;
  const mine = list.user?.relation === 'self';
  const meta = [
    mine ? t('lists.byYou') : t('lists.by', { name: list.user?.username || '' }),
    count(list),
  ];
  const grid = list.kind === 'grid9';
  return (
    <Link to={to || listHref(list)} className={`list-card${grid ? ' ls-card--grid' : ''}`} data-list-id={list.id}>
      <CoverStack albumIds={list.coverAlbumIds} />
      <span className="ls-card__body">
        <span className="list-card__title">{list.title}</span>
        <span className="list-card__meta">
          {meta.join(' · ')}
          {list.visibility !== 'public' && mine && <> · {t(`lists.visibility.${list.visibility}`).toLowerCase()}</>}
          {list.likeCount > 0 && <> · <span className="ls-card__likes"><Icon name="heart" size={12} /> {list.likeCount}</span></>}
          {list.ranked && !grid && <> · {t('lists.ranked')}</>}
        </span>
        {list.moderated && <span className="chip chip--sm chip--danger ls-card__flag">{t('lists.moderated')}</span>}
      </span>
    </Link>
  );
}

export default ListCard;
