// Pièces communes des pages et emplacements de P1-F : textes des quêtes, récompenses, libellés des catégories de
// battles, médailles (PLAN.md 5.4, 5.6, 5.7 ; design-system-current §4.7 à 4.9). Rien ici ne parle au serveur.
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useArtist } from '../../state/catalog.js';
import { Icon, RoyaltyIcon } from '../ui.jsx';
import { METRICS } from '@shared/quests.js';
import { familyOf } from '@shared/badges.js';
import { parseCategory } from '@shared/battles.js';
import { codeSet, generatedRule } from '@shared/sets.js';
import { eventDef } from '@shared/events.js';
import '../../styles/play.css';

export const enc = encodeURIComponent;

/** Décennie telle qu'on la dit : « 90 » pour 1990, « 2000 » pour 2000 (« les années 90 », « les années 2000 »). */
export const decadeLabel = (d) => (Number(d) < 2000 ? String(Number(d) % 100).padStart(2, '0') : String(d));

/** Titre d'une quête (« Note 3 albums », « Obtiens 3 nouvelles cartes · Électro »). */
export function questTitle(t, quest) {
  const vars = quest?.vars || {};
  return t(`quests.q.${quest.defId}`, {
    n: quest.target,
    genre: vars.genre ? t(`genre.${vars.genre}`) : '',
    d: vars.decade ? decadeLabel(vars.decade) : '',
  });
}

/** Icône de l'anneau d'une quête. */
export const questIcon = (quest) => METRICS[quest?.metric]?.icon || 'star';

/** Où faire une quête (lien « Y aller ») ; null quand c'est déjà sur la page. */
export function questLink(quest) {
  switch (quest?.metric) {
    case 'open_boosters':
    case 'new_cards':
      return '/#booster';
    case 'new_artist':
    case 'rate_albums':
    case 'rate_tracks':
    case 'rate_genres':
      return '/discover';
    case 'complete_album':
    case 'write_review':
      return '/collection';
    case 'battle_votes':
      return '/battles';
    case 'blindtest_play':
    case 'blindtest_score':
      return '/blindtest';
    case 'add_to_list':
      return '/lists';
    case 'post':
    case 'comment':
      return '/';
    case 'onboarded':
      return '/welcome';
    case 'add_friend':
      return '/friends';
    default:
      return null;
  }
}

/** Récompense en texte (« +50 royalties · +30 XP »), pour les messages. */
export function rewardText(t, num, reward = {}) {
  const parts = [];
  if (reward.royalties) parts.push(`+${num(reward.royalties)} royalties`);
  if (reward.xp) parts.push(t('quests.reward.xp', { n: reward.xp }));
  if (reward.boosters) parts.push(t('quests.reward.boosters', { n: reward.boosters }));
  if (reward.themed || reward.theme) parts.push(t('quests.reward.themed'));
  return parts.join(' · ');
}

/** Pastilles de récompense d'une quête : XP, royalties (or), booster (turquoise). */
export function RewardChips({ reward = {} }) {
  const { t, num } = useI18n();
  return (
    <span className="quest__rewards">
      {reward.royalties > 0 && (
        <span className="chip chip--sm chip--gold"><RoyaltyIcon size={13} /><span className="mono">+{num(reward.royalties)}</span></span>
      )}
      {reward.xp > 0 && <span className="chip chip--sm"><span className="mono">+{reward.xp}</span> XP</span>}
      {reward.boosters > 0 && <span className="chip chip--sm chip--cue">{t('quests.reward.boosters', { n: reward.boosters })}</span>}
      {(reward.themed > 0 || reward.theme) && <span className="chip chip--sm chip--cue">{t('quests.reward.themed')}</span>}
    </span>
  );
}

/** Anneau de progression (44 px) avec l'icône de la quête au centre. */
export function QuestRing({ quest, icon }) {
  const pct = quest.target ? Math.round((Math.min(quest.progress, quest.target) / quest.target) * 100) : 0;
  return (
    <span className="quest__ring" aria-hidden="true">
      <span className="q-ring q-ring--lg" style={{ '--p': pct }} />
      <Icon name={quest.done || quest.claimed ? 'check' : icon || questIcon(quest)} size={18} />
    </span>
  );
}

// ----- catégories des battles ----------------------------------------------------------------------------

/**
 * Libellés d'une catégorie (« Meilleur album de Daft Punk », court : « Daft Punk ») ; `name` : nom de repli quand
 * l'artiste ou l'album n'est pas encore dans le catalogue du site (pris sur les albums du duel).
 */
