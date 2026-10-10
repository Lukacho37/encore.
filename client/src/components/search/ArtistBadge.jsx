// Pastille d'artiste : son initiale sur un visuel généré (palette tirée de son identifiant, ou `art` d'un album).
// Sortie de pages/Collection.jsx (qui la réexporte, ArtistPage s'en sert) pour servir aussi aux résultats de
// recherche sans charger la page Collection. Styles : app.css (.artist-badge). Chantier P0-E.
import CoverArt from '../CoverArt.jsx';
import { generatedArt } from '@shared/art.js';

export function ArtistBadge({ artist, size = 44, art }) {
  const seed = art?.seed || artist?.id || 'artist';
  const visual = art?.palette ? { ...art, seed } : { ...generatedArt(seed), seed };
  return (
    <span className="artist-badge" style={{ width: size, height: size }}>
      <CoverArt art={visual} generated />
      <span className="artist-badge__initial" style={{ fontSize: size * 0.42 }}>{artist?.name?.[0] || '?'}</span>
    </span>
  );
}

export default ArtistBadge;
