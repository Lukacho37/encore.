// Événements (/events, /events/:slug) — chantier P2-B (PLAN.md 2.1, 6.9). Le calendrier est dans le code
// (shared/events.js) ; le serveur dit ce qui est en cours pour le joueur.
//   /events        en ce moment (grand panneau par événement : dates, « encore 5 jours », quêtes 1/3), à venir, passés.
//   /events/:slug  l'événement : ses 3 quêtes (réclamées ici ; à venir : verrouillées), le bonus des 3 (badge, booster
//                  thématique, cadre), son coffret (qui reste ouvert après), sa catégorie de battles (« Voter »),
//                  ses récompenses ; le Rétro mène à la page Rétro (P2-A) quand elle existe.
// Pas de compte à rebours anxiogène ni d'offre limitée : « encore N jours », et le coffret reste ouvert ensuite.
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../state/catalog.js';
import { post } from '../api.js';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { Icon, useToast } from '../components/ui.jsx';
import { CategoryName, QuestRing, RewardChips, questLink, rewardText } from '../components/play/common.jsx';
import { SetCard, enc, eventTitle, eventWhen, useEventDates } from '../components/sets/parts.jsx';
import { pageExists } from '../routes.jsx';
import '../styles/play.css';
import '../styles/sets.css';

/** Pastille d'état d'un événement : en cours (turquoise), à venir, terminé ; « Aperçu » en démonstration. */
function StatusChip({ ev }) {
  const { t } = useI18n();
  const tone = ev.status === 'current' ? ' chip--cue' : ev.status === 'past' ? ' chip--quiet' : '';
  return (
    <span className="set-ev-status">
      <span className={`chip chip--sm${tone}`}>{t(`events.status.${ev.status}`)}</span>
      {ev.status !== 'past' && <span className="small muted">{eventWhen(t, ev)}</span>}
      {ev.preview && <span className="chip chip--sm chip--quiet" title={t('events.previewHint')}>{t('events.preview')}</span>}
    </span>
  );
}

/** Événement en cours, dans la liste : grand panneau (point du booster, titre, dates, quêtes). */
function CurrentEvent({ ev }) {
  const { t, lang } = useI18n();
  const dates = useEventDates();
  return (
    <article className="panel set-ev-hero" data-event={ev.slug}>
      <span className="set-ev-hero__dot" aria-hidden="true" />
      <div className="set-ev-hero__body">
        <span className="eyebrow">{dates(ev)}</span>
        <h2 className="set-ev-hero__title">{eventTitle(lang, ev)}</h2>
        <p className="muted">{t(`events.desc.${ev.slug}`)}</p>
        <StatusChip ev={ev} />
      </div>
      <div className="set-ev-hero__side">
        {ev.quests?.total > 0 && <span className="mono set-ev-hero__count">{t('events.questsShort', ev.quests)}</span>}
        <Link to={`/events/${enc(ev.slug)}`} className="btn btn--primary">{t('events.open')}</Link>
      </div>
    </article>
  );
}

/** Ligne d'un événement à venir ou passé. */
function EventRow({ ev }) {
  const { lang } = useI18n();
  const dates = useEventDates();
  return (
    <li>
      <Link to={`/events/${enc(ev.slug)}`} className="set-ev-row" data-event={ev.slug}>
        <span className="set-ev-row__icon" aria-hidden="true"><Icon name={ev.icon || 'star'} size={18} /></span>
        <span className="set-ev-row__text">
          <span className="set-ev-row__title">{eventTitle(lang, ev)}</span>
          <span className="small muted">{dates(ev)}</span>
        </span>
        <StatusChip ev={ev} />
      </Link>
    </li>
  );
}

