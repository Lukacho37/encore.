// Pièces communes des coffrets et des événements — chantier P2-B (PLAN.md 6.8, 6.9) : titres (les coffrets générés se
// recomposent avec les noms de genre du site), dates d'un événement, carte d'un coffret (pochettes en éventail, vraies
// pochettes quand elles existent, progression en albums complétés, récompenses). Utilisées par l'onglet Coffrets de la
// collection, la page d'un coffret et la page d'un événement.
import { memo, useCallback } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbums } from '../../state/catalog.js';
import CoverArt from '../CoverArt.jsx';
import { Icon, Progress, useToast } from '../ui.jsx';
import '../../styles/sets.css';

export const enc = encodeURIComponent;

// Récompenses de coffret déjà annoncées pendant la session : une même réponse peut être lue deux fois (relecture,
// double montage en développement), le message ne s'affiche qu'une fois.
const announced = new Set();

/** Message « Coffret : badge débloqué ! » pour chaque récompense donnée à la lecture (`rewards` d'une réponse). */
export function useSetRewardToast() {
  const { t } = useI18n();
  const toast = useToast();
  return useCallback((rewards = []) => {
    for (const r of rewards) {
      const key = `${r.setId}:${r.reward}`;
      if (announced.has(key)) continue;
      announced.add(key);
      toast(t(`sets.rewardToast.${r.reward}`), 'success');
    }
  }, [t, toast]);
}

/** Titre d'un coffret dans la langue du site ; un coffret généré : « Électro · Années 1990 ». */
export function setTitle(t, lang, set) {
  if (!set) return '';
  if (set.kind === 'generated' && set.rule?.genre && set.rule?.decade) {
    const genre = t(`genre.${set.rule.genre}`);
    return t('sets.generatedTitle', { genre: genre === `genre.${set.rule.genre}` ? set.rule.genre : genre, decade: t('decade', { d: set.rule.decade }) });
  }
  return set.titles?.[lang] || set.titles?.fr || set.id;
}

/** Titre d'un événement dans la langue du site. */
export const eventTitle = (lang, ev) => ev?.titles?.[lang] || ev?.titles?.fr || ev?.slug || '';

/** « 16 nov. – 29 nov. 2026 » : la fenêtre d'un événement (fin exclue : le dernier jour est la veille). */
export function useEventDates() {
  const { lang } = useI18n();
  const short = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  const long = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });
  return (ev) => {
    if (!ev) return '';
    const last = ev.end - 12 * 3_600_000;
    return `${short.format(new Date(ev.start))} – ${long.format(new Date(last))}`;
  };
}

/** État d'un événement en clair : « encore 5 jours », « dans 24 jours », « Terminé ». */
export function eventWhen(t, ev) {
  if (!ev) return '';
  if (ev.status === 'current') return t('events.daysLeft', { n: ev.daysLeft ?? 0 });
  if (ev.status === 'upcoming') return t('events.startsIn', { n: ev.startsIn ?? 0 });
  return t('events.status.past');
}

/** Pochettes en éventail d'un coffret (4 au plus) : la vraie pochette quand elle existe, sinon le visuel généré. */
export function SetStack({ albumIds, size = 'md' }) {
  const albums = useAlbums(albumIds);
  return (
    <span className={`set-stack set-stack--${size}`} aria-hidden="true">
      {albumIds.map((id, i) => (
        <span key={id} className="set-stack__cover" style={{ '--i': i }}>
          {albums[i] ? <CoverArt art={{ ...albums[i].art, seed: albums[i].art?.seed || id }} sizes={size === 'lg' ? '120px' : '88px'} /> : null}
        </span>
      ))}
    </span>
  );
}

/** Pastilles des récompenses d'un coffret : badge (aux 3/4) et cadre (au complet), gagnés en or. */
export function SetRewardChips({ set }) {
  const { t } = useI18n();
  const r = set.rewards || {};
  return (
    <span className="set-chips-line">
      {r.badgeEarnedAt
        ? <span className="chip chip--sm chip--gold"><Icon name="trophy" size={13} /> {t('sets.badgeWon')}</span>
        : <span className="chip chip--sm"><Icon name="trophy" size={13} /> {t('sets.badgeAt', { n: r.badgeAt })}</span>}
      {r.frameEarnedAt
        ? <span className="chip chip--sm chip--gold"><Icon name="user" size={13} /> {t('sets.frameWon')}</span>
        : <span className="chip chip--sm"><Icon name="user" size={13} /> {t('sets.frameAt', { n: r.frameAt })}</span>}
    </span>
  );
}

/**
 * Carte d'un coffret (onglet Coffrets, page d'un événement) : pochettes, sorte, titre, « 3/8 » albums complétés avec
 * sa barre (or), cartes possédées, récompenses. Lien vers /sets/:id.
 */
export const SetCard = memo(function SetCard({ set }) {
  const { t, lang } = useI18n();
  const n = set.albumCount;
  const done = set.progress.completed;
  const complete = done >= n;
  const title = setTitle(t, lang, set);
  return (
    <Link to={`/sets/${enc(set.id)}`} className={`panel set-card${complete ? ' set-card--done' : ''}`} data-set={set.id}>
      <SetStack albumIds={set.covers} />
      <span className="set-card__body">
        <span className="set-card__kind">{t(`sets.kind.${set.kind}`)}</span>
        <span className="set-card__title">{title}</span>
        <span className="set-card__meta">
          {t('sets.albums', { n })}
          {set.progress.owned > 0 && <> · <span className="mono">{t('sets.cards', { owned: set.progress.owned, total: set.progress.total })}</span></>}
        </span>
        <span className="set-card__progress">
          <Progress value={done} max={n} color="var(--gold)" size="sm" label={t('sets.completed', { done, n })} />
          <span className="mono">{done}/{n}</span>
        </span>
        <SetRewardChips set={set} />
      </span>
    </Link>
  );
});
