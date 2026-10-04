import { Link, Navigate, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { AlbumTile } from './Home.jsx';
import { ArtistBadge } from './Collection.jsx';
import { TrackGrid } from './AlbumPage.jsx';
import { Icon, Progress } from '../components/ui.jsx';
import { ARTIST_BY_ID, ALBUMS_BY_ARTIST, PROMO_TRACKS } from '@shared/catalog.js';
import { ECONOMY } from '@shared/rules.js';

export default function ArtistPage() {
  const { id } = useParams();
  const { t, country } = useI18n();
  const { stats, achievements } = useGame();
  const artist = ARTIST_BY_ID[id];
  if (!artist) return <Navigate to="/collection/artists" replace />;
  const albums = ALBUMS_BY_ARTIST[id] || [];
  const promos = PROMO_TRACKS.filter((p) => p.artistId === id);
  const p = stats.artists[id];
  const mastered = achievements.has(`artist:${id}`);

  return (
    <div className="artist-page">
      <Link to="/collection/artists" className="back-link"><Icon name="back" /> {t('collection.tabs.artists')}</Link>
      <header className={`artist-head${mastered ? ' artist-head--master' : ''}`}>
        <ArtistBadge artist={artist} size={96} />
        <div className="artist-head__info">
          <span className="eyebrow">{t(`genre.${artist.genre}`)} · {country(artist.country)}</span>
          <h1>{artist.name}</h1>
          <div className="album-head__progress">
            <Progress value={p.owned} max={p.total} color={albums[0]?.art.palette[1]} size="lg" />
            <span className="mono">{p.owned}/{p.total}</span>
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
        <div className="album-grid">
          {albums.map((a) => <AlbumTile key={a.id} album={a} progress={stats.albums[a.id]} />)}
        </div>
      </section>

      {promos.length > 0 && (
        <section className="section">
          <header className="section__head"><h2>{t('artist.promos')}</h2></header>
          <TrackGrid tracks={promos} />
        </section>
      )}
    </div>
  );
}
