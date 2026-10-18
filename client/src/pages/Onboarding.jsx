// Premiers pas (/welcome) — chantier P1-E (PLAN.md 2.5, 4.2.7, 5.9 ; design-system-current §4.11).
// Cinq étapes, chacune peut être passée (« Passer » vide l'étape et continue) :
//   1. genres     la grille de genres du blind test (.genre-grid), 3 au moins ;
//   2. artistes   .pick-artists (pastilles d'artistes des genres choisis) + recherche d'un autre artiste, 3 à 10 ;
//   3. 9 albums   la grille « Mes 9 albums » de P1-C (Grid9 : toucher une case, la croix, glisser pour échanger),
//                 suggestions (albums des artistes choisis, puis des genres) et recherche ; elle devient « Mes 9 albums »
//                 et la liste d'envies ;
//   4. notes      quelques albums populaires de ces genres à noter vite (RatingInput) ou « Pas écouté » ;
//   5. résultat   profil musical en une phrase, boosters de bienvenue (3 thématiques + un booster d'album au choix,
//                 une seule fois par compte), 12 premières recommandations, amis suggérés, Premiers pas ; il finit
//                 sur « Ouvrir mes boosters » (héros de l'accueil, /#booster).
// GET /api/onboarding?genres=&artists=&exclude= → options de chaque étape (et ce que le joueur avait choisi :
// « Refaire mon profil musical » repart de là) ; POST /api/onboarding → résultat (et l'état partiel du joueur :
// user.onboarded). « Plus tard » : POST { skip: true } pour un nouveau compte (l'accueil n'insiste plus), simple retour
// sinon. Le brouillon survit à un rechargement (sessionStorage, facultatif).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { post } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { apiPath, clearApiCache, useAlbums, useApi, useArtists } from '../state/catalog.js';
import { Icon, Spinner, useToast } from '../components/ui.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { PackArt } from '../components/PackOpening.jsx';
import { AlbumTile } from '../components/AlbumTile.jsx';
import { RatingInput } from '../components/Rating.jsx';
import { ErrorBox } from '../components/feedback.jsx';
import { ArtistBadge } from '../components/search/ArtistBadge.jsx';
import { SearchCombobox } from '../components/search/SearchCombobox.jsx';
import { Grid9 } from '../components/lists/Grid9.jsx';
import { decadeLabel, genreName, SuggestionRow } from '../components/match/parts.jsx';
import { forgetMatchScores } from '../components/match/MatchFigure.jsx';
import '../styles/discover.css';

const STEPS = ['genres', 'artists', 'nine', 'rate', 'result'];
const GENRES_MIN = 3;
const ARTISTS_MIN = 3;
const ARTISTS_MAX = 10;
const GRID = 9;
const RATE_SHOWN = 5;
const RATE_MAX = 10;
const DRAFT_KEY = 'albummania.onboarding';
const EMPTY_GRID = Array(GRID).fill(null);
const TILE_SIZES = '(max-width: 640px) 45vw, 160px';

/** Brouillon gardé le temps de l'onglet (facultatif : stockage indisponible = rien de gardé). */
const draft = {
  read() {
    try {
      const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  },
  write(v) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(v));
    } catch {
      // stockage plein ou interdit : tant pis pour le brouillon
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // idem
    }
  },
};

const padGrid = (list = []) => Array.from({ length: GRID }, (_, i) => list[i] || null);

// ----- étape 1 : genres -----------------------------------------------------------------------------

function GenresStep({ genres, picked, toggle }) {
  const { t } = useI18n();
  return (
    <div className="genre-grid" role="group" aria-label={t('onboarding.genres.title')}>
      {genres.map((g) => {
        const on = picked.includes(g.id);
        return (
          <button key={g.id} type="button" role="checkbox" aria-checked={on} data-genre={g.id}
            className={`genre-btn genre-btn--${g.id}${on ? ' is-on' : ''}`} onClick={() => toggle(g.id)}>
            <span className="genre-btn__name">{genreName(t, g.id)}</span>
            <span className="small muted">{t('onboarding.genres.albums', { n: g.albums })}</span>
          </button>
        );
      })}
    </div>
  );
}

// ----- étape 2 : artistes ---------------------------------------------------------------------------

