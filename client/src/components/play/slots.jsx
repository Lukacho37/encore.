// Quêtes, duels, trophées et classements d'un album — chantier P1-F (PLAN.md 9.2). Props (contrat, ne pas les renommer) :
// QuestStrip : aucune ; BattleWidget : aucune ; TrophyShelf { username } ; AlbumRankings { albumId }.
// En plus : BadgeGrid { username } (toutes les médailles, par rubrique : page Badges, onglet Badges du Studio).
//   QuestStrip     rangée de pastilles sous la rangée Boutique / Doublons / Blind test de l'accueil (au plus 3 : ce qui
//                  est à réclamer, les Premiers pas, les quêtes du jour) ; une quête finie se réclame d'un clic.
//   BattleWidget   duel compact de la colonne de l'accueil (un clic sur une pochette vote), lien vers les battles.
//   TrophyShelf    étagère de trophées du Studio : les 8 plus belles médailles, lien « Tous les badges ».
//   AlbumRankings  « Autour de l'album » : rangs de l'album dans ses classements (5 au plus), « Lancer un duel ».
// Chacun monte aussi le message « Nouvelle médaille ! » (un seul s'affiche, voir BadgeToast.jsx).
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useApi } from '../../state/catalog.js';
import { EmptyState, ErrorBox, Skeleton } from '../feedback.jsx';
import { Icon, Modal, RoyaltyIcon, useToast } from '../ui.jsx';
import { BADGE_GROUPS, familyOf, rewardFor, tierRank } from '@shared/badges.js';
import { BadgeToast } from './BadgeToast.jsx';
import { Duel, useBattleQueue } from './Duel.jsx';
import { CategoryName, Medal, enc, medalName, medalTone, questTitle, rewardText, tierGoal } from './common.jsx';
import { claimBonus, claimQuest, useQuests } from './questStore.js';

const SHELF = 8;

// ----- quêtes de l'accueil ------------------------------------------------------------------------------------

/** Pastilles de la rangée : à réclamer d'abord, puis les Premiers pas, les quêtes du jour, celles de la semaine. */
function stripItems(data) {
  const out = [];
  const daily = data.daily?.slots || [];
  const weekly = data.weekly?.slots || [];
  const first = data.firstSteps || [];
  const keyOf = (q) => (q.scope === 'first' ? 'first' : q.scope === 'daily' ? data.daily.periodKey : data.weekly.periodKey);
  if (data.daily?.bonus?.claimable) out.push({ kind: 'bonus', periodKey: data.daily.periodKey });
  for (const q of [...daily, ...first, ...weekly]) if (q.done && !q.claimed) out.push({ kind: 'claim', quest: q, periodKey: keyOf(q) });
  if (first.length && first.some((q) => !q.claimed)) out.push({ kind: 'first', done: first.filter((q) => q.claimed).length, total: first.length });
  for (const q of daily) if (!q.done) out.push({ kind: 'progress', quest: q, label: 'daily' });
  if (out.length < 3 && daily.length && daily.every((q) => q.claimed) && !data.daily?.bonus?.claimable) out.push({ kind: 'done' });
  for (const q of weekly) if (!q.done) out.push({ kind: 'progress', quest: q, label: 'weekly' });
  return out.slice(0, 3);
}

const pct = (q) => (q.target ? Math.round((Math.min(q.progress, q.target) / q.target) * 100) : 0);

