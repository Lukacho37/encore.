// Page d'artiste /artist/:id — existante (P0), blocs P1 posés par P1-B (PLAN.md 2.5) : en-tête et maîtrise,
// discographie, promos, puis « Meilleur album de … ? » (duels de P1-F, dès deux albums) et les discussions (P1-A).
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { AlbumTile } from './Home.jsx';
import { ArtistBadge } from './Collection.jsx';
import { MissingState, PressDialog, TrackGrid } from './AlbumPage.jsx';
import { Celebration } from '../components/Achievements.jsx';
import { Icon, Progress } from '../components/ui.jsx';
import { useArtistDetail } from '../state/catalog.js';
import { pageExists } from '../routes.jsx';
import { Discussions } from '../components/social/Discussions.jsx';
import { ECONOMY } from '@shared/rules.js';
import '../styles/album.css';
import '../styles/studio.css';

// Discographie affichée par pages : un artiste importé a au plus une dizaine d'albums, mais on reste prudent.
const PAGE = 36;

/** En-tête et discographie vides le temps du chargement. */
function ArtistSkeleton() {
  const { t } = useI18n();
  return (
    <div className="artist-page" aria-busy="true">
      <span className="sr-only" role="status">{t('artist.loading')}</span>
      <Link to="/collection/artists" className="back-link"><Icon name="back" /> {t('collection.tabs.artists')}</Link>
      <header className="artist-head">
        <span className="album-skel album-skel--badge" />
        <div className="artist-head__info">
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--title" />
          <span className="album-skel album-skel--bar" />
        </div>
      </header>
      <section className="section">
        <div className="album-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="artist-skel-tile">
              <span className="album-skel album-skel--cover" />
              <span className="album-skel album-skel--line" />
              <span className="album-skel album-skel--line album-skel--short" />
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function ArtistView({ id }) {
  const { t, country, num } = useI18n();
  const { achievements, albumProgress, artistProgress } = useGame();
  const [pressing, setPressing] = useState(null);
  const [celebrate, setCelebrate] = useState([]);
  const [shown, setShown] = useState(PAGE);
  const detail = useArtistDetail(id);
  const loaded = detail.data?.artist?.id === id ? detail.data : null;

  if (!loaded) {
    if (detail.error) {
      return (
        <MissingState err={detail.error} notFoundTitle={t('artist.notFound')} notFoundBody={t('artist.notFoundBody')}
          loadError={t('artist.loadError')} onRetry={detail.reload} backTo="/collection/artists" backLabel={t('collection.tabs.artists')} />
      );
    }
    return <ArtistSkeleton />;
  }

  const { artist } = loaded;
  const albums = loaded.albums || [];
  const promos = loaded.promos || [];
  const p = artistProgress(id, artist.trackCount);
  const mastered = achievements.has(`artist:${id}`);
  const genre = artist.genre ? t(`genre.${artist.genre}`) : null;
  const eyebrow = [genre && genre !== `genre.${artist.genre}` ? genre : null, artist.country ? country(artist.country) : null].filter(Boolean).join(' · ');
  const color = albums[0]?.art?.palette?.[1];

  return (
    <div className="artist-page">
      <Link to="/collection/artists" className="back-link"><Icon name="back" /> {t('collection.tabs.artists')}</Link>
      <header className={`artist-head${mastered ? ' artist-head--master' : ''}`}>
        <ArtistBadge artist={artist} size={96} art={albums[0]?.art} />
        <div className="artist-head__info">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{artist.name}</h1>
          <p className="small muted artist-head__counts">
            {t('artist.counts', { albums: t('artist.albums', { n: albums.length }), tracks: t('artist.cards', { n: p.total }) })}
          </p>
          <div className="album-head__progress">
            <Progress value={p.owned} max={p.total} color={color} size="lg" />
            <span className="mono">{num(p.owned)}/{num(p.total)}</span>
          </div>
          <p className="muted">{t('artist.progress', { pct: `${Math.round(p.pct * 100)} %` })}</p>
          {mastered ? (
            <p className="gold-note"><Icon name="star" /> {t('artist.master', { name: artist.name })}</p>
          ) : (
            <p className="small muted">{t('artist.masterHint', { name: artist.name, r: ECONOMY.artistReward })}</p>
          )}
        </div>
      </header>

      <section className="section">
        <header className="section__head"><h2>{t('artist.discography')}</h2></header>
        {albums.length ? (
          <>
            <div className="album-grid">
              {albums.slice(0, shown).map((a) => <AlbumTile key={a.id} album={a} progress={albumProgress(a.id, a.trackCount)} />)}
            </div>
            {albums.length > shown && (
              <div className="artist-more">
                <button type="button" className="btn btn--ghost" onClick={() => setShown((n) => n + PAGE)}>
                  {t('artist.more', { n: albums.length - shown })}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="empty">{t('artist.noAlbums')}</p>
        )}
      </section>

      {promos.length > 0 && (
        <section className="section">
          <header className="section__head"><h2>{t('artist.promos')}</h2></header>
          <TrackGrid tracks={promos} onPress={setPressing} />
        </section>
      )}

      {albums.length > 1 && pageExists('Battles') && (
        <section className="panel st-battle-cta" data-artist="battle" aria-labelledby="st-artist-battle">
          <span className="st-battle-cta__icon" aria-hidden="true"><Icon name="trophy" size={22} /></span>
          <div className="st-battle-cta__text">
            <h2 className="panel__title" id="st-artist-battle">{t('studio.artist.battle', { name: artist.name })}</h2>
            <p className="small muted">{t('studio.artist.battleBody')}</p>
          </div>
          <span className="st-battle-cta__actions">
            <Link to={`/battles?category=${encodeURIComponent(`artist:${artist.id}`)}`} className="btn btn--ghost btn--sm">
              <Icon name="trophy" size={16} /> {t('studio.artist.battleCta')}
            </Link>
            {pageExists('Rankings') && (
              <Link to={`/rankings/${encodeURIComponent(`artist:${artist.id}`)}`} className="btn btn--quiet btn--sm">{t('studio.artist.ranking')}</Link>
            )}
          </span>
        </section>
      )}

      <div className="st-album-block" data-artist="discussions"><Discussions itemType="artist" itemId={id} /></div>

      <PressDialog trackId={pressing} onClose={() => setPressing(null)} onDone={(res) => setCelebrate(res.achievements || [])} />
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
    </div>
  );
}

export default function ArtistPage() {
  const { id } = useParams();
  // Un artiste = un état neuf : on remonte la page à chaque changement d'artiste.
  return <ArtistView key={id} id={id} />;
}
