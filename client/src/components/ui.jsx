import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CoverArt from './CoverArt.jsx';
import { ALBUM_BY_ID } from '@shared/catalog.js';
import { useI18n } from '../i18n/index.jsx';

// ---------- icônes ----------------------------------------------------------

export function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  switch (name) {
    case 'pack':
      return <svg {...common}><path d="M6 3h12l-1 3H7z" /><rect x="5" y="6" width="14" height="15" rx="2" /><path d="M9 11h6M9 15h4" /></svg>;
    case 'disc':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 6a6 6 0 0 1 6 6" /></svg>;
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>;
    case 'headphones':
      return <svg {...common}><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="5" height="7" rx="2" /><rect x="16" y="14" width="5" height="7" rx="2" /></svg>;
    case 'users':
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.6" /><path d="M16 14.2a5 5 0 0 1 6 4.8" /></svg>;
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
    case 'logout':
      return <svg {...common}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></svg>;
    case 'sound':
      return <svg {...common}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>;
    case 'mute':
      return <svg {...common}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>;
    case 'close':
      return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case 'back':
      return <svg {...common}><path d="M15 5l-7 7 7 7" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'check':
      return <svg {...common}><path d="M5 12.5l4.5 4.5L19 7" /></svg>;
    case 'lock':
      return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>;
    case 'recycle':
      return <svg {...common}><path d="M7 19H4.5a2 2 0 0 1-1.7-3l2.4-4" /><path d="M11 5.5l1-1.7a2 2 0 0 1 3.4 0l2.3 4" /><path d="M17 19h2.5a2 2 0 0 0 1.7-3l-1.2-2" /><path d="M5 9l.2 3.1L8.3 11M15.5 5.8l2.2 2.3-3 .9M13 21l-2-2 2-2" /><path d="M11 19h6" /></svg>;
    case 'press':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M12 3v4M12 17v4" /></svg>;
    case 'edit':
      return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>;
    case 'external':
      return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
    case 'mail':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></svg>;
    case 'globe':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
    case 'star':
      return <svg {...common}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" /></svg>;
    default:
      return null;
  }
}

/** Jeton de royalties (petit disque doré). */
export function RoyaltyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="royalty-icon">
      <circle cx="10" cy="10" r="9" fill="#ffd35a" />
      <circle cx="10" cy="10" r="6.3" fill="none" stroke="#b8862a" strokeWidth="1" />
      <circle cx="10" cy="10" r="2.2" fill="#b8862a" />
    </svg>
  );
}

export function Royalties({ value, className = '' }) {
  const { num } = useI18n();
  return (
    <span className={`royalties ${className}`}>
      <RoyaltyIcon />
      <span className="mono">{num(value)}</span>
    </span>
  );
}

// ---------- avatar -----------------------------------------------------------

export function Avatar({ user, size = 40, className = '' }) {
  const album = user?.avatar?.startsWith('album:') ? ALBUM_BY_ID[user.avatar.slice(6)] : null;
  const style = { width: size, height: size, fontSize: size * 0.44, '--ac': user?.avatarColor || '#ff4f7e' };
  return (
    <span className={`avatar ${className}`} style={style} aria-hidden="true">
      {album ? <CoverArt art={{ ...album.art, seed: album.id }} /> : <span>{(user?.username || '?')[0].toUpperCase()}</span>}
    </span>
  );
}

// ---------- barre de progression --------------------------------------------

export function Progress({ value, max, color, label, size = 'md' }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className={`progress progress--${size}${pct === 100 ? ' progress--done' : ''}`} style={{ '--pc': color }}
      role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="progress__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

// ---------- modale -----------------------------------------------------------

export function Modal({ open, onClose, title, children, className = '', labelledBy }) {
  const ref = useRef(null);
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // La modale garde Échap pour elle : l'écran d'ouverture de booster en dessous ne se ferme pas.
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => ref.current?.querySelector('[data-autofocus], button, input')?.focus());
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.opening')) document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : title} ref={ref}>
        {title && (
          <header className="modal__head">
            <h2 id={labelledBy}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <Icon name="close" />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Bouton à double clic : le premier demande confirmation, le second agit. */
export function ConfirmButton({ children, confirmLabel, onConfirm, className = 'btn btn--ghost', disabled }) {
  const [armed, setArmed] = useState(false);
  const { t } = useI18n();
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)} disabled={disabled}>
        {children}
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <span className="confirm-inline__label">{confirmLabel}</span>
      <button type="button" className="btn btn--danger btn--sm" onClick={() => { setArmed(false); onConfirm(); }}>
        {t('common.confirm')}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setArmed(false)}>
        {t('common.cancel')}
      </button>
    </span>
  );
}

// ---------- toasts -----------------------------------------------------------

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast--${x.tone}`}>{x.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- divers -----------------------------------------------------------

export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Logo({ className = '' }) {
  return (
    <span className={`logo ${className}`}>
      <span className="logo__mark" aria-hidden="true" />
      <span className="logo__word">Album<span className="logo__mania">Mania</span></span>
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
