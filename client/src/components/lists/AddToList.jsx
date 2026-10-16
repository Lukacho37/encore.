// « Ajouter à une liste » (bouton + feuille) et « Listes qui le contiennent » — chantier P1-C (PLAN.md 2.3, 2.5, 9.2).
// Props (contrat, ne pas les renommer) : AddToListButton { item: { type: 'album' | 'track', id } } ; AlbumListsBlock { albumId }.
// En plus, facultatifs : AddToListButton { compact (icône seule, lignes de recherche), className }.
// La feuille propose « Mes 9 albums » (un album va dans la première case vide), puis mes listes qui acceptent ce type
// d'élément (ajout à la fin : POST /api/lists/:id/items ; 409 already_in_list → « Déjà dedans »), et la création d'une
// liste avec l'élément dedans (ou l'éditeur complet). Le serveur vérifie le propriétaire, les doublons et les limites.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get, post, put } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useCursorList } from '../../state/paged.js';
import { useAlbum, useTrack } from '../../state/catalog.js';
import { EmptyState, LoadMore, Skeleton } from '../feedback.jsx';
import { Icon, Modal, Spinner, useToast } from '../ui.jsx';
import { ListCard, useItemCount } from './ListCard.jsx';
import { ListIcon } from './icons.jsx';
import '../../styles/lists.css';

const enc = encodeURIComponent;
/** Une liste accepte-t-elle ce type d'élément ? (albums, morceaux, ou les deux) */
const accepts = (list, type) => (list.itemType || 'album') === 'mixed' || (list.itemType || 'album') === type;

/** Ligne « Mes 9 albums » de la feuille (albums seulement). */
function GridRow({ albumId }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [grid, setGrid] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    get('/me/grid9').then((g) => alive && setGrid(g)).catch(() => alive && setGrid({ slots: Array(9).fill(null), failed: true }));
    return () => {
      alive = false;
    };
  }, []);
  const slots = grid?.slots || [];
  const inside = slots.includes(albumId);
  const free = slots.indexOf(null);
  const add = async () => {
    if (free < 0 || inside) return;
    setBusy(true);
    try {
      const next = slots.slice();
      next[free] = albumId;
      setGrid(await put('/me/grid9', { slots: next }));
      toast(t('lists.add.gridDone'));
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="ls-pick__row ls-pick__row--grid">
      <span className="ls-pick__icon" aria-hidden="true"><Icon name="grid" size={18} /></span>
      <span className="ls-pick__text">
        <span className="ls-pick__title">{t('nine.title')}</span>
        <span className="ls-pick__meta">{grid ? t('nine.filled', { n: slots.filter(Boolean).length }) : t('common.loading')}</span>
      </span>
      {!grid ? <Spinner /> : inside ? (
        <span className="chip chip--sm chip--cue"><Icon name="check" size={14} /> {t('lists.add.inGrid')}</span>
      ) : free < 0 ? (
        <Link to="/nine" className="btn btn--ghost btn--sm">{t('lists.add.gridFull')}</Link>
      ) : (
        <button type="button" className="btn btn--ghost btn--sm" onClick={add} disabled={busy}>{busy ? <Spinner /> : <Icon name="plus" size={16} />} {t('lists.add.add')}</button>
      )}
    </li>
  );
}

