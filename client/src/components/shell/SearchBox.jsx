// Champ de recherche des pages Découvrir et Introuvable — chantier P0-D.
// Utilise la liste de suggestions partagée (SearchCombobox, P0-E) dès que son fichier existe ; en attendant, un
// formulaire simple. Entrée : page de résultats /search (P0-E) si elle existe, sinon la recherche des albums de la
// collection (/collection/albums?q=…), qui marche depuis toujours.
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { Icon } from '../ui.jsx';

// Chemins littéraux (Vite les lit à la compilation) : un fichier absent donne un objet vide, sans erreur.
const COMBO = import.meta.glob('../search/SearchCombobox.jsx');
const SEARCH_PAGE = import.meta.glob('../../pages/SearchPage.jsx');
const hasSearchPage = Object.keys(SEARCH_PAGE).length > 0;

/** Adresse d'un résultat choisi dans la liste de suggestions ({ kind, id }). */
export function resultPath({ kind, id } = {}) {
  const enc = encodeURIComponent(String(id ?? ''));
  switch (kind) {
    case 'album': return `/album/${enc}`;
    case 'track': return `/track/${enc}`;
    case 'artist': return `/artist/${enc}`;
    case 'user':
    case 'member': return `/u/${enc}`;
    case 'list': return `/list/${enc}`;
    default: return null;
  }
}

/** Adresse de la recherche complète d'un texte. */
export const searchPath = (q) => (hasSearchPage
  ? `/search?q=${encodeURIComponent(q)}`
  : `/collection/albums?q=${encodeURIComponent(q)}`);

function PlainSearch({ placeholder, onSubmit, autoFocus }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (q.trim()) onSubmit(q.trim());
  };
  return (
    <form className="sh-searchbox" role="search" onSubmit={submit}>
      <label className="search">
        <span className="sr-only">{t('shell.search.label')}</span>
        <Icon name="search" />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
          autoFocus={autoFocus} enterKeyHint="search" maxLength={100} />
      </label>
      <button type="submit" className="btn btn--ghost" disabled={!q.trim()}>{t('shell.search.submit')}</button>
    </form>
  );
}

const comboLoader = Object.values(COMBO)[0];
const Combo = comboLoader
  ? lazy(() => comboLoader().then((m) => ({ default: m.SearchCombobox || m.default || PlainSearch })))
  : null;

export function SearchBox({ autoFocus = false }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const placeholder = t('shell.search.placeholder');
  const onSubmit = (q) => navigate(searchPath(q));
  const onPick = (result) => {
    const to = resultPath(result);
    if (to) navigate(to);
  };
  const plain = <PlainSearch placeholder={placeholder} onSubmit={onSubmit} autoFocus={autoFocus} />;
  if (!Combo) return plain;
  return (
    <Suspense fallback={plain}>
      <div className="sh-searchbox">
        <Combo scope="all" variant="inline" placeholder={placeholder} onPick={onPick} onSubmit={onSubmit} autoFocus={autoFocus} />
      </div>
    </Suspense>
  );
}

export default SearchBox;
