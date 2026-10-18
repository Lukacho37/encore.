// Morceaux communs du Taste Match — chantier P1-E (fichier propre au chantier, dossier components/match/) :
//   MatchBars       barres des composantes (.match-bars : libellé | progression | valeur), avec la phrase qui explique
//                   chacune (« 14 éléments notés en commun, à 1,2 point près ») quand `explain` est vrai ;
//   CoverRow        rangée de petites pochettes (.cover-row) qui mènent aux albums (vraies pochettes, repli généré) ;
//   SuggestionRow   ligne d'un joueur suggéré (.user-card : avatar, pseudo, raison, pourcentage, « Ajouter ») ;
//   decadeLabel     « années 90 », « années 2000 » (« 90s », « 2000s »).
// Styles : discover.css.
import { useState } from 'react';
import { Link } from 'react-router';
import { post } from '../../api.js';
import CoverArt from '../CoverArt.jsx';
import { Avatar, Icon, Progress, useToast } from '../ui.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useAlbums, useArtists } from '../../state/catalog.js';
import { MatchFigure } from './MatchFigure.jsx';
import '../../styles/discover.css';

const enc = encodeURIComponent;

/** « années 90 » / « années 2000 » ; « 90s » / « 2000s ». */
export function decadeLabel(t, decade) {
  const d = Number(decade);
  return t('discover.decadeShort', { d: d < 2000 ? String(d % 100).padStart(2, '0') : d });
}

/** Nom d'un genre (identifiant gardé s'il n'a pas de traduction). */
export function genreName(t, id) {
  const label = t(`genre.${id}`);
  return label === `genre.${id}` ? id : label;
}

/** « A, B et C » (« A, B and C »). */
export function joinNames(t, names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')}${t('match.explain.and')}${list[list.length - 1]}`;
}

/** Phrase qui explique une composante, dans l'échelle de notes du joueur (étoiles : écart divisé par deux). */
function useExplain() {
  const { t, lang } = useI18n();
  const { ratingScale } = useGame();
  return (c, artistNames) => {
    const v = c.vars || {};
    const fmt = (x) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(x);
    switch (c.key) {
      case 'ratings':
        if (c.value == null || !v.n) return t('match.explain.ratingsNone');
        return ratingScale === 'points'
          ? t('match.explain.ratingsPoints', { n: v.n, gap: fmt(v.gap ?? 0) })
          : t('match.explain.ratingsStars', { n: v.n, gap: fmt((v.gap ?? 0) / 2) });
      case 'loved':
        return v.n ? t('match.explain.loved', { n: v.n }) : t('match.explain.lovedNone');
      case 'artists':
        return artistNames.length ? t('match.explain.artists', { names: joinNames(t, artistNames) }) : t('match.explain.artistsNone');
      case 'genres':
        return v.ids?.length ? t('match.explain.genres', { names: joinNames(t, v.ids.map((g) => genreName(t, g))) }) : t('match.explain.none');
      case 'decades':
        return v.ids?.length ? t('match.explain.decades', { decade: decadeLabel(t, v.ids[0]) }) : t('match.explain.none');
      default:
        return '';
    }
  };
}

/**
 * Barres des composantes. `limit` : les N plus fortes seulement (carte de l'accueil) ; `explain` : la phrase sous
 * chaque barre (page Taste Match).
 */