function ArtistsStep({ options, extra, picked, toggle, onPick }) {
  const { t } = useI18n();
  const ids = useMemo(() => [...new Set([...extra, ...(options?.artists || [])])], [extra, options]);
  const artists = useArtists(ids);
  const artAlbumIds = ids.map((id) => options?.artistAlbums?.[id] || '');
  const albums = useAlbums(artAlbumIds);
  const full = picked.length >= ARTISTS_MAX;
  return (
    <>
      <div className="dc-step__tools">
        <div className="dc-step__search">
          <SearchCombobox scope="artist" variant="inline" recent={false} label={t('onboarding.artists.searchLabel')}
            placeholder={t('onboarding.artists.search')} onSubmit={() => {}}
            onPick={(r) => r?.kind === 'artist' && onPick(String(r.id))} />
        </div>
        <span className="dc-step__count mono" aria-live="polite">{full ? t('onboarding.artists.max') : t('onboarding.artists.count', { n: picked.length })}</span>
      </div>
      {!options ? (
        <div className="pick-artists" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => <span key={i} className="skeleton dc-pick-skel" />)}
        </div>
      ) : (
        <div className="pick-artists" role="group" aria-label={t('onboarding.artists.title')}>
          {ids.map((id, i) => {
            const on = picked.includes(id);
            const a = artists[i];
            return (
              <button key={id} type="button" className={`pick-artist${on ? ' is-on' : ''}`} aria-pressed={on} data-artist={id}
                disabled={!on && full} onClick={() => toggle(id)}>
                <span className="dc-pick-artist__badge">
                  <ArtistBadge artist={a || { id, name: '?' }} size={72} art={albums[i]?.art} />
                  {on && <span className="pick-artist__check"><Icon name="check" size={14} /></span>}
                </span>
                {a?.name || '…'}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ----- étape 3 : 9 albums ---------------------------------------------------------------------------

function PickTile({ albumId, album, on, disabled, onClick }) {
  const { t } = useI18n();
  return (
    <button type="button" className={`dc-pick${on ? ' is-on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick} data-pick={albumId}
      aria-label={album ? (on ? `${album.title} · ${t('onboarding.nine.added')}` : t('onboarding.nine.add', { title: album.title })) : undefined}>
      <span className="dc-pick__cover">
        {album && <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} sizes="110px" />}
      </span>
      {on && <span className="dc-pick__check" aria-hidden="true"><Icon name="check" size={13} /></span>}
      <span className="dc-pick__title">{album?.title || '…'}</span>
    </button>
  );
}

function PickGroup({ title, ids, grid, onToggle }) {
  const albums = useAlbums(ids);
  const full = grid.filter(Boolean).length >= GRID;
  return (
    <div className="dc-nine__group">
      <h3 className="label">{title}</h3>
      <div className="dc-picks">
        {ids.map((id, i) => {
          const on = grid.includes(id);
          return <PickTile key={id} albumId={id} album={albums[i]} on={on} disabled={!on && full} onClick={() => onToggle(id)} />;
        })}
      </div>
    </div>
  );
}

function NineStep({ options, grid, setGrid }) {
  const { t } = useI18n();
  const [slot, setSlot] = useState(null);
  const inputRef = useRef(null);
  const filled = grid.filter(Boolean).length;
  const place = (id) => {
    setGrid((g) => {
      if (g.includes(id)) return g;
      const next = [...g];
      const at = slot != null && !next[slot] ? slot : next.indexOf(null);
      if (at < 0) return g;
      next[at] = id;
      return next;
    });
    setSlot(null);
  };
  const toggle = (id) => (grid.includes(id) ? setGrid((g) => g.map((x) => (x === id ? null : x))) : place(id));
  const groups = options?.albums || [];
  return (
    <div className="dc-nine">
      <div className="dc-nine__grid">
        <Grid9 slots={grid} editable compact
          onSlot={(i) => {
            setSlot(i);
            inputRef.current?.focus();
          }}
          onRemove={(i) => setGrid((g) => g.map((x, j) => (j === i ? null : x)))}
          onSwap={(a, b) => setGrid((g) => {
            const next = [...g];
            [next[a], next[b]] = [next[b], next[a]];
            return next;
          })} />
        <p className="small muted">{filled >= GRID ? t('onboarding.nine.full') : t('onboarding.nine.slotHint')}</p>
      </div>
      <div className="dc-nine__picks">
        <div className="dc-step__tools">
          <div className="dc-step__search">
            <SearchCombobox scope="album" variant="inline" recent={false} inputRef={inputRef} label={t('onboarding.nine.searchLabel')}
              placeholder={t('onboarding.nine.search')} onSubmit={() => {}}
              onPick={(r) => r?.kind === 'album' && place(String(r.id))} />
          </div>
          <span className="dc-step__count mono" aria-live="polite">{t('onboarding.nine.count', { n: filled })}</span>
        </div>
        {!options ? (
          <div className="dc-picks" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <span key={i} className="skeleton dc-pick-skel" />)}</div>
        ) : groups.map((g) => (
          <PickGroup key={g.key} title={g.key === 'artists' ? t('onboarding.nine.fromArtists') : g.key === 'popular' ? t('discover.sections.popular') : genreName(t, g.key)}
            ids={g.items} grid={grid} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}

// ----- étape 4 : notes rapides ----------------------------------------------------------------------

function RateRow({ albumId, album, value, onChange }) {
  const { t } = useI18n();
  const skipped = value === null;
  return (
    <li className={`dc-rate__item${value !== undefined ? ' is-done' : ''}`} data-rate={albumId}>
      <span className="dc-rate__cover">{album && <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} sizes="64px" />}</span>
      <span className="dc-rate__text">
        <span className="dc-rate__title">{album?.title || '…'}</span>
        <span className="dc-rate__artist">{album ? `${album.artist}${album.year ? ` · ${album.year}` : ''}` : ''}</span>
      </span>
      <span className="dc-rate__input">
        <RatingInput value={typeof value === 'number' ? value : null} onChange={(v) => onChange(typeof v === 'number' ? v : undefined)} size={26} compact label={album?.title} />
        <button type="button" className={`btn btn--ghost btn--sm dc-rate__skip${skipped ? ' is-on' : ''}`} aria-pressed={skipped}
          onClick={() => onChange(skipped ? undefined : null)} data-not-heard="">
          {skipped && <Icon name="check" size={14} />} {t('onboarding.rate.notHeard')}
        </button>
      </span>
    </li>
  );
}

function RateStep({ options, ratings, setRating }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(RATE_SHOWN);
  const ids = (options?.quickRate || []).slice(0, RATE_MAX);
  const albums = useAlbums(ids);
  const rated = Object.values(ratings).filter((v) => typeof v === 'number').length;
  if (!options) return <div className="rows"><span className="skel-row" /><span className="skel-row" /><span className="skel-row" /></div>;
  return (
    <>
      <ul className="dc-rate">
        {ids.slice(0, shown).map((id, i) => (
          <RateRow key={id} albumId={id} album={albums[i]} value={ratings[id]} onChange={(v) => setRating(id, v)} />
        ))}
      </ul>
      <div className="dc-step__tools">
        <span className="dc-step__count">{t('onboarding.rate.count', { n: rated })}</span>
        {shown < ids.length && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShown(ids.length)}>
            <Icon name="plus" size={14} /> {t('onboarding.rate.more')}
          </button>
        )}
      </div>
    </>
  );
}

// ----- résultat ---------------------------------------------------------------------------------------

function boosterLabel(t, b, albums) {
  const [kind, value] = String(b.theme || '').split(':');
  if (kind === 'genre') return t('onboarding.result.booster.genre', { genre: genreName(t, value) });
  if (b.theme === 'album:choice') return t('onboarding.result.booster.choice');
  if (kind === 'album') return albums.get(value)?.title || t('onboarding.result.booster.album');
  return t('onboarding.result.booster.album');
}

/** « Premiers pas » : la série de quêtes (libellés de l'espace « quests » de P1-F), la première déjà faite. */
function FirstSteps({ steps }) {
  const { t } = useI18n();
  const rows = (steps || []).map((s) => ({ ...s, label: t(`quests.q.${s.id}`, { n: s.target }) }))
    .filter((s) => !s.label.startsWith('quests.'));
  if (!rows.length) return null;
  return (
    <ol className="dc-first">
      {rows.map((s) => {
        const done = s.metric === 'onboarded';
        return (
          <li key={s.id} className={done ? 'is-done' : undefined} data-first-step={s.id}>
            <span className="dc-first__mark" aria-hidden="true">{done && <Icon name="check" size={12} />}</span>
            <span>{s.label}</span>
            {done && <span className="sr-only">{t('onboarding.result.stepDone')}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Result({ result }) {
  const { t } = useI18n();
  const p = result.profile || {};
  const recIds = (result.recommendations || []).map((r) => r.id);
  const recAlbums = useAlbums(recIds);
  const boosterAlbumIds = (result.boosters || []).map((b) => (b.theme?.startsWith('album:') && b.theme !== 'album:choice' ? b.theme.slice(6) : '')).filter(Boolean);
  const bAlbums = useAlbums(boosterAlbumIds);
  const albumMap = new Map(boosterAlbumIds.map((id, i) => [id, bAlbums[i]]));
  const parts = [
    ...(p.genres || []).map((g) => genreName(t, g)),
    ...(p.decades || []).slice(0, 1).map((d) => decadeLabel(t, d)),
    p.flavour ? t(`onboarding.result.flavour.${p.flavour}`) : null,
  ].filter(Boolean);
  const sentence = parts.join(' · ');
  const friends = result.suggestedFriends || [];
  return (
    <div className="dc-onboard" data-onboarding="result">
      <section className="panel dc-step dc-invite">
        <p className="eyebrow">{t('onboarding.result.eyebrow')}</p>
        <h1 className="dc-result__profile" data-profile={sentence}>{sentence ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}` : t('onboarding.result.titleEmpty')}</h1>
        {!sentence && <p>{t('onboarding.result.empty')}</p>}
        {result.grid9?.length > 0 && <p><Icon name="heart" size={14} /> {t('onboarding.result.wishlist')}</p>}
        <div className="dc-result__cta">
          <Link to="/#booster" className="btn btn--primary btn--lg" data-open-boosters=""><Icon name="pack" size={18} /> {t('onboarding.result.open')}</Link>
          <Link to="/discover" className="btn btn--ghost">{t('onboarding.result.discover')}</Link>
        </div>
      </section>

      <div className="dc-result__cols">
        <section className="panel" data-result="boosters">
          <h2 className="panel__title"><Icon name="pack" /> {t('onboarding.result.boostersTitle')}</h2>
          {result.boosters?.length ? (
            <>
              <p className="small muted">{t('onboarding.result.boostersBody')}</p>
              <ul className="dc-boosters">
                {result.boosters.map((b) => {
                  const albumId = b.theme?.startsWith('album:') && b.theme !== 'album:choice' ? b.theme.slice(6) : null;
                  return (
                    <li key={b.id} className="dc-booster" data-booster={b.theme}>
                      <span className="dc-booster__pack"><PackArt album={albumId ? albumMap.get(albumId) : undefined} /></span>
                      <span>{boosterLabel(t, b, albumMap)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : <p className="small muted">{t('onboarding.result.boostersNone')}</p>}
        </section>
        <section className="panel" data-result="first-steps">
          <h2 className="panel__title"><Icon name="trophy" /> {t('onboarding.result.firstSteps')}</h2>
          <p className="small muted">{t('onboarding.result.firstStepsBody')}</p>
          <FirstSteps steps={result.firstSteps} />
          <Link to="/quests#first" className="btn btn--ghost btn--sm">{t('onboarding.result.quests')}</Link>
        </section>
      </div>

      {recIds.length > 0 && (
        <section className="panel" data-result="recommendations">
          <h2 className="panel__title"><Icon name="compass" /> {t('onboarding.result.recsTitle')}</h2>
          <p className="small muted">{t('onboarding.result.recsBody')}</p>
          <div className="dc-grid">
            {recIds.map((id, i) => (recAlbums[i] ? <AlbumTile key={id} album={recAlbums[i]} discover compact sizes={TILE_SIZES} /> : null))}
          </div>
        </section>
      )}

      <section className="panel dc-suggest" data-result="friends">
        <h2 className="panel__title"><Icon name="users" /> {t('onboarding.result.friendsTitle')}</h2>
        {friends.length ? (
          <div className="dc-suggest__list">{friends.map((item) => <SuggestionRow key={item.user.id} item={item} />)}</div>
        ) : <p className="small muted">{t('onboarding.result.friendsEmpty')}</p>}
      </section>
    </div>
  );
}

// ----- page -----------------------------------------------------------------------------------------

export default function Onboarding() {
  const { t, error: errorText } = useI18n();
  const { user } = useGame();
  const navigate = useNavigate();
  const toast = useToast();
  const base = useApi('/onboarding', { keep: false });
  const saved = useMemo(() => draft.read(), []);
  const [step, setStep] = useState(() => Math.min(3, Math.max(0, Number(saved?.step) || 0)));
  const [genres, setGenres] = useState(() => (Array.isArray(saved?.genres) ? saved.genres : []));
  const [artists, setArtists] = useState(() => (Array.isArray(saved?.artists) ? saved.artists : []));
  const [extraArtists, setExtraArtists] = useState(() => (Array.isArray(saved?.extra) ? saved.extra : []));
  const [grid, setGrid] = useState(() => padGrid(Array.isArray(saved?.grid) ? saved.grid : []));
  const [ratings, setRatings] = useState(() => (saved?.ratings && typeof saved.ratings === 'object' ? saved.ratings : {}));
  const [query, setQuery] = useState(() => saved?.query || null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const prefilled = useRef(!!saved);

  // « Refaire mon profil musical » : on repart de ce qui avait été choisi.
  useEffect(() => {
    const mine = base.data?.mine;
    if (!mine || prefilled.current) return;
    prefilled.current = true;
    setGenres(mine.genres || []);
    setArtists(mine.artists || []);
    setExtraArtists(mine.artists || []);
    setGrid(padGrid(mine.grid9 || []));
  }, [base.data]);

  useEffect(() => {
    if (!result) draft.write({ step, genres, artists, extra: extraArtists, grid, ratings, query });
  }, [step, genres, artists, extraArtists, grid, ratings, query, result]);

  // Options d'une étape : figées à l'entrée de l'étape (genres, artistes, 9 albums choisis jusque-là).
  const options = useApi(query && step >= 1 && step <= 3 ? query : null).data;

  const gridIds = grid.filter(Boolean);
  // `over` : ce que l'étape qu'on passe vient de vider (l'état n'est pas encore à jour dans cette fermeture).
  const queryFor = (next, over = {}) => apiPath('/onboarding', {
    genres: (over.genres ?? genres).join(','),
    artists: next >= 2 ? (over.artists ?? artists).join(',') : '',
    exclude: next >= 3 ? (over.grid ?? gridIds).join(',') : '',
  });

  const go = (next, over) => {
    if (next >= 1 && next <= 3) setQuery(queryFor(next, over));
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  const submit = async (overrides = {}) => {
    setBusy(true);
    try {
      const g = overrides.genres ?? genres;
      const a = overrides.artists ?? artists;
      const body = {
        genres: g.length >= GENRES_MIN ? g : [],
        artists: a.length >= ARTISTS_MIN && a.length <= ARTISTS_MAX ? a : [],
        grid9: (overrides.grid ?? gridIds).slice(0, GRID),
        ratings: Object.entries(overrides.ratings ?? ratings).filter(([, v]) => v !== undefined).slice(0, RATE_MAX)
          .map(([albumId, score]) => ({ albumId, score: typeof score === 'number' ? score : null })),
      };
      const res = await post('/onboarding', body);
      draft.clear();
      clearApiCache('/discover');
      clearApiCache('/match');
      clearApiCache('/me/grid9');
      forgetMatchScores();
      setResult(res.result);
      setStep(4);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast(`${t('onboarding.submitError')} ${errorText(err.code)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    draft.clear();
    if (user?.onboarded) {
      navigate('/');
      return;
    }
    setBusy(true);
    try {
      await post('/onboarding', { skip: true });
    } catch {
      // pas grave : l'invitation restera sur l'accueil
    }
    navigate('/');
  };

  // Étape suivante (Continuer) ou passée (Passer : l'étape est vidée).
  const next = (skip = false) => {
    if (step === 0) {
      if (skip) setGenres([]);
      go(1, skip ? { genres: [] } : undefined);
    } else if (step === 1) {
      if (skip) setArtists([]);
      go(2, skip ? { artists: [] } : undefined);
    } else if (step === 2) {
      if (skip) setGrid(EMPTY_GRID);
      go(3, skip ? { grid: [] } : undefined);
    } else if (step === 3) {
      submit(skip ? { ratings: {}, grid: gridIds } : { grid: gridIds });
    }
  };

  const valid = [
    genres.length >= GENRES_MIN,
    artists.length >= ARTISTS_MIN && artists.length <= ARTISTS_MAX,
    gridIds.length >= 1,
    true,
  ][step];
  const hint = step === 0 && genres.length < GENRES_MIN
    ? t('onboarding.genres.min', { n: GENRES_MIN - genres.length })
    : step === 1 && artists.length < ARTISTS_MIN ? t('onboarding.genres.min', { n: ARTISTS_MIN - artists.length }) : '';

  if (step === 4 && result) return <Result result={result} />;

  const name = STEPS[step];
  const toggle = (list, set, id, max = Infinity) => set(list.includes(id) ? list.filter((x) => x !== id) : list.length >= max ? list : [...list, id]);
  return (
    <div className="dc-onboard" data-onboarding={name}>
      <div className="dc-onboard__top">
        <span className="eyebrow">{t('onboarding.eyebrow')}{user?.username ? ` · @${user.username}` : ''}</span>
        <button type="button" className="link-btn" onClick={later} disabled={busy} data-onboarding-later="">{t('onboarding.skipAll')}</button>
      </div>
      <section className="panel dc-step" aria-labelledby="dc-step-title">
        <div className="steps" aria-label={t('onboarding.stepOf', { n: step + 1, total: STEPS.length })}>
          <span className="steps__bar" aria-hidden="true">
            {STEPS.map((s, i) => <i key={s} className={i < step ? 'is-done' : i === step ? 'is-current' : undefined} />)}
          </span>
          <span className="mono muted small">{step + 1}/{STEPS.length}</span>
        </div>
        <h1 className="dc-step__title" id="dc-step-title">{t(`onboarding.${name}.title`)}</h1>
        <p className="dc-step__lead">{t(`onboarding.${name}.body`)}</p>

        {step === 0 && (base.error ? <ErrorBox error={base.error} onRetry={base.reload} /> : !base.data ? (
          <div className="genre-grid" aria-busy="true">{Array.from({ length: 14 }, (_, i) => <span key={i} className="skeleton dc-genre-skel" />)}</div>
        ) : (
          <GenresStep genres={base.data.genres} picked={genres} toggle={(id) => toggle(genres, setGenres, id)} />
        ))}
        {step === 1 && (
          <ArtistsStep options={options} extra={extraArtists} picked={artists}
            toggle={(id) => toggle(artists, setArtists, id, ARTISTS_MAX)}
            onPick={(id) => {
              setExtraArtists((x) => (x.includes(id) ? x : [id, ...x]));
              setArtists((x) => (x.includes(id) || x.length >= ARTISTS_MAX ? x : [...x, id]));
            }} />
        )}
        {step === 2 && <NineStep options={options} grid={grid} setGrid={setGrid} />}
        {step === 3 && <RateStep options={options} ratings={ratings} setRating={(id, v) => setRatings((r) => ({ ...r, [id]: v }))} />}

        <div className="onboard__foot">
          {step > 0 ? (
            <button type="button" className="btn btn--quiet dc-foot__back" onClick={() => go(step - 1)} disabled={busy} aria-label={t('onboarding.back')}>
              <Icon name="back" size={16} /> <span className="dc-foot__label">{t('onboarding.back')}</span>
            </button>
          ) : <span />}
          {hint && <span className="dc-foot__hint" aria-live="polite">{hint}</span>}
          <span className="dc-foot__right">
            <button type="button" className="btn btn--quiet" onClick={() => next(true)} disabled={busy} data-onboarding-skip="">{t('onboarding.skip')}</button>
            <button type="button" className="btn btn--primary btn--lg" onClick={() => next(false)} disabled={busy || !valid} data-onboarding-next="">
              {busy ? <><Spinner /> {t('onboarding.saving')}</> : step === 3 ? (
                <>
                  <span className="dc-foot__long">{t('onboarding.finish')}</span>
                  <span className="dc-foot__short" aria-hidden="true">{t('onboarding.finishShort')}</span>
                </>
              ) : t('onboarding.next')}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
