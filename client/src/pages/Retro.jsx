// AlbumMania Rétro (/retro/:year) — chantier P2-A (PLAN.md 2.1, 5.8, 7.1, 8.3 P2.2). Jamais « Wrapped » ni « Replay ».
// GET /api/retro/:year → l'année du joueur en cinq images (components/passport/model.js) : Mon année (le grand
// chiffre et les faits), Mon artiste de l'année, Mes albums de l'année, Mes moments (première carte, premier vinyle et
// son n° de pressage, pépite, mois le plus actif), Mon année en genres. Chaque image s'affiche ici au format story
// (9:16, fond encre, logo AlbumMania en pied) et se partage par la feuille de P1-C (story par défaut, 4:5 et carré
// aussi ; vraies pochettes, repli généré). Navigation : boutons, flèches du clavier, glissement du doigt, liste des
// images. Une année légère garde des phrases douces ; une image vide le dit et ne se partage pas.
// L'année en cours avant le 1er décembre : compte à rebours et liens vers le passeport et les Rétro passés.
// Année indisponible (avant l'inscription, hors limites) : 404 retro_not_found, avec les années disponibles.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useAlbum, useApi, useTrack } from '../state/catalog.js';
import { Icon, Logo } from '../components/ui.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { retroSlides } from '../components/passport/model.js';
import '../styles/passport.css';

// Feuille de partage chargée seulement quand on partage.
const ShareSheet = lazy(() => import('../share/ShareSheet.jsx'));

const enc = encodeURIComponent;
const DAY = 86_400_000;

export default function Retro() {
  const { year } = useParams();
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi(`/retro/${enc(year || '')}`, { keep: false });
  if (loading) {
    return (
      <div className="pp-page" data-page="retro" aria-busy="true">
        <div className="pp-skel pp-skel--head skeleton" />
        <div className="pp-retro"><div className="pp-slide skeleton" /></div>
      </div>
    );
  }
  if (error) {
    if (error.code === 'retro_not_found') {
      return (
        <div className="pp-page" data-page="retro" data-retro="missing">
          <EmptyState icon="star" title={t('retro.notFound.title', { year })} body={t('retro.notFound.body')}
            action={{ label: t('retro.passport'), to: '/passport', primary: false }} />
          <YearLinks years={error.data?.years || []} current={Number(year)} />
        </div>
      );
    }
    return <div className="pp-page" data-page="retro"><ErrorBox error={error} onRetry={reload} /></div>;
  }
  if (!data) return null;
  if (data.status === 'locked') return <Locked r={data} />;
  return <RetroView r={data} />;
}

/** Autres années disponibles (puces). */
function YearLinks({ years, current }) {
  const { t } = useI18n();
  const others = years.filter((y) => y !== current);
  if (!others.length) return null;
  return (
    <div className="pp-years" aria-label={t('retro.years')}>
      <span className="label">{t('retro.years')}</span>
      {others.map((y) => <Link key={y} to={`/retro/${y}`} className="chip chip--toggle" data-retro-year={y}>{y}</Link>)}
    </div>
  );
}

// ----- Rétro pas encore ouvert --------------------------------------------------------------------------------

function Locked({ r }) {
  const { t } = useI18n();
  const days = Math.max(1, Math.ceil((r.opensAt - Date.now()) / DAY));
  return (
    <div className="pp-page" data-page="retro" data-retro="locked">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('retro.kicker')}</span>
          <h1>{t('retro.title', { year: String(r.year) })}</h1>
        </div>
      </header>
      <section className="panel pp-locked">
        <div>
          <h2>{t('retro.locked.title', { year: String(r.year) })}</h2>
          <p>{t('retro.locked.body')}</p>
          <div className="pp-head__actions">
            <Link to="/passport" className="btn btn--primary"><Icon name="globe" size={16} /> {t('retro.locked.passport')}</Link>
            {(r.years || []).slice(0, 2).map((y) => (
              <Link key={y} to={`/retro/${y}`} className="btn btn--ghost">{t('retro.locked.past', { year: String(y) })}</Link>
            ))}
          </div>
        </div>
        <div className="pp-locked__aside" aria-label={t('retro.locked.countdown', { n: days })}>
          <span className="pp-locked__count" aria-hidden="true">{days}</span>
          <span className="label" aria-hidden="true">{t('retro.locked.countdown', { n: days })}</span>
        </div>
      </section>
    </div>
  );
}

// ----- Rétro ouvert -------------------------------------------------------------------------------------------

