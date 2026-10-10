// Recherche d'un album du catalogue (titre ou artiste) pour l'espace admin — chantier P0-F (sorti de pages/Admin.jsx,
// où il servait aux outils de test ; il sert aussi au retrait d'une pochette). Liste déroulante accessible au clavier :
// flèches pour parcourir, Entrée pour choisir, Échap pour fermer. Props : { onPick(album), placeholder?, label? }.
import { useEffect, useId, useRef, useState } from 'react';
import { get } from '../../api.js';
import { apiPath, registerCatalog } from '../../state/catalog.js';
import { useDebounced } from '../../state/paged.js';
import { useI18n } from '../../i18n/index.jsx';
import CoverArt from '../CoverArt.jsx';
import { Icon } from '../ui.jsx';

const PICKER_LIMIT = 8;

export function AlbumPicker({ onPick, placeholder, label }) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, '');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [res, setRes] = useState({ q: null, items: [], loading: false, error: false });
  const q = useDebounced(text.trim(), 250);
  const ticket = useRef(0);
  const seen = useRef(new Map()); // réponses déjà reçues, par recherche

  useEffect(() => {
    if (!open) return;
    const n = ++ticket.current; // une réponse arrivée après une recherche plus récente est ignorée
    if (seen.current.has(q)) {
      const items = seen.current.get(q);
      setRes({ q, items, loading: false, error: false });
      setActive(items.length ? 0 : -1);
      return;
    }
    setRes((r) => ({ ...r, loading: true, error: false }));
    get(apiPath('/catalog/albums', { q, sort: 'popular', limit: PICKER_LIMIT }))
      .then((data) => {
        if (n !== ticket.current) return;
        const items = data.items || [];
        registerCatalog({ albums: items });
        seen.current.set(q, items);
        setRes({ q, items, loading: false, error: false });
        setActive(items.length ? 0 : -1);
      })
      .catch(() => {
        if (n === ticket.current) setRes((r) => ({ ...r, loading: false, error: true }));
      });
  }, [open, q]);

  const pick = (album) => {
    onPick(album);
    setOpen(false);
    setText('');
  };

  const onKeyDown = (e) => {
    const count = res.items.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (count) setActive((a) => (a + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) setActive((a) => (a <= 0 ? count - 1 : a - 1));
    } else if (e.key === 'Enter') {
      // Pas de choix tant que les résultats ne correspondent pas au texte tapé (recherche encore en attente).
      if (open && res.items[active] && res.q === text.trim()) {
        e.preventDefault();
        pick(res.items[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const stale = res.q !== text.trim();
  const listId = `${uid}-list`;
  let note = null;
  if (res.error) note = t('admin.albumSearchError');
  else if (res.loading && !res.items.length) note = t('admin.albumSearching');
  else if (!res.loading && !stale && res.q !== null && !res.items.length) note = t('admin.albumNone');

  return (
    <div className="adm-picker">
      <label htmlFor={`${uid}-input`} className="sr-only">{label || t('admin.albumSearchLabel')}</label>
      <div className="search">
        <Icon name="search" />
        <input id={`${uid}-input`} className="input" type="search" autoComplete="off" spellCheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && active >= 0 && res.items[active] ? `${uid}-opt-${active}` : undefined}
          placeholder={placeholder || t('admin.albumSearch')} value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      </div>
      {open && (
        // La liste garde le focus dans le champ : un clic choisit l'album sans fermer la liste avant.
        <div className="adm-picker__pop" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={label || t('admin.albumSearchLabel')} aria-busy={res.loading || undefined}
            className={`adm-picker__list${stale || res.loading ? ' is-stale' : ''}`}>
            {res.items.map((a, i) => (
              <li key={a.id} id={`${uid}-opt-${i}`} role="option" aria-selected={i === active}
                className={`adm-option${i === active ? ' is-active' : ''}`} onClick={() => pick(a)} onMouseEnter={() => setActive(i)}>
                <span className="adm-option__cover"><CoverArt art={a.art} sizes="40px" /></span>
                <span className="adm-option__text">
                  <span className="adm-option__title">{a.title}</span>
                  <span className="small muted">{[a.artist, a.year, t('admin.albumTracks', { n: a.trackCount })].filter(Boolean).join(' · ')}</span>
                </span>
                {a.source === 'seed' && <span className="role-tag">{t('admin.albumBase')}</span>}
              </li>
            ))}
          </ul>
          {note && <p className="adm-picker__note small muted" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}

export default AlbumPicker;
