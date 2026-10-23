// Accueil (« Boosters ») — chantier P0-B, repris par P1-A en P1, par P2-B en P2 (PLAN.md 2.4, 2.5, DESIGN-OVERRIDE.md).
// En tête, LITTÉRALEMENT inchangés : le héros Boosters (paquet, « N boosters disponibles », minuteur, guide des raretés,
// « Ouvrir un booster ») et la rangée Boutique / Doublons / Blind test. En dessous (P1) : « Boosters spéciaux » (P1-D),
// la rangée des quêtes (P1-F), la rangée de l'événement en cours et du Rétro (P2-B), puis le fil (compositeur, onglets
// Tes amis · Pour toi · Communauté, pages chargées au défilement) à côté de sa colonne (Presque complets avec « Deux
// façons de finir un album », Taste Match, battle, amis suggérés) ; sur téléphone la colonne se range après la première
// page du fil. Enfin « Derniers morceaux obtenus ».
import { Suspense, lazy, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { RarityGuideButton } from '../components/RarityGuide.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { PackArt } from '../components/PackOpening.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { AlbumTile, AlbumTileSkeleton } from '../components/AlbumTile.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Icon, Progress, Royalties, RoyaltyIcon, formatDuration, useNow } from '../components/ui.jsx';
import { ECONOMY, FOCUS_CHANCE } from '@shared/rules.js';
import { useAlbums } from '../state/catalog.js';
import { useBoosterFlow } from '../state/boosterFlow.js';
import { SpecialBoosters } from '../components/game/SpecialBoosters.jsx';
import { BattleWidget, QuestStrip } from '../components/play/slots.jsx';
import { EventChip, RetroChip } from '../components/sets/EventChip.jsx';
import { SuggestedFriends, TasteMatchCard } from '../components/match/HomeCards.jsx';
import { Composer } from '../components/social/Composer.jsx';
import { FEED_TABS, FeedList, feedItemOfPost, useFeed } from '../components/social/FeedList.jsx';
import { itemHref, useMedia, useOnPosted } from '../components/social/util.js';
import '../styles/home.css';
import '../styles/social.css';

// La vignette d'album vit dans components/AlbumTile.jsx (une seule pour tout le site) ; ces réexports gardent les
// anciens imports (`import { AlbumTile } from './Home.jsx'`) valables.
export { AlbumTile, AlbumTileSkeleton };

// Pastille du Rétro : celle du passeport (P2-A, components/passport/RetroChip.jsx) quand elle existe, chargée à part ;
// sinon celle du calendrier des événements (P2-B). Glob vide si le fichier n'existe pas : rien n'est importé.
const passportRetro = Object.values(import.meta.glob('../components/passport/RetroChip.jsx'))[0];
const PassportRetroChip = passportRetro
  ? lazy(() => passportRetro().then((m) => ({ default: m.RetroChip || m.default || (() => null) })))
  : null;

/** Rangée de l'événement en cours et du Rétro, sous la rangée des quêtes (jamais dans le héros). */
function EventRow() {
  return (
    <div className="status-row set-row" data-home="events">
      <EventChip />
      {PassportRetroChip ? <Suspense fallback={null}><PassportRetroChip /></Suspense> : <RetroChip />}
    </div>
  );
}

// Albums montrés dans « Presque complets » ; au-delà de SEGMENTS morceaux, une barre continue remplace les segments.
const ALMOST = 3;
const SEGMENTS = 24;
// Colonne rangée dans le fil (téléphone, tablette) : après la première page.
const NARROW = '(max-width: 1020px)';
const FIRST_PAGE = 20;

/** Minuteur du prochain booster gratuit (seul ce bloc se redessine chaque seconde). */
function PackTimer() {
  const { t } = useI18n();
  const { packs, now } = useGame();
  useNow(1000);
  const remaining = packs.nextAt ? packs.nextAt - now() : null;
  return (
    <p className="hero__timer">
      {remaining != null && remaining > 0
        ? <>{t('home.next', { time: '' })}<span className="mono timer">{formatDuration(remaining)}</span></>
        : t('home.full', { max: packs.max })}
    </p>
  );
}

/** Albums commencés les plus proches d'être complets, d'après les statistiques du serveur. */
function closestAlbums(stats) {
  return Object.entries(stats?.albums || {})
    .filter(([, p]) => p.owned > 0 && p.pct < 1)
    .sort(([a, pa], [b, pb]) => pb.pct - pa.pct || (pa.total - pa.owned) - (pb.total - pb.owned) || (a < b ? -1 : 1));
}

/** Une ligne de « Presque complets » : pochette, titre, artiste, « 13/14 » et un segment par morceau. */
function AlmostRow({ id, album, p }) {
  const { t } = useI18n();
  const label = t('home.tracks', { n: p.owned });
  return (
    <li>
      <Link to={itemHref('album', id)} className="so-almost__row" data-almost={id}>
        <span className="so-almost__cover">{album ? <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} sizes="52px" /> : null}</span>
        <span className="so-almost__body">
          <span className="so-almost__title">{album?.title || '…'}</span>
          <span className="so-almost__sub">
            <span>{album?.artist || ''}</span>
            <span className="mono" title={label}>{p.owned}/{p.total}</span>
          </span>
          {p.total <= SEGMENTS ? (
            <span className="so-segs" aria-hidden="true">
              {Array.from({ length: p.total }, (_, i) => <span key={i} className={`so-segs__seg${i < p.owned ? ' is-on' : ''}`} />)}
            </span>
          ) : <Progress value={p.owned} max={p.total} size="sm" />}
        </span>
      </Link>
    </li>
  );
}

