// Feuille de partage d'une image — chantier P1-C (PLAN.md 9.2, 7.1). Props (contrat, ne pas les renommer) :
//   <ShareSheet spec title onClose />  (spec : voir renderImage.js)
// En plus, facultatifs : controls (défaut true : choix du format et du thème dans la feuille), fileName (sans extension).
// L'image est composée dans le navigateur (renderImage : vraies pochettes, repli vignette par vignette sur le visuel
// généré), montrée en aperçu, puis :
// - « Partager » : feuille de partage du système avec le fichier PNG quand le navigateur sait le faire (Web Share API) ;
//   sinon, sur téléphone, l'image en grand avec « Appuie longuement pour l'enregistrer » ; sinon un téléchargement ;
// - « Télécharger » : lien de téléchargement (URL Blob) ; dans la démo (bac à sable sans téléchargement), l'image en grand.
// SHARE_COVERS=off (GET /api/legal/info → shareCovers: false) : visuels générés seulement.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Modal, Spinner, useToast } from '../components/ui.jsx';
import { ListIcon } from '../components/lists/icons.jsx';
import { useStableCallback } from '../components/lists/stable.js';
import { useI18n } from '../i18n/index.jsx';
import { useApi } from '../state/catalog.js';
import { useCovers } from '../state/CoversContext.jsx';
import { FORMATS, renderImage } from './renderImage.js';
import { hostSave } from './hostSave.js';
import '../styles/lists.css';

const FORMAT_KEYS = ['portrait', 'square', 'story'];
const THEME_KEYS = ['ink', 'ivory'];

/** Nom de fichier sûr (« albummania-mes-9-albums.png »). */
function slug(text) {
  const s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 48) || 'image';
}

/** Téléphone ou tablette : le doigt remplace la souris (appui long pour enregistrer une image). */
const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function ShareSheet({ spec, title, onClose: rawClose, controls = true, fileName }) {
  const { t } = useI18n();
  const onClose = useStableCallback(rawClose);
  const toast = useToast();
  const covers = useCovers();
  const legal = useApi('/legal/info');
  const ready = !!(legal.data || legal.error);
  const realCovers = legal.data?.shareCovers !== false;
  const [format, setFormat] = useState(() => (FORMATS[spec?.format] ? spec.format : 'portrait'));
  const [theme, setTheme] = useState(() => (THEME_KEYS.includes(spec?.theme) ? spec.theme : 'ink'));
  const [state, setState] = useState({ busy: true, error: null, result: null });
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef(null);

  // La spécification change de forme (nouvel objet à chaque rendu du parent) : on ne recompose que si son contenu change.
  const key = JSON.stringify([spec?.title, spec?.subtitle, spec?.tiles, spec?.blocks, spec?.attribution]);
  const name = `albummania-${slug(fileName || spec?.title || title)}.png`;
  const coversKey = Object.keys(covers.items || {}).length;

  useEffect(() => {
    if (!ready || !spec) return undefined;
    let alive = true;
    setState((s) => ({ ...s, busy: true, error: null }));
    renderImage({ ...spec, format, theme }, { covers, realCovers })
      .then((res) => {
        if (!alive) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(res.blob);
        setState({ busy: false, error: null, result: { ...res, url: urlRef.current, bytes: res.blob.size } });
      })
      .catch((error) => alive && setState({ busy: false, error, result: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, format, theme, ready, realCovers, coversKey, attempt]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const result = state.result;
  const file = useMemo(() => (result ? new File([result.blob], name, { type: 'image/png' }) : null), [result, name]);
  const [w, h] = FORMATS[format];

  const download = async () => {
    if (!result) return;
    // Démo : le bac à sable bloque les téléchargements classiques. Le lecteur de claude.ai propose d'enregistrer le
    // fichier ; sans lui, l'image s'affiche en grand pour l'enregistrer (appui long ou clic droit).
    if (__DEMO__) {
      const saved = await hostSave(name, result.blob);
      if (saved === 'saved') toast(t('share.downloaded'));
      else if (!saved) setSaving(true);
      return;
    }
    const a = document.createElement('a');
    a.href = result.url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(t('share.downloaded'));
  };

  const share = async () => {
    if (!file) return;
    try {
      if (!__DEMO__ && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: spec?.title || title });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    // Pas de partage de fichier : appui long sur téléphone (et dans la démo), téléchargement sinon.
    if (coarse() || __DEMO__) setSaving(true);
    else download();
  };

  const seg = (keys, value, set, label, prefix) => (
    <div className="ls-share__tool">
      <span className="label">{label}</span>
      <span className="seg" role="group" aria-label={label}>
        {keys.map((k) => (
          <button key={k} type="button" className={`seg__btn seg__btn--wide${value === k ? ' is-on' : ''}`} aria-pressed={value === k} onClick={() => set(k)}>
            {t(`${prefix}.${k}`)}
          </button>
        ))}
      </span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={title || t('share.title')} className="modal--wide ls-share-modal">
      {saving && result ? (
        <div className="ls-share__save">
          <img className="ls-share__full" src={result.url} alt={t('share.previewAlt', { title: spec?.title || '' })} width={result.width} height={result.height} />
          <p className="ls-share__hint">
            <Icon name="share" size={16} /> {coarse() ? t('share.longPress') : t('share.rightClick')}
          </p>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setSaving(false)}>{t('share.back')}</button>
          </div>
        </div>
      ) : (
        <div className="ls-share">
          <div className="ls-share__stage" style={{ '--ls-ratio': `${w} / ${h}` }}>
            {result && !state.error && (
              <img className={`ls-share__img${state.busy ? ' is-stale' : ''}`} src={result.url} alt={t('share.previewAlt', { title: spec?.title || '' })}
                width={result.width} height={result.height} data-share-image="" data-width={result.width} data-height={result.height}
                data-bytes={result.bytes} data-covers={result.usedCovers ? '1' : '0'} />
            )}
            {state.busy && (
              <span className="ls-share__busy" role="status">
                <Spinner /> <span>{t('share.generating')}</span>
              </span>
            )}
            {state.error && !state.busy && (
              <div className="ls-share__error" role="alert">
                <p>{t('share.error')}</p>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAttempt((n) => n + 1)}>{t('share.retry')}</button>
              </div>
            )}
          </div>
          <div className="ls-share__side">
            {controls && (
              <div className="ls-share__tools">
                {seg(FORMAT_KEYS, format, setFormat, t('share.format'), 'share.formats')}
                {seg(THEME_KEYS, theme, setTheme, t('share.theme'), 'share.themes')}
              </div>
            )}
            <p className="small muted ls-share__meta">
              <span className="mono">{t('share.size', { w, h })}</span>
              {result && <> · {result.usedCovers ? t('share.coversNote') : realCovers ? t('share.generatedNote') : t('share.artNote')}</>}
            </p>
            <div className="ls-share__actions">
              <button type="button" className="btn btn--primary" onClick={download} disabled={!result || state.busy}>
                <ListIcon name="download" size={16} /> {t('share.download')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={share} disabled={!result || state.busy}>
                <Icon name="share" size={16} /> {t('share.share')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default ShareSheet;
