// Albums proches (page album) — chantier P1-E (PLAN.md 9.2). Props (contrat, ne pas les renommer) : { albumId }.
// GET /api/albums/:id/similar → { items: [{ id, reason: 'corated' | 'artist' | 'genre_decade' }], catalog } : aimés par
// les mêmes joueurs, du même artiste, même genre et même époque (album_similar une fois rempli, calcul à la volée
// avant). Une étagère « Albums similaires » (Shelf), chaque vignette avec sa raison ; rien tant que la réponse n'est pas
// arrivée, ni s'il n'y a rien à proposer.
import { useI18n } from '../../i18n/index.jsx';
import { useApi } from '../../state/catalog.js';
import { Shelf } from './Shelf.jsx';

export function SimilarAlbums({ albumId }) {
  const { t } = useI18n();
  const { data } = useApi(albumId ? `/albums/${encodeURIComponent(albumId)}/similar` : null);
  const items = data?.items || [];
  if (!items.length) return null;
  const reasons = new Map(items.map((x) => [x.id, x.reason]));
  return (
    <Shelf
      id="similar"
      title={t('discover.similar.title')}
      albumIds={items.map((x) => x.id)}
      captionOf={(id) => (reasons.get(id) ? t(`discover.similar.reasons.${reasons.get(id)}`) : null)}
    />
  );
}

export default SimilarAlbums;
