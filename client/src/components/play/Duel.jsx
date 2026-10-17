// Un duel (« battle ») à la fois — chantier P1-F (PLAN.md 2.5 Battles, 5.4 ; design-system-current §4.7).
//   useBattleQueue(category) : file de duels signés (GET /api/battles/next?n=3), vote (POST /api/battles/vote), écarts
//     d'Elo affichés puis duel suivant qui glisse ; « Je ne connais pas l'un des deux » ; plus de paire → `empty`.
//   <Duel duel result onVote busy compact /> : deux pochettes (vraies pochettes quand elles existent, visuel généré
//     sinon), titres, artiste et année, « Je préfère », médaillon VS. Jamais de lecteur intégré dans un duel : « Écouter »
//     mène à la page de l'album (PLAN.md 7.1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { get, post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useTrack } from '../../state/catalog.js';
import CoverArt from '../CoverArt.jsx';
import { useToast } from '../ui.jsx';
import { enc, useCategoryLabel } from './common.jsx';

const SHOW_RESULT_MS = 1100;
const pairOf = (d) => `${d.itemType}|${d.a}|${d.b}`;

/**
 * File de duels d'une catégorie (null : au hasard). Renvoie { current, result, busy, loading, empty, error, today,
 * featured, vote(winner), skip(), reload() }. `today` : { votes, xp, xpLeft } du jour.
 */
export function useBattleQueue(category) {
  const { error: errorText } = useI18n();
  const toast = useToast();
  const [queue, setQueue] = useState([]);
  const [state, setState] = useState({ loading: true, empty: false, error: null, today: null, featured: null });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);
  const seen = useRef(new Set());
  const timer = useRef(null);

  const add = useCallback((duels = []) => {
    const fresh = duels.filter((d) => !seen.current.has(pairOf(d)));
    for (const d of fresh) seen.current.add(pairOf(d));
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
    return fresh.length;
  }, []);

  const load = useCallback((reset = false) => {
    const mine = ++ticket.current;
    if (reset) {
      seen.current = new Set();
      setQueue([]);
      setResult(null);
    }
    setState((s) => ({ ...s, loading: true, error: null, ...(reset ? { empty: false } : {}) }));
    const qs = `?n=3${category ? `&category=${enc(category)}` : ''}`;
    return get(`/battles/next${qs}`)
      .then((res) => {
        if (mine !== ticket.current) return;
        const n = add(res.duels);
        setState((s) => ({ ...s, loading: false, today: res.today, featured: res.featured, empty: s.empty || (!n && reset) }));
      })
      .catch((err) => {
        if (mine !== ticket.current) return;
        if (err.code === 'no_duel') setState((s) => ({ ...s, loading: false, empty: true }));
        else setState((s) => ({ ...s, loading: false, error: err }));
      });
  }, [category, add]);

  useEffect(() => {
    load(true);
    return () => clearTimeout(timer.current);
  }, [load]);

  const current = queue[0] || null;

  // Duel suivant : on garde au moins deux duels d'avance.
  useEffect(() => {
    if (!state.loading && !state.empty && !state.error && queue.length < 2 && !busy) load(false);
  }, [queue.length, state.loading, state.empty, state.error, busy, load]);

  const advance = useCallback(() => {
    setResult(null);
    setQueue((q) => q.slice(1));
    setBusy(false);
  }, []);

  const vote = useCallback(async (winner) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const res = await post('/battles/vote', { token: current.token, winner, ...(category ? { category } : {}) });
      if (res.next?.duels?.length) add(res.next.duels);
      else if (res.next === null && category) setState((s) => ({ ...s, emptyAfter: true }));
      setState((s) => ({
        ...s,
        today: s.today ? { ...s.today, votes: res.todayCount, xp: (s.today.xp || 0) + (res.xp || 0), xpLeft: Math.max(0, (s.today.xpLeft || 0) - (res.xp || 0)) } : s.today,
      }));
      if (res.skipped) {
        advance();
        return;
      }
      setResult({ token: current.token, winner, deltaA: res.deltaA, deltaB: res.deltaB, xp: res.xp });
      clearTimeout(timer.current);
      timer.current = setTimeout(advance, SHOW_RESULT_MS);
    } catch (err) {
      // Jeton expiré, paire déjà votée : on passe au suivant sans bloquer.
      if (['bad_token', 'already_voted'].includes(err.code)) advance();
      else {
        setBusy(false);
        toast(errorText(err.code), 'error');
      }
    }
  }, [current, busy, category, add, advance, toast, errorText]);

  const empty = !current && (state.empty || state.emptyAfter) && !state.loading;
  return {
    current, result, busy, loading: state.loading && !current, empty, error: !current ? state.error : null, today: state.today,
    featured: state.featured, vote, skip: () => vote(null), reload: () => load(true),
  };
}