/**
 * « Deux façons de finir un album » (repliée sous Presque complets) : boosters gratuits orientés vers les albums
 * commencés, et booster d'album (bouton direct pour l'album le plus avancé).
 */
function HowToFinish({ target, onAlbumPack }) {
  const { t, lang, num, error } = useI18n();
  const { user, isAdmin } = useGame();
  const focus = new Intl.NumberFormat(lang, { style: 'percent' }).format(FOCUS_CHANCE);
  const price = isAdmin ? 0 : ECONOMY.albumPackPrice;
  const affordable = user.royalties >= price;
  return (
    <details className="so-almost__how">
      <summary>{t('home.howTitle')}</summary>
      <p><b>{t('home.howFocusTitle')}</b> · {t('home.howFocusBody', { p: focus })}</p>
      <p>
        <b>{t('home.howAlbumTitle')}</b>
        {' '}<span className="chip chip--sm">{price ? <><RoyaltyIcon size={12} /> <span className="mono">{num(price)}</span></> : t('home.howAlbumFree')}</span>
        {' '}· {t('home.howAlbumBody')}
      </p>
      {target && (
        <p>
          <button type="button" className="btn btn--primary btn--sm so-almost__quick" disabled={!affordable}
            title={affordable ? undefined : error('not_enough_royalties')} onClick={() => onAlbumPack(target)}>
            <Icon name="pack" size={16} /> <span>{t('home.howQuick', { title: target.title })}</span>
          </button>
        </p>
      )}
    </details>
  );
}

/** Colonne « Presque complets » (remplace la rangée « Albums en cours ») ; rien tant qu'aucun album n'est commencé. */
function AlmostPanel({ onAlbumPack }) {
  const { t } = useI18n();
  const { stats } = useGame();
  const started = useMemo(() => closestAlbums(stats), [stats]);
  const almost = useMemo(() => started.slice(0, ALMOST).map(([id, p]) => ({ id, p })), [started]);
  const albums = useAlbums(almost.map((x) => x.id));
  if (!almost.length) return null;
  return (
    <section className="panel so-almost" aria-labelledby="home-almost-title" data-home="almost">
      <header className="so-almost__head">
        <h2 className="panel__title" id="home-almost-title">
          <Icon name="disc" /> {almost[0].p.pct >= 0.5 ? t('home.almost') : t('home.inProgress')}
        </h2>
        <Link to="/collection?mine=1" className="section__link">{t('home.seeAll')}</Link>
      </header>
      <p className="small muted">{t('home.started', { n: started.length })}</p>
      <ul className="so-almost__list">
        {almost.map(({ id, p }, i) => <AlmostRow key={id} id={id} album={albums[i]} p={p} />)}
      </ul>
      <HowToFinish target={albums[0]} onAlbumPack={onAlbumPack} />
    </section>
  );
}

/** Colonne de l'accueil : Presque complets, Taste Match (P1-E), battle (P1-F), amis suggérés (P1-E). */
function HomeAside({ onAlbumPack }) {
  return (
    <>
      <AlmostPanel onAlbumPack={onAlbumPack} />
      <TasteMatchCard />
      <BattleWidget />
      <SuggestedFriends limit={3} />
    </>
  );
}

/** Le fil : en-tête avec les onglets, compositeur, liste ; la colonne à côté (ordinateur) ou dans le fil (téléphone). */
function HomeFeed({ onAlbumPack }) {
  const { t } = useI18n();
  const [asked, setAsked] = useState(null);
  const [focus, setFocus] = useState(0);
  const feed = useFeed(asked);
  const narrow = useMedia(NARROW);
  // Post publié depuis « Partager » (critique, liste…) sur cette page : en tête du fil, comme ceux du compositeur.
  useOnPosted((post) => feed.prepend(feedItemOfPost(post)));
  const active = asked || feed.tab;
  const aside = <HomeAside onAlbumPack={onAlbumPack} />;
  return (
    <section className="section so-home" aria-labelledby="home-feed-title">
      <header className="section__head so-home__head">
        <h2 id="home-feed-title">{t('feed.title')}</h2>
        <div className="seg so-tabs" role="group" aria-label={t('feed.tabsLabel')}>
          {FEED_TABS.map((tab) => (
            <button key={tab} type="button" className={`seg__btn seg__btn--wide${active === tab ? ' is-on' : ''}`} aria-pressed={active === tab}
              data-tab={tab} onClick={() => tab !== active && setAsked(tab)}>
              {t(`feed.tabs.${tab}`)}
            </button>
          ))}
        </div>
      </header>
      <div className="home-cols">
        <div className="so-main">
          <Composer focusSignal={focus} onPosted={(post) => feed.prepend(feedItemOfPost(post))} />
          <FeedList feed={feed} onCompose={() => setFocus((n) => n + 1)} insert={narrow ? { after: FIRST_PAGE, node: <div className="so-aside">{aside}</div> } : null} />
        </div>
        {!narrow && <aside className="so-aside" aria-label={t('feed.aside')}>{aside}</aside>}
      </div>
    </section>
  );
}

