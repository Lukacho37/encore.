// Champ de recherche avec suggestions — chantier P0-E (PLAN.md 5.1, contrat 9.2, design-system-current §4.1).
// Props (contrat, ne pas les renommer) :
//   { scope, placeholder, variant: 'bar' | 'sheet' | 'inline', onPick(result), onSubmit(q), autoFocus }
//   result = { kind, id } (membre : id = pseudo, userId en plus ; liste : identifiant numérique).
// En plus, facultatifs : value / onChange (champ contrôlé, ex. la Collection), onClose (feuille : « Annuler », Échap,
// et barre ouverte depuis l'icône ; reçoit 'escape' | 'blur' | 'cancel'), label (nom accessible), id, inputRef, submitLabel(q, total) (texte de l'action du
// pied de liste, qui appelle onSubmit), recent (recherches récentes quand le champ est vide, défaut true).
// Comportement : suggestions dès 2 caractères (attente de 150 ms, requête précédente annulée, réponses gardées),
// groupes Albums · Morceaux · Artistes · Membres · Listes avec pochettes, motif combobox WAI-ARIA (↑ ↓ parcourent
// tous les groupes, Entrée ouvre la ligne active ou valide la recherche, Échap ferme puis efface, Tab ferme).
// Variante « sheet » : feuille plein écran du téléphone (onglets par type avec compteurs, lignes de 62 px).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { clearRecentSearches, recentSearches, rememberSearch, resultPath, searchPagePath, useSearchSuggest } from '../../state/search.js';
import { prepareQuery, SEARCH_KINDS } from '@shared/search.js';
import { Icon, Spinner } from '../ui.jsx';
import { countLabel, optionsOf, recentEntryOf, RecentBody, RowBody } from './results.jsx';
import '../../styles/search.css';

const PANEL_WIDTH = 560;
const kindsOfScope = (scope) => (!scope || scope === 'all' ? SEARCH_KINDS : SEARCH_KINDS.filter((k) => String(scope).split(',').includes(k)));

/**
 * Groupes affichés : vides masqués ; artistes, membres et listes réunis quand chacun n'a qu'une ligne. Le groupe du
 * meilleur résultat (`topKind`, champ `top` de la réponse) passe en tête : « da » commence par Daft Punk, « get
 * lucky » par le morceau, « stromea » par Stromae (PLAN.md 5.1, point 8) ; sinon l'ordre Albums · Morceaux · Artistes…
 */
function groupsOf(options, topKind = null) {
  const byKind = new Map();
  for (const o of options) {
    if (!byKind.has(o.kind)) byKind.set(o.kind, []);
    byKind.get(o.kind).push(o);
  }
  const groups = [];
  const small = ['artist', 'user', 'list'].filter((k) => byKind.has(k));
  const merge = small.length >= 2 && small.every((k) => byKind.get(k).length === 1);
  for (const kind of SEARCH_KINDS) {
    if (!byKind.has(kind)) continue;
    if (merge && small.includes(kind)) {
      if (kind === small[0]) groups.push({ key: 'mixed', kinds: small, options: small.flatMap((k) => byKind.get(k)) });
      continue;
    }
    groups.push({ key: kind, kinds: [kind], options: byKind.get(kind) });
  }
  const lead = topKind ? groups.findIndex((g) => g.kinds.includes(topKind)) : -1;
  if (lead > 0) groups.unshift(...groups.splice(lead, 1));
  return groups;
}

/** Options dans l'ordre d'affichage des groupes (les flèches parcourent la liste dans cet ordre). */
const orderedOptions = (groups) => groups.flatMap((g) => g.options);

/** Lignes de chargement (même hauteur que les vraies). */
function SkeletonRows({ count = 3 }) {
  return Array.from({ length: count }, (_, i) => (
    <li key={i} className="gsearch__opt gs-skel" aria-hidden="true">
      <span className="gsearch__thumb" />
      <span className="gsearch__text"><span className="gs-skel__line" /><span className="gs-skel__line gs-skel__line--short" /></span>
    </li>
  ));
}

