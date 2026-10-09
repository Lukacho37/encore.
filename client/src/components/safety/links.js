// Liens dans les textes publiés (critiques, posts, commentaires) — chantier P0-F (PLAN.md 7.1). Même liste blanche que le
// serveur (server/moderation.js, LINK_HOSTS), qui retire déjà les autres liens : ici, on ne rend cliquables que ceux-là,
// avec rel="nofollow ugc noopener noreferrer". Les deux listes doivent rester identiques.
export const LINK_HOSTS = ['deezer.com', 'open.spotify.com', 'music.apple.com', 'youtube.com', 'youtu.be', 'bandcamp.com', 'musicbrainz.org', 'wikipedia.org'];

// Adresse dans un texte (schéma http(s) ou « www. ») ; la ponctuation finale n'en fait pas partie.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/gi;
const TRAILING = /[.,;:!?)\]}»”’]+$/;

/** URL complète d'un lien autorisé, ou null. */
export function allowedHref(raw) {
  let url;
  try {
    url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return LINK_HOSTS.some((d) => host === d || host.endsWith(`.${d}`)) ? url.href : null;
}

/**
 * Découpe un texte en morceaux : { text } ou { link, href } (lien autorisé). Un lien hors liste reste du texte.
 */
export function splitLinks(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const tail = TRAILING.exec(raw)?.[0] || '';
    const link = tail ? raw.slice(0, -tail.length) : raw;
    const href = allowedHref(link);
    if (!href) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ link, href });
    last = m.index + link.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
