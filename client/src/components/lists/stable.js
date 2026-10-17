// Rappel stable — chantier P1-C. La fenêtre commune (Modal de ui.jsx) relance son effet (focus, Échap) quand son
// `onClose` change : un `onClose` écrit en ligne par le parent change à chaque rendu de celui-ci (catalogue qui se
// remplit pendant une recherche, sauvegarde automatique…), et le focus sautait alors du champ au bouton « Fermer ».
// useStableCallback(fn) renvoie une fonction qui ne change jamais et appelle toujours la dernière version de `fn`.
import { useCallback, useEffect, useRef } from 'react';

export function useStableCallback(fn) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current?.(...args), []);
}

export default useStableCallback;
