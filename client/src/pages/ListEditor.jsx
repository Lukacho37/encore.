// Éditeur de liste (/lists/new, /list/:id/edit) — chantier P1-C (PLAN.md 2.5, 4.2.4) : titre, description, liste classée
// ou non, visibilité (Publique / Amis / Privée), type d'éléments (à la création : albums, morceaux ou les deux), ajout
// par la recherche (SearchCombobox), ordre au glisser (poignée ⋮⋮, souris ou doigt) ou avec les boutons ↑ ↓ (clavier),
// note par élément (280 caractères), 250 éléments au plus. Création : POST /api/lists ; modification : PATCH puis
// PUT /api/lists/:id/items (toutes les positions en une fois). ?add=album:<id> pré-remplit une nouvelle liste
// (« Ajouter à une liste » → « Éditeur complet »). Le serveur revérifie tout (propriétaire, doublons, limites, liens).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api, del, get, post, put } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useAlbum, useTrack } from '../state/catalog.js';
import { EmptyState, ErrorBox, Skeleton } from '../components/feedback.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { ConfirmButton, Icon, Spinner, useToast } from '../components/ui.jsx';
import { SearchCombobox } from '../components/search/SearchCombobox.jsx';
import { ListIcon } from '../components/lists/icons.jsx';
import { BackLink } from './PostPage.jsx';
import '../styles/lists.css';

export const MAX_ITEMS = 250;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 1000;
const NOTE_MAX = 280;
const ITEM_TYPES = ['album', 'track', 'mixed'];
const VISIBILITIES = ['public', 'friends', 'private'];
const keyOf = (it) => `${it.type}:${it.id}`;

/** Une ligne de l'éditeur : poignée, rang, pochette, titre, note, ↑ ↓, retirer. */
function EditRow({ item, index, total, ranked, dragging, onMove, onRemove, onNote, onGrip, flash }) {
  const { t } = useI18n();
  const album = useAlbum(item.type === 'album' ? item.id : null);
  const track = useTrack(item.type === 'track' ? item.id : null);
  const x = album || track;
  const [noteOpen, setNoteOpen] = useState(!!item.note);
  const title = x?.title || t('common.loading');
  const meta = item.type === 'album' ? [album?.artist, album?.year].filter(Boolean).join(' · ') : [track?.artist, track?.album].filter(Boolean).join(' · ');
  return (
    <li className={`ls-row${dragging ? ' ls-row--dragging' : ''}${flash ? ' ls-row--flash' : ''}`} data-row={index} data-item={keyOf(item)}>
      <div className="ls-row__main">
        <button type="button" className="ls-row__grip" onPointerDown={(e) => onGrip(e, index)} aria-label={t('lists.editor.drag', { title })}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onMove(index, index + (e.key === 'ArrowUp' ? -1 : 1), true);
            }
          }}>
          <ListIcon name="grip" size={18} />
        </button>
        {ranked && <span className="ls-row__rank">{index + 1}</span>}
        <span className="ls-row__cover">{x && <CoverArt art={{ ...x.art, seed: x.art?.seed || x.albumId || x.id }} sizes="48px" />}</span>
        <span className="ls-row__text">
          <span className="ls-row__title">{title}</span>
          <span className="ls-row__meta">{item.type === 'track' && <span className="chip chip--sm chip--quiet">{t('lists.track')}</span>}{meta}</span>
        </span>
        <span className="ls-row__tools">
          <button type="button" className={`icon-btn ls-row__btn${noteOpen ? ' is-on' : ''}`} onClick={() => setNoteOpen((o) => !o)}
            aria-expanded={noteOpen} aria-label={t('lists.editor.note', { title })} title={t('lists.editor.noteShort')}>
            <Icon name="comment" size={16} />
          </button>
          <button type="button" className="icon-btn ls-row__btn" onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={t('lists.editor.up', { title })}>
            <ListIcon name="up" size={16} />
          </button>
          <button type="button" className="icon-btn ls-row__btn" onClick={() => onMove(index, index + 1)} disabled={index === total - 1} aria-label={t('lists.editor.down', { title })}>
            <ListIcon name="down" size={16} />
          </button>
          <button type="button" className="icon-btn ls-row__btn ls-row__btn--remove" onClick={() => onRemove(index)} aria-label={t('lists.editor.remove', { title })}>
            <Icon name="close" size={16} />
          </button>
        </span>
      </div>
      {noteOpen && (
        <label className="ls-row__note">
          <span className="sr-only">{t('lists.editor.note', { title })}</span>
          <textarea className="input textarea" rows={2} maxLength={NOTE_MAX} value={item.note || ''} placeholder={t('lists.editor.notePlaceholder')}
            onChange={(e) => onNote(index, e.target.value)} />
          <span className="ls-count">{(item.note || '').length}/{NOTE_MAX}</span>
        </label>
      )}
    </li>
  );
}

