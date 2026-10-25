// L'atelier sur le site — chantier P2-D (PLAN.md 6.3, 6.11, 9.2). Le slot du contrat : VernirButton { trackId } (fiche
// de carte, page morceau ; ne rien renommer). Le même fichier fournit le reste de l'atelier :
//   VernirButton { trackId }    « Vernir » d'une carte standard possédée (rien pour une carte absente ou déjà holo) ;
//                               ouvre la fenêtre Vernir : payer 4 × la valeur de recyclage, ou 3 doublons de la rareté.
//   ComptoirSheet { onClose }   le Comptoir : tes doublons par rareté, tes albums recherchés et leurs cartes manquantes,
//                               « Échanger » (3 doublons d'une rareté contre une carte de cette rareté).
//   ComptoirButton { className, label }  lien qui ouvre le Comptoir (rangée Doublons de l'accueil, fiche de carte).
//   ComptoirOffer { trackId }   fiche d'une carte manquante : l'échange proposé au Comptoir (ou « recherche l'album »).
//   WorkshopRules               les règles de l'atelier, pour le guide des raretés (chaque règle y est publiée).
//   DeluxeWatcher               monté une fois (CardModalProvider) : après une note ou un album complété, demande au
//                               serveur si l'édition deluxe vient d'être gagnée, l'ajoute à l'état et le dit.
//   DeluxeLine { albumId }      « Édition deluxe : note les 3 morceaux restants » (page d'album, platine).
// Les chiffres viennent de shared/rules.js (les mêmes que le serveur et la démo). Vernir et le Comptoir renvoient l'état
// complet du joueur (le nombre d'exemplaires de plusieurs cartes change) : la fusion de l'état se fait toute seule.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import Card, { RarityGem } from '../Card.jsx';
import CoverArt from '../CoverArt.jsx';
import { Celebration } from '../Achievements.jsx';
import { DeluxeNudge } from '../Vinyl.jsx';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../feedback.jsx';
import { Icon, Modal, Progress, Royalties, RoyaltyIcon, Spinner, useToast } from '../ui.jsx';
import { WishlistToggle } from './WishlistToggle.jsx';
import { useWishlist } from './wishlist.js';
import { get, onApiResponse, post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { getAlbum, getTrack, useAlbum, useApi, useTrack } from '../../state/catalog.js';
import { useCursorList } from '../../state/paged.js';
import { sound } from '../../sound.js';
import {
  COMPTOIR_DUPLICATES, DELUXE_XP, RARITIES, RARITY, THEMED_BOOSTER_PRICE, VERNIR_DUPLICATES, deluxeKey, duplicatesByRarity, workshopRules,
} from '@shared/rules.js';
import { DELUXE_TITLE_AT } from '@shared/cosmetics.js';
import '../../styles/workshop.css';

const enc = encodeURIComponent;
/** Raretés des cartes d'album (les promos ne s'échangent pas au Comptoir). */
const ALBUM_RARITIES = RARITIES.filter((r) => r !== 'promo');

/** Doublons du joueur par rareté, d'après son état (chaque ligne de carte porte sa rareté). */
function useSpares() {
  const { cards } = useGame();
  return useMemo(() => duplicatesByRarity((cards || []).map((c) => ({ rarity: c.r, count: c.c }))), [cards]);
}

// ----- Vernir ---------------------------------------------------------------------------------------------------

/** Bouton « Vernir » : seulement pour une carte possédée en standard, pas encore en holo. */
export function VernirButton({ trackId, className = 'btn btn--ghost' }) {
  const { t } = useI18n();
  const { owned } = useGame();
  const [open, setOpen] = useState(false);
  const mine = owned?.get(trackId);
  if (!trackId || !mine || !(mine.std > 0) || mine.holo > 0) return null;
  return (
    <>
      <button type="button" className={`${className} ws-vernir-btn`} onClick={() => setOpen(true)} data-vernir={trackId}>
        <Icon name="star" size={16} /> {t('workshop.vernir.button')}
      </button>
      {open && <VernirSheet trackId={trackId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Fenêtre « Vernir la carte » : aperçu holo, deux façons de payer, confirmation. */
export function VernirSheet({ trackId, onClose }) {
  const { t, error, num } = useI18n();
  const toast = useToast();
  const track = useTrack(trackId);
  const info = useApi(trackId ? `/collection/vernir/${enc(trackId)}` : null, { keep: false });
  const data = info.data?.trackId === trackId ? info.data : null;
  const [pay, setPay] = useState(null);
  const [busy, setBusy] = useState(false);
  const choice = pay ?? (data?.can.royalties || !data?.can.duplicates ? 'royalties' : 'duplicates');
  const rarity = data?.rarity || track?.rarity || 'common';

  const confirm = async () => {
    if (!data?.can[choice] || busy) return;
    setBusy(true);
    try {
      const res = await post('/collection/vernir', { trackId, pay: choice });
      sound.reveal(rarity, true);
      toast(res.holoEdition ? t('workshop.vernir.holoEdition') : t('workshop.vernir.done'), 'success');
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
      setBusy(false);
      info.reload();
    }
  };

  return (
    <Modal open onClose={onClose} title={t('workshop.vernir.title')} className="ws-vernir">
      <div className="ws-vernir__body" data-sheet="vernir">
        <figure className="ws-vernir__card">
          <Card trackId={trackId} variant="holo" tilt artSizes="200px" />
          <figcaption className="small muted">{t('workshop.vernir.preview')}</figcaption>
        </figure>
        <div className="ws-vernir__text">
          <p className="ws-vernir__intro">{t('workshop.vernir.intro')}</p>
          {info.error ? <ErrorBox error={info.error} onRetry={info.reload} /> : !data ? (
            <p className="small muted" role="status"><Spinner /> {t('common.loading')}</p>
          ) : data.reason ? (
            <p className="small muted">{error(data.reason)}</p>
          ) : (
            <fieldset className="ws-pay">
              <legend className="ws-pay__legend">{t('workshop.vernir.choose')}</legend>
              <button type="button" className={`ws-pay__opt${choice === 'royalties' ? ' is-on' : ''}`} aria-pressed={choice === 'royalties'}
                onClick={() => setPay('royalties')} data-pay="royalties">
                <span className="ws-pay__title"><RoyaltyIcon size={16} /> {t('workshop.vernir.royalties', { n: num(data.cost.royalties) })}</span>
                <span className="ws-pay__hint small muted">
                  {data.can.royalties ? t('workshop.vernir.royaltiesHint')
                    : t('workshop.vernir.royaltiesShort', { n: num(data.cost.royalties - data.royalties) })}
                </span>
              </button>
              <button type="button" className={`ws-pay__opt${choice === 'duplicates' ? ' is-on' : ''}`} aria-pressed={choice === 'duplicates'}
                onClick={() => setPay('duplicates')} data-pay="duplicates">
                <span className="ws-pay__title">
                  <RarityGem rarity={rarity} size={13} /> {t('workshop.vernir.duplicates', { n: data.cost.duplicates, rarity: t(`rarity.${rarity}`) })}
                </span>
                <span className="ws-pay__hint small muted">{t('workshop.vernir.duplicatesHint', { n: data.duplicates })}</span>
              </button>
              <p className="small muted ws-pay__rule">{t('workshop.duplicatesRule')}</p>
            </fieldset>
          )}
        </div>
      </div>
      {data && !data.reason && (
        <footer className="ws-sheet__foot">
          <Royalties value={data.royalties} className="pill" />
          <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy || !data.can[choice]} data-autofocus>
            {busy ? <Spinner /> : <Icon name="star" size={16} />} {t('workshop.vernir.confirm')}
          </button>
        </footer>
      )}
    </Modal>
  );
}

// ----- Comptoir ---------------------------------------------------------------------------------------------------

/** Les doublons du joueur, une pastille par rareté d'album. */
function SpareChips({ spares, needed }) {
  const { t } = useI18n();
  return (
    <ul className="ws-spares" aria-label={t('workshop.comptoir.yoursLabel')}>
      {ALBUM_RARITIES.map((r) => (
        <li key={r} className={`chip ws-spares__chip${(spares?.[r] || 0) >= needed ? ' ws-spares__chip--ready' : ''}`} style={{ '--rc': RARITY[r].color }}
          title={t(`rarity.${r}`)} data-rarity={r}>
          <RarityGem rarity={r} size={11} /> <span className="ws-spares__name">{t(`rarity.${r}`)}</span> <b className="mono">{spares?.[r] || 0}</b>
        </li>
      ))}
    </ul>
  );
}

/** « Échanger » en deux temps : le bouton, puis la confirmation sur place. */
function ExchangeButton({ track, have, needed, onDone, compact = false }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(id);
  }, [armed]);
  const ready = have >= needed;
  const exchange = async () => {
    setBusy(true);
    try {
      const res = await post('/collection/comptoir', { trackId: track.id });
      sound.reveal(track.rarity);
      toast(t('workshop.comptoir.done', { title: track.title }), 'success');
      onDone?.(res);
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  if (!ready) return <span className="small muted ws-need">{t('workshop.comptoir.need', { n: needed - have })}</span>;
  if (!armed) {
    return (
      <button type="button" className={`btn ${compact ? 'btn--ghost btn--sm' : 'btn--primary btn--sm'}`} onClick={() => setArmed(true)}
        aria-label={t('workshop.comptoir.exchangeLabel', { n: needed, rarity: t(`rarity.${track.rarity}`), title: track.title })} data-exchange={track.id}>
        <Icon name="recycle" size={14} /> {t('workshop.comptoir.exchange')}
      </button>
    );
  }
  return (
    <span className="ws-confirm">
      <button type="button" className="btn btn--primary btn--sm" onClick={exchange} disabled={busy} data-confirm-exchange={track.id} data-autofocus>
        {busy ? <Spinner /> : null} {t('workshop.comptoir.offerConfirm', { n: needed })}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setArmed(false)} disabled={busy}>{t('common.cancel')}</button>
    </span>
  );
}

/** Une carte manquante du Comptoir : la carte (visuel généré, pas encore obtenue) et son échange. */
function MissingCard({ item, have, needed, onDone }) {
  const track = useTrack(item.trackId);
  return (
    <li className="ws-missing__item" data-missing={item.trackId}>
      <Card trackId={item.trackId} ghost artSizes="120px" />
      {track && <ExchangeButton track={track} have={have} needed={needed} onDone={onDone} compact />}
    </li>
  );
}

/** Un album recherché et ses cartes manquantes. */
function ComptoirAlbum({ entry, spares, needed, onDone }) {
  const { t } = useI18n();
  const album = useAlbum(entry.albumId);
  return (
    <section className="ws-album" data-album={entry.albumId}>
      <header className="ws-album__head">
        <Link to={`/album/${enc(entry.albumId)}`} className="ws-album__cover" aria-hidden="true" tabIndex={-1}>
          {album?.art ? <CoverArt art={{ ...album.art, seed: album.art.seed || album.id }} sizes="48px" /> : <span className="ws-album__cover-wait" />}
        </Link>
        <div className="ws-album__text">
          <Link to={`/album/${enc(entry.albumId)}`} className="ws-album__title">{album?.title || '…'}</Link>
          <span className="small muted">{album?.artist || ''}</span>
        </div>
        <span className="ws-album__progress">
          <span className="mono small">{t('workshop.comptoir.progress', { owned: entry.owned, total: entry.total })}</span>
          <Progress value={entry.owned} max={entry.total} color={album?.art?.palette?.[1]} size="xs" />
        </span>
      </header>
      <ul className="ws-missing">
        {entry.missing.map((m) => <MissingCard key={m.trackId} item={m} have={spares?.[m.rarity] || 0} needed={needed} onDone={onDone} />)}
      </ul>
    </section>
  );
}

/** Le Comptoir (fenêtre) : doublons, albums recherchés incomplets, échanges. */
export function ComptoirSheet({ onClose }) {
  const { t } = useI18n();
  const [meta, setMeta] = useState(null);
  const [celebrate, setCelebrate] = useState([]);
  const list = useCursorList('/collection/comptoir', { limit: 6, idOf: (a) => a.albumId, onPage: (res) => setMeta(res) });
  const needed = meta?.needed ?? COMPTOIR_DUPLICATES;
  const onDone = (res) => {
    if (res?.achievements?.length) setCelebrate(res.achievements);
    // La carte rejoint la collection : la liste (cartes manquantes, doublons) est relue.
    list.reload();
  };
  let body;
  if (list.error && !list.items.length) body = <ErrorBox error={list.error} onRetry={list.reload} />;
  else if (!meta) body = <div className="ws-comptoir__wait"><Skeleton kind="row" count={3} /></div>;
  else if (!meta.wishlist) {
    body = (
      <EmptyState icon="list" title={t('workshop.comptoir.emptyTitle')} body={t('workshop.comptoir.emptyBody')}
        action={<Link to="/discover" className="btn btn--primary btn--sm" onClick={onClose}>{t('workshop.comptoir.emptyAction')}</Link>} />
    );
  } else if (!list.items.length) body = <p className="empty">{t('workshop.comptoir.allDone')}</p>;
  else {
    body = (
      <>
        <div className="ws-comptoir__albums">
          {list.items.map((entry) => <ComptoirAlbum key={entry.albumId} entry={entry} spares={meta.duplicates} needed={needed} onDone={onDone} />)}
        </div>
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} label={t('workshop.comptoir.more')} />
      </>
    );
  }
  return (
    <>
      <Modal open onClose={onClose} title={t('workshop.comptoir.title')} className="modal--wide ws-comptoir">
        <div className="ws-comptoir__body" data-sheet="comptoir">
          <p className="ws-comptoir__intro">{t('workshop.comptoir.intro', { n: needed })}</p>
          <div className="ws-comptoir__spares">
            <span className="eyebrow">{t('workshop.comptoir.yours')}</span>
            <SpareChips spares={meta?.duplicates} needed={needed} />
          </div>
          <p className="small muted ws-comptoir__rule">{t('workshop.duplicatesRule')}</p>
          {body}
        </div>
      </Modal>
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
    </>
  );
}

/** Lien qui ouvre le Comptoir (rangée Doublons de l'accueil, fiche d'une carte). */
export function ComptoirButton({ className = 'link-btn small', label }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${className} ws-comptoir-link`} onClick={() => setOpen(true)} data-open-comptoir>
        <Icon name="recycle" size={14} /> {label || t('workshop.comptoir.link')}
      </button>
      {open && <ComptoirSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** Fiche d'une carte manquante d'album : l'échange au Comptoir, ou l'album à rechercher d'abord. */
export function ComptoirOffer({ trackId }) {
  const { t } = useI18n();
  const { user, ownedSet } = useGame();
  const track = useTrack(trackId);
  const album = useAlbum(track?.albumId || null);
  const wish = useWishlist(user?.id);
  const spares = useSpares();
  const [celebrate, setCelebrate] = useState([]);
  if (!track?.albumId || track.rarity === 'promo' || ownedSet?.has(trackId) || !user) {
    return <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />;
  }
  const wanted = wish.ids.has(track.albumId);
  const have = spares[track.rarity] || 0;
  return (
    <section className="ws-offer" data-comptoir-offer={trackId}>
      <h3 className="ws-offer__title"><Icon name="recycle" size={15} /> {t('workshop.comptoir.offerTitle')}</h3>
      {wanted ? (
        <>
          <p className="small">
            {t('workshop.comptoir.offer', { n: COMPTOIR_DUPLICATES, rarity: t(`rarity.${track.rarity}`) })}{' '}
            <span className="muted">{t('workshop.comptoir.offerHave', { n: have })}</span>
          </p>
          <ExchangeButton track={track} have={have} needed={COMPTOIR_DUPLICATES} onDone={(res) => res?.achievements?.length && setCelebrate(res.achievements)} />
        </>
      ) : wish.status === 'ready' ? (
        <div className="ws-offer__wish">
          <p className="small muted">{t('workshop.comptoir.offerWish', { album: album?.title || track.album || '' })}</p>
          <WishlistToggle albumId={track.albumId} />
        </div>
      ) : null}
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
    </section>
  );
}

// ----- règles publiées --------------------------------------------------------------------------------------------

/** Les règles de l'atelier (guide des raretés) : chaque prix et chaque échange, les chiffres de shared/rules.js. */
export function WorkshopRules() {
  const { t, num } = useI18n();
  const rules = workshopRules();
  const costs = ALBUM_RARITIES.concat('promo').map((r) => `${t(`rarity.${r}`)} ${num(rules.vernir.costs[r])}`).join(' · ');
  return (
    <section className="ws-rules" data-rules="workshop">
      <h3><Icon name="star" size={15} /> {t('workshop.rules.title')}</h3>
      <p>{t('workshop.rules.vernir', { costs, n: VERNIR_DUPLICATES })}</p>
      <p>{t('workshop.rules.comptoir', { n: rules.comptoir.duplicates })}</p>
      <p className="small muted">{t('workshop.rules.duplicates')}</p>
      <p>{t('workshop.rules.deluxe', { xp: rules.deluxe.xp, title: DELUXE_TITLE_AT })}</p>
      <p>{t('workshop.rules.themed', { price: THEMED_BOOSTER_PRICE })}</p>
    </section>
  );
}

// ----- édition deluxe -----------------------------------------------------------------------------------------------

/** « Édition deluxe : note les N morceaux restants » d'un album complété (rien sinon). */
export function DeluxeLine({ albumId }) {
  const { achievements } = useGame();
  if (!albumId || !achievements?.has?.(`album:${albumId}`)) return null;
  return <DeluxeNudge albumId={albumId} className="ws-deluxe-line--page" />;
}

const RATING_PATH = /^\/ratings\/(album|track)\/([^/?]+)/;
/** Album d'une carte : celui du catalogue chargé, sinon l'identifiant « <albumId>:<numéro> ». */
const albumOfTrack = (id) => getTrack(id)?.albumId ?? (id.lastIndexOf(':') > 0 ? id.slice(0, id.lastIndexOf(':')) : null);

/**
 * Monté une fois : quand une note est enregistrée sur un album complété (ou un album se complète), demande au serveur
 * si l'édition deluxe vient d'être gagnée (GET /albums/:id/deluxe : sa réponse ajoute le succès à l'état) et le dit.
 */
export function DeluxeWatcher() {
  const { t } = useI18n();
  const toast = useToast();
  const { achievements } = useGame() || {};
  const known = useRef(achievements);
  const asked = useRef(new Set());
  useEffect(() => {
    known.current = achievements;
  });
  useEffect(() => onApiResponse((res, { method, path } = {}) => {
    const albums = new Set();
    const m = method === 'PUT' && RATING_PATH.exec(path || '');
    if (m) {
      const id = decodeURIComponent(m[2]);
      const albumId = m[1] === 'album' ? id : albumOfTrack(id);
      if (albumId) albums.add(albumId);
    }
    for (const a of Array.isArray(res?.achievements) ? res.achievements : []) {
      if (typeof a?.key === 'string' && a.key.startsWith('album:')) albums.add(a.key.slice(6));
    }
    for (const albumId of albums) {
      const ach = known.current;
      const completed = ach?.has?.(`album:${albumId}`) || res?.achievements?.some?.((a) => a?.key === `album:${albumId}`);
      if (!completed || ach?.has?.(deluxeKey(albumId)) || asked.current.has(albumId)) continue;
      asked.current.add(albumId);
      get(`/albums/${enc(albumId)}/deluxe`)
        .then((status) => {
          if (!status?.done) return;
          sound.complete();
          toast(t('workshop.deluxe.earned', { title: getAlbum(albumId)?.title || '', xp: status.xp ?? DELUXE_XP }), 'success');
        })
        .catch(() => {})
        .finally(() => asked.current.delete(albumId));
    }
  }), [t, toast]);
  return null;
}

export default VernirButton;
