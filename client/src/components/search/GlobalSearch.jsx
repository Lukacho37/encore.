// Recherche globale de la barre du haut — chantier P0-E (PLAN.md 2.2, 5.1 ; design-system-current §4.1).
// Props (contrat, ne pas les renommer) : aucune ; montée par la coque dans l'emplacement .sh-search (P0-D).
// Trois formes, selon la place :
//   - champ en ligne (.topbar__search) quand l'emplacement est assez large (grand écran) ;
//   - sinon une icône (.search-trigger) : sur tablette elle ouvre le même champ et sa liste dans un panneau sous la
//     barre ; sur téléphone (860 px et moins), la feuille plein écran (.search-sheet), que le bouton Retour ferme.
// Raccourcis : « / » et Ctrl/⌘ K placent le curseur dans la recherche (ou l'ouvrent).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { resultPath, searchPagePath } from '../../state/search.js';
import { Icon } from '../ui.jsx';
import { SearchCombobox } from './SearchCombobox.jsx';
import '../../styles/search.css';

const PHONE = '(max-width: 860px)';
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches;
/** Le Retour du téléphone ferme la feuille : elle a sa propre entrée d'historique (site complet seulement). */
const HISTORY = !__DEMO__;

export function GlobalSearch() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mode, setMode] = useState(null); // null | 'pop' (tablette) | 'sheet' (téléphone)
  const fieldRef = useRef(null);
  const triggerRef = useRef(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Changement de page : panneau et feuille se ferment.
  useEffect(() => {
    setMode((m) => (m === 'pop' ? null : m));
  }, [pathname]);

  const openSheet = useCallback(() => {
    if (HISTORY && !window.history.state?.gsSheet) window.history.pushState({ ...window.history.state, gsSheet: true }, '');
    setMode('sheet');
  }, []);

  /** Ferme la feuille : on retire d'abord son entrée d'historique (le Retour suivant quitte la page, pas la feuille). */
  const closeSheet = useCallback(() => {
    if (HISTORY && window.history.state?.gsSheet) window.history.back();
    else setMode(null);
  }, []);

  useEffect(() => {
    if (!HISTORY) return undefined;
    const onPop = () => {
      if (!window.history.state?.gsSheet && modeRef.current === 'sheet') setMode(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Feuille ouverte : la page derrière ne défile plus.
  useEffect(() => {
    if (mode !== 'sheet') return undefined;
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, [mode]);

  const openSearch = useCallback(() => {
    const field = fieldRef.current;
    if (field && field.offsetParent !== null) field.focus();
    else if (isPhone()) openSheet();
    else setMode('pop');
  }, [openSheet]);

  // Raccourcis clavier : « / » hors d'un champ de saisie, Ctrl/⌘ K partout.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || modeRef.current === 'sheet') return;
      const editable = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
      const k = e.key;
      if ((k === 'k' || k === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        openSearch();
      } else if (k === '/' && !editable && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('.modal-backdrop, .opening')) {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openSearch]);

  // Choix d'un résultat depuis la feuille : son entrée d'historique est remplacée par la page choisie.
  const sheetPick = (result) => {
    const to = resultPath(result);
    setMode(null);
    if (to) navigate(to, { replace: HISTORY && !!window.history.state?.gsSheet });
  };
  const sheetSubmit = (q) => {
    setMode(null);
    navigate(searchPagePath(q), { replace: HISTORY && !!window.history.state?.gsSheet });
  };
  // Échap rend le focus à l'icône ; un clic ailleurs le laisse où il va.
  const closePop = (reason) => {
    setMode(null);
    if (reason === 'escape') triggerRef.current?.focus();
  };

  return (
    <div className="gs-global">
      <div className="topbar__search gs-inline">
        <SearchCombobox variant="bar" inputRef={fieldRef} id="gs-top" />
      </div>
      <button type="button" className="icon-btn search-trigger" ref={triggerRef} aria-label={t('search.open')}
        aria-haspopup="dialog" aria-expanded={!!mode}
        // Panneau ouvert : le clic le referme (le champ garde le focus jusque-là, sinon il se fermerait puis rouvrirait).
        onMouseDown={(e) => mode && e.preventDefault()} onClick={() => (mode ? setMode(null) : openSearch())}>
        <Icon name="search" size={20} />
      </button>
      {mode === 'pop' && (
        <div className="gs-pop" role="dialog" aria-label={t('search.label')}>
          <SearchCombobox variant="bar" autoFocus onClose={closePop} id="gs-pop" />
        </div>
      )}
      {mode === 'sheet' && createPortal(
        <SearchCombobox variant="sheet" autoFocus onClose={closeSheet} onPick={sheetPick} onSubmit={sheetSubmit} id="gs-sheet" />,
        document.body,
      )}
    </div>
  );
}

export default GlobalSearch;
