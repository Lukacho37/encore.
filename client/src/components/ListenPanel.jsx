// Panneau d'écoute d'un album ou d'un morceau — chantier P0-C, enrichi par P2-C (PLAN.md 4.3, 7.1, 9.2). Props (contrat) :
//   <ListenPanel kind="album" | "track" item={album | morceau} />
// Liens et lecteurs viennent de GET /api/catalog/listen/:type/:id (server/enrich.js) : la page officielle quand
// l'identifiant est connu (Deezer ; Spotify et Apple Music d'après MusicBrainz / Wikidata, données libres CC0),
// sinon une recherche (Spotify, Apple Music, YouTube), la plateforme d'écoute préférée du joueur (user.prefs.listen)
// en premier. Les lecteurs officiels (Deezer, Spotify, Apple Music) ne se chargent qu'après un clic (« Charger le
// lecteur » ou « Toujours charger », mémorisé par plateforme dans ce navigateur, effaçable dans les Paramètres avec
// resetEmbedChoices()) : jamais de lecture automatique, jamais de fichier audio servi par AlbumMania, rien posé sur
// le lecteur. Avant la réponse (ou sans elle), les liens se déduisent de l'élément, comme avant P2. Un élément
// archivé (fournisseur détaché) le dit ; un fournisseur détaché n'est plus proposé.
// Remplace les anciens listenLinks / ListenBlock (fiche carte) et AlbumListen (page album).
import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useApi } from '../state/catalog.js';
import { PROVIDER_NAMES, useCovers } from '../state/CoversContext.jsx';
import { shownCover } from './CoverArt.jsx';
import { Icon } from './ui.jsx';
import { storage } from '../storage.js';
import { PROVIDER_NAMES as LISTEN_NAMES, deezerIdOf as parseDeezerId, embedFor, searchUrl } from '@shared/ids.js';
import '../styles/track.css';
import '../styles/enrich.css';

/** Clé du choix « Toujours charger » par plateforme ({ deezer: 'always', spotify: 'always' }) dans le navigateur. */
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

/** Au moins un lecteur se charge sans demander (pour le réglage « Lecteurs intégrés » des Paramètres). */
export const hasAlwaysEmbeds = () => Object.values(embedChoices()).includes('always');

function rememberEmbed(provider) {
  storage.set(EMBED_STORAGE_KEY, JSON.stringify({ ...embedChoices(), [provider]: 'always' }));
}

/** Oublie les « Toujours charger » (réglage « Lecteurs intégrés » des Paramètres, P0-D). */
export function resetEmbedChoices() {
  storage.remove(EMBED_STORAGE_KEY);
}

/** Identifiant Deezer d'un lien de page Deezer (« …deezer.com/fr/album/302127 ») s'il est du bon type, sinon null. */
export const deezerIdOf = parseDeezerId;

/** Plateformes proposées, dans l'ordre par défaut ; `prefs.listen` vaut l'un des trois premiers identifiants. */
const PLATFORMS = ['deezer', 'spotify', 'apple', 'youtube'];

/** Lien direct d'un élément : page officielle connue (/api/covers pour les albums de base, `url` des importés). */
export function directLink(kind, item, covers) {
  const fromCovers = kind === 'album' ? covers?.all?.[item.id] : covers?.tracks?.[item.id];
  if (fromCovers?.url) return { url: fromCovers.url, provider: fromCovers.provider || 'deezer' };
  return item?.url ? { url: item.url, provider: 'deezer' } : null;
}

/** La plateforme préférée d'abord, les autres dans leur ordre. */
function preferFirst(list, prefer, key = (x) => x.id) {
  const first = list.findIndex((x) => key(x) === prefer);
  return first > 0 ? [list[first], ...list.slice(0, first), ...list.slice(first + 1)] : list;
}

/**
 * Liens d'écoute d'un élément : [{ id, name, href, direct }], la plateforme préférée d'abord. Une plateforme avec un
 * lien direct l'utilise ; les autres ouvrent leur recherche (« artiste titre »), sans aucune API.
 */
export function listenLinks(kind, item, { direct = null, prefer = 'deezer' } = {}) {
  const text = `${item.artist || ''} ${String(item.title || '').replace(/\*+/g, '')}`.trim();
  const links = PLATFORMS.map((id) => (direct?.provider === id
    ? { id, name: LISTEN_NAMES[id], href: direct.url, direct: true }
    : { id, name: LISTEN_NAMES[id], href: searchUrl(id, text), direct: false }));
  return preferFirst(links, prefer);
}

/** Lecteur intégré officiel (après le clic) : jamais de lecture automatique, rien par-dessus. */
function EmbedFrame({ embed, kind, title }) {
  const { t } = useI18n();
  const name = LISTEN_NAMES[embed.provider];
  return (
    <iframe
      className={`trk-listen__frame en-frame en-frame--${embed.provider} trk-listen__frame--${kind}`}
      style={{ height: embed.height }}
      title={t('listen.frameTitle', { p: name, title })}
      src={embed.src}
      loading="lazy"
      allow="encrypted-media; clipboard-write"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox={embed.provider === 'apple'
        ? 'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation'
        : undefined}
    />
  );
}

