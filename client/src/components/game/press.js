// Coût du pressage d'une carte manquante pour le joueur connecté — chantier P1-D (PLAN.md 6.4).
// Carte d'album : le barème de shared/rules.js (pressCost), sans requête. Promo : pressable pour 1 200 royalties une
// fois un album de son artiste complété ; seul le serveur le sait (GET /api/me/press/:trackId), redemandé quand un
// album se complète. Pour les pages qui affichent « Presser · N » (page morceau, page d'album, P1-B) :
//   const press = usePressCost(track);   // track : { id, rarity } (vue du catalogue)
//   press.cost   null = pas pressable (promo verrouillée, chargement) ; 0 pour l'admin
//   press.locked vrai pour une promo dont aucun album de l'artiste n'est complété (texte : game.press.promoLocked)
import { useEffect, useRef } from 'react';
import { pressCost, PROMO_PRESS_COST } from '@shared/rules.js';
import { useApi } from '../../state/catalog.js';
import { useGame } from '../../state/GameContext.jsx';

export { PROMO_PRESS_COST };

export function usePressCost(track) {
  const { isAdmin, ownedSet, achievements } = useGame();
  const promo = track?.rarity === 'promo';
  const owned = !!track?.id && !!ownedSet?.has?.(track.id);
  const info = useApi(promo && !owned && !isAdmin ? `/me/press/${encodeURIComponent(track.id)}` : null, { keep: false });
  // Un album complété peut déverrouiller la promo de son artiste : on redemande (pas au premier rendu, useApi charge).
  const completed = achievements?.size ?? 0;
  const seen = useRef(completed);
  const { reload } = info;
  useEffect(() => {
    if (seen.current === completed) return;
    seen.current = completed;
    reload();
    // reload change à chaque rendu : seule la complétion d'un album relance la requête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);
  if (!track) return { cost: null, locked: false, loading: false };
  if (isAdmin) return { cost: 0, locked: false, loading: false };
  if (!promo) return { cost: pressCost(track.rarity) ?? null, locked: false, loading: false };
  if (owned) return { cost: null, locked: false, loading: false };
  return {
    cost: info.data?.pressable ? info.data.cost : null,
    locked: info.data?.reason === 'promo_locked',
    loading: info.loading,
  };
}

export default usePressCost;