/** Réordonnement au glisser de la poignée (souris, stylet, doigt) : la ligne suit le pointeur, les autres s'écartent. */
function useRowDrag(listRef, onMove) {
  const [dragging, setDragging] = useState(null);
  const state = useRef(null);
  const move = useRef(onMove);
  useEffect(() => {
    move.current = onMove;
  });
  useEffect(() => {
    const onPointerMove = (e) => {
      const s = state.current;
      if (!s || e.pointerId !== s.id) return;
      const rows = [...(listRef.current?.querySelectorAll(':scope > [data-row]') || [])];
      let target = s.index;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          target = i > s.index ? i - 1 : i;
          break;
        }
        target = i;
      }
      if (target !== s.index) {
        move.current(s.index, target);
        s.index = target;
        setDragging(target);
      }
    };
    const onUp = (e) => {
      if (state.current && e.pointerId === state.current.id) {
        state.current = null;
        setDragging(null);
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [listRef]);
  const onGrip = useCallback((e, index) => {
    if (e.button !== 0) return;
    e.preventDefault();
    state.current = { id: e.pointerId, index };
    setDragging(index);
  }, []);
  return { dragging, onGrip };
}

export default function ListEditor() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t, error } = useI18n();
  const [load, setLoad] = useState({ ready: !editing, error: null });
  const [form, setForm] = useState(() => {
    const m = /^(album|track):(.+)$/.exec(params.get('add') || '');
    return {
      title: '', description: '', ranked: false, visibility: 'public',
      itemType: m?.[1] === 'track' ? 'track' : 'album',
      items: m ? [{ type: m[1], id: m[2], note: '' }] : [],
    };
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleError, setTitleError] = useState(null);
  const [flash, setFlash] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!editing) return undefined;
    let alive = true;
    get(`/lists/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!alive) return;
        if (!data.list.mine || data.list.kind !== 'list') {
          navigate(data.list.kind === 'grid9' ? '/nine' : `/list/${id}`, { replace: true });
          return;
        }
        setForm({
          title: data.list.title, description: data.description || '', ranked: data.list.ranked, visibility: data.list.visibility,
          itemType: data.list.itemType || 'album', items: data.items.map((it) => ({ type: it.type, id: it.id, note: it.note || '' })),
        });
        setLoad({ ready: true, error: null });
      })
      .catch((err) => alive && setLoad({ ready: false, error: err }));
    return () => {
      alive = false;
    };
  }, [editing, id, navigate]);

  // Modifications non enregistrées : le navigateur prévient avant de quitter la page.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (patch) => {
    setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }));
    setDirty(true);
  };
  const moveItem = useCallback((from, to, focus = false) => {
    setForm((f) => {
      if (to < 0 || to >= f.items.length || from === to) return f;
      const items = f.items.slice();
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      return { ...f, items };
    });
    setDirty(true);
    if (focus) requestAnimationFrame(() => listRef.current?.querySelector(`[data-row="${to}"] .ls-row__grip`)?.focus());
  }, []);
  const { dragging, onGrip } = useRowDrag(listRef, moveItem);

  const add = (pick) => {
    if (!pick || !['album', 'track'].includes(pick.kind)) return;
    const item = { type: pick.kind, id: String(pick.id), note: '' };
    if (form.items.some((it) => keyOf(it) === keyOf(item))) {
      setFlash(keyOf(item));
      setTimeout(() => setFlash(null), 1200);
      toast(t('lists.editor.already'));
      return;
    }
    if (form.items.length >= MAX_ITEMS) {
      toast(error('list_full'), 'error');
      return;
    }
    change((f) => ({ items: [...f.items, item] }));
    requestAnimationFrame(() => listRef.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setTitleError(t('errors.title_required'));
      return;
    }
    setBusy(true);
    setTitleError(null);
    const meta = { title: form.title, description: form.description, ranked: form.ranked, visibility: form.visibility };
    const items = form.items.map((it) => ({ type: it.type, id: it.id, note: it.note?.trim() || null }));
    try {
      let listId = id;
      if (editing) {
        await api('PATCH', `/lists/${encodeURIComponent(id)}`, meta);
        await put(`/lists/${encodeURIComponent(id)}/items`, { items });
      } else {
        const res = await post('/lists', { ...meta, itemType: form.itemType, items });
        listId = res.list.id;
      }
      setDirty(false);
      toast(editing ? t('lists.editor.saved') : t('lists.editor.created'));
      navigate(`/list/${listId}`, { replace: true });
    } catch (err) {
      if (err.code === 'title_required') setTitleError(error(err.code));
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await del(`/lists/${encodeURIComponent(id)}`);
      setDirty(false);
      toast(t('lists.editor.deleted'));
      navigate('/lists', { replace: true });
    } catch (err) {
      toast(error(err.code), 'error');
      setBusy(false);
    }
  };

  const back = editing ? `/list/${id}` : '/lists';
  if (load.error) {
    return (
      <div className="page ls-page">
        <BackLink to="/lists" label={t('lists.title')} />
        {load.error.status === 404
          ? <EmptyState icon="list" title={t('lists.page.goneTitle')} body={t('lists.page.goneBody')} action={{ label: t('lists.page.allLists'), to: '/lists', primary: false }} />
          : <ErrorBox error={load.error} />}
      </div>
    );
  }
  if (!load.ready) {
    return <div className="page ls-page"><Skeleton kind="row" count={4} /></div>;
  }

  const scope = form.itemType === 'mixed' ? 'album,track' : form.itemType;
  const seg = (keys, value, onPick, prefix, label) => (
    <span className="seg ls-seg" role="group" aria-label={label}>
      {keys.map((k) => (
        <button key={k} type="button" className={`seg__btn seg__btn--wide${value === k ? ' is-on' : ''}`} aria-pressed={value === k} onClick={() => onPick(k)}>
          {t(`${prefix}.${k}`)}
        </button>
      ))}
    </span>
  );

  return (
    <div className="page ls-page ls-editor">
      <BackLink to={back} label={editing ? form.title || t('lists.title') : t('lists.title')} />
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('lists.eyebrow')}</span>
          <h1>{editing ? t('lists.editor.editTitle') : t('lists.editor.newTitle')}</h1>
        </div>
      </header>
      <form className="ls-editor__grid" onSubmit={save} noValidate>
        <div className="panel ls-editor__meta">
          <label className={`field${titleError ? ' field--error' : ''}`}>
            <span className="field__label">{t('lists.editor.titleLabel')} <span className="ls-count">{form.title.length}/{TITLE_MAX}</span></span>
            <input className="input" value={form.title} maxLength={TITLE_MAX} required autoFocus={!editing} data-list-title=""
              placeholder={t('lists.editor.titlePlaceholder')} onChange={(e) => change({ title: e.target.value })} />
            {titleError && <span className="field__error">{titleError}</span>}
          </label>
          <label className="field">
            <span className="field__label">{t('lists.editor.descriptionLabel')} <span className="ls-count">{form.description.length}/{DESCRIPTION_MAX}</span></span>
            <textarea className="input textarea" rows={3} maxLength={DESCRIPTION_MAX} value={form.description}
              placeholder={t('lists.editor.descriptionPlaceholder')} onChange={(e) => change({ description: e.target.value })} />
          </label>
          {!editing && (
            <div className="field">
              <span className="field__label">{t('lists.editor.typeLabel')}</span>
              {seg(ITEM_TYPES, form.itemType, (k) => change((f) => ({
                itemType: k,
                // Un type plus étroit retire les éléments qui n'y entrent plus.
                items: k === 'mixed' ? f.items : f.items.filter((it) => it.type === k),
              })), 'lists.editor.types', t('lists.editor.typeLabel'))}
            </div>
          )}
          <button type="button" className="ls-switch" role="switch" aria-checked={form.ranked} onClick={() => change((f) => ({ ranked: !f.ranked }))}>
            <span className="ls-switch__text">
              <span className="ls-switch__label">{t('lists.editor.rankedLabel')}</span>
              <span className="ls-switch__hint">{t('lists.editor.rankedHint')}</span>
            </span>
            <span className={`switch${form.ranked ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
          <div className="field">
            <span className="field__label">{t('lists.editor.visibilityLabel')}</span>
            {seg(VISIBILITIES, form.visibility, (k) => change({ visibility: k }), 'lists.visibility', t('lists.editor.visibilityLabel'))}
            <span className="field__hint">{t(`lists.editor.visibilityHint.${form.visibility}`)}</span>
          </div>
        </div>

        <div className="ls-editor__items">
          <header className="section__head ls-editor__items-head">
            <h2>{t('lists.editor.itemsTitle')}</h2>
            <span className="label mono">{form.items.length}/{MAX_ITEMS}</span>
          </header>
          <div className="ls-picker ls-editor__search">
            <SearchCombobox scope={scope} variant="inline" recent={false} onPick={add} onSubmit={() => {}}
              placeholder={t(`lists.editor.searchPlaceholder.${form.itemType}`)} label={t('lists.editor.searchLabel')} />
          </div>
          {form.items.length ? (
            <ol className={`ls-rows${dragging != null ? ' is-dragging' : ''}`} ref={listRef}>
              {form.items.map((it, i) => (
                <EditRow key={keyOf(it)} item={it} index={i} total={form.items.length} ranked={form.ranked} dragging={dragging === i} flash={flash === keyOf(it)}
                  onMove={moveItem} onGrip={onGrip}
                  onRemove={(idx) => change((f) => ({ items: f.items.filter((_, j) => j !== idx) }))}
                  onNote={(idx, note) => change((f) => ({ items: f.items.map((x, j) => (j === idx ? { ...x, note } : x)) }))} />
              ))}
            </ol>
          ) : (
            <EmptyState icon="search" title={t('lists.editor.emptyTitle')} body={t('lists.editor.emptyBody')} />
          )}
          {form.items.length > 1 && <p className="small muted ls-editor__help">{t('lists.editor.help')}</p>}
        </div>

        <div className="ls-editor__foot">
          {editing && (
            <ConfirmButton className="btn btn--ghost ls-editor__delete" confirmLabel={t('lists.editor.deleteConfirm')} onConfirm={remove} disabled={busy}>
              <ListIcon name="trash" size={16} /> {t('lists.editor.delete')}
            </ConfirmButton>
          )}
          <span className="ls-editor__spacer" />
          <button type="button" className="btn btn--ghost" onClick={() => navigate(back)}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--primary" disabled={busy} data-save-list="">
            {busy ? <Spinner /> : <Icon name="check" size={16} />} {editing ? t('lists.editor.save') : t('lists.editor.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
