// Albums recherchés : bouton « Rechercher » et bloc du Studio — chantier P1-D (PLAN.md 6.4, 9.2).
// Props (contrat, ne pas les renommer) : WishlistToggle { albumId } ; WishlistBlock { username }.
// En plus, facultatif : WishlistToggle { compact } (vignettes, lignes de recherche : bouton rond, icône seule).
// Un album recherché oriente 25 % des cartes des boosters vers ses cartes manquantes (shared/rules.js) ; 12 places,
// +4 aux niveaux 10, 25 et 50 (409 wishlist_full au-delà).
import { useState } from 'react';
import { Link } from 'react-router';
import { AlbumTile } from '../AlbumTile.jsx';
import { EmptyState } from '../feedback.jsx';
import { Icon, useToast } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useAlbums, useApi } from '../../state/catalog.js';
import { toggleWishlist, useWishlist } from './wishlist.js';
import '../../styles/game.css';

/** Bouton « Rechercher » / « Recherché » d'un album. Masqué pour un album complété qui n'est pas recherché. */
export function WishlistToggle({ albumId, compact = false }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const { user, stats } = useGame();
  const wish = useWishlist(user?.id);
  const [busy, setBusy] = useState(false);
  if (!albumId || !user) return null;
  const wanted = wish.ids.has(albumId);
  const done = (stats?.albums?.[albumId]?.pct ?? 0) >= 1;
  if (done && !wanted) return null;
  const label = wanted ? t('wishlist.removeLong') : t('wishlist.addLong');

  const onClick = async (e) => {
    // Sur une vignette (lien), le bouton ne suit pas le lien.
    e.preventDefault();
    e.stopPropagation();
    if (busy || wish.status === 'loading') return;
    setBusy(true);
    try {
      const res = await toggleWishlist(albumId, !wanted);
      toast(res.wanted ? t('wishlist.added', { count: res.count, max: res.max }) : t('wishlist.removed'), 'success');
    } catch (err) {
      toast(err?.code === 'wishlist_full' ? t('errors.wishlist_full', { max: err.data?.max ?? wish.max }) : error(err?.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <button type="button" className={`gm-wish gm-wish--icon${wanted ? ' is-on' : ''}`} onClick={onClick} disabled={busy}
        aria-pressed={wanted} aria-label={label} title={label}>
        <Icon name="heart" size={16} />
      </button>
    );
  }
  return (
    <button type="button" className={`btn btn--ghost btn--sm gm-wish${wanted ? ' is-on' : ''}`} onClick={onClick} disabled={busy}
      aria-pressed={wanted} title={label}>
      <Icon name="heart" size={16} />
      <span>{wanted ? t('wishlist.on') : t('wishlist.add')}</span>
    </button>
  );
}

/** Vignettes du bloc, avec la progression du joueur affiché. */
function WishTiles({ ids, progressOf }) {
  const albums = useAlbums(ids);
  return (
    <div className="gm-wishlist__grid">
      {ids.map((id, i) => (
        <AlbumTile key={id} album={albums[i]} progress={progressOf(id, albums[i]?.trackCount)} compact sizes="(max-width: 700px) 45vw, 180px" />
      ))}
    </div>
  );
}

/** Bloc « Albums recherchés » du Studio (le sien : tenu à jour en direct ; celui d'un autre : GET /users/:u/wishlist). */
export function WishlistBlock({ username }) {
  const { t } = useI18n();
  const { user, albumProgress } = useGame();
  const self = !!user && user.username === username;
  const mine = useWishlist(self ? user.id : null);
  const other = useApi(!self && username ? `/users/${encodeURIComponent(username)}/wishlist` : null, { keep: false });
  if (!username) return null;
  // Profil privé ou joueur introuvable : le Studio affiche déjà ce qu'il faut, le bloc se tait.
  if (!self && other.error) return null;
  const ids = self ? mine.order : other.data?.items || [];
  const max = self ? user.slots?.wishlist ?? mine.max : other.data?.max;
  const ready = self ? mine.status === 'ready' || mine.status === 'error' : !!other.data;
  const progressOf = (id, total) => (self ? albumProgress(id, total || 0) : other.data?.progress?.[id] || { owned: 0, total: total || 0 });
  const headId = `gm-wishlist-${username.replace(/[^\w-]/g, '_')}`;

  return (
    <section className="panel gm-wishlist" aria-labelledby={headId}>
      <header className="gm-wishlist__head">
        <h2 className="panel__title" id={headId}>
          <Icon name="heart" /> {self ? t('wishlist.blockTitle') : t('wishlist.blockOther', { name: username })}
        </h2>
        {ready && max != null && <span className="chip mono">{t('wishlist.count', { count: ids.length, max })}</span>}
      </header>
      {self && ids.length > 0 && <p className="small muted gm-wishlist__hint">{t('wishlist.hint')}</p>}
      {!ready ? (
        <div className="gm-wishlist__grid" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => <AlbumTile key={i} album={null} />)}
        </div>
      ) : ids.length ? (
        <WishTiles ids={ids} progressOf={progressOf} />
      ) : self ? (
        <EmptyState icon="heart" title={t('wishlist.emptySelf')} body={t('wishlist.emptySelfBody')}
          action={{ label: t('wishlist.action'), to: '/collection?sort=popular', icon: 'search' }} />
      ) : (
        <p className="empty">{t('wishlist.emptyOther', { name: username })}</p>
      )}
      {self && ids.length > 0 && (
        <Link to="/collection?sort=popular" className="section__link gm-wishlist__more">{t('wishlist.action')}</Link>
      )}
    </section>
  );
}

export default WishlistToggle;
