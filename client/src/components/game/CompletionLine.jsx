// Ligne de complétion de la page d'album — chantier P1-D (PLAN.md 2.5 « Album » point 2, 6.2 point 4).
// Props (contrat) : { albumId }. À placer par la page d'album (P1-B) dans l'en-tête, à la place de la note dorée
// « Complété le … » (la première ligne la reprend, avec le même style) :
//   « Complété le 6 octobre 2026 · Pressage n° 37 · 6 jours après ta première carte » (album complété seulement)
//   « Complété par 214 joueurs · 3 amis » (avatars des amis, liens vers leur Studio)
// Données : GET /api/albums/:id/completion (amis bloqués écartés par le serveur), redemandées quand le joueur complète
// l'album. Rien n'est affiché pendant le chargement ni en cas d'erreur (la page reste lisible).
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Avatar, Icon } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useApi } from '../../state/catalog.js';
import '../../styles/game.css';

export function CompletionLine({ albumId }) {
  const { t, date } = useI18n();
  const { achievements } = useGame();
  const key = `album:${albumId}`;
  const doneAt = achievements?.get?.(key) ?? null;
  const { data, reload } = useApi(albumId ? `/albums/${encodeURIComponent(albumId)}/completion` : null, { keep: false });
  // L'album vient d'être complété (booster, pressage) : le Pressage n° et le compteur changent.
  const seen = useRef(doneAt);
  useEffect(() => {
    if (seen.current === doneAt) return;
    seen.current = doneAt;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneAt]);
  if (!albumId || !data || data.albumId !== albumId) return null;

  const mine = data.mine;
  const parts = mine ? [
    t('game.moment.completedOn', { date: date(mine.at) }),
    mine.rank ? t('game.moment.pressing', { n: mine.rank }) : null,
    mine.days === 0 ? t('game.moment.sameDay') : t('game.moment.days', { n: mine.days }),
  ].filter(Boolean) : [];
  const friends = data.friends || [];

  return (
    <div className="gm-completion">
      {parts.length > 0 && (
        <p className="gold-note gm-completion__mine">
          <Icon name="disc" />
          {parts.map((p, i) => <span key={i}>{i > 0 && <span className="gm-moment__dot" aria-hidden="true">· </span>}{p}</span>)}
        </p>
      )}
      <p className="gm-completion__all small">
        {data.completedBy > 0 ? (
          <>
            <span>{t('game.completion.by', { n: data.completedBy })}</span>
            {data.friendsCount > 0 && <span className="muted"> · {t('game.completion.friends', { n: data.friendsCount })}</span>}
          </>
        ) : (
          <span className="muted">{t('game.completion.none')}</span>
        )}
      </p>
      {friends.length > 0 && (
        <ul className="gm-completion__friends" aria-label={t('game.completion.friendsLabel')}>
          {friends.map((u) => (
            <li key={u.id}>
              <Link to={`/u/${encodeURIComponent(u.username)}`} title={u.username}>
                <Avatar user={u} size={28} />
                <span className="sr-only">{u.username}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CompletionLine;
