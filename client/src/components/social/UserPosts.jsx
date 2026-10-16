// Posts d'un joueur (onglet Posts du Studio) — chantier P1-A (PLAN.md 9.2). Props (contrat, ne pas les renommer) : { username }.
// GET /api/users/:username/posts (curseur, les plus récents d'abord) : ses posts lisibles par celui qui regarde ; Studio
// « amis » ou « privé » d'un autre : rien (`restricted`). Sur son propre Studio, le compositeur est en tête.
import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useCursorList } from '../../state/paged.js';
import { EmptyState, ErrorBox, LoadMore } from '../feedback.jsx';
import { Composer } from './Composer.jsx';
import { PostCard } from './PostCard.jsx';
import { useOnPosted } from './util.js';
import '../../styles/social.css';

export function UserPosts({ username }) {
  const { t } = useI18n();
  const { user } = useGame();
  const [restricted, setRestricted] = useState(false);
  const [focus, setFocus] = useState(0);
  const self = !!username && user?.username === username;
  const list = useCursorList(username ? `/users/${encodeURIComponent(username)}/posts` : null, {
    limit: 20,
    onPage: (res) => setRestricted(!!res?.restricted),
  });
  // Sur son propre Studio, un post publié depuis « Partager » arrive aussi en tête.
  useOnPosted((post) => self && list.prepend(post));
  if (!username) return null;
  const first = list.loading && !list.items.length;
  return (
    <section className="so-userposts" data-user-posts={username}>
      {self && <Composer focusSignal={focus} onPosted={(post) => list.prepend(post)} />}
      {first && <div className="so-skel" aria-hidden="true" />}
      {list.error && !list.items.length && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.items.length > 0 && (
        <ul className="so-feed">
          {list.items.map((p) => (
            <li key={p.id}>
              <PostCard post={p} onRemove={() => list.remove(p.id)} onChange={(next) => list.update(p.id, () => next)} />
            </li>
          ))}
        </ul>
      )}
      {!list.loading && !list.error && !list.items.length && (
        restricted ? <EmptyState icon="lock" body={t('userPosts.restricted', { name: username })} />
          : self ? <EmptyState icon="comment" title={t('userPosts.emptySelf')} action={{ label: t('userPosts.emptySelfCta'), onClick: () => setFocus((n) => n + 1), icon: 'edit' }} />
            : <EmptyState icon="comment" body={t('userPosts.emptyOther', { name: username })} />
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} auto error={list.items.length ? list.error : null}
        onRetry={list.loadMore} label={t('feed.more')} />
    </section>
  );
}

export default UserPosts;
