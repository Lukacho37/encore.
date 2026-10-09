// Image à partager (PNG) — chantier P1-C (PLAN.md 9.2, règles 7.1 : visuels générés par défaut).
// renderImage(spec) → Promise<{ blob, usedCovers }> ; spec = { format: 'portrait'|'square'|'story', theme: 'ink'|'ivory',
// title, subtitle?, tiles: [{ albumId | trackId, label?, sub? }], blocks?: [...], footer: 'AlbumMania' }.
// Squelette posé par K0 (scripts/scaffold.mjs) : refuse avec le code `not_ready`.
export function renderImage(_spec) {
  const err = new Error('not_ready');
  err.code = 'not_ready';
  return Promise.reject(err);
}

export default renderImage;
