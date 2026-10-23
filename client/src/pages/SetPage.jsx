// Page d'un coffret (/sets/:id) — chantier P2-B (PLAN.md 2.1, 6.8). GET /api/sets/:id : en-tête (pochettes en éventail,
// sorte, titre, « 3/8 albums complétés », cartes), récompenses (badge aux 3/4, cadre au complet, avec l'aperçu du cadre
// sur ton avatar), les albums du coffret (vignettes partagées : vraie pochette, progression en cartes), tes amis sur ce
// coffret, le nombre de joueurs qui ont le badge, et l'événement quand c'est un coffret d'événement. Une récompense
// atteinte avant la création du coffret est donnée à la lecture (message).
import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useAlbums, useApi } from '../state/catalog.js';
import { AlbumTile, AlbumTileSkeleton } from '../components/AlbumTile.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { Avatar, Icon, Progress, useToast } from '../components/ui.jsx';
import { SetStack, enc, eventTitle, eventWhen, setTitle, useEventDates } from '../components/sets/parts.jsx';
import { TIER_REWARDS } from '@shared/badges.js';
import '../styles/sets.css';

const SKELETON_TILES = Array.from({ length: 8 }, (_, i) => <AlbumTileSkeleton key={i} />);

/** Récompense du coffret : badge (aux 3/4) ou cadre (au complet), gagnée ou avec ce qu'il reste à faire. */
function RewardCard({ kind, set }) {
  const { t, date } = useI18n();
  const { user } = useGame();
  const r = set.rewards;
  const target = kind === 'badge' ? r.badgeAt : r.frameAt;
  const earnedAt = kind === 'badge' ? r.badgeEarnedAt : r.frameEarnedAt;
  const done = Math.min(set.progress.completed, target);
  const frameKey = r.frame.replace(/^frame:/, '');
  return (
    <article className={`panel set-reward${earnedAt ? ' set-reward--earned' : ''}`} data-reward={kind}>
      {kind === 'badge' ? (
        <span className="set-reward__disc" aria-hidden="true"><Icon name="trophy" size={22} /></span>
      ) : (
        <span className="set-reward__avatar" aria-hidden="true"><Avatar user={user} size={52} frame={frameKey} /></span>
      )}
      <div className="set-reward__body">
        <h3 className="set-reward__title">
          {kind === 'badge' ? <>{t('sets.badge.name')} <span className="chip chip--sm">{t('sets.badge.tier')}</span></> : t('sets.frame.name')}
        </h3>
        <p className="set-reward__text">
          {earnedAt
            ? t(`sets.${kind}.earned`, { date: date(earnedAt) })
            : t(`sets.${kind}.goal`, { n: target })}
        </p>
        {kind === 'badge' && <span className="chip chip--sm chip--quiet"><span className="mono">{t('sets.badge.xp', { n: TIER_REWARDS.bronze.xp })}</span></span>}
        {kind === 'frame' && earnedAt && <p className="small muted">{t('sets.frame.hint')}</p>}
      </div>
      <span className="set-reward__count mono">{earnedAt ? <Icon name="check" size={18} /> : `${done}/${target}`}</span>
    </article>
  );
}

/** Albums du coffret : vignettes partagées, progression en cartes du joueur. */
function SetAlbums({ albums }) {
  const list = useAlbums(albums.map((a) => a.id));
  return (
    <div className="album-grid set-albums">
      {albums.map((a, i) => (
        <AlbumTile key={a.id} album={list[i]} progress={{ owned: a.owned, total: a.total }} className={a.completed ? 'set-albums__done' : ''} />
      ))}
    </div>
  );
}