/** Données d'un côté du duel (album ou morceau), lues dans le catalogue du site. */
function useItem(itemType, id) {
  const album = useAlbum(itemType === 'album' ? id : null);
  const track = useTrack(itemType === 'track' ? id : null);
  if (itemType === 'track') {
    return track ? { id, title: track.title, meta: [track.artist, track.album].filter(Boolean).join(' · '), art: track.art, href: `/track/${enc(id)}` } : null;
  }
  return album ? { id, title: album.title, meta: [album.artist, album.year].filter(Boolean).join(' · '), art: album.art, href: `/album/${enc(id)}`, artist: album.artist } : null;
}

function Side({ item, side, result, onVote, busy, compact }) {
  const { t } = useI18n();
  const chosen = result?.winner === side;
  const delta = result ? (side === 'a' ? result.deltaA : result.deltaB) : null;
  const cls = `duel__side${chosen ? ' is-chosen' : result ? ' is-other' : ''}`;
  return (
    <button type="button" className={cls} onClick={() => onVote(side)} disabled={busy || !item} data-side={side}
      aria-label={item ? t('battles.preferAria', { title: item.title }) : undefined}>
      <span className="duel__cover">
        {item?.art ? <CoverArt art={{ ...item.art, seed: item.art.seed || item.id }} title={item.title} sizes={compact ? '120px' : '300px'} /> : <span className="cover skeleton" />}
        {delta != null && (
          <span className={`duel__delta${delta > 0 ? ' duel__delta--up' : ''}`}>{delta > 0 ? '+' : '−'}{Math.abs(Math.round(delta))}</span>
        )}
      </span>
      <span className="duel__title">{item?.title || '…'}</span>
      <span className="duel__meta">{item?.meta || ''}</span>
      {!compact && <span className="btn btn--ghost btn--block">{t('battles.prefer')}</span>}
    </button>
  );
}

/** Le duel : en-tête (catégorie, votes du jour), arène, pied (passer, XP, classement, écouter). */
export function Duel({ duel, result, onVote, busy, today, compact = false, head = true }) {
  const { t } = useI18n();
  const a = useItem(duel.itemType, duel.a);
  const b = useItem(duel.itemType, duel.b);
  const label = useCategoryLabel(duel.category, { name: duel.itemType === 'album' && a?.artist === b?.artist ? a?.artist : undefined });
  const arena = (
    <div className={`duel__arena is-dealt${compact ? ' pl-widget__arena' : ''}`} key={duel.token}>
      <Side item={a} side="a" result={result} onVote={onVote} busy={busy} compact={compact} />
      <span className="duel__vs" aria-hidden="true">VS</span>
      <Side item={b} side="b" result={result} onVote={onVote} busy={busy} compact={compact} />
    </div>
  );
  if (compact) {
    return (
      <>
        <span className="pl-widget__label">{label.long}</span>
        {arena}
      </>
    );
  }
  const xpLeft = today?.xpLeft ?? null;
  return (
    <article className="duel" data-duel={duel.category}>
      {head && (
        <header className="duel__head">
          <div>
            <span className="eyebrow">{t('battles.kicker')} · {label.short}</span>
            <h2>{label.long}</h2>
          </div>
          {today && (
            <span className="chip chip--quiet" data-today={today.votes}>
              {t('battles.today', { n: today.votes })}
              {today.xp > 0 && <> · <span className="mono">{t('battles.xpGain', { n: today.xp })}</span></>}
            </span>
          )}
        </header>
      )}
      {arena}
      <footer className="duel__foot">
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => onVote(null)} disabled={busy}>{t('battles.skip')}</button>
        <span className="label">
          {result?.xp ? t('battles.xpGain', { n: result.xp }) : xpLeft === 0 ? t('battles.xpDone') : t('battles.xpRule')}
        </span>
      </footer>
      <footer className="duel__foot">
        <span className="label">
          {t('battles.listenOn')}{' '}
          {a && <Link to={a.href} className="duel__listen">{a.title}</Link>}
          {a && b && ' · '}
          {b && <Link to={b.href} className="duel__listen">{b.title}</Link>}
        </span>
        <Link to={`/rankings/${enc(duel.category)}`} className="section__link">{t('battles.seeRanking')}</Link>
      </footer>
    </article>
  );
}

export default Duel;