/** Feuille « Ajouter à une liste ». */
function AddSheet({ item, onClose }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const count = useItemCount();
  const album = useAlbum(item.type === 'album' ? item.id : null);
  const track = useTrack(item.type === 'track' ? item.id : null);
  const name = (item.type === 'album' ? album?.title : track?.title) || '';
  const mine = useCursorList('/lists?owner=me', { limit: 30 });
  const [status, setStatus] = useState({}); // id de liste → 'busy' | 'added' | 'already' | 'full'
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const lists = useMemo(() => mine.items.filter((l) => accepts(l, item.type)), [mine.items, item.type]);

  const addTo = async (list) => {
    setStatus((s) => ({ ...s, [list.id]: 'busy' }));
    try {
      const res = await post(`/lists/${list.id}/items`, { type: item.type, id: item.id });
      mine.update(list.id, () => res.list);
      setStatus((s) => ({ ...s, [list.id]: 'added' }));
      toast(t('lists.add.done', { title: list.title }));
    } catch (err) {
      const code = err.code === 'already_in_list' ? 'already' : err.code === 'list_full' ? 'full' : null;
      setStatus((s) => ({ ...s, [list.id]: code }));
      if (!code) toast(error(err.code), 'error');
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await post('/lists', { title: title.trim(), itemType: item.type === 'track' ? 'track' : 'album', visibility: 'public', items: [{ type: item.type, id: item.id }] });
      mine.prepend(res.list);
      setStatus((s) => ({ ...s, [res.list.id]: 'added' }));
      setTitle('');
      toast(t('lists.add.created', { title: res.list.title }));
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('lists.add.title')} className="modal--narrow ls-add-modal">
      {name && <p className="small muted ls-add__what">{t('lists.add.what', { title: name })}</p>}
      <ul className="ls-pick" aria-label={t('lists.add.title')}>
        {item.type === 'album' && <GridRow albumId={item.id} />}
        {lists.map((l) => {
          const st = status[l.id];
          return (
            <li key={l.id} className="ls-pick__row">
              <span className="ls-pick__icon" aria-hidden="true"><ListIcon name={l.visibility === 'private' ? 'lock' : l.visibility === 'friends' ? 'friends' : 'globe'} size={16} /></span>
              <span className="ls-pick__text">
                <span className="ls-pick__title">{l.title}</span>
                <span className="ls-pick__meta">{count(l)}</span>
              </span>
              {st === 'added' ? <span className="chip chip--sm chip--cue"><Icon name="check" size={14} /> {t('lists.add.added')}</span>
                : st === 'already' ? <span className="chip chip--sm chip--quiet">{t('lists.add.already')}</span>
                  : st === 'full' ? <span className="chip chip--sm chip--quiet">{t('lists.add.full')}</span>
                    : (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => addTo(l)} disabled={st === 'busy'} aria-label={t('lists.add.addTo', { title: l.title })}>
                        {st === 'busy' ? <Spinner /> : <Icon name="plus" size={16} />} {t('lists.add.add')}
                      </button>
                    )}
            </li>
          );
        })}
        {mine.loading && !mine.items.length && <Skeleton kind="row" count={2} />}
      </ul>
      {!mine.loading && !lists.length && <p className="small muted">{t('lists.add.none')}</p>}
      <LoadMore hasMore={mine.hasMore} loading={mine.loading} onClick={mine.loadMore} />
      <form className="ls-add__new" onSubmit={create}>
        <label className="field">
          <span className="field__label">{t('lists.add.newLabel')}</span>
          <span className="ls-add__line">
            <input className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder={t('lists.add.newPlaceholder')} />
            <button type="submit" className="btn btn--primary" disabled={creating || !title.trim()}>{creating ? <Spinner /> : t('lists.add.create')}</button>
          </span>
        </label>
        <Link to={`/lists/new?add=${enc(`${item.type}:${item.id}`)}`} className="section__link ls-add__full" onClick={onClose}>{t('lists.add.fullEditor')}</Link>
      </form>
    </Modal>
  );
}

export function AddToListButton({ item, compact = false, className = '' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!item?.id || !['album', 'track'].includes(item.type)) return null;
  return (
    <>
      <button type="button" className={`btn btn--ghost${compact ? ' btn--sm ls-add-btn--compact' : ''} ${className}`.trim()} onClick={() => setOpen(true)}
        aria-label={compact ? t('lists.add.button') : undefined} data-add-to-list="">
        <Icon name="list" size={16} />{!compact && <span>{t('lists.add.button')}</span>}
      </button>
      {open && <AddSheet item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

/** « Listes qui le contiennent » (page d'album, « Autour de l'album ») : listes des amis d'abord, puis toutes. */
export function AlbumListsBlock({ albumId }) {
  const { t } = useI18n();
  const lists = useCursorList(albumId ? `/items/album/${enc(albumId)}/lists` : null, { limit: 4 });
  if (!albumId) return null;
  return (
    <section className="section ls-album-lists" aria-labelledby="ls-album-lists-title">
      <header className="section__head">
        <h2 id="ls-album-lists-title"><Icon name="list" size={20} /> {t('lists.albumBlock.title')}</h2>
        <AddToListButton item={{ type: 'album', id: albumId }} compact />
      </header>
      {lists.items.length > 0 ? (
        <div className="ls-cards">
          {lists.items.map((l) => <ListCard key={l.id} list={l} />)}
        </div>
      ) : lists.loading ? (
        <div className="ls-cards"><Skeleton kind="row" count={2} /></div>
      ) : (
        <EmptyState icon="list" title={t('lists.albumBlock.emptyTitle')} body={t('lists.albumBlock.emptyBody')} />
      )}
      <LoadMore hasMore={lists.hasMore} loading={lists.loading} onClick={lists.loadMore} error={lists.items.length ? lists.error : null} onRetry={lists.loadMore} />
    </section>
  );
}

export default AddToListButton;
