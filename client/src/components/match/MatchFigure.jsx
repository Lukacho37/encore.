// Pourcentage Taste Match (en-tête du Studio, cartes de joueurs) — chantier P1-E (PLAN.md 9.2). Props (contrat, ne pas les
// renommer) : { username }. En plus, facultatifs :
//   score   score déjà connu (amis suggérés : il vient avec la réponse), sans requête ;
//   inline  « 87 % goûts communs » sur une ligne (en-tête du Studio) au lieu du chiffre au-dessus du libellé ;
//   link    false : pas de lien vers /match/:username (défaut : lien).
// Les scores se lisent par lots : les figures montées dans le même instant (une page d'amis, des résultats de recherche)
// partagent un seul GET /api/match/batch?usernames=… (30 pseudos au plus) ; un score « pending » (le serveur en calcule
// 5 neufs par appel) est redemandé un peu plus tard, trois fois au plus. Les scores sont gardés pour la session (le
// serveur les garde 6 h). Rien ne s'affiche pour soi-même, un joueur bloqué, un Studio fermé ou un score inconnu.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { get } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import '../../styles/discover.css';

const BATCH = 30;
const RETRY_MS = 1500;
const RETRIES = 3;

const scores = new Map(); // pseudo (minuscules) → score | null
const tries = new Map(); // pseudo → demandes restées « pending »
const waiting = new Map(); // pseudo → abonnés (fonctions d'état des figures montées)
let queue = new Set();
let timer = null;

const keyOf = (name) => String(name || '').toLowerCase();

function notify(key) {
  for (const fn of waiting.get(key) || []) fn(scores.get(key));
}

async function flush() {
  timer = null;
  const names = [...queue];
  queue = new Set();
  for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH);
    let res;
    try {
      res = await get(`/match/batch?usernames=${chunk.map(encodeURIComponent).join(',')}`);
    } catch {
      // Limite atteinte ou réseau : pas de chiffre plutôt qu'une erreur.
      for (const name of chunk) {
        scores.set(keyOf(name), null);
        notify(keyOf(name));
      }
      continue;
    }
    const pending = new Set((res.pending || []).map(keyOf));
    const byKey = new Map(Object.entries(res.scores || {}).map(([k, v]) => [keyOf(k), v]));
    for (const name of chunk) {
      const key = keyOf(name);
      if (pending.has(key) && (tries.get(key) || 0) < RETRIES) {
        tries.set(key, (tries.get(key) || 0) + 1);
        setTimeout(() => request(name), RETRY_MS);
        continue;
      }
      scores.set(key, byKey.has(key) ? byKey.get(key) : null);
      notify(key);
    }
  }
}

function request(name) {
  queue.add(name);
  if (!timer) timer = setTimeout(flush, 30);
}

/** Score Taste Match avec `username` : undefined tant qu'il n'est pas connu, null s'il n'y en a pas. */
export function useMatchScore(username, known) {
  const key = keyOf(username);
  const [score, setScore] = useState(() => scores.get(key));
  useEffect(() => {
    if (!key || known != null) return undefined;
    if (scores.has(key)) {
      setScore(scores.get(key));
      return undefined;
    }
    const subscribers = waiting.get(key) || new Set();
    waiting.set(key, subscribers);
    subscribers.add(setScore);
    request(username);
    return () => subscribers.delete(setScore);
  }, [key, username, known]);
  return known != null ? known : score;
}

/** Oublie les scores gardés (les goûts ont changé : premiers pas refaits, par exemple). */
export function forgetMatchScores() {
  scores.clear();
  tries.clear();
}

export function MatchFigure({ username, score: known, inline = false, link = true }) {
  const { t } = useI18n();
  const { user } = useGame();
  const self = !!username && keyOf(username) === keyOf(user?.username);
  const score = useMatchScore(self ? null : username, known);
  if (self || !username || score == null || !Number.isFinite(score)) return null;
  const label = t('match.figureLabel', { score, name: username });
  const body = (
    <>
      <b>{t('match.pct', { n: score })}</b>
      <span>{t('match.figure')}</span>
    </>
  );
  const className = `match-figure${inline ? ' dc-figure--inline' : ''}`;
  return link ? (
    <Link to={`/match/${encodeURIComponent(username)}`} className={className} aria-label={label} title={label} data-match-figure={score}>{body}</Link>
  ) : (
    <span className={className} role="img" aria-label={label} title={label} data-match-figure={score}>{body}</span>
  );
}

export default MatchFigure;
