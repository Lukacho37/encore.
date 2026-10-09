// Texte publié par un joueur (critique, post, commentaire) — chantier P0-F (PLAN.md 7.1, 7.2, 9.2).
// Props (contrat) : { text, clamp? }. Retours à la ligne gardés ; seuls les liens de la liste blanche (Deezer, Spotify,
// Apple Music, YouTube, Bandcamp, MusicBrainz, Wikipédia) sont cliquables, avec rel="nofollow ugc noopener noreferrer" ;
// tout le reste est du texte (échappé par React, jamais de HTML). `clamp` : six lignes au plus, puis « Lire la suite ».
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { splitLinks } from './safety/links.js';
import '../styles/safety.css';

export function UgcText({ text, clamp = false }) {
  const { t } = useI18n();
  const parts = useMemo(() => splitLinks(String(text ?? '')), [text]);
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);

  // Coupé seulement s'il dépasse vraiment (mesuré après rendu, et à chaque changement de largeur).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!clamp || open || !el) return undefined;
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp, open, parts]);

  const body = parts.map((p, i) => (p.href
    ? <a key={i} href={p.href} target="_blank" rel="nofollow ugc noopener noreferrer" className="sf-ugc__link" title={t('safety.linkTitle')}>{p.link}</a>
    : <span key={i}>{p.text}</span>));

  return (
    <span className="sf-ugc-wrap">
      <span ref={ref} className={`sf-ugc${clamp && !open ? ' sf-ugc--clamp' : ''}`}>{body}</span>
      {clamp && (overflow || open) && (
        <button type="button" className="link-btn sf-ugc__more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t('safety.readLess') : t('safety.readMore')}
        </button>
      )}
    </span>
  );
}

export default UgcText;
