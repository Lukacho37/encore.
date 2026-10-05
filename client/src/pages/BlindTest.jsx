import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { get, post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import Card from '../components/Card.jsx';
import { Icon, Spinner, useToast } from '../components/ui.jsx';
import { useTrack } from '../state/catalog.js';
import { sound } from '../sound.js';
import { storage } from '../storage.js';

const CLUE_STEP = 4; // secondes entre deux indices
const MIN_GENRE_TRACKS = 12; // en dessous, un genre donne des parties trop répétitives : il n'est pas proposé

/** Genres jouables : « tous » et ceux qui ont assez de morceaux au catalogue. */
const playableGenres = (info) => (info?.genres || []).filter((g) => g.id === 'all' || g.count >= MIN_GENRE_TRACKS);

function TimerRing({ seconds, total }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, seconds / total);
  return (
    <span className={`timer-ring${seconds <= 5 ? ' is-low' : ''}`}>
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} className="timer-ring__track" />
        <circle cx="30" cy="30" r={r} className="timer-ring__value" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />
      </svg>
      <span className="timer-ring__num mono">{Math.ceil(seconds)}</span>
    </span>
  );
}

function Clue({ clue }) {
  const { t, country } = useI18n();
  switch (clue.type) {
    case 'decade': return t('bt.clue.decade', { v: clue.value });
    case 'country': return t('bt.clue.country', { v: country(clue.value) });
    case 'year': return t('bt.clue.year', { v: clue.value });
    case 'position': return clue.value ? t('bt.clue.position', clue.value) : t('bt.clue.promo');
    case 'words': return t('bt.clue.words', { count: clue.value.count, n: clue.value.count, initial: clue.value.initial });
    default: return null;
  }
}

/** Réponse de la manche : carte, titre, artiste, album et année (la carte arrive avec la réponse du serveur). */
function AnswerReveal({ answer, choice, final, busy, onNext }) {
  const { t } = useI18n();
  const track = useTrack(answer.answer);
  const title = track?.title || choice?.title || '…';
  const artist = track?.artist || choice?.artist;
  let detail = null;
  if (track) detail = [track.kind === 'promo' || !track.albumId ? t('bt.clue.promo') : track.album, track.year].filter(Boolean).join(' · ');
  return (
    <section className={`bt-result${answer.correct ? ' is-right' : ' is-wrong'}`}>
      <div className="bt-result__card"><Card trackId={answer.answer} /></div>
      <div className="bt-result__text">
        <strong className="bt-result__verdict">
          {answer.correct ? t('bt.correct') : answer.timeout ? t('bt.timeout') : t('bt.wrong')}
          {answer.correct && <span className="mono"> {t('bt.points', { n: answer.points })}</span>}
        </strong>
        <span className="muted">{t('bt.answerWas')} <b>{title}</b>{artist ? ` · ${artist}` : ''}</span>
        {detail && <span className="small muted">{detail}</span>}
        <button type="button" className="btn btn--primary" onClick={onNext} disabled={busy} autoFocus>
          {final ? t('bt.seeResults') : t('bt.next')}
        </button>
      </div>
    </section>
  );
}

function Equalizer({ playing }) {
  return (
    <span className={`eq${playing ? ' is-playing' : ''}`} aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--d': `${(i * 137) % 600}ms` }} />)}
    </span>
  );
}

