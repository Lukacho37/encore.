// Page /battles — chantier P1-F (PLAN.md 2.5 Battles, 5.4, 8.2 P1.5). Un duel à la fois : deux pochettes, « Je préfère »
// sous chacune, « Je ne connais pas l'un des deux » ; après le vote, les écarts d'Elo s'affichent et le duel suivant
// glisse. Catégorie : au hasard (tes goûts, le global, un artiste que tu connais), celle du jour, le global, ou celle de
// l'adresse (?category=, depuis un album ou un classement). Compteur du jour « 12 votes aujourd'hui · +60 XP ».
// « Écouter » mène à la page de l'album : jamais de lecteur intégré dans un duel (PLAN.md 7.1).
import { Link, useSearchParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { Icon } from '../components/ui.jsx';
import { BadgeToast } from '../components/play/BadgeToast.jsx';
import { CategoryName } from '../components/play/common.jsx';
import { Duel, useBattleQueue } from '../components/play/Duel.jsx';
import { parseCategory } from '@shared/battles.js';
import '../styles/play.css';

function DuelSkeleton() {
  return (
    <article className="duel" aria-busy="true">
      <div className="duel__head"><span className="skeleton pl-skel-title" /></div>
      <div className="duel__arena">
        <span className="duel__side"><span className="duel__cover skeleton" /></span>
        <span className="duel__vs" aria-hidden="true">VS</span>
        <span className="duel__side"><span className="duel__cover skeleton" /></span>
      </div>
    </article>
  );
}

export default function Battles() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get('category');
  const category = raw && parseCategory(raw) ? raw : null;
  const battle = useBattleQueue(category);
  const featured = battle.featured;
  const modes = [
    { key: null, label: t('battles.mix') },
    ...(featured ? [{ key: featured, label: <><Icon name="star" size={14} /> <CategoryName category={featured} variant="short" /></>, title: t('battles.featured') }] : []),
    ...(featured !== 'global:album' ? [{ key: 'global:album', label: <CategoryName category="global:album" variant="short" /> }] : []),
  ];
  if (category && !modes.some((m) => m.key === category)) modes.push({ key: category, label: <CategoryName category={category} variant="short" /> });
  const choose = (key) => setParams(key ? { category: key } : {}, { replace: true });

  return (
    <div className="pl-page" data-page="battles">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('battles.kicker')}</span>
          <h1>{t('battles.title')}</h1>
          <p className="pl-page__intro">{t('battles.intro')}</p>
        </div>
        <Link to="/rankings" className="btn btn--ghost btn--sm"><Icon name="list" size={16} /> {t('battles.rankings')}</Link>
      </header>
      <div className="pl-modes" role="group" aria-label={t('battles.mode')}>
        {modes.map((m) => (
          <button key={m.key || 'mix'} type="button" className={`chip chip--toggle${m.key === category ? ' is-on' : ''}`}
            aria-pressed={m.key === category} title={m.title} onClick={() => choose(m.key)} data-mode={m.key || 'mix'}>
            {m.label}
          </button>
        ))}
      </div>
      {battle.current ? (
        <Duel duel={battle.current} result={battle.result} onVote={battle.vote} busy={battle.busy} today={battle.today} />
      ) : battle.empty ? (
        <EmptyState icon="trophy" title={t('battles.empty')} body={t('battles.emptyBody')} className="pl-duel-empty"
          action={category ? { label: t('battles.emptyAction'), onClick: () => choose(null) } : { label: t('battles.rankings'), to: '/rankings', primary: false }} />
      ) : battle.error ? (
        <ErrorBox error={battle.error} onRetry={battle.reload} />
      ) : (
        <DuelSkeleton />
      )}
      <BadgeToast />
    </div>
  );
}
