// Pressage d'une carte manquante : réservé à l'admin, gratuitement, pour tester (shared/rules.js). Un joueur n'achète
// jamais une carte précise : boosters, Comptoir, échanges entre amis et enchères. Pour les pages qui affichent
// « Presser · Gratuit » (page morceau, page d'album) :
//   const press = usePressCost(track);   // track : { id, rarity } (vue du catalogue)
//   press.cost   0 pour l'admin si la carte manque, sinon null (pas de pressage)
import { useGame } from '../../state/GameContext.jsx';

export function usePressCost(track) {
  const { isAdmin, ownedSet } = useGame();
  const owned = !!track?.id && !!ownedSet?.has?.(track.id);
  return { cost: track && isAdmin && !owned ? 0 : null };
}

export default usePressCost;