/** Tes amis sur ce coffret : les plus avancés d'abord. */
function SetFriends({ friends, set }) {
  const { t } = useI18n();
  if (!friends.length) {
    return <EmptyState icon="users" body={t('sets.friendsNone')} action={{ label: t('sets.friendsFind'), to: '/friends', primary: false }} />;
  }
  return (
    <ul className="set-friends">
      {friends.map((f) => (
        <li key={f.user.id}>
          <Link to={`/u/${enc(f.user.username)}`} className="set-friend">
            <Avatar user={f.user} size={36} />
            <span className="set-friend__name">{f.user.username}</span>
            <Progress value={f.completed} max={set.albumCount} color="var(--gold)" size="sm" label={t('sets.friendDone', { n: f.completed })} />
            <span className="mono">{f.completed}/{set.albumCount}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function SetPage() {
  const { id } = useParams();
  const { t, lang, num } = useI18n();
  const toast = useToast();
  const dates = useEventDates();
  const onData = useCallback((res) => {
    for (const r of res?.rewards || []) toast(t(`sets.rewardToast.${r.reward}`), 'success');
  }, [t, toast]);
  const { data, error, reload } = useApi(id ? `/sets/${enc(id)}` : null, { keep: false, onData });

  const back = <Link to="/collection/sets" className="back-link"><Icon name="back" /> {t('sets.back')}</Link>;
  if (error?.status === 404 || error?.code === 'set_not_found') {
    return (
      <div className="set-page" data-page="set">
        {back}
        <EmptyState icon="disc" body={t('sets.notFound')} action={{ label: t('sets.back'), to: '/collection/sets' }} />
      </div>
    );
  }
  if (error && !data) {
    return <div className="set-page" data-page="set">{back}<ErrorBox error={error} onRetry={reload} /></div>;
  }
  if (!data) {
    return (
      <div className="set-page" data-page="set" aria-busy="true">
        {back}
        <header className="set-head"><span className="set-stack set-stack--lg set-stack--skel" /><div className="set-head__info"><span className="set-skel-line" /><span className="set-skel-line set-skel-line--short" /></div></header>
        <div className="album-grid">{SKELETON_TILES}</div>
      </div>
    );
  }

  const { set, albums, friends, holders, event } = data;
  const n = set.albumCount;
  const done = set.progress.completed;
  return (
    <div className="set-page" data-page="set" data-set={set.id}>
      {back}
      <header className="set-head">
        <SetStack albumIds={set.covers} size="lg" />
        <div className="set-head__info">
          <span className="eyebrow">{t('sets.eyebrow')} · {t(`sets.kind.${set.kind}`)}</span>
          <h1>{setTitle(t, lang, set)}</h1>
          <p className="set-head__line">
            {t('sets.albums', { n })} · <span className="mono">{t('sets.cards', { owned: num(set.progress.owned), total: num(set.progress.total) })}</span>
          </p>
          <div className="set-head__progress">
            <span className="set-head__count"><b>{done}</b>/{n}</span>
            <span className="set-head__bar">
              <Progress value={done} max={n} color="var(--gold)" size="lg" label={t('sets.completed', { done, n })} />
              <span className="small muted">{t('sets.completed', { done, n })}</span>
            </span>
          </div>
          {event && (
            <Link to={`/events/${enc(event.slug)}`} className="set-head__event" data-event={event.slug}>
              <span className="quest-chip__dot" aria-hidden="true" />
              <span>{t('sets.eventLink', { title: eventTitle(lang, event) })}</span>
              <span className="muted">· {event.status === 'past' ? t('sets.eventAfter') : `${dates(event)} · ${eventWhen(t, event)}`}</span>
            </Link>
          )}
        </div>
      </header>

      <section className="set-rewards" aria-label={t('sets.rewardsTitle')}>
        <RewardCard kind="badge" set={set} />
        <RewardCard kind="frame" set={set} />
      </section>

      <section className="section" aria-labelledby="set-albums-title">
        <header className="section__head">
          <h2 id="set-albums-title">{t('sets.albumsTitle')}</h2>
        </header>
        <p className="small muted set-page__hint">{t('sets.albumsHint')}</p>
        <SetAlbums albums={albums} />
      </section>

      <section className="section" aria-labelledby="set-friends-title">
        <header className="section__head">
          <h2 id="set-friends-title">{t('sets.friendsTitle')}</h2>
        </header>
        <SetFriends friends={friends} set={set} />
        <p className="small muted set-page__holders">{holders > 0 ? t('sets.holders', { n: holders }) : t('sets.holdersNone')}</p>
      </section>
    </div>
  );
}
