// Panneau d'écoute d'un album ou d'un morceau — chantier P0-C (PLAN.md 7.1, 9.2). Props (contrat) :
//   <ListenPanel kind="album" | "track" item={album | morceau} />
// Liens officiels : la page Deezer de l'élément (lien direct) puis des recherches Spotify, Apple Music et YouTube,
// la plateforme d'écoute préférée du joueur (user.prefs.listen) en premier. Lecteur intégré Deezer seulement après
// un clic (« Charger le lecteur » ou « Toujours charger », mémorisé dans ce navigateur, effaçable dans les
// Paramètres avec resetEmbedChoices()) : jamais de lecture automatique, jamais de fichier audio servi par AlbumMania,
// rien posé sur le lecteur. Remplace les anciens listenLinks / ListenBlock (fiche carte) et AlbumListen (page album).
import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { PROVIDER_NAMES, useCovers } from '../state/CoversContext.jsx';
import { shownCover } from './CoverArt.jsx';
import { Icon } from './ui.jsx';
import { storage } from '../storage.js';
import '../styles/track.css';

/** Clé du choix « Toujours charger » par plateforme ({ deezer: 'always' }) dans le stockage du navigateur. */
export const EMBED_STORAGE_KEY = 'albummania.embeds';

/** Choix enregistrés des lecteurs intégrés : { deezer: 'always' } (objet vide par défaut). */
export function embedChoices() {
  try {
    const value = JSON.parse(storage.get(EMBED_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function rememberEmbed(provider) {
  storage.set(EMBED_STORAGE_KEY, JSON.stringify({ ...embedChoices(), [provider]: 'always' }));
}

/** Oublie les « Toujours charger » (réglage « Lecteurs intégrés » des Paramètres, P0-D). */
export function resetEmbedChoices() {
  storage.remove(EMBED_STORAGE_KEY);
}

/** Identifiant Deezer d'un lien de page Deezer (« …deezer.com/fr/album/302127 ») s'il est du bon type, sinon null. */
export function deezerIdOf(url, kind) {
  const m = /^https:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(album|track)\/(\d+)/i.exec(String(url || ''));
  return m && m[1].toLowerCase() === kind ? m[2] : null;
}

/** Plateformes proposées, dans l'ordre par défaut ; `prefs.listen` vaut l'un des trois premiers identifiants. */
const PLATFORMS = [
  { id: 'deezer', name: 'Deezer', search: (q) => `https://www.deezer.com/search/${q}` },
  { id: 'spotify', name: 'Spotify', search: (q) => `https://open.spotify.com/search/${q}` },
  { id: 'apple', name: 'Apple Music', search: (q) => `https://music.apple.com/search?term=${q}` },
  { id: 'youtube', name: 'YouTube', search: (q) => `https://www.youtube.com/results?search_query=${q}` },
];

/** Lien direct d'un élément : page officielle connue (/api/covers pour les albums de base, `url` des importés). */
export function directLink(kind, item, covers) {
  const fromCovers = kind === 'album' ? covers?.all?.[item.id] : covers?.tracks?.[item.id];
  if (fromCovers?.url) return { url: fromCovers.url, provider: fromCovers.provider || 'deezer' };
  return item?.url ? { url: item.url, provider: 'deezer' } : null;
}

/**
 * Liens d'écoute d'un élément : [{ id, name, href, direct }], la plateforme préférée d'abord. Une plateforme avec un
 * lien direct l'utilise ; les autres ouvrent leur recherche (« artiste titre »), sans aucune API.
 */
export function listenLinks(kind, item, { direct = null, prefer = 'deezer' } = {}) {
  const q = encodeURIComponent(`${item.artist || ''} ${String(item.title || '').replace(/\*+/g, '')}`.trim());
  const links = PLATFORMS.map((p) => (direct?.provider === p.id
    ? { id: p.id, name: p.name, href: direct.url, direct: true }
    : { id: p.id, name: p.name, href: p.search(q), direct: false }));
  const first = links.findIndex((l) => l.id === prefer);
  return first > 0 ? [links[first], ...links.slice(0, first), ...links.slice(first + 1)] : links;
}

export default function ListenPanel({ kind, item }) {
  const { t } = useI18n();
  const { user } = useGame();
  const covers = useCovers();
  const [loaded, setLoaded] = useState(() => embedChoices().deezer === 'always');
  if (!item) return null;
  const direct = directLink(kind, item, covers);
  const links = listenLinks(kind, item, { direct, prefer: user?.prefs?.listen });
  const deezerId = direct?.provider === 'deezer' ? deezerIdOf(direct.url, kind) : null;
  // Crédit de la pochette seulement quand une vraie pochette est affichée (pas retirée, pas en échec).
  const cover = shownCover(item.art, covers);
  const always = () => {
    rememberEmbed('deezer');
    setLoaded(true);
  };
  return (
    <section className="trk-listen" aria-label={t('track.listen.title')}>
      <div className="trk-listen__links">
        <span className="label">{t('track.listen.on')}</span>
        {links.map((l) => (
          <a key={l.id} href={l.href} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm"
            title={l.direct ? t('track.listen.directTitle', { p: l.name }) : t('track.listen.searchTitle', { p: l.name })}>
            {l.name} <Icon name="external" size={14} />
          </a>
        ))}
      </div>
      {deezerId && (loaded ? (
        <iframe
          className={`trk-listen__frame trk-listen__frame--${kind}`}
          title={t('track.listen.frameTitle', { title: item.title })}
          src={`https://widget.deezer.com/widget/dark/${kind}/${deezerId}`}
          loading="lazy"
          allow="encrypted-media; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="trk-listen__embed">
          <span className="trk-listen__icon" aria-hidden="true"><Icon name="headphones" size={18} /></span>
          <p className="trk-listen__text">
            <strong>{t('track.listen.embedTitle')}</strong>
            <span className="muted"> · {t('track.listen.embedBody')}</span>
          </p>
          <span className="trk-listen__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLoaded(true)}>{t('track.listen.load')}</button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={always}>{t('track.listen.always')}</button>
          </span>
        </div>
      ))}
      {cover && (
        <p className="small muted trk-listen__credit">
          {direct
            ? <a href={direct.url} target="_blank" rel="noreferrer noopener">{t('track.listen.coverCredit', { p: PROVIDER_NAMES[cover.provider] || cover.provider })}</a>
            : t('track.listen.coverCredit', { p: PROVIDER_NAMES[cover.provider] || cover.provider })}
        </p>
      )}
    </section>
  );
}