export default function BlindTest() {
  const { t, error, num } = useI18n();
  const { applyState, isAdmin } = useGame();
  const toast = useToast();
  const [reveal, setReveal] = useState(() => storage.get('albummania.btReveal') === '1');
  const toggleReveal = () => {
    storage.set('albummania.btReveal', reveal ? '0' : '1');
    setReveal(!reveal);
  };
  const [info, setInfo] = useState(null);
  const [genre, setGenre] = useState('all');
  const [game, setGame] = useState(null); // { id, rewarded }
  const [round, setRound] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [final, setFinal] = useState(null);
  const [score, setScore] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef(null);
  const startRef = useRef(0);
  const submitting = useRef(false);

  const loadInfo = useCallback(() => get('/blindtest').then(setInfo).catch((err) => toast(error(err.code), 'error')), [toast, error]);
  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const stopAudio = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  const beginRound = (r) => {
    setRound(r);
    setAnswer(null);
    setElapsed(0);
    startRef.current = performance.now();
    setNeedsTap(false);
  };

  // Lecture de l'extrait audio quand il y en a un.
  useEffect(() => {
    if (!round?.audio || answer) return;
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().then(() => setPlaying(true), () => setNeedsTap(true));
  }, [round, answer]);

  const submit = useCallback(async (choice) => {
    if (!game || answer || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    stopAudio();
    try {
      const res = await post(`/blindtest/${game.id}/answer`, { choice });
      setAnswer({ ...res.result, timeout: choice === null });
      setScore(res.result.score);
      if (res.result.correct) sound.correct();
      else sound.wrong();
      if (res.final) {
        setFinal(res.final);
        if (res.state) applyState(res.state);
      }
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [game, answer, applyState, toast, error]);

  // Chronomètre de la manche.
  useEffect(() => {
    if (!round || answer) return undefined;
    const id = setInterval(() => {
      const s = (performance.now() - startRef.current) / 1000;
      setElapsed(s);
      if (s >= round.seconds) submit(null);
      else if (round.seconds - s <= 5 && Math.floor(s * 2) % 2 === 0) sound.tick();
    }, 250);
    return () => clearInterval(id);
  }, [round, answer, submit]);

  const start = async () => {
    sound.unlock();
    setBusy(true);
    try {
      // Un genre choisi qui n'est plus proposé (catalogue modifié entre-temps) retombe sur « tous ».
      const res = await post('/blindtest/start', { genre: playableGenres(info).some((g) => g.id === genre) ? genre : 'all' });
      setGame({ id: res.gameId, rewarded: res.rewarded });
      setFinal(null);
      setScore(0);
      beginRound(res.round);
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (final) {
      setRound(null);
      return;
    }
    setBusy(true);
    try {
      const res = await post(`/blindtest/${game.id}/next`);
      beginRound(res.round);
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const quit = () => {
    stopAudio();
    setGame(null);
    setRound(null);
    setFinal(null);
    loadInfo();
  };

  if (!info) return <div className="boot boot--inline"><Spinner /></div>;

  // ---------- résultats ----------
  if (final && !round) {
    return (
      <div className="bt">
        <section className="bt-final panel">
          <span className="eyebrow">{t('bt.results')}</span>
          <h1 className="bt-final__score mono">{t('bt.score', { n: num(final.score) })}</h1>
          <p>{t('bt.correctCount', { n: final.correct, c: final.correct, total: final.rounds })}</p>
          <div className={`bt-final__reward${final.rewardPacks ? ' is-win' : ''}`}>
            <Icon name="pack" size={22} />
            <span>
              {final.rewardPacks ? t('bt.won', { n: final.rewardPacks }) : final.rewarded ? t('bt.wonNone') : t('bt.notRewarded')}
            </span>
          </div>
          <div className="bt-final__actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={() => { quit(); }}>{t('bt.again')}</button>
            {final.rewardPacks > 0 && <Link to="/" className="btn btn--ghost btn--lg">{t('bt.toPacks')}</Link>}
          </div>
        </section>
        <p className="muted small center">{t('bt.soon')}</p>
      </div>
    );
  }

  // ---------- manche en cours ----------
  if (round) {
    const remaining = Math.max(0, round.seconds - elapsed);
    const shownClues = round.clues ? Math.min(round.clues.length, 1 + Math.floor(elapsed / CLUE_STEP)) : 0;
    return (
      <div className="bt">
        <header className="bt-bar">
          <span className="mono">{t('bt.round', { n: round.index + 1, total: round.rounds })}</span>
          <span className="bt-bar__dots" aria-hidden="true">
            {Array.from({ length: round.rounds }, (_, i) => <i key={i} className={i < round.index ? 'is-done' : i === round.index ? 'is-now' : ''} />)}
          </span>
          <span className="mono bt-bar__score">{num(score)} pts</span>
          {isAdmin && (
            <label className="bt-reveal small">
              <input type="checkbox" checked={reveal} onChange={toggleReveal} /> {t('bt.adminReveal')}
            </label>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={quit}>{t('bt.quit')}</button>
        </header>

        <section className="bt-stage">
          <TimerRing seconds={answer ? 0 : remaining} total={round.seconds} />
          {round.audio ? (
            <div className="bt-audio">
              <audio ref={audioRef} src={round.audio} preload="auto" onEnded={() => setPlaying(false)} />
              <Equalizer playing={playing && !answer} />
              {needsTap && !answer ? (
                <button type="button" className="btn btn--primary" onClick={() => audioRef.current.play().then(() => { setPlaying(true); setNeedsTap(false); })}>
                  {t('bt.play')}
                </button>
              ) : <p className="muted">{t('bt.listening')}</p>}
            </div>
          ) : (
            <div className="bt-clues">
              <span className="eyebrow">{t('bt.clues')}</span>
              <ol>
                {round.clues.map((c, i) => (
                  <li key={c.type} className={i < shownClues || answer ? 'is-shown' : ''}>
                    {i < shownClues || answer ? <Clue clue={c} /> : t('bt.clue.hidden')}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <div className="bt-choices">
          {round.choices.map((c) => {
            const state = !answer ? '' : c.id === answer.answer ? ' is-right' : c.id === answer.picked ? ' is-wrong' : ' is-dim';
            return (
              <button key={c.id} type="button" className={`bt-choice${state}`} onClick={() => submit(c.id)} disabled={!!answer || busy}>
                <span className="bt-choice__title">{c.title}</span>
                <span className="bt-choice__artist">{c.artist}</span>
                {isAdmin && reveal && !answer && round.answer === c.id && <span className="bt-choice__admin">{t('bt.adminTag')}</span>}
              </button>
            );
          })}
        </div>

        {answer && (
          <AnswerReveal answer={answer} choice={round.choices.find((c) => c.id === answer.answer)} final={final} busy={busy} onNext={next} />
        )}
      </div>
    );
  }

  // ---------- accueil ----------
  const limitReached = info.rewardedLimit != null && info.rewardedToday >= info.rewardedLimit;
  const genres = playableGenres(info);
  const selected = genres.some((g) => g.id === genre) ? genre : 'all';
  // Libellé d'un genre ; un genre sans traduction garde son identifiant.
  const genreName = (id) => {
    const label = t(`genre.${id}`);
    return label === `genre.${id}` ? id : label;
  };
  return (
    <div className="bt">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('nav.blindtest')}</span>
          <h1>{t('bt.title')}</h1>
          <p className="muted measure">{t('bt.intro')}</p>
        </div>
      </header>
      <div className="bt-intro">
        <section className="panel">
          <h2 className="panel__title">{t('bt.genre')}</h2>
          <div className="genre-grid" role="radiogroup" aria-label={t('bt.genre')}>
            {genres.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={selected === g.id} className={`genre-btn genre-btn--${g.id}${selected === g.id ? ' is-on' : ''}`} onClick={() => setGenre(g.id)}>
                <span className="genre-btn__name">{genreName(g.id)}</span>
                <span className="small muted">{t('bt.tracks', { n: g.count })}</span>
              </button>
            ))}
          </div>
          <p className="small muted">{info.audio ? t('bt.audioMode') : t('bt.clueMode')}</p>
          <button type="button" className="btn btn--primary btn--xl" onClick={start} disabled={busy}>
            <Icon name="headphones" /> {t('bt.start')}
          </button>
        </section>
        <aside className="panel">
          <h2 className="panel__title">{t('bt.rewards')}</h2>
          <ul className="reward-list">
            {Object.entries(info.rewards).sort((a, b) => b[0] - a[0]).map(([c, n]) => (
              <li key={c}><span>{t('bt.rewardRow', { c, n })}</span><span className="reward-list__packs" aria-hidden="true">{'▮'.repeat(n)}</span></li>
            ))}
          </ul>
          <p className={`small${limitReached ? ' form-error' : ' muted'}`}>
            {info.rewardedLimit == null ? t('bt.todayUnlimited') : limitReached ? t('bt.limitReached') : t('bt.today', { n: info.rewardedToday, max: info.rewardedLimit })}
          </p>
          <p className="small muted">{t('bt.soon')}</p>
        </aside>
      </div>
    </div>
  );
}
