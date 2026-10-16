// Discussions d'un album, d'un morceau ou d'un artiste — chantier P1-A (PLAN.md 9.2). Props (contrat, ne pas les renommer) : { itemType, itemId }.
// Posts qui citent l'élément (GET /api/items/:type/:id/posts, curseur) : ceux des amis d'abord (« Vos amis »), puis
// ceux de tout le monde (« Communauté AlbumMania »), et « Publier à propos de cet album » (le post cite l'élément).
// Les posts « amis seulement » d'inconnus, masqués ou de joueurs bloqués n'y sont jamais (le serveur filtre).
import { useState } from 'react';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useArtist, useTrack } from '../../state/catalog.js';
import { useCursorList } from '../../state/paged.js';
import { ErrorBox, LoadMore } from '../feedback.jsx';
import { Composer } from './Composer.jsx';
import { PostCard } from './PostCard.jsx';
import { useOnBlocked } from './util.js';
import '../../styles/social.css';

const TYPES = ['album', 'track', 'artist'];

/** Titre de l'élément (texte d'invite du compositeur). */
function useItemTitle(type, id) {
  const album = useAlbum(type === 'album' ? id : null);
  const track = useTrack(type === 'track' ? id : null);
  const artist = useArtist(type === 'artist' ? id : null);
  return type === 'album' ? album?.title : type === 'track' ? track?.title : artist?.name;
}

/** Un groupe de posts (« Vos amis », « Communauté AlbumMania »). */
function Group({ title, posts, list }) {
  if (!posts.length) return null;
  return (
    <div className="so-group">
      {title && <h3 className="so-group__title">{title}</h3>}
      <ul className="so-feed">
        {posts.map((p) => (
          <li key={p.id}>
            <PostCard post={p} hideItem onRemove={() => list.remove(p.id)} onChange={(next) => list.update(p.id, () => next)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Discussions({ itemType, itemId }) {
  const { t } = useI18n();
  const valid = TYPES.includes(itemType) && itemId != null && itemId !== '';
  const title = useItemTitle(itemType, valid ? itemId : null);
  const list = useCursorList(valid ? `/items/${itemType}/${encodeURIComponent(itemId)}/posts` : null, { limit: 10 });
  const [focus, setFocus] = useState(0);
  useOnBlocked((userId) => {
    for (const p of list.items) if (p.user?.id === userId) list.remove(p.id);
  });
  if (!valid) return null;

  const friends = list.items.filter((p) => p.user?.relation === 'friend');
  const others = list.items.filter((p) => p.user?.relation !== 'friend');
  const first = list.loading && !list.items.length;
  return (
    <section className="section so-discussions" id="discussions" aria-labelledby={`disc-${itemType}`} data-discussions={`${itemType}:${itemId}`}>
      <header className="section__head">
        <h2 id={`disc-${itemType}`}>{t('discussions.title')}</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFocus((n) => n + 1)}>{t(`discussions.publish.${itemType}`)}</button>
      </header>
      <Composer item={{ type: itemType, id: itemId }} itemTitle={title} compact focusSignal={focus} onPosted={(post) => list.prepend(post)} />
      {first && <div className="so-skel so-skel--short" aria-hidden="true" />}
      {list.error && !list.items.length && <ErrorBox error={list.error} onRetry={list.reload} />}
      <Group title={t('discussions.friends')} posts={friends} list={list} />
      <Group title={friends.length ? t('discussions.community') : null} posts={others} list={list} />
      {!list.loading && !list.error && !list.items.length && <p className="so-note">{t('discussions.empty')}</p>}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.items.length ? list.error : null}
        onRetry={list.loadMore} label={t('discussions.more')} />
    </section>
  );
}

export default Discussions;