export function useCategoryLabel(key, { name: fallback } = {}) {
  const { t, country } = useI18n();
  const cat = parseCategory(key);
  const artist = useArtist(cat && (cat.kind === 'artist' || cat.kind === 'artist_tracks') ? cat.value : null);
  const album = useAlbum(cat && cat.kind === 'album_tracks' ? cat.value : null);
  if (!cat) return { long: '', short: '', kind: null };
  const vars = {
    name: artist?.name || album?.title || fallback || '',
    genre: cat.kind === 'genre' || cat.kind === 'genre_decade' ? t(`genre.${cat.value}`) : '',
    d: cat.kind === 'decade' ? decadeLabel(cat.value) : cat.kind === 'genre_decade' ? decadeLabel(cat.value2) : '',
    v: cat.kind === 'year' ? String(cat.value) : '',
    country: cat.kind === 'country' ? country(cat.value) : '',
  };
  return { long: t(`battles.label.${cat.kind}`, vars), short: t(`battles.short.${cat.kind}`, vars), kind: cat.kind, cat };
}

/** Libellé d'une catégorie, en composant (pour une liste). */
export function CategoryName({ category, variant = 'long', name }) {
  const label = useCategoryLabel(category, { name });
  return <>{variant === 'short' ? label.short : label.long}</>;
}

// ----- médailles -----------------------------------------------------------------------------------------

/** Classe de la médaille selon son meilleur palier (or par défaut, holo pour le platine). */
export const medalTone = (tier) => (tier === 'platinum' ? 'medal--holo' : tier === 'silver' ? 'medal--silver' : tier === 'bronze' ? 'medal--bronze' : tier ? '' : 'medal--locked');

/**
 * Nom du coffret ou de l'événement d'une médaille externe (variante : son identifiant), dans la langue du site ; un
 * coffret généré se recompose comme sur sa page (« Électro · Années 1990 »). '' s'il est inconnu.
 */
function externalName(t, lang, medal) {
  const id = medal.variant;
  if (!id) return '';
  if (medal.id === 'event') {
    const ev = eventDef(id);
    return ev?.title?.[lang] || ev?.title?.fr || '';
  }
  const rule = generatedRule(id);
  if (rule) return t('sets.generatedTitle', { genre: t(`genre.${rule.genre}`), decade: t('decade', { d: rule.decade }) });
  const def = codeSet(id);
  return def?.title?.[lang] || def?.title?.fr || '';
}

/**
 * Nom d'une médaille (« Explorateur des années 90 », « Fan de jazz », « Coffret · Les classiques du bac »). `lang` :
 * langue du site, pour le nom d'un coffret ou d'un événement (médailles externes).
 */
export function medalName(t, medal, lang = 'fr') {
  const vars = {};
  if (medal.id === 'explorer') vars.d = decadeLabel(medal.variant);
  if (medal.id === 'genre_fan') vars.genre = t(`genre.${medal.variant}`);
  if (familyOf(medal.id)?.external) {
    const name = externalName(t, lang, medal);
    if (name) return t(`badges.f.${medal.id}.named`, { name });
  }
  return t(`badges.f.${medal.id}.name`, vars);
}

/** Objectif d'un palier (« Compléter 10 albums »). */
export function tierGoal(t, medal, tier) {
  const goal = `badges.f.${medal.id}.goal`;
  const key = medal.id === 'explorer' ? `${goal}.${tier.metric}` : goal;
  return t(key, { n: tier.target });
}

/** Prochain palier à gagner (le premier qui ne l'est pas), ou null. */
export const nextTier = (medal) => medal.tiers.find((x) => !x.earnedAt) || null;

/**
 * Une médaille (`.medal`) : disque au meilleur palier gagné, nom, date (ou progression « 7/10 » du prochain palier).
 * `onClick` en fait un bouton (détail des paliers).
 */
export function Medal({ medal, onClick, small = false }) {
  const { t, date, lang } = useI18n();
  const best = medal.best;
  const next = nextTier(medal);
  const icon = familyOf(medal.id)?.icon || 'trophy';
  const name = medalName(t, medal, lang);
  const sub = best
    ? <span className="medal__date">{medal.earnedAt ? date(medal.earnedAt) : t(`badges.tiers.${best}`)}</span>
    : next && next.progress != null
      ? <span className="medal__date mono">{next.progress}/{next.target}</span>
      : <span className="medal__date">{t('badges.locked')}</span>;
  const inner = (
    <>
      <span className="medal__disc">
        <Icon name={best ? icon : 'lock'} size={best ? 22 : 20} />
        {best && <span className="medal__tier">{t(`badges.tiers.${best}`)}</span>}
      </span>
      <span className="medal__name">{name}</span>
      {sub}
    </>
  );
  const cls = `medal ${medalTone(best)}${small ? ' medal--sm' : ''}`;
  const variant = medal.variant ?? undefined;
  if (!onClick) return <div className={cls} data-medal={medal.id} data-variant={variant}>{inner}</div>;
  return (
    <button type="button" className={cls} data-medal={medal.id} data-variant={variant} onClick={() => onClick(medal)} aria-label={t('badges.detail', { name })}>
      {inner}
    </button>
  );
}
