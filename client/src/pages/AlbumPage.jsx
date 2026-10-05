import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import Card, { RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import PackOpening, { PackArt } from '../components/PackOpening.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Celebration } from '../components/Achievements.jsx';
import { Icon, Modal, Progress, ProviderMark, RoyaltyIcon, useToast } from '../components/ui.jsx';
import { PROVIDER_NAMES, realCover, useCovers } from '../state/CoversContext.jsx';
import { Vinyl, TurntableModal, isHoloComplete } from '../components/Vinyl.jsx';
import {
  RatingHistogram, RatingInput, RatingValue, ReviewEditor, ReviewList, useItemRatings,
} from '../components/Rating.jsx';
import { getAlbum, useAlbumDetail, useTrack } from '../state/catalog.js';
import { ECONOMY, albumReward, pressCost } from '@shared/rules.js';
import { post, api } from '../api.js';
import { sound } from '../sound.js';
import { storage } from '../storage.js';
import '../styles/album.css';

export function PressDialog({ trackId, onClose, onDone }) {
  const { t, error } = useI18n();
  const { user, applyState, isAdmin } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const track = useTrack(trackId || null);
  const cost = !track || isAdmin ? 0 : pressCost(track.rarity) ?? 0;
  const missing = Math.max(0, cost - (user?.royalties || 0));

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await post('/collection/press', { trackId });
      applyState(res.state);
      sound.reveal(track.rarity);
      toast(t('album.pressed', { title: track.title }), 'success');
      onDone?.(res);
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!trackId && !!track} onClose={onClose} title={t('album.pressTitle')} className="modal--narrow">
      {track && (
        <div className="press">
          <div className="press__card"><Card trackId={trackId} ghost /></div>
          <p>{t('album.pressBody', { title: track.title, n: cost })}</p>
          {missing > 0 && <p className="form-error">{t('album.pressMissing', { n: missing })}</p>}
          <div className="press__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy || missing > 0} data-autofocus>
              <Icon name="press" /> {t('album.press')} · {isAdmin ? t('album.pressFree') : <><RoyaltyIcon size={14} /> <span className="mono">{cost}</span></>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Grille de cartes (objets carte de l'API) : possédées en couleur, manquantes en fantôme avec « Presser ». */
export function TrackGrid({ tracks, onPress }) {
  const { owned, isAdmin } = useGame();
  const { t } = useI18n();
  const openCard = useCardModal();
  return (
    <div className="card-grid">
      {tracks.map((tr) => {
        const mine = owned.get(tr.id);
        const cost = isAdmin ? 0 : pressCost(tr.rarity);
        return (
          <div key={tr.id} className="card-cell">
            <Card trackId={tr.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} count={mine ? mine.std + mine.holo : 0}
              onClick={() => openCard(tr.id)} />
            {!mine && cost != null && onPress && (
              <button type="button" className={`press-btn${isAdmin ? ' press-btn--free' : ''}`} onClick={() => onPress(tr.id)}>
                <Icon name="press" size={14} />
                {/* Sur un écran étroit, le libellé se raccourcit mais le prix reste lisible. */}
                <span className="press-btn__label">{t('album.press')} ·</span>
                <span className="press-btn__cost">{isAdmin ? t('album.pressFreeShort') : <span className="mono">{cost}</span>}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Emplacements de cartes le temps du chargement. */
export function TrackGridSkeleton({ count = 12 }) {
  return (
    <div className="card-grid" aria-hidden="true">
      {Array.from({ length: Math.min(24, Math.max(1, count)) }, (_, i) => (
        <div key={i} className="card-cell"><span className="card card--loading" /></div>
      ))}
    </div>
  );
}

/** Tracklist façon fiche d'album : rareté, carte possédée, moyenne et ta note pour chaque morceau. */
function Tracklist({ tracks, trackRatings, onPress }) {
  const { t, error } = useI18n();
  const { owned, ratings, isAdmin, applyState } = useGame();
  const openCard = useCardModal();
  const toast = useToast();
  const pending = useRef({});
  const [resetKey, setResetKey] = useState(0);
  const send = async (trackId, score) => {
    try {
      const res = await api('PUT', `/ratings/track/${encodeURIComponent(trackId)}`, { score });
      applyState(res.state);
    } catch (err) {
      toast(error(err.code), 'error');
      setResetKey((k) => k + 1); // la note affichée revient à celle du serveur
    }
  };
  // En quittant la tracklist, les notes en attente partent tout de suite au lieu d'être perdues.
  useEffect(() => () => {
    for (const [trackId, { timer, score }] of Object.entries(pending.current)) {
      clearTimeout(timer);
      send(trackId, score);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Petite attente avant l'envoi : plusieurs appuis rapides ne font qu'une seule requête.
  const rateTrack = (trackId, score) => {
    clearTimeout(pending.current[trackId]?.timer);
    const timer = setTimeout(() => {
      delete pending.current[trackId];
      send(trackId, score);
    }, 350);
    pending.current[trackId] = { timer, score };
  };
  return (
    <div className="table-wrap tracklist-wrap">
      <table className="tracklist">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>{t('album.colTrack')}</th>
            <th>{t('card.rarity')}</th>
            <th>{t('album.colOwned')}</th>
            <th>{t('album.colAvg')}</th>
            <th>{t('album.colMine')}</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((tr) => {
            const mine = owned.get(tr.id);
            const community = trackRatings?.[tr.id];
            const cost = isAdmin ? 0 : pressCost(tr.rarity);
            return (
              <tr key={tr.id} className={mine ? 'is-owned' : ''}>
                <td className="num mono muted">{tr.n}</td>
                <td>
                  <button type="button" className="tracklist__title" onClick={() => openCard(tr.id)}>
                    {tr.title}
                    {tr.feat && <span className="muted small"> · feat. {tr.feat}</span>}
                  </button>
                </td>
                <td><span className="tracklist__rarity"><RarityGem rarity={tr.rarity} size={12} /> {t(`rarity.${tr.rarity}`)}</span></td>
                <td>
                  {mine ? (
                    <span className={`owned-chip${mine.holo ? ' owned-chip--holo' : ''}`}><Icon name="check" size={13} /> {mine.holo ? t('card.holo') : `×${mine.std}`}</span>
                  ) : cost != null ? (
                    <button type="button" className="press-btn press-btn--inline" onClick={() => onPress(tr.id)}
                      aria-label={`${t('album.press')} · ${tr.title}`}>
                      <Icon name="press" size={13} /> {isAdmin ? t('album.pressFree') : <span className="mono">{cost}</span>}
                    </button>
                  ) : null}
                </td>
                <td>{community?.count ? <span className="tracklist__avg"><RatingValue value={community.average} average size={11} /> <span className="muted small mono">({community.count})</span></span> : <span className="muted">·</span>}</td>
                <td><RatingInput key={`${tr.id}-${resetKey}`} value={ratings.get(`track:${tr.id}`) ?? null} onChange={(v) => rateTrack(tr.id, v)} size={15} compact label={`${t('rating.yours')} · ${tr.title}`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlbumRatings({ albumId, ratingsApi }) {
  const { t } = useI18n();
  const { data, save, remove } = ratingsApi;
  if (!data) return null;
  const { summary } = data;
  return (
    <section className="section album-ratings" id="critiques">
      <header className="section__head"><h2>{t('reviews.title')}</h2></header>
      <div className="album-ratings__grid">
        <div className="panel">
          <h3 className="panel__title">{t('reviews.yours')}</h3>
          <ReviewEditor key={albumId} data={data} save={save} remove={remove} />
        </div>
        <div className="panel album-ratings__community">
          <h3 className="panel__title">{t('rating.community')}</h3>
          {summary.count ? (
            <>
              <div className="community-score">
                <RatingValue value={summary.average} average size={22} />
                <span className="muted small">{t('rating.count', { n: summary.count })}</span>
              </div>
              <RatingHistogram distribution={summary.distribution} mine={data.mine?.score} />
            </>
          ) : <p className="muted">{t('rating.empty')}</p>}
          {data.friendScores?.length > 0 && (
            <div className="friend-scores">
              <span className="studio__label">{t('rating.friends')}</span>
              <ul>
                {data.friendScores.map((f) => (
                  <li key={f.user.id}>
                    <Link to={`/u/${f.user.username}`} className="friend-score">
                      <span className="friend-score__name">{f.user.username}</span>
                      <RatingValue value={f.score} size={11} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <h3 className="studio__label album-ratings__list-title">{t('reviews.list')}</h3>
      <ReviewList reviews={data.reviews || []} />
    </section>
  );
}

/**
 * Booster d'album : 5 cartes de cet album, celles qui manquent d'abord, payé en royalties.
 * Gratuit et illimité pour l'admin (même album complet, pour tester).
 */
function AlbumBooster({ album, complete, onOpen }) {
  const { t, num } = useI18n();
  const { user, isAdmin } = useGame();
  const uid = useId();
  const price = isAdmin ? 0 : ECONOMY.albumPackPrice;
  const missing = Math.max(0, price - (user?.royalties ?? 0));
  const blocked = !isAdmin && (complete || missing > 0);
  let hint = null;
  if (complete) hint = t(isAdmin ? 'album.booster.completeAdmin' : 'album.booster.complete');
  else if (missing > 0) hint = t('album.booster.missing', { n: num(missing) });
  return (
    <section className={`album-booster${blocked ? ' album-booster--blocked' : ''}`} aria-labelledby={`${uid}-title`}>
      <PackArt className="album-booster__pack" album={album} />
      <div className="album-booster__text">
        <h2 id={`${uid}-title`} className="album-booster__title">{t('album.booster.title')}</h2>
        <p className="album-booster__body">
          {price ? t('album.booster.body', { price: num(price) }) : t('album.booster.bodyFree')}
        </p>
        {hint && <p id={`${uid}-hint`} className="album-booster__hint small">{hint}</p>}
      </div>
      <button type="button" className="btn btn--primary album-booster__btn" onClick={onOpen} disabled={blocked}
        aria-describedby={hint ? `${uid}-hint` : undefined}>
        <Icon name="pack" /> {t('album.booster.open')}
        {price > 0 && <span className="album-booster__price"><RoyaltyIcon size={14} /> <span className="mono">{num(price)}</span></span>}
      </button>
    </section>
  );
}

/** Album ou artiste introuvable (404), ou erreur de chargement avec « Réessayer ». */
export function MissingState({ err, notFoundTitle, notFoundBody, loadError, onRetry, backTo, backLabel }) {
  const { t, error } = useI18n();
  const notFound = err?.status === 404 || /^unknown_/.test(err?.code || '');
  return (
    <div className="empty-page catalog-missing">
      <Icon name={notFound ? 'search' : 'disc'} size={40} />
      <h1 className="catalog-missing__title">{notFound ? notFoundTitle : loadError}</h1>
      <p>{notFound ? notFoundBody : error(err?.code)}</p>
      <div className="catalog-missing__actions">
        {!notFound && onRetry && <button type="button" className="btn btn--primary" onClick={onRetry}>{t('album.retry')}</button>}
        <Link to={backTo} className="btn btn--ghost"><Icon name="back" /> {backLabel}</Link>
      </div>
    </div>
  );
}

/** En-tête vide le temps de charger un album jamais vu dans la session. */
function AlbumSkeleton() {
  const { t } = useI18n();
  return (
    <div className="album-page" aria-busy="true">
      <span className="sr-only" role="status">{t('album.loading')}</span>
      <Link to="/collection" className="back-link"><Icon name="back" /> {t('album.back')}</Link>
      <header className="album-head">
        <div className="album-head__cover album-skel album-skel--cover" />
        <div className="album-head__info">
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--title" />
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--bar" />
          <span className="album-skel album-skel--block" />
        </div>
      </header>
      <TrackGridSkeleton count={12} />
    </div>
  );
}

/** Lien d'écoute de l'album : /api/covers pour les 20 albums de base, lien Deezer pour les albums importés. */
function AlbumListen({ album }) {
  const { t } = useI18n();
  const covers = useCovers();
  const seedLink = covers.all[album.id];
  const link = seedLink || (album.url ? { url: album.url, provider: 'deezer' } : null);
  const cover = realCover(album.art, covers);
  if (!link && !cover) return null;
  const name = link && (PROVIDER_NAMES[link.provider] || link.provider);
  return (
    <div className="cover-credit">
      {link && (
        <a href={link.url} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm">
          <ProviderMark provider={link.provider} /> {seedLink ? t('covers.listenAlbumOn', { p: name }) : t('covers.listenOn', { p: name })}
        </a>
      )}
      {cover && <span className="small muted">{t('covers.credit', { p: PROVIDER_NAMES[cover.provider] || cover.provider })}</span>}
    </div>
  );
}

function AlbumView({ id }) {
  const { t, date, error } = useI18n();
  const { achievements, owned, ratings, albumProgress } = useGame();
  const toast = useToast();
  const [pressing, setPressing] = useState(null);
  const [celebrate, setCelebrate] = useState([]);
  const [view, setView] = useState(() => storage.get('albummania.albumView') || 'cards');
  const [turntable, setTurntable] = useState(null);
  const [opening, setOpening] = useState(null);
  const detail = useAlbumDetail(id);
  const loaded = detail.data?.album?.id === id ? detail.data : null;
  // Album déjà croisé ailleurs (liste, recherche, booster) : l'en-tête s'affiche pendant que les cartes arrivent.
  const album = loaded?.album || getAlbum(id);
  const tracks = loaded?.tracks || null;
  const ratingsApi = useItemRatings('album', id);

  // Quand une de mes notes de morceau change (tracklist ou fiche carte), on recharge les moyennes.
  const trackSignature = useMemo(
    () => (tracks ? tracks.map((tr) => ratings.get(`track:${tr.id}`) ?? '-').join(',') : null),
    [ratings, tracks],
  );
  const firstSignature = useRef(null);
  const { reload } = ratingsApi;
  useEffect(() => {
    if (trackSignature === null) return;
    if (firstSignature.current === null) firstSignature.current = trackSignature;
    else if (trackSignature !== firstSignature.current) {
      firstSignature.current = trackSignature;
      reload();
    }
  }, [trackSignature, reload]);

  const openBooster = useCallback(() => {
    if (!album) return;
    sound.unlock();
    setOpening({ promise: post('/packs/album', { albumId: album.id }), key: Date.now() });
  }, [album]);

  const closeOpening = useCallback((err) => {
    setOpening(null);
    if (err) toast(error(err.code), 'error');
  }, [toast, error]);

  const notFound = detail.error && (detail.error.status === 404 || detail.error.code === 'unknown_album');
  if (!album || notFound) {
    if (detail.error) {
      return (
        <MissingState err={detail.error} notFoundTitle={t('album.notFound')} notFoundBody={t('album.notFoundBody')}
          loadError={t('album.loadError')} onRetry={detail.reload} backTo="/collection" backLabel={t('album.back')} />
      );
    }
    return <AlbumSkeleton />;
  }

  const total = tracks ? tracks.length : album.trackCount || 0;
  const ownedCount = tracks
    ? tracks.reduce((n, tr) => n + (owned.has(tr.id) ? 1 : 0), 0)
    : albumProgress(id, album.trackCount).owned;
  const complete = total > 0 && ownedCount >= total;
  const doneAt = achievements.get(`album:${id}`);
  const reward = albumReward(album.trackCount || total);
  const edition = doneAt && isHoloComplete(id, owned, tracks || album.trackCount) ? 'holo' : 'black';
  const summary = ratingsApi.data?.summary;
  const palette = album.art?.palette || [];
  const genre = album.genre ? t(`genre.${album.genre}`) : null;
  const eyebrow = [album.code, genre && genre !== `genre.${album.genre}` ? genre : null, album.year].filter(Boolean).join(' · ');
  const chooseView = (v) => {
    setView(v);
    storage.set('albummania.albumView', v);
  };

  return (
    <div className="album-page" style={{ '--album-c0': palette[0], '--album-c1': palette[1] }}>
      <Link to="/collection" className="back-link"><Icon name="back" /> {t('album.back')}</Link>
      <header className={`album-head${doneAt ? ' album-head--vinyl' : ''}`}>
        {doneAt ? (
          <div className="album-head__vinyl">
            <Vinyl albumId={id} album={album} edition={edition} onClick={() => setTurntable({ albumId: id, edition, at: doneAt, mine: true })} label={t('album.playVinyl')} />
          </div>
        ) : (
          <div className="album-head__cover">
            <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} title={album.title} sizes="(max-width: 860px) 220px, 280px" />
          </div>
        )}
        <div className="album-head__info">
          {eyebrow && <span className="eyebrow mono">{eyebrow}</span>}
          <h1>{album.title}</h1>
          <Link to={`/artist/${encodeURIComponent(album.artistId)}`} className="album-head__artist">{album.artist}</Link>
          <AlbumListen album={album} />
          {summary?.count > 0 && (
            <a href="#critiques" className="album-head__score">
              <RatingValue value={summary.average} average size={16} />
              <span className="muted small">{t('rating.count', { n: summary.count })}</span>
            </a>
          )}
          <div className="album-head__progress">
            <Progress value={ownedCount} max={total} color={palette[1]} size="lg" />
            <span className="mono">{ownedCount}/{total}</span>
          </div>
          {doneAt ? (
            <p className="gold-note">
              <Icon name="disc" /> {t('album.completedOn', { date: date(doneAt) })}
              {edition === 'holo' && <span className="edition-tag edition-tag--holo">{t('vinyl.holo')}</span>}
            </p>
          ) : (
            <div className="reward-box">
              <span className="eyebrow">{t('album.reward')}</span>
              <p>{t('album.rewardBody', { r: reward.royalties, x: reward.xp })}</p>
              <p className="small muted">{t('album.pressHint')}</p>
            </div>
          )}
        </div>
      </header>

      <AlbumBooster album={album} complete={complete} onOpen={openBooster} />

      <div className="toolbar">
        <div className="seg" role="group" aria-label={t('album.view')}>
          {[['cards', t('album.viewCards')], ['tracklist', t('album.viewTracklist')]].map(([v, label]) => (
            <button key={v} type="button" className={`seg__btn seg__btn--wide${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => chooseView(v)}>{label}</button>
          ))}
        </div>
      </div>

      {!tracks ? (
        detail.error ? (
          <div className="empty album-tracks-error">
            <p>{t('album.tracksError')}</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={detail.reload}>{t('album.retry')}</button>
          </div>
        ) : (
          <>
            <span className="sr-only" role="status">{t('album.loading')}</span>
            <TrackGridSkeleton count={album.trackCount || 12} />
          </>
        )
      ) : view === 'cards'
        ? <TrackGrid tracks={tracks} onPress={setPressing} />
        : <Tracklist tracks={tracks} trackRatings={ratingsApi.data?.tracks} onPress={setPressing} />}

      <AlbumRatings albumId={id} ratingsApi={ratingsApi} />

      <PressDialog trackId={pressing} onClose={() => setPressing(null)} onDone={(res) => setCelebrate(res.achievements || [])} />
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
      <TurntableModal vinyl={turntable} onClose={() => setTurntable(null)} />
      {opening && (
        <PackOpening key={opening.key} promise={opening.promise} album={album} onClose={closeOpening} onAgain={openBooster} />
      )}
    </div>
  );
}

export default function AlbumPage() {
  const { id } = useParams();
  // Un album = un état neuf (vue, modales, chargement) : on remonte la page à chaque changement d'album.
  return <AlbumView key={id} id={id} />;
}