function RetroView({ r }) {
  const { t, lang } = useI18n();
  const { ratingScale } = useGame();
  const username = r.owner?.username || '';
  const slides = useMemo(() => retroSlides({ t, lang, r, username, scale: ratingScale }), [t, lang, r, username, ratingScale]);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [sharing, setSharing] = useState(false);
  const start = useRef(null);
  const n = slides.length;
  const slide = slides[index];
  const go = (i) => {
    const next = Math.max(0, Math.min(n - 1, i));
    if (next === index) return;
    setDir(next > index ? 1 : -1);
    setIndex(next);
  };
  useEffect(() => {
    setIndex(0);
  }, [r.year]);
  const onKey = (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    }
  };
  const onDown = (e) => {
    start.current = e.clientX;
  };
  const onUp = (e) => {
    if (start.current == null) return;
    const dx = e.clientX - start.current;
    start.current = null;
    if (Math.abs(dx) > 48) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <div className="pp-page" data-page="retro" data-retro="open" data-year={String(r.year)}>
      <header className="page-head pp-head">
        <div>
          <span className="eyebrow">{t('retro.kicker')}</span>
          <h1>{t('retro.title', { year: String(r.year) })}</h1>
          <p className="pp-head__intro">{r.thin ? t('retro.introThin') : t('retro.intro')}</p>
          {r.preview && (
            <div className="pp-head__meta">
              <span className="chip chip--sm chip--gold" title={t('retro.previewHint')} data-retro-preview="">{t('retro.preview')}</span>
            </div>
          )}
        </div>
      </header>

      <div className="pp-retro">
        <div className="pp-retro__viewer" tabIndex={0} role="region" aria-roledescription="carousel" aria-label={t('retro.title', { year: String(r.year) })}
          onKeyDown={onKey}>
          <RetroSlide key={`${r.year}-${index}`} slide={slide} index={index} n={n} year={String(r.year)} dir={dir} onPointerDown={onDown} onPointerUp={onUp} />
          <div className="pp-retro__nav">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t('retro.prev')} data-retro-prev="">
              <Icon name="back" size={16} />
            </button>
            <span className="mono small muted" aria-live="polite">{t('retro.slideOf', { i: index + 1, n })}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(index + 1)} disabled={index === n - 1} aria-label={t('retro.next')} data-retro-next="">
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setSharing(true)} disabled={!slide.spec}
            title={slide.spec ? undefined : t('retro.shareNone')} data-retro-share={slide.id}>
            <Icon name="share" size={16} /> {t('retro.share')}
          </button>
          {!slide.spec && <p className="pp-hint">{t('retro.shareNone')}</p>}
        </div>

        <aside className="pp-retro__side">
          <section className="panel">
            <h2 className="panel__title"><Icon name="star" /> {t('retro.slides')}</h2>
            <ol className="pp-thumbs">
              {slides.map((s, i) => (
                <li key={s.id}>
                  <button type="button" onClick={() => go(i)} aria-current={i === index ? 'true' : undefined}
                    aria-label={t('retro.goTo', { i: i + 1, title: s.name })} data-retro-thumb={s.id}>
                    <span className="pp-thumbs__n">{i + 1}</span>
                    <span>{s.name}</span>
                    {s.spec ? <Icon name="share" size={14} /> : <span />}
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <YearLinks years={r.years || []} current={r.year} />
          <Link to="/passport" className="section__link"><Icon name="globe" size={16} /> {t('retro.passport')}</Link>
        </aside>
      </div>

      {sharing && slide.spec && (
        <Suspense fallback={null}>
          <ShareSheet spec={slide.spec} title={t('retro.shareTitle', { year: String(r.year) })} fileName={`retro-${r.year}-${index + 1}-${slide.id}`}
            onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Pochette d'une image : album ou morceau (vraie pochette, repli généré). */
function SlideCover({ albumId, trackId, className = '' }) {
  const album = useAlbum(albumId || null);
  const track = useTrack(trackId || null);
  const item = album || track;
  return (
    <span className={`pp-slide__cover ${className}`}>
      {item?.art ? <CoverArt art={item.art} title={item.title} sizes="(max-width: 520px) 70vw, 320px" /> : null}
    </span>
  );
}

/** Une image du Rétro à l'écran (format story). */
function RetroSlide({ slide, index, n, year, dir, onPointerDown, onPointerUp }) {
  const { t, num } = useI18n();
  return (
    <article className="pp-slide pp-slide--in" style={{ '--pp-from': dir > 0 ? '14px' : '-14px' }} aria-roledescription="slide"
      aria-label={t('retro.goTo', { i: index + 1, title: slide.name })} data-slide={slide.id} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="pp-slide__in">
        <div className="pp-slide__dots" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => <span key={i} className={i <= index ? 'is-on' : undefined} />)}
        </div>
        <span className="pp-slide__eyebrow">{t('retro.title', { year })}</span>
        {slide.id !== 'artist' && <h2 className="pp-slide__title">{slide.title}</h2>}
        <div className="pp-slide__body">
          {slide.id === 'intro' && <IntroBody s={slide} num={num} />}
          {slide.id === 'artist' && <ArtistBody s={slide} />}
          {slide.id === 'albums' && <AlbumsBody s={slide} />}
          {slide.id === 'moments' && <MomentsBody s={slide} />}
          {slide.id === 'genres' && <GenresBody s={slide} />}
        </div>
        <div className="pp-slide__foot"><Logo /></div>
      </div>
    </article>
  );
}

function IntroBody({ s, num }) {
  const { t } = useI18n();
  if (s.empty) {
    return (
      <div className="pp-slide__empty">
        <p>{t('retro.intros.empty')}</p>
        <Link to="/" className="btn btn--primary btn--sm"><Icon name="pack" size={16} /> {t('retro.openBoosters')}</Link>
      </div>
    );
  }
  return (
    <>
      <div className="pp-slide__big" data-retro-cards={s.cards}><b>{num(s.cards)}</b><span>{s.cardsLabel}</span></div>
      {s.facts.length > 0 && <ul className="pp-slide__facts">{s.facts.map((f) => <li key={f}>{f}</li>)}</ul>}
      {s.thin && <p className="pp-slide__text">{s.thin}</p>}
      {s.covers.length > 0 && (
        <div className="pp-slide__covers pp-slide__covers--4">
          {s.covers.map((id) => <SlideCover key={id} albumId={id} />)}
        </div>
      )}
    </>
  );
}

function ArtistBody({ s }) {
  const { t } = useI18n();
  if (s.empty) return <div className="pp-slide__empty"><h2 className="pp-slide__title">{s.title}</h2><p>{t('retro.artist.none')}</p></div>;
  return (
    <>
      <span className="pp-slide__label pp-slide__center">{s.title}</span>
      {s.albumId && <SlideCover albumId={s.albumId} className="pp-slide__hero" />}
      <Link to={`/artist/${enc(s.artistId)}`} className="pp-slide__name">{s.artist}</Link>
      {s.facts.length > 0 && <p className="pp-slide__text pp-slide__center">{s.facts.join(' · ')}</p>}
      {s.runnersUp.length > 0 && (
        <p className="pp-slide__item-sub pp-slide__center">{t('retro.artist.runnersUp')} · {s.runnersUp.join(', ')}</p>
      )}
    </>
  );
}

function AlbumsBody({ s }) {
  const { t } = useI18n();
  if (s.empty) return <div className="pp-slide__empty"><p>{t('retro.albums.none')}</p></div>;
  return (
    <>
      <span className="pp-slide__label">{s.caption}</span>
      <ol className="pp-slide__list">
        {s.items.map((x, i) => (
          <li key={x.albumId} className="pp-slide__item">
            <span className="pp-slide__rank">{i + 1}</span>
            <SlideCover albumId={x.albumId} />
            <Link to={`/album/${enc(x.albumId)}`}>
              <span className="pp-slide__item-title">{x.title}</span>
              <span className="pp-slide__item-sub">{x.artist ? `${x.artist} · ` : ''}{x.sub}</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

function MomentsBody({ s }) {
  const { t } = useI18n();
  if (s.empty) return <div className="pp-slide__empty"><p>{t('retro.moments.none')}</p></div>;
  return (
    <ul className="pp-slide__list">
      {s.items.map((x) => (
        <li key={x.kind} className="pp-slide__item pp-slide__item--moment" data-moment={x.kind}>
          <SlideCover albumId={x.albumId} trackId={x.trackId} />
          <span>
            <span className="pp-slide__label">{x.label}</span>
            <span className="pp-slide__item-title">{x.title}</span>
            <span className="pp-slide__item-sub">{x.sub}</span>
          </span>
        </li>
      ))}
      {s.busiest && (
        <li className="pp-slide__item pp-slide__item--moment" data-moment="busiest">
          <span className="pp-slide__icon" aria-hidden="true"><Icon name="flag" size={22} /></span>
          <span>
            <span className="pp-slide__label">{t('retro.moments.busiest')}</span>
            <span className="pp-slide__item-title">{s.busiest}</span>
          </span>
        </li>
      )}
    </ul>
  );
}

function GenresBody({ s }) {
  const { t } = useI18n();
  if (s.empty) return <div className="pp-slide__empty"><p>{t('retro.genres.none')}</p></div>;
  return (
    <>
      {s.top && <p className="pp-slide__text">{s.top}</p>}
      <ul className="pp-slide__bars">
        {s.bars.map((b) => (
          <li key={b.id} style={{ '--pp-c': b.color }}>
            <span>{b.label}</span>
            <span className="mono">{b.pct}</span>
            <i aria-hidden="true"><b style={{ width: `${Math.max(4, b.value * 100)}%` }} /></i>
          </li>
        ))}
      </ul>
      {s.decade && <p className="pp-slide__item-sub">{s.decade}</p>}
      {s.covers.length > 0 && (
        <div className="pp-slide__covers pp-slide__covers--4">
          {s.covers.map((id) => <SlideCover key={id} albumId={id} />)}
        </div>
      )}
    </>
  );
}
