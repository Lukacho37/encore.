// Page /quests — chantier P1-F (PLAN.md 2.5 Quests, 5.6, 6.7). Du jour (3 quêtes + « Bonus du jour » quand les 3
// sont réclamées, une relance gratuite par jour) · De la semaine (3 + booster thématique) · Premiers pas (tant qu'ils
// ne sont pas tous réclamés). Chaque quête : anneau de progression, récompense, « Réclamer » ou « Y aller ».
// Pas de série à tenir, pas de punition : une période finie laisse simplement place à la suivante.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { ErrorBox } from '../components/feedback.jsx';
import { Icon, MiniPack, formatDuration, useNow, useToast } from '../components/ui.jsx';
import { BadgeToast } from '../components/play/BadgeToast.jsx';
import { QuestRing, RewardChips, questLink, questTitle, rewardText } from '../components/play/common.jsx';
import { claimBonus, claimQuest, rerollQuest, useQuests } from '../components/play/questStore.js';
import '../styles/play.css';

function QuestRow({ quest, periodKey, canReroll, busy, onAct }) {
  const { t } = useI18n();
  const link = questLink(quest);
  const cls = `quest${quest.done ? ' quest--done' : ''}${quest.claimed ? ' quest--claimed' : ''}`;
  return (
    <li className={cls} data-quest={quest.defId} data-slot={quest.slot}>
      <QuestRing quest={quest} />
      <div>
        <div className="quest__title">{questTitle(t, quest)}</div>
        <RewardChips reward={quest.reward} />
      </div>
      <div className="quest__side">
        {quest.claimed ? (
          <span className="chip chip--sm chip--gold"><Icon name="check" size={14} /> {t('quests.claimed')}</span>
        ) : quest.done ? (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onAct('claim', periodKey, quest)}>{t('quests.claim')}</button>
        ) : (
          <>
            <span className="mono quest__count">{t('quests.progress', { progress: quest.progress, target: quest.target })}</span>
            {link && <Link to={link} className="quest__go">{t('quests.go')}</Link>}
            {canReroll && (
              <button type="button" className="quest__reroll" disabled={busy} onClick={() => onAct('reroll', periodKey, quest)}
                aria-label={t('quests.rerollAria')} title={t('quests.reroll')}>
                <Icon name="recycle" size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** Ligne du bonus de la période (booster bonus du jour, booster thématique de la semaine). */
function BonusRow({ period, scope, busy, onBonus }) {
  const { t } = useI18n();
  const claimed = period.slots.filter((q) => q.claimed).length;
  const bonus = period.bonus || {};
  const cls = `quest quest--bonus${bonus.claimable || bonus.claimed ? ' quest--done' : ''}${bonus.claimed ? ' quest--claimed' : ''}`;
  return (
    <li className={cls} data-bonus={scope}>
      <span className="quest__pack" aria-hidden="true"><MiniPack /></span>
      <div>
        <div className="quest__title">{t(scope === 'daily' ? 'quests.bonusDaily' : 'quests.bonusWeekly')}</div>
        <p className="small muted">{t(scope === 'daily' ? 'quests.bonusDailyBody' : 'quests.bonusWeeklyBody')}</p>
      </div>
      <div className="quest__side">
        {bonus.claimed ? (
          <span className="chip chip--sm chip--gold"><Icon name="check" size={14} /> {t('quests.bonusClaimed')}</span>
        ) : bonus.claimable ? (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onBonus(period.periodKey)}>{t('quests.bonusClaim')}</button>
        ) : (
          <span className="mono quest__count">{t('quests.bonusLocked', { n: claimed })}</span>
        )}
      </div>
    </li>
  );
}

function Countdown({ end }) {
  const { t } = useI18n();
  useNow(1000);
  const left = Math.max(0, end - Date.now());
  return <span className="pl-section__meta">{t('quests.renews', { time: '' })}<span className="mono">{formatDuration(left)}</span></span>;
}

function PeriodPanel({ id, title, period, scope, busy, onAct, onBonus }) {
  const { t } = useI18n();
  return (
    <section className="panel" id={id} data-period={scope} aria-labelledby={`${id}-title`}>
      <header className="pl-section__head">
        <h2 className="panel__title" id={`${id}-title`}>{title}</h2>
        <Countdown end={period.endsAt} />
      </header>
      <ul className="quests">
        {period.slots.map((q) => (
          <QuestRow key={q.slot} quest={q} periodKey={period.periodKey} busy={busy}
            canReroll={scope === 'daily' && period.rerollsLeft > 0 && !q.claimed && !q.done} onAct={onAct} />
        ))}
        <BonusRow period={period} scope={scope} busy={busy} onBonus={onBonus} />
      </ul>
      {scope === 'daily' && (
        <p className="pl-panel-foot">
          {period.rerollsLeft > 0 ? t('quests.rerollLeft', { n: period.rerollsLeft }) : t('quests.rerollNone')}
        </p>
      )}
    </section>
  );
}

export default function Quests() {
  const { t, num, error } = useI18n();
  const toast = useToast();
  const { hash } = useLocation();
  const { data, error: loadError, reload } = useQuests();
  const [busy, setBusy] = useState(false);

  // Lien « Premiers pas » de l'accueil : la section défile sous les yeux.
  useEffect(() => {
    if (hash === '#first' && data) document.getElementById('first')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [hash, data]);

  const act = async (kind, periodKey, quest) => {
    setBusy(true);
    try {
      if (kind === 'claim') {
        const res = await claimQuest(periodKey, quest.slot);
        toast(t('quests.toast', { reward: rewardText(t, num, res.reward) }), 'success');
      } else {
        const res = await rerollQuest(periodKey, quest.slot);
        toast(t('quests.rerolled', { title: questTitle(t, res.quest) }));
      }
    } catch (err) {
      toast(error(err.code), 'error');
      if (err.code === 'period_over') reload();
    } finally {
      setBusy(false);
    }
  };
  const bonus = async (periodKey) => {
    setBusy(true);
    try {
      const res = await claimBonus(periodKey);
      toast(t('quests.bonusToast', { reward: rewardText(t, num, res.reward) }), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pl-page" data-page="quests">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('quests.kicker')}</span>
          <h1>{t('quests.title')}</h1>
          <p className="pl-page__intro">{t('quests.intro')}</p>
        </div>
        <Link to="/badges" className="btn btn--ghost btn--sm"><Icon name="trophy" size={16} /> {t('badges.title')}</Link>
      </header>
      {loadError && !data ? (
        <ErrorBox error={loadError} onRetry={reload} />
      ) : !data ? (
        <div className="pl-grid" aria-busy="true">
          {[0, 1].map((i) => (
            <section key={i} className="panel">
              <span className="skeleton pl-skel-quest" />
              <span className="skeleton pl-skel-quest" />
              <span className="skeleton pl-skel-quest" />
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="pl-grid">
            <PeriodPanel id="daily" title={t('quests.daily')} period={data.daily} scope="daily" busy={busy} onAct={act} onBonus={bonus} />
            <PeriodPanel id="weekly" title={t('quests.weekly')} period={data.weekly} scope="weekly" busy={busy} onAct={act} onBonus={bonus} />
          </div>
          {data.firstSteps?.length > 0 && (
            <section className="panel" id="first" data-period="first" aria-labelledby="first-title">
              <header className="pl-section__head">
                <h2 className="panel__title" id="first-title">{t('quests.first')}</h2>
                <span className="pl-section__meta">
                  <span className="mono">{data.firstSteps.filter((q) => q.claimed).length}/{data.firstSteps.length}</span>
                </span>
              </header>
              <p className="small muted">{t('quests.firstIntro')}</p>
              <ul className="quests">
                {data.firstSteps.map((q) => <QuestRow key={q.slot} quest={q} periodKey="first" busy={busy} onAct={act} />)}
              </ul>
            </section>
          )}
        </>
      )}
      <BadgeToast />
    </div>
  );
}