export default function Home() {
  const { t, num } = useI18n();
  const { packs, user, cards, duplicates, duplicatesValue, isAdmin } = useGame();
  const openCard = useCardModal();
  // Ouverture, achat et recyclage : la même machine que les autres pages (state/boosterFlow.js).
  const { openFree: open, openAlbum, buy, recycle, overlay, busy } = useBoosterFlow();

  const canOpen = packs.unlimited || packs.available > 0;

  const recent = useMemo(() => {
    const seen = new Set();
    return [...cards].sort((a, b) => b.at - a.at).filter((c) => !seen.has(c.t) && seen.add(c.t)).slice(0, 8);
  }, [cards]);

  return (
    <div className="home">
      {/* Héros Boosters et rangée Boutique / Doublons / Blind test : balisage et rendu inchangés (DESIGN-OVERRIDE). */}
      <section className="hero" id="booster">
        <button type="button" className="hero__pack" onClick={() => canOpen && open(1)} disabled={!canOpen} aria-label={t('home.open')}>
          <PackArt className="pack--float" />
        </button>
        <div className="hero__panel">
          <span className="eyebrow">{t('home.eyebrow')} · {t('home.content')}</span>
          <h1 className="hero__title">
            {packs.unlimited ? t('home.unlimited') : t('home.stock', { n: packs.available })}
          </h1>
          {!packs.unlimited && <PackTimer />}
          {!packs.unlimited && packs.bonus > 0 && <p className="muted small">{t('home.bonus', { n: packs.bonus })}</p>}
          <RarityGuideButton className="link-btn hero__help" />
          <div className="hero__actions">
            <button type="button" className="btn btn--primary btn--xl" onClick={() => open(1)} disabled={!canOpen}>
              <Icon name="pack" /> {canOpen ? t('home.open') : t('home.empty')}
            </button>
            {isAdmin && (
              <button type="button" className="btn btn--ghost btn--xl" onClick={() => open(10)}>{t('home.openN', { n: 10 })}</button>
            )}
          </div>
        </div>
      </section>

      <section className="home-panels">
        <article className="panel" id="boutique">
          <h2 className="panel__title"><RoyaltyIcon size={18} /> {t('home.shopTitle')}</h2>
          <p className="muted">{t('home.buyBody')}</p>
          <div className="panel__row">
            <Royalties value={user.royalties} className="pill" />
            <button type="button" className="btn btn--ghost" disabled={busy || user.royalties < ECONOMY.packPrice}
              onClick={buy}>
              {t('home.buy')} · <RoyaltyIcon size={14} /> <span className="mono">{ECONOMY.packPrice}</span>
            </button>
          </div>
        </article>
        <article className="panel">
          <h2 className="panel__title"><Icon name="recycle" /> {t('home.dupTitle')}</h2>
          {/* Valeur calculée par GameContext à partir de la rareté de chaque ligne de carte. */}
          <p className="muted">{duplicates ? t('home.dupBody', { n: duplicates, v: num(duplicatesValue || 0) }) : t('home.dupNone')}</p>
          <p className="small muted">{t('home.dupHint')}</p>
          <button type="button" className="btn btn--ghost" disabled={busy || !duplicates} onClick={recycle}>
            {t('home.recycle')}
          </button>
        </article>
        <Link to="/blindtest" className="panel panel--bt">
          <span className="panel--bt__eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <h2 className="panel__title"><Icon name="headphones" /> {t('nav.blindtest')}</h2>
          <p>{t('home.blindtest')}</p>
          <span className="btn btn--primary btn--sm">{t('home.blindtestCta')}</span>
        </Link>
      </section>

      {/* P1 : sous le héros et la rangée, jamais au-dessus. P2-B : l'événement et le Rétro sous les quêtes. */}
      <SpecialBoosters />
      <QuestStrip />
      <EventRow />

      <HomeFeed onAlbumPack={openAlbum} />

      <section className="section" data-home="recent">
        <header className="section__head">
          <h2>{t('home.recent')}</h2>
        </header>
        {recent.length ? (
          <div className="card-row">
            {recent.map((c) => (
              <Card key={c.t} trackId={c.t} variant={c.v} onClick={() => openCard(c.t)} />
            ))}
          </div>
        ) : (
          <p className="empty">{t('home.start')}</p>
        )}
      </section>

      {overlay}
    </div>
  );
}
