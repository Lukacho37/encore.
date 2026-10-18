// Cartes Taste Match et amis suggérés (colonne de l'accueil, Amis) — chantier P1-E (PLAN.md 9.2). Props (contrat, ne pas
// les renommer) : TasteMatchCard : aucune ; SuggestedFriends { limit }.
//   TasteMatchCard    l'ami au goût le plus proche (GET /api/match/top) : paire d'avatars, « 87 % », les trois
//                     composantes les plus fortes, pochettes en commun, « Comparer en détail » (design-system-current
//                     §4.5, .match-card). Sans ami : rien, sauf pour un compte qui n'a pas encore fait ses premiers
//                     pas, invité à créer son profil musical (/welcome).
//   SuggestedFriends  joueurs suggérés (GET /api/match/suggestions?limit=) : goûts proches, amis en commun, artistes
//                     favoris en commun, avec le pourcentage et « Ajouter ». Sur l'accueil, seulement tant que le
//                     joueur a moins de 3 amis (PLAN.md 2.5) et en version compacte ; ailleurs (page Amis), toujours.
import { Link, useLocation } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useApi } from '../../state/catalog.js';
import { Avatar, Icon } from '../ui.jsx';
import { CoverRow, MatchBars, SuggestionRow } from './parts.jsx';
import '../../styles/discover.css';

const enc = encodeURIComponent;
const FEW_FRIENDS = 3;

/** Invitation à créer son profil musical (compte qui n'est pas encore passé par /welcome). */
export function ProfileInvite({ compact = false }) {
  const { t } = useI18n();
  return (
    <section className="panel dc-invite" data-home="profile-invite" aria-labelledby="dc-invite-title">
      <h2 className="panel__title" id="dc-invite-title"><Icon name="compass" /> {t('match.invite.title')}</h2>
      {!compact && <p>{t('match.invite.body')}</p>}
      <Link to="/welcome" className="btn btn--primary btn--sm">{t('match.invite.cta')}</Link>
    </section>
  );
}

export function TasteMatchCard() {
  const { t } = useI18n();
  const { user } = useGame();
  const { data } = useApi('/match/top', { keep: false });
  if (!data) return null;
  const m = data.match;
  if (!m) return user && user.onboarded === false ? <ProfileInvite /> : null;
  const name = m.user.username;
  const shown = (m.shared?.albums || []).slice(0, 4);
  const more = Math.max(0, (m.shared?.counts?.albums ?? m.shared?.albums?.length ?? 0) - shown.length);
  return (
    <article className="panel match-card" data-home="taste-match" aria-labelledby="dc-match-card-title">
      <h2 className="panel__title" id="dc-match-card-title"><Icon name="users" /> {t('match.cardTitle')}</h2>
      <div className="match-card__top">
        <span className="match-card__pair">
          <Avatar user={user} size={44} />
          <Avatar user={m.user} size={44} />
        </span>
        <div>
          <div className="match-card__pct">{t('match.pct', { n: m.score })}</div>
          <p className="muted small dc-card__pct-sub">
            {t('match.with', { name })}
            {m.estimate && <> · {t('match.confidence.low')}</>}
          </p>
        </div>
      </div>
      <MatchBars components={m.components} limit={3} />
      {shown.length > 0 && (
        <div className="panel__row">
          <CoverRow albumIds={shown} />
          {more > 0 && <span className="muted small">{t('match.shared.more', { n: more })}</span>}
        </div>
      )}
      <Link to={`/match/${enc(name)}`} className="btn btn--ghost btn--sm">{t('match.compare')}</Link>
    </article>
  );
}

export function SuggestedFriends({ limit = 8 }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const home = pathname === '/';
  const { data } = useApi(`/match/suggestions?limit=${Math.max(1, Math.min(12, Number(limit) || 8))}`, { keep: false });
  if (!data) return null;
  const items = data.items || [];
  if (home && (data.friendCount >= FEW_FRIENDS || !items.length)) return null;
  return (
    <section className="panel dc-suggest" data-home="suggestions" aria-labelledby="dc-suggest-title">
      <header className="dc-suggest__head">
        <h2 className="panel__title" id="dc-suggest-title">{t('match.suggestions.title')}</h2>
        {home && <Link to="/friends" className="section__link">{t('match.suggestions.seeAll')}</Link>}
      </header>
      {!home && <p className="small muted">{t('match.suggestions.lead')}</p>}
      {items.length ? (
        <div className="dc-suggest__list">
          {items.map((item) => <SuggestionRow key={item.user.id} item={item} compact={home} />)}
        </div>
      ) : (
        <p className="small muted">{t('match.suggestions.empty')}</p>
      )}
    </section>
  );
}