export function SearchCombobox({
  scope = 'all', placeholder, variant = 'inline', onPick, onSubmit, autoFocus = false,
  value, onChange, onClose, label, id, inputRef: externalRef, submitLabel, recent = true,
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const uid = useId().replace(/:/g, '');
  const baseId = id || `gs-${uid}`;
  const listId = `${baseId}-list`;
  const sheet = variant === 'sheet';
  const controlled = value !== undefined;
  const [own, setOwn] = useState('');
  const text = controlled ? value : own;
  const setText = useCallback((next) => {
    if (!controlled) setOwn(next);
    onChange?.(next);
  }, [controlled, onChange]);
  const [open, setOpen] = useState(sheet);
  const [active, setActive] = useState(-1);
  const [tab, setTab] = useState('all');
  const [recents, setRecents] = useState(() => (recent ? recentSearches() : []));
  const [shift, setShift] = useState(0);
  const rootRef = useRef(null);
  const ownInput = useRef(null);
  const input = externalRef || ownInput;
  const escaped = useRef(false);
  const keyNav = useRef(false);

  const kinds = useMemo(() => kindsOfScope(scope), [scope]);
  const query = text.trim();
  const prepared = prepareQuery(query);
  // Feuille : un onglet par type ; « Tout » donne aussi les compteurs des onglets.
  const all = useSearchSuggest(query, { scope, enabled: open });
  const single = useSearchSuggest(query, { scope: tab, enabled: open && sheet && tab !== 'all' });
  const shown = sheet && tab !== 'all' ? single : all;
  const data = shown.data;
  const fq = prepared?.fq || '';
  const shownKinds = useMemo(() => (sheet && tab !== 'all' ? [tab] : kinds), [sheet, tab, kinds]);
  const options = useMemo(() => (fq ? optionsOf(data, shownKinds) : []), [fq, data, shownKinds]);
  const showRecents = recent && !prepared && recents.length > 0;
  const topKind = sheet && tab !== 'all' ? null : data?.top?.kind;
  const groups = useMemo(() => groupsOf(options, topKind), [options, topKind]);
  const ordered = useMemo(() => orderedOptions(groups), [groups]);
  const choices = showRecents ? recents.map((entry, i) => ({ key: `recent:${i}`, recent: entry })) : ordered;
  const counts = all.data?.counts || {};
  const total = kinds.reduce((sum, k) => sum + (counts[k] || 0), 0);
  const capped = kinds.some((k) => (counts[k] || 0) >= 100);

  // La ligne active suit la liste affichée.
  useEffect(() => {
    setActive((a) => (a >= choices.length ? -1 : a));
  }, [choices.length]);
  useEffect(() => {
    setActive(-1);
  }, [query, tab]);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => input.current?.focus());
  }, [autoFocus, input]);

  // Liste déroulante de la barre : jamais au-delà du bord droit de l'écran.
  useLayoutEffect(() => {
    if (sheet || !open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 32);
    const overflow = rect.left + width - (window.innerWidth - 16);
    setShift(overflow > 0 ? -Math.min(overflow, Math.max(0, rect.left - 16)) : 0);
  }, [open, sheet, text]);

  const close = useCallback(() => {
    if (sheet) return;
    setOpen(false);
    setActive(-1);
  }, [sheet]);

  const finish = (entry) => {
    if (entry) rememberSearch(entry);
    setRecents(recent ? recentSearches() : []);
    if (!sheet) {
      setOpen(false);
      input.current?.blur();
    }
    if (!controlled) setOwn('');
  };

  const pickOption = (option) => {
    if (option.recent) {
      const entry = option.recent;
      if (entry.kind === 'query') {
        setText(entry.q);
        setActive(-1);
        input.current?.focus();
        return;
      }
      finish(entry);
      if (onPick) onPick({ kind: entry.kind, id: entry.id });
      else navigate(resultPath(entry));
      return;
    }
    finish(recentEntryOf(option, t));
    // Deuxième argument (facultatif) : l'objet complet (album, morceau, artiste, UserSummary, liste).
    if (onPick) onPick(option.pick, option.item);
    else navigate(resultPath(option.pick));
  };

  const submit = () => {
    if (!query) return;
    finish({ kind: 'query', q: query });
    if (onSubmit) onSubmit(query);
    else navigate(searchPagePath(query, sheet ? tab : null));
  };

  const onKeyDown = (e) => {
    const count = choices.length;
    keyNav.current = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (count) setActive((a) => (a + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) setActive((a) => (a <= 0 ? count - 1 : a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && choices[active]) pickOption(choices[active]);
      else submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Premier Échap : ferme la liste ; deuxième : efface ; feuille et barre ouverte depuis l'icône : se ferment.
      if (sheet || (onClose && !text)) {
        onClose?.('escape');
      } else if (open && !escaped.current) {
        escaped.current = true;
        setOpen(false);
      } else {
        escaped.current = false;
        setText('');
        if (onClose) onClose('escape');
      }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  // Le focus quitte le composant (Tab, clic ailleurs) : la liste se ferme.
  const onBlur = (e) => {
    if (sheet) return;
    if (rootRef.current?.contains(e.relatedTarget)) return;
    close();
    onClose?.('blur');
  };

  const optionId = (i) => `${baseId}-opt-${i}`;
  const activeId = open && active >= 0 && choices[active] ? optionId(active) : undefined;

  // Ligne active hors de la partie visible de la liste (flèches dans une longue liste) : la liste défile jusqu'à elle.
  // (Au clavier seulement : une ligne survolée à la souris ne fait pas bouger la liste.)
  useEffect(() => {
    if (activeId && keyNav.current) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const field = (
    <div className="gsearch__field">
      <span className="gsearch__icon" aria-hidden="true"><Icon name="search" size={sheet ? 20 : 18} /></span>
      <input
        ref={input}
        id={`${baseId}-input`}
        className="gsearch__input"
        type="search"
        role="combobox"
        aria-label={label || t('search.label')}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={100}
        placeholder={placeholder || t('search.placeholder')}
        value={text}
        onChange={(e) => {
          escaped.current = false;
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setRecents(recent ? recentSearches() : []);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {variant === 'bar' && !text && <span className="gsearch__kbd" aria-hidden="true">/</span>}
      {text && (
        <button type="button" className="icon-btn gsearch__clear" aria-label={t('search.clear')}
          onClick={() => {
            setText('');
            setOpen(true);
            input.current?.focus();
          }}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );

  // ----- contenu de la liste -----
  let index = -1;
  const renderOption = (option, size) => {
    index += 1;
    const i = index;
    return (
      <li key={option.key} id={optionId(i)} role="option" aria-selected={i === active}
        className={`gsearch__opt${i === active ? ' is-active' : ''}`}
        onMouseEnter={() => { keyNav.current = false; setActive(i); }} onClick={() => pickOption(option)}>
        {option.recent ? <RecentBody entry={option.recent} size={size} /> : <RowBody option={option} query={query} size={size} />}
      </li>
    );
  };
  const size = sheet ? 48 : 40;

  let body;
  if (showRecents) {
    body = (
      <div role="group" aria-labelledby={`${baseId}-recent`} className="gsearch__group">
        <header className="gsearch__group-head">
          <span className="eyebrow" id={`${baseId}-recent`}>{t('search.recent')}</span>
          <button type="button" className="gsearch__more gs-link" onClick={() => { clearRecentSearches(); setRecents([]); input.current?.focus(); }}>
            {t('search.clearRecent')}
          </button>
        </header>
        <ul className="gsearch__list" role="none">{recents.map((entry, i) => renderOption({ key: `recent:${i}`, recent: entry }, size))}</ul>
      </div>
    );
  } else if (!prepared) {
    body = query ? <p className="gs-note">{t('search.minChars')}</p> : (sheet ? <p className="gs-note">{t('search.start')}</p> : null);
  } else if (shown.error && !options.length) {
    body = (
      <div className="gs-note" role="alert">
        <span>{t('search.error')}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={shown.retry}>{t('search.retry')}</button>
      </div>
    );
  } else if (!data && shown.loading) {
    body = <ul className="gsearch__list" role="none"><SkeletonRows count={sheet ? 5 : 3} /></ul>;
  } else if (data && !options.length && !shown.loading) {
    body = (
      <div className="gs-empty">
        <p className="gs-empty__title">{t('search.none', { q: query })}</p>
        <p className="gs-empty__body">{t('search.noneHint')}</p>
      </div>
    );
  } else {
    body = groups.map((g) => {
      const headId = `${baseId}-g-${g.key}`;
      const n = g.kinds.length === 1 ? counts[g.kinds[0]] : null;
      const single = sheet && tab !== 'all';
      return (
        <div key={g.key} role="group" aria-labelledby={headId} className="gsearch__group">
          {!single && (
            <header className="gsearch__group-head">
              <span className="eyebrow" id={headId}>{g.kinds.map((k) => t(`search.kinds.${k}`)).join(' · ')}</span>
              {n != null && n > g.options.length && (
                sheet
                  ? <button type="button" className="gsearch__more gs-link" onClick={() => setTab(g.kinds[0])}>{t('search.seeAll')}</button>
                  : <button type="button" className="gsearch__more gs-link" tabIndex={-1}
                    onClick={() => { finish({ kind: 'query', q: query }); navigate(searchPagePath(query, g.kinds[0])); }}>
                    {t('search.seeAllN', { n: countLabel(n) })}
                  </button>
              )}
            </header>
          )}
          <ul className="gsearch__list" role="none">{g.options.map((o) => renderOption(o, size))}</ul>
        </div>
      );
    });
  }

  const suggestion = prepared && data?.suggestion && !shown.loading ? data.suggestion : null;
  const fuzzy = suggestion && (
    <p className="gsearch__fuzzy">
      {t('search.didYouMean')}{' '}
      <button type="button" className="gs-link gs-fuzzy__btn" onClick={() => { setText(suggestion); input.current?.focus(); }}><b>{suggestion}</b></button>
      {t('search.didYouMeanEnd')}
    </p>
  );
  const busy = prepared && shown.loading;
  const live = prepared && data && !shown.loading
    ? (options.length ? t('search.live', { n: options.length }) : t('search.none', { q: query }))
    : '';

  // Rien trouvé : pas de lien vers une page de résultats vide (sauf action propre à la page : filtrer, envoyer une demande).
  const nothing = !!data && !options.length && !shown.loading && !shown.error;
  const footer = prepared && !showRecents && (!nothing || submitLabel) && (
    <footer className="gsearch__foot">
      <button type="button" className="gsearch__all gs-link" tabIndex={-1} onClick={submit}>
        {submitLabel ? submitLabel(query, total) : capped || !total ? t('search.showAllAny', { q: query }) : t('search.showAll', { n: total, q: query })}
        <Icon name="chevron" size={14} />
      </button>
      {!sheet && (
        <span className="gsearch__keys" aria-hidden="true">
          <span className="kbd">↑</span><span className="kbd">↓</span><span>{t('search.keys.move')}</span>
          <span className="kbd">↵</span><span>{t('search.keys.open')}</span>
          <span className="kbd">{t('search.keys.escKey')}</span><span>{t('search.keys.close')}</span>
        </span>
      )}
    </footer>
  );

  const listbox = (
    <div id={listId} role="listbox" aria-label={t('search.results')} aria-busy={busy || undefined}
      className={`gs-listbox${shown.stale || (busy && data) ? ' is-stale' : ''}`}>
      {body}
    </div>
  );

  if (sheet) {
    return (
      <div className="search-sheet" role="dialog" aria-modal="true" aria-label={t('search.label')} ref={rootRef}>
        <div className="search-sheet__head">
          {field}
          <button type="button" className="btn btn--quiet gs-cancel" onClick={() => onClose?.('cancel')}>{t('search.cancel')}</button>
        </div>
        {prepared && (
          <div className="search-sheet__tabs" role="group" aria-label={t('search.filterKinds')}>
            {['all', ...kinds].map((k) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
                className={`chip chip--toggle${k !== 'all' && all.data && !counts[k] ? ' gs-chip--empty' : ''}`}>
                {t(`search.kinds.${k}`)}
                {k !== 'all' && counts[k] > 0 && <span className="chip__n">{countLabel(counts[k])}</span>}
              </button>
            ))}
          </div>
        )}
        {/* Toucher la liste range le clavier (les résultats restent visibles) ; un clic y laisse le focus au champ. */}
        <div className="search-sheet__body" onMouseDown={(e) => e.target.closest('button') || e.preventDefault()}
          onTouchStart={() => input.current?.blur()}>
          {fuzzy}
          {listbox}
          {footer}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{live}</p>
      </div>
    );
  }

  const panelOpen = open && (showRecents || !!prepared);
  return (
    <div className={`gsearch gs-combo gs-combo--${variant}${open ? ' is-open' : ''}`} ref={rootRef} onBlur={onBlur}>
      {field}
      {panelOpen && (
        // Clic dans la liste : le champ garde le focus (la liste ne se ferme pas avant le choix).
        <div className="gsearch__panel" style={shift ? { left: `${shift}px` } : undefined}
          onMouseDown={(e) => e.preventDefault()}>
          {busy && !data && <span className="gs-spinner" aria-hidden="true"><Spinner /></span>}
          {fuzzy}
          {listbox}
          {footer}
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
    </div>
  );
}

export default SearchCombobox;
