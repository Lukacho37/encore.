// Pastille de l'événement en cours (accueil) — chantier P2-B (PLAN.md 2.5, 6.9, 9.2). Props (contrat, ne pas les
// renommer) : aucune. Posée par Home.jsx SOUS la rangée Boutique / Doublons / Blind test, jamais dans le héros.
//   EventChip  l'événement en cours (« French Touch · encore 5 jours · 1/3 ») ; sans événement en cours, le prochain s'il
//              commence dans moins de 21 jours (« Bientôt · French Touch · dans 9 jours ») ; rien sinon.
// La pastille du Rétro (décembre, janvier) est celle de P2-A (components/passport/RetroChip.jsx), posée à côté par
// Home.jsx. GET /api/events, relue à chaque arrivée sur l'accueil.
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useApi } from '../../state/catalog.js';
import { enc, eventTitle, eventWhen } from './parts.jsx';
import '../../styles/play.css';
import '../../styles/sets.css';

/** Calendrier vu par le joueur (GET /api/events), relu à chaque montage de l'accueil. */
export const useEventsOverview = () => useApi('/events', { keep: false });

export function EventChip() {
  const { t, lang } = useI18n();
  const { data } = useEventsOverview();
  if (!data) return null;
  const live = (data.current || []).filter((e) => e.kind === 'event').slice(0, 2);
  if (!live.length && data.soon) {
    const ev = data.soon;
    return (
      <Link to={`/events/${enc(ev.slug)}`} className="quest-chip quest-chip--event set-chip" data-chip="event-soon" data-event={ev.slug}>
        <span className="quest-chip__dot" aria-hidden="true" />
        <span className="quest-chip__label">{t('events.soon')}</span>
        <span className="quest-chip__task">{eventTitle(lang, ev)}</span>
        <span className="quest-chip__label">· {eventWhen(t, ev)}</span>
      </Link>
    );
  }
  return (
    <>
      {live.map((ev) => (
        <Link key={ev.slug} to={`/events/${enc(ev.slug)}`} className="quest-chip quest-chip--event set-chip" data-chip="event" data-event={ev.slug}>
          <span className="quest-chip__dot" aria-hidden="true" />
          <span className="quest-chip__task">{eventTitle(lang, ev)}</span>
          <span className="quest-chip__label">· {eventWhen(t, ev)}</span>
          {ev.quests?.total > 0 && <span className="mono" title={t('events.questsShort', ev.quests)}>{ev.quests.claimed}/{ev.quests.total}</span>}
        </Link>
      ))}
    </>
  );
}

export default EventChip;