export function MatchBars({ components = [], limit = 0, explain = false }) {
  const { t } = useI18n();
  const artistIds = components.find((c) => c.key === 'artists')?.vars?.ids || [];
  const artists = useArtists(artistIds);
  const why = useExplain();
  const names = artists.map((a, i) => a?.name || (a === undefined ? '' : artistIds[i])).filter(Boolean);
  let list = components;
  if (limit) list = components.filter((c) => c.value != null).sort((a, b) => b.value - a.value).slice(0, limit);
  return (
    <ul className="match-bars">
      {list.map((c) => (
        <li key={c.key} className={c.value == null ? 'is-empty' : undefined} data-component={c.key}>
          <span>{t(`match.components.${c.key}`)}</span>
          <Progress value={c.value ?? 0} max={100} color="var(--cue)" size="sm" label={`${t(`match.components.${c.key}`)} · ${c.value ?? 0}`} />
          <span className="mono">{c.value ?? '–'}</span>
          {explain && <span className="dc-bars__why">{why(c, names)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Petites pochettes des albums (liens) : vraies pochettes, visuel généré en repli. */
export function CoverRow({ albumIds = [], max = 4 }) {
  const ids = albumIds.slice(0, max);
  const albums = useAlbums(ids);
  return (
    <span className="cover-row">
      {ids.map((id, i) => {
        const a = albums[i];
        return (
          <Link key={id} to={`/album/${enc(id)}`} title={a ? `${a.title} · ${a.artist}` : undefined} aria-label={a?.title || id}>
            {a && <CoverArt art={{ ...a.art, seed: a.art?.seed || a.id }} sizes="40px" />}
          </Link>
        );
      })}
    </span>
  );
}

/** Raison d'une suggestion : goûts proches, amis en commun, artistes favoris en commun. */
function useReason(item) {
  const { t } = useI18n();
  const artists = useArtists(item.reason === 'favorites' ? item.artists || [] : []);
  if (item.reason === 'friends_of_friends' && item.mutualFriends > 0) return t('match.suggestions.reason.friends_of_friends', { n: item.mutualFriends });
  if (item.reason === 'favorites' && artists.some(Boolean)) {
    return t('match.suggestions.reason.favorites', { artists: joinNames(t, artists.map((a) => a?.name)) });
  }
  if (item.mutualFriends > 0) return t('match.suggestions.reason.friends_of_friends', { n: item.mutualFriends });
  return t('match.suggestions.reason.taste');
}

/**
 * Ligne d'un joueur suggéré : avatar, pseudo, raison, pourcentage, « Ajouter » (demande d'ami). `compact` (colonne
 * étroite de l'accueil) : bouton rond « + » au lieu du bouton avec son libellé.
 */
export function SuggestionRow({ item, compact = false }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [relation, setRelation] = useState(item.user.relation);
  const [busy, setBusy] = useState(false);
  const reason = useReason(item);
  const name = item.user.username;
  const add = async () => {
    setBusy(true);
    try {
      const res = await post('/friends/request', { username: name });
      setRelation(res.status === 'accepted' ? 'friend' : 'outgoing');
    } catch (err) {
      if (err.code === 'already_requested') setRelation('outgoing');
      else if (err.code === 'already_friends') setRelation('friend');
      else toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="user-card" data-suggestion={name}>
      <Link to={`/u/${enc(name)}`} tabIndex={-1} aria-hidden="true"><Avatar user={item.user} size={44} /></Link>
      <div className="dc-suggest__who">
        <Link to={`/u/${enc(name)}`} className="user-card__name">{name}</Link>
        <span className="user-card__sub">{reason}</span>
      </div>
      <div className="dc-suggest__actions">
        <MatchFigure username={name} score={item.score ?? undefined} />
        {relation === 'friend' ? (
          <span className="chip chip--sm chip--ok"><Icon name="check" size={12} /> {t('match.suggestions.friend')}</span>
        ) : relation === 'outgoing' ? (
          <span className="chip chip--sm">{t('match.suggestions.sent')}</span>
        ) : compact ? (
          <button type="button" className="icon-btn dc-suggest__add" onClick={add} disabled={busy} data-add-friend={name}
            aria-label={`${t('match.suggestions.add')} · ${name}`} title={t('match.suggestions.add')}>
            <Icon name="plus" size={16} />
          </button>
        ) : (
          <button type="button" className="btn btn--ghost btn--sm dc-suggest__btn" onClick={add} disabled={busy} data-add-friend={name}>
            <Icon name="plus" size={14} /> {t('match.suggestions.add')}
          </button>
        )}
      </div>
    </div>
  );
}
