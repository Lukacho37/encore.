// Démo publiée sur claude.ai : la page tourne dans un cadre qui n'autorise pas les téléchargements classiques
// (lien <a download>). Le lecteur propose à la place la capacité `downloads` : le visiteur confirme l'enregistrement
// du fichier. Hors de ce lecteur (site réel, démo ouverte en local), `hostSave` répond false et l'appelant garde son
// comportement habituel.

// Demandée une seule fois, dès le chargement : la réponse du lecteur arrive plus tard (null s'il n'y en a pas).
const downloads = __DEMO__ && typeof window !== 'undefined' && typeof window.claude?.use === 'function'
  ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
  : Promise.resolve(null);

/**
 * Propose le fichier au visiteur par le lecteur de claude.ai. Renvoie 'saved' (accepté), 'declined' (refusé : ne rien
 * faire de plus) ou false (capacité absente : l'appelant prend le relais).
 */
export async function hostSave(filename, data) {
  const ns = await downloads;
  if (!ns) return false;
  try {
    await ns.save({ filename, data });
    return 'saved';
  } catch (err) {
    if (err?.code === 'declined' || err?.code === 'rate_limited') return 'declined';
    return false;
  }
}