export default function ListenPanel({ kind, item }) {
  const { t } = useI18n();
  const { user } = useGame();
  const covers = useCovers();
  const { data } = useApi(item?.id ? `/catalog/listen/${kind}/${encodeURIComponent(item.id)}` : null);
  const [chosen, setChosen] = useState(null);
  const [loaded, setLoaded] = useState(() => new Set(Object.entries(embedChoices()).filter(([, v]) => v === 'always').map(([k]) => k)));
  if (!item) return null;
  const prefer = user?.prefs?.listen;

  // Liens et lecteurs du serveur ; sinon (chargement, démo hors ligne), ceux qui se déduisent de l'élément.
  const local = directLink(kind, item, covers);
  const links = data?.links
    ? preferFirst(data.links.map((l) => ({ id: l.provider, name: LISTEN_NAMES[l.provider] || l.provider, href: l.url, direct: !!l.direct })), prefer)
    : listenLinks(kind, item, { direct: local, prefer });
  const localDeezer = local?.provider === 'deezer' ? deezerIdOf(local.url, kind) : null;
  const embeds = preferFirst(data?.embeds || (localDeezer ? [embedFor('deezer', kind, localDeezer)].filter(Boolean) : []), prefer, (e) => e.provider);
  const embed = embeds.find((e) => e.provider === chosen) || embeds[0] || null;
  const embedName = embed ? LISTEN_NAMES[embed.provider] : '';
  const deezerLink = links.find((l) => l.id === 'deezer' && l.direct);

  // Crédit de la pochette seulement quand une vraie pochette est affichée (pas retirée, pas en échec).
  const cover = shownCover(item.art, covers);
  const load = (provider, always = false) => {
    if (always) rememberEmbed(provider);
    setLoaded((s) => new Set([...s, provider]));
  };
  const sources = (data?.sources || []).filter((s) => s.url);

  return (
    <section className="trk-listen en-listen" aria-label={t('track.listen.title')}>
      {data?.archived && (
        <p className="en-archived small" role="note">
          <span className="chip chip--sm chip--quiet">{t(`listen.archived.${kind}`)}</span>
          <span className="muted">{t('listen.archivedBody')}</span>
        </p>
      )}
      <div className="trk-listen__links">
        <span className="label">{t('track.listen.on')}</span>
        {links.map((l) => (
          <a key={l.id} href={l.href} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm"
            title={l.direct ? t('track.listen.directTitle', { p: l.name }) : t('track.listen.searchTitle', { p: l.name })}>
            {l.name} <Icon name="external" size={14} />
          </a>
        ))}
      </div>
      {embed && (
        <div className="en-player">
          {embeds.length > 1 && (
            <div className="seg en-switch" role="group" aria-label={t('listen.players')}>
              {embeds.map((e) => (
                <button key={e.provider} type="button" className={`seg__btn seg__btn--wide${e === embed ? ' is-on' : ''}`}
                  aria-pressed={e === embed} onClick={() => setChosen(e.provider)}>
                  {LISTEN_NAMES[e.provider]}
                </button>
              ))}
            </div>
          )}
          {loaded.has(embed.provider) ? (
            <EmbedFrame key={embed.src} embed={embed} kind={kind} title={item.title} />
          ) : (
            <div className="trk-listen__embed">
              <span className="trk-listen__icon" aria-hidden="true"><Icon name="headphones" size={18} /></span>
              <p className="trk-listen__text">
                <strong>{t('listen.embedTitle', { p: embedName })}</strong>
                <span className="muted"> · {t('listen.embedBody', { p: embedName })}</span>
              </p>
              <span className="trk-listen__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => load(embed.provider)}>{t('track.listen.load')}</button>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => load(embed.provider, true)}>{t('track.listen.always')}</button>
              </span>
            </div>
          )}
        </div>
      )}
      {(cover || sources.length > 0) && (
        <p className="small muted trk-listen__credit en-credit">
          {cover && (deezerLink && cover.provider === 'deezer'
            ? <a href={deezerLink.href} target="_blank" rel="noreferrer noopener">{t('track.listen.coverCredit', { p: PROVIDER_NAMES[cover.provider] || cover.provider })}</a>
            : <span>{t('track.listen.coverCredit', { p: PROVIDER_NAMES[cover.provider] || cover.provider })}</span>)}
          {cover && sources.length > 0 && <span aria-hidden="true"> · </span>}
          {sources.length > 0 && <span><IdsCredit sources={sources} /></span>}
        </p>
      )}
    </section>
  );
}

/** « Identifiants : MusicBrainz · Wikidata (données libres CC0) », chaque source liée à sa fiche. */
function IdsCredit({ sources }) {
  const { t } = useI18n();
  const [before, after] = String(t('listen.idsCredit', { sources: '\u0000' })).split('\u0000');
  return (
    <>
      {before}
      {sources.map((s, i) => (
        <span key={s.source}>
          {i > 0 && ' · '}
          <a href={s.url} target="_blank" rel="noreferrer noopener">{LISTEN_NAMES[s.source] || s.source}</a>
        </span>
      ))}
      {after}
    </>
  );
}