/** Rangée des quêtes de l'accueil (`.status-row`, une ligne qui défile sur téléphone). */
export function QuestStrip() {
  const { t, num, error } = useI18n();
  const toast = useToast();
  const { data } = useQuests();
  const [busy, setBusy] = useState(null);
  const items = useMemo(() => (data ? stripItems(data) : []), [data]);
  if (!data || !items.length) return <BadgeToast />;

  const claim = async (item) => {
    setBusy(item.kind === 'bonus' ? 'bonus' : item.quest.id);
    try {
      const res = item.kind === 'bonus' ? await claimBonus(item.periodKey) : await claimQuest(item.periodKey, item.quest.slot);
      toast(t(item.kind === 'bonus' ? 'quests.bonusToast' : 'quests.toast', { reward: rewardText(t, num, res.reward) }), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="status-row pl-strip" data-home="quests" role="group" aria-label={t('quests.title')}>
      {items.map((item) => {
        if (item.kind === 'bonus') {
          return (
            <button key="bonus" type="button" className="quest-chip quest-chip--done" onClick={() => claim(item)} disabled={busy === 'bonus'} data-chip="bonus">
              <span className="q-ring" style={{ '--p': 100 }} />
              <span className="quest-chip__label">{t('quests.chip.bonus')}</span> {t('quests.chip.bonusClaim')}
            </button>
          );
        }
        if (item.kind === 'claim') {
          const q = item.quest;
          return (
            <button key={`c-${item.periodKey}-${q.slot}`} type="button" className="quest-chip quest-chip--done" onClick={() => claim(item)}
              disabled={busy === q.id} data-chip="claim" data-quest={q.defId}>
              <span className="q-ring" style={{ '--p': 100 }} />
              <span className="quest-chip__task">{questTitle(t, q)}</span>
              {q.reward?.royalties > 0 && <span className="royalties"><RoyaltyIcon size={14} /><span className="mono">+{num(q.reward.royalties)}</span></span>}
              <span className="quest-chip__label">{t('quests.chip.claim')}</span>
            </button>
          );
        }
        if (item.kind === 'first') {
          return (
            <Link key="first" to="/quests#first" className="quest-chip" data-chip="first">
              <span className="q-ring" style={{ '--p': Math.round((item.done / item.total) * 100) }} />
              <span className="quest-chip__label">{t('quests.chip.first')}</span>
              <span className="mono">{t('quests.chip.firstProgress', { done: item.done, total: item.total })}</span>
            </Link>
          );
        }
        if (item.kind === 'done') {
          return (
            <Link key="done" to="/quests" className="quest-chip quest-chip--done" data-chip="done">
              <span className="q-ring" style={{ '--p': 100 }} />
              {t('quests.chip.done')} <span className="quest-chip__label">· {t('quests.chip.doneBody')}</span>
            </Link>
          );
        }
        const q = item.quest;
        return (
          <Link key={`p-${q.id}`} to="/quests" className="quest-chip" data-chip="progress" data-quest={q.defId}>
            <span className="q-ring" style={{ '--p': pct(q) }} />
            <span className="quest-chip__label">{t(`quests.chip.${item.label}`)}</span>
            <span className="quest-chip__task">{questTitle(t, q)}</span>
            <span className="mono">{t('quests.progress', { progress: q.progress, target: q.target })}</span>
          </Link>
        );
      })}
      <BadgeToast />
    </div>
  );
}

// ----- battle de l'accueil ------------------------------------------------------------------------------------

/** Duel compact de la colonne de l'accueil : voter d'un clic, le suivant arrive tout seul. */
export function BattleWidget() {
  const { t } = useI18n();
  const battle = useBattleQueue(null);
  if (battle.error) return null;
  return (
    <section className="panel pl-widget" data-home="battle" aria-labelledby="pl-widget-title">
      <header className="pl-widget__head">
        <h2 className="panel__title" id="pl-widget-title"><Icon name="trophy" /> {t('battles.widgetTitle')}</h2>
        <Link to="/battles" className="section__link">{t('battles.widgetAll')}</Link>
      </header>
      {battle.current ? (
        <Duel duel={battle.current} result={battle.result} onVote={battle.vote} busy={battle.busy} compact />
      ) : battle.empty ? (
        <p className="small muted">{t('battles.emptyBody')}</p>
      ) : (
        <span className="skeleton pl-widget__skel" aria-hidden="true" />
      )}
      {battle.current && (
        <div className="pl-panel-foot">
          <span>{t('battles.widgetHint')}</span>
          <button type="button" className="link-btn" onClick={battle.skip} disabled={battle.busy}>{t('battles.skip')}</button>
        </div>
      )}
      <BadgeToast />
    </section>
  );
}

// ----- médailles ------------------------------------------------------------------------------------------------

/** Badges d'un joueur : les siens (avec la progression) ou ceux d'un autre (gagnés seulement). */
function useBadges(username) {
  const { user } = useGame();
  const self = !username || username.toLowerCase() === user?.username?.toLowerCase();
  const api = useApi(self ? '/badges' : `/users/${enc(username)}/badges`, { keep: false });
  return { ...api, self };
}

/** Récompense d'un palier (« +400 XP · +1 booster bonus », titre au dernier palier), comme shared/badges.js. */
function tierReward(t, num, family, tier) {
  const r = rewardFor(family, tier);
  const parts = [t('badges.reward.xp', { n: num(r.xp) })];
  if (r.royalties) parts.push(t('badges.reward.royalties', { n: num(r.royalties) }));
  if (r.boosters) parts.push(t('badges.reward.boosters'));
  if (r.cosmetic) parts.push(t('badges.reward.cosmetic', { name: t(`cosmetics.title.${r.cosmetic.split(':')[1]}`) }));
  return parts.join(' · ');
}

/** Détail d'une médaille : paliers, objectifs, récompenses, dates (ou progression). */
export function MedalDetail({ medal, onClose }) {
  const { t, date, num, lang } = useI18n();
  const name = medal ? medalName(t, medal, lang) : '';
  return (
    <Modal open={!!medal} onClose={onClose} title={name}>
      {medal && (
        <div className="pl-medal-detail">
          <Medal medal={medal} />
          <h3 className="label">{t('badges.tierList')}</h3>
          <ul className="pl-tiers">
            {medal.tiers.map((tier) => (
              <li key={tier.tier} className={`pl-tier${tier.earnedAt ? ' is-earned' : ''}`} data-tier={tier.tier}>
                <span className={`medal medal--sm ${medalTone(tier.tier)}`} aria-hidden="true"><span className="medal__disc" /></span>
                <span className="pl-tier__text">
                  <span className="pl-tier__goal">{t(`badges.tiers.${tier.tier}`)} · {tierGoal(t, medal, tier)}</span>
                  <span className="pl-tier__reward">{tierReward(t, num, medal.id, tier.tier)}</span>
                </span>
                <span className="pl-tier__state">
                  {tier.earnedAt
                    ? t('badges.earnedOn', { date: date(tier.earnedAt) })
                    : tier.progress != null ? <span className="mono">{tier.progress}/{tier.target}</span> : t('badges.locked')}
                </span>
              </li>
            ))}
          </ul>
          {/* Médaille d'un coffret ou d'un événement (P2-B) : lien vers sa page. */}
          {medal.variant && familyOf(medal.id)?.external && (
            <Link to={medal.id === 'event' ? `/events/${enc(medal.variant)}` : `/sets/${enc(medal.variant)}`} className="btn btn--ghost btn--sm"
              onClick={onClose} data-medal-link={medal.id}>
              <Icon name={medal.id === 'event' ? 'star' : 'disc'} size={16} /> {t(`badges.f.${medal.id}.open`)}
            </Link>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>{t('badges.close')}</button>
        </div>
      )}
    </Modal>
  );
}

/** Toutes les médailles d'un joueur, par rubrique (Collection, Critique, Partage, Jeu). */
export function BadgeGrid({ username }) {
  const { t } = useI18n();
  const { data, error, loading, reload, self } = useBadges(username);
  const [open, setOpen] = useState(null);
  if (error?.code === 'profile_private') return <p className="empty">{t('badges.private', { name: username })}</p>;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !data) return <div className="rows"><Skeleton kind="row" count={4} /></div>;
  if (!self && !data.families.length) return <p className="empty">{t('badges.emptyOther', { name: username })}</p>;
  return (
    <div className="pl-badges" data-badges={data.earned}>
      {BADGE_GROUPS.map((group) => {
        const list = data.families.filter((m) => m.group === group);
        if (!list.length) return null;
        return (
          <section key={group} className="panel pl-badge-group" data-group={group}>
            <h2 className="pl-badge-group__title">{t(`badges.groups.${group}`)}</h2>
            <div className="medals">
              {list.map((m) => <Medal key={`${m.id}:${m.variant ?? ''}`} medal={m} onClick={setOpen} />)}
            </div>
          </section>
        );
      })}
      <MedalDetail medal={open} onClose={() => setOpen(null)} />
      <BadgeToast />
    </div>
  );
}

/** Étagère de trophées du Studio : les plus belles médailles gagnées (8 au plus). */
export function TrophyShelf({ username }) {
  const { t } = useI18n();
  const { data, error, loading, self } = useBadges(username);
  const [open, setOpen] = useState(null);
  const best = useMemo(() => (data?.families || []).filter((m) => m.best)
    .sort((a, b) => tierRank(b.best) - tierRank(a.best) || (b.earnedAt || 0) - (a.earnedAt || 0))
    .slice(0, SHELF), [data]);
  // Studio privé, joueur introuvable ou bloqué : l'étagère ne s'affiche pas.
  if (error?.code === 'profile_private' || error?.code === 'user_not_found') return null;
  const all = self ? '/badges' : `/u/${enc(username)}/badges`;
  return (
    <section className="panel pl-shelf" data-studio="trophies" aria-labelledby="pl-shelf-title">
      <header className="pl-shelf__head">
        <h2 className="panel__title" id="pl-shelf-title"><Icon name="trophy" /> {t('badges.shelf')}</h2>
        {data && <Link to={all} className="section__link">{t('badges.seeAll')}</Link>}
      </header>
      {error ? (
        <p className="small muted">{t('badges.error')}</p>
      ) : loading || !data ? (
        <span className="skeleton pl-widget__skel" aria-hidden="true" />
      ) : !best.length ? (
        self
          ? <EmptyState icon="trophy" title={t('badges.emptySelf')} body={t('badges.emptySelfBody')} action={{ label: t('badges.emptySelfAction'), to: '/badges', primary: false }} />
          : <p className="small muted">{t('badges.emptyOther', { name: username })}</p>
      ) : (
        <div className="medals">
          {best.map((m) => <Medal key={`${m.id}:${m.variant ?? ''}`} medal={m} onClick={setOpen} />)}
        </div>
      )}
      <MedalDetail medal={open} onClose={() => setOpen(null)} />
      <BadgeToast />
    </section>
  );
}

// ----- autour de l'album ----------------------------------------------------------------------------------------

/** « Autour de l'album » : ses rangs dans les classements (5 au plus) et « Lancer un duel ». */
export function AlbumRankings({ albumId }) {
  const { t } = useI18n();
  const { data, error } = useApi(albumId ? `/items/album/${enc(albumId)}/rankings` : null, { keep: false });
  if (error || !albumId) return null;
  const items = data?.items || [];
  return (
    <section className="panel pl-around" data-album="rankings" aria-labelledby="pl-around-title">
      <h2 className="panel__title" id="pl-around-title"><Icon name="trophy" /> {t('rankings.around')}</h2>
      {!data ? (
        <span className="skeleton pl-widget__skel" aria-hidden="true" />
      ) : items.length ? (
        <ul className="pl-around__list">
          {items.map((r) => (
            <li key={r.category}>
              <Link to={`/rankings/${enc(r.category)}`} className="pl-around__row" data-category={r.category}>
                <span className="pl-around__rank">{t('rankings.rank', { n: r.rank })}</span>
                <span className="pl-around__text">
                  <span className="pl-around__label"><CategoryName category={r.category} /></span>
                  <span className="pl-around__of">
                    {t('rankings.of', { n: r.total })}
                    {r.provisional && <span className="chip chip--sm">{t('rankings.provisional')}</span>}
                  </span>
                </span>
                <span className="pl-around__go" aria-hidden="true"><Icon name="chevron" size={16} /></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">{t('rankings.aroundEmptyBody')}</p>
      )}
      {data && (
        <div className="pl-around__foot">
          <Link to={`/battles?category=${enc(data.vote)}`} className="btn btn--ghost btn--sm"><Icon name="trophy" size={16} /> {t('rankings.aroundVote')}</Link>
          <Link to="/rankings" className="btn btn--quiet btn--sm">{t('rankings.title')}</Link>
        </div>
      )}
    </section>
  );
}