function Calendar() {
  const { t } = useI18n();
  const { data, error, reload } = useApi('/events', { keep: false });
  return (
    <div className="set-events" data-page="events">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('events.kicker')}</span>
          <h1>{t('events.title')}</h1>
          <p className="set-page__intro">{t('events.intro')}</p>
        </div>
        <Link to="/collection/sets?kind=event" className="btn btn--ghost btn--sm"><Icon name="disc" size={16} /> {t('sets.tab')}</Link>
      </header>
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? (
        <div aria-busy="true"><span className="panel set-ev-hero set-ev-hero--skel" /></div>
      ) : (
        <>
          <section className="section" aria-labelledby="ev-current">
            <header className="section__head"><h2 id="ev-current">{t('events.sections.current')}</h2></header>
            {data.current.length
              ? <div className="set-ev-list">{data.current.map((ev) => <CurrentEvent key={ev.slug} ev={ev} />)}</div>
              : <EmptyState icon="star" body={t('events.none')} />}
          </section>
          {data.upcoming.length > 0 && (
            <section className="section" aria-labelledby="ev-upcoming">
              <header className="section__head"><h2 id="ev-upcoming">{t('events.sections.upcoming')}</h2></header>
              <ul className="set-ev-rows">{data.upcoming.map((ev) => <EventRow key={ev.slug} ev={ev} />)}</ul>
            </section>
          )}
          {data.past.length > 0 && (
            <section className="section" aria-labelledby="ev-past">
              <header className="section__head"><h2 id="ev-past">{t('events.sections.past')}</h2></header>
              <ul className="set-ev-rows">{data.past.map((ev) => <EventRow key={ev.slug} ev={ev} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Où faire une quête d'événement : les battles de l'événement, son coffret, sinon comme une quête ordinaire. */
function eventQuestLink(quest, battle) {
  if (quest.metric === 'battle_votes' && quest.vars?.event && battle) return `/battles?category=${enc(battle.category)}`;
  if (quest.metric === 'complete_album' && quest.vars?.set) return `/sets/${enc(quest.vars.set)}`;
  return questLink(quest);
}

/** Une quête d'événement (même rangée que la page Quêtes) : anneau, titre, récompense, « Réclamer ». */
function EventQuest({ quest, status, battle, busy, onClaim }) {
  const { t } = useI18n();
  const link = status === 'current' ? eventQuestLink(quest, battle) : null;
  const cls = `quest${quest.done ? ' quest--done' : ''}${quest.claimed ? ' quest--claimed' : ''}`;
  return (
    <li className={cls} data-quest={quest.defId} data-slot={quest.slot}>
      <QuestRing quest={quest} icon={quest.locked ? 'lock' : undefined} />
      <div>
        <div className="quest__title">{t(`events.q.${quest.defId}`, { n: quest.target })}</div>
        <RewardChips reward={quest.reward} />
      </div>
      <div className="quest__side">
        {quest.claimed ? (
          <span className="chip chip--sm chip--gold"><Icon name="check" size={14} /> {t('events.quests.claimed')}</span>
        ) : quest.locked ? (
          <span className="small muted">{t('events.quests.locked')}</span>
        ) : quest.done && status === 'current' ? (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onClaim(quest)}>{t('events.quests.claim')}</button>
        ) : (
          <>
            <span className="mono quest__count">{quest.progress}/{quest.target}</span>
            {link && <Link to={link} className="quest__go">{t('quests.go')}</Link>}
          </>
        )}
      </div>
    </li>
  );
}

/** Bonus des 3 quêtes : badge, booster thématique (et cadre). */
function BonusRow({ quests, rewards, busy, onBonus }) {
  const { t } = useI18n();
  const claimed = quests.slots.filter((q) => q.claimed).length;
  const bonus = quests.bonus || {};
  const cls = `quest quest--bonus${bonus.claimable || bonus.claimed ? ' quest--done' : ''}${bonus.claimed ? ' quest--claimed' : ''}`;
  return (
    <li className={cls} data-bonus="event">
      <span className="quest__ring" aria-hidden="true">
        <span className="q-ring q-ring--lg" style={{ '--p': Math.round((claimed / Math.max(1, quests.slots.length)) * 100) }} />
        <Icon name={bonus.claimed ? 'check' : 'trophy'} size={18} />
      </span>
      <div>
        <div className="quest__title">{t('events.quests.bonus')}</div>
        <p className="small muted">{t('events.quests.bonusBody', { frame: rewards?.frame ? t('events.quests.bonusFrame') : '' })}</p>
      </div>
      <div className="quest__side">
        {bonus.claimed ? (
          <span className="chip chip--sm chip--gold"><Icon name="check" size={14} /> {t('events.quests.bonusDone')}</span>
        ) : bonus.claimable ? (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={onBonus}>{t('events.quests.bonusClaim')}</button>
        ) : (
          <span className="mono quest__count">{claimed}/{quests.slots.length}</span>
        )}
      </div>
    </li>
  );
}

/** Récompenses de l'événement : badge, cadre (pendant l'événement), booster thématique. */
function Rewards({ ev, rewards }) {
  const { t, lang, date } = useI18n();
  const items = [
    { key: 'badge', icon: 'trophy', title: t('events.rewards.badge'), body: t('events.rewards.badgeBody'), earned: ev.earned?.badgeAt },
    ...(rewards?.frame ? [{ key: 'frame', icon: 'user', title: t('events.rewards.frame', { title: eventTitle(lang, ev) }), body: t('events.rewards.frameBody'), earned: ev.earned?.frameAt }] : []),
    ...(rewards?.theme ? [{ key: 'booster', icon: 'pack', title: t('events.rewards.booster'), body: t('events.rewards.boosterBody'), earned: null }] : []),
  ];
  return (
    <ul className="set-ev-rewards">
      {items.map((r) => (
        <li key={r.key} className={`set-ev-reward${r.earned ? ' set-ev-reward--earned' : ''}`} data-reward={r.key}>
          <span className="set-ev-reward__icon" aria-hidden="true"><Icon name={r.icon} size={18} /></span>
          <span className="set-ev-reward__text">
            <b>{r.title}</b>
            <span className="small muted">{r.earned ? t('events.rewards.earnedOn', { date: date(r.earned) }) : r.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function EventDetail({ slug }) {
  const { t, lang, num, error: errorText } = useI18n();
  const toast = useToast();
  const dates = useEventDates();
  const { data, error, reload } = useApi(`/events/${enc(slug)}`, { keep: false });
  const [busy, setBusy] = useState(false);

  const act = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const res = await fn();
      toast(success(res), 'success');
      reload();
    } catch (err) {
      toast(errorText(err.code), 'error');
      if (err.code === 'period_over') reload();
    } finally {
      setBusy(false);
    }
  }, [toast, reload, errorText]);

  const back = <Link to="/events" className="back-link"><Icon name="back" /> {t('events.back')}</Link>;
  if (error?.status === 404) {
    return <div className="set-events" data-page="event">{back}<EmptyState icon="star" body={t('events.notFound')} action={{ label: t('events.back'), to: '/events' }} /></div>;
  }
  if (error && !data) return <div className="set-events" data-page="event">{back}<ErrorBox error={error} onRetry={reload} /></div>;
  if (!data) {
    return <div className="set-events" data-page="event" aria-busy="true">{back}<span className="panel set-ev-hero set-ev-hero--skel" /></div>;
  }

  const { event: ev, quests, set, battle, rewards } = data;
  const claim = (q) => act(() => post(`/events/${enc(ev.slug)}/quests/${q.slot}/claim`), (res) => t('events.quests.toast', { reward: rewardText(t, num, res.reward) }));
  const bonus = () => act(() => post(`/events/${enc(ev.slug)}/bonus`), () => t('events.quests.bonusToast', { frame: rewards?.frame ? t('events.quests.bonusFrame') : '' }));
  const retroPage = ev.kind === 'retro' && ev.year && pageExists('Retro');

  return (
    <div className="set-events" data-page="event" data-event={ev.slug}>
      {back}
      <header className="panel set-ev-hero set-ev-hero--page">
        <span className="set-ev-hero__dot" aria-hidden="true" />
        <div className="set-ev-hero__body">
          <span className="eyebrow">{t('events.chipLabel')} · {dates(ev)}</span>
          <h1 className="set-ev-hero__title">{eventTitle(lang, ev)}</h1>
          <p className="muted">{t(`events.desc.${ev.slug}`)}</p>
          <StatusChip ev={ev} />
        </div>
        {retroPage && (
          <div className="set-ev-hero__side">
            <Link to={`/retro/${ev.year}`} className="btn btn--primary">{t('events.retro.open', { year: ev.year })}</Link>
          </div>
        )}
      </header>

      <div className="set-ev-grid">
        {quests && (
          <section className="panel set-ev-quests" aria-labelledby="ev-quests-title" data-period="event">
            <h2 className="panel__title" id="ev-quests-title"><Icon name="check" /> {t('events.quests.title')}</h2>
            <p className="small muted">{ev.status === 'past' ? t('events.quests.over') : t('events.quests.intro')}</p>
            <ul className="quests">
              {quests.slots.map((q) => <EventQuest key={q.slot} quest={q} status={ev.status} battle={battle} busy={busy} onClaim={claim} />)}
              <BonusRow quests={quests} rewards={rewards} busy={busy} onBonus={bonus} />
            </ul>
          </section>
        )}

        <div className="set-ev-side">
          {battle && (
            <section className="panel set-ev-battle" aria-labelledby="ev-battle-title">
              <h2 className="panel__title" id="ev-battle-title"><Icon name="trophy" /> {t('events.battle.title')}</h2>
              <p className="set-ev-battle__cat">
                <CategoryName category={battle.category} />
                {battle.featured && <span className="chip chip--sm chip--cue">{t('events.battle.featured')}</span>}
              </p>
              <p className="small muted">{t('events.battle.body')}</p>
              {ev.status !== 'past' && (
                <Link to={`/battles?category=${enc(battle.category)}`} className="btn btn--ghost btn--sm">{t('events.battle.cta')}</Link>
              )}
            </section>
          )}
          <section className="panel" aria-labelledby="ev-rewards-title">
            <h2 className="panel__title" id="ev-rewards-title"><Icon name="star" /> {t('events.rewards.title')}</h2>
            <Rewards ev={ev} rewards={rewards} />
          </section>
        </div>
      </div>

      {ev.setId && (
        <section className="section" aria-labelledby="ev-set-title">
          <header className="section__head"><h2 id="ev-set-title">{t('events.set.title')}</h2></header>
          {set ? (
            <div className="set-grid set-grid--one">
              <SetCard set={set} />
              <p className="small muted set-ev-set__after">{t('sets.eventAfter')}</p>
            </div>
          ) : <EmptyState icon="disc" body={t('events.set.soon')} />}
        </section>
      )}
    </div>
  );
}

export default function Events() {
  const { slug } = useParams();
  return slug ? <EventDetail key={slug} slug={slug} /> : <Calendar />;
}
