// Compositeur de post — chantier P1-A (PLAN.md 4.2.1, 9.4, components.css .composer) : texte (1 000 caractères au plus),
// citation d'un album, d'un morceau ou d'un artiste (recherche globale, portée album / morceau / artiste) rendue en carte
// de mention avec sa vraie pochette, visibilité (Public / Amis), « Publier ». Le serveur vérifie tout (compte actif,
// quotas, politique des liens, doublons) ; ses refus s'affichent tels quels.
// Props : { item?: { type, id } (élément imposé : discussions d'un album, d'un morceau, d'un artiste, partage d'une
//          critique ou d'une liste), itemTitle?, placeholder?, onPosted?(post), compact?, autoFocus?, focusSignal? (change →
//          le champ prend le focus) }.
import { useEffect, useId, useRef, useState } from 'react';
import { post as apiPost } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { Avatar, Icon, Spinner, useToast } from '../ui.jsx';
import { SearchCombobox } from '../search/SearchCombobox.jsx';
import { MentionCard } from './MentionCard.jsx';
import '../../styles/social.css';

export const POST_MAX = 1000;
const MENTION_SCOPE = 'album,track,artist';

export function Composer({ item = null, itemTitle = null, placeholder: asked = null, onPosted, compact = false, autoFocus = false, focusSignal = 0 }) {
  const { t, error } = useI18n();
  const { user } = useGame();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const [text, setText] = useState('');
  const [mention, setMention] = useState(null);
  const [picking, setPicking] = useState(false);
  const [visibility, setVisibility] = useState('public');
  const [busy, setBusy] = useState(false);
  // Déplié dès le premier focus (et jusqu'à la publication) : replier au blur ferait sauter « Citer » sous le pointeur.
  const [expanded, setExpanded] = useState(false);
  const field = useRef(null);

  useEffect(() => {
    if (focusSignal) field.current?.focus();
  }, [focusSignal]);

  const attached = item || mention;
  const length = [...text].length;
  const over = length > POST_MAX;
  const canSend = !busy && !over && (text.trim().length > 0 || !!attached);
  const open = expanded || text.length > 0 || !!mention || picking;

  const pick = (result) => {
    if (!result || !['album', 'track', 'artist'].includes(result.kind)) return;
    setMention({ type: result.kind, id: result.id });
    setPicking(false);
    field.current?.focus();
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const res = await apiPost('/posts', { body: text.trim(), visibility, ...(attached ? { item: attached } : {}) });
      setText('');
      setMention(null);
      setPicking(false);
      setExpanded(false);
      toast(t('composer.published'), 'success');
      onPosted?.(res.post);
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const placeholder = asked || (item && itemTitle ? t('composer.placeholderItem', { title: itemTitle }) : t('composer.placeholder'));
  return (
    <form className={`so-composer${compact ? ' so-composer--compact' : ''}`} onSubmit={submit} data-composer={item ? `${item.type}:${item.id}` : 'home'}>
      <div className="so-composer__row">
        {!compact && <Avatar user={user} size={40} />}
        <div className="so-composer__main">
          <label className="sr-only" htmlFor={`composer-${uid}`}>{t('composer.label')}</label>
          <textarea id={`composer-${uid}`} ref={field} className="input textarea so-composer__field" rows={open ? 3 : 1}
            value={text} placeholder={placeholder} autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)} onFocus={() => setExpanded(true)}
            onKeyDown={(e) => {
              // Ctrl / ⌘ + Entrée publie (Entrée seule passe à la ligne).
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
            }} />
        </div>
      </div>
      {mention && (
        <div className="so-composer__mention">
          <MentionCard item={mention} size="sm" linked={false} />
          <button type="button" className="icon-btn so-unmention" aria-label={t('composer.removeMention')} title={t('composer.removeMention')}
            onClick={() => setMention(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {picking && !mention && (
        <div className="so-composer__picker">
          <SearchCombobox scope={MENTION_SCOPE} variant="inline" autoFocus recent={false} placeholder={t('composer.mentionSearch')}
            label={t('composer.mentionTitle')} onPick={pick} onSubmit={() => {}}
            onClose={(why) => why === 'escape' && setPicking(false)} />
        </div>
      )}
      <div className="so-composer__tools">
        {!item && !mention && (
          <button type="button" className={`act-btn${picking ? ' is-on' : ''}`} aria-expanded={picking} onClick={() => setPicking((p) => !p)}
            title={t('composer.mentionTitle')}>
            <Icon name="disc" size={18} /><span>{t('composer.mention')}</span>
          </button>
        )}
        <label className="sr-only" htmlFor={`composer-vis-${uid}`}>{t('composer.visibility')}</label>
        <select id={`composer-vis-${uid}`} className="input so-composer__vis" value={visibility} onChange={(e) => setVisibility(e.target.value)}
          title={t(`social.visibilityHint.${visibility}`)}>
          <option value="public">{t('social.visibility.public')}</option>
          <option value="friends">{t('social.visibility.friends')}</option>
        </select>
        <span className="so-grow" />
        {(open || length > 0) && (
          <span className={`so-composer__count mono${over ? ' is-over' : ''}`} aria-live="polite">{t('composer.counter', { n: length })}</span>
        )}
        <button type="submit" className="btn btn--primary btn--sm" disabled={!canSend}>
          {busy ? <Spinner /> : <Icon name="plus" size={16} />} {t('composer.publish')}
        </button>
      </div>
    </form>
  );
}

export default Composer;
