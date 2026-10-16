import { lazy, Suspense, useEffect, useState } from 'react';
import { Vinyl } from './Vinyl.jsx';
import { Icon, Modal, useToast } from './ui.jsx';
import { RatingInput } from './Rating.jsx';
import { put } from '../api.js';
import { useAlbum, useArtist } from '../state/catalog.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { sound } from '../sound.js';
import '../styles/game.css';

// Feuille de partage (P1-C) chargée seulement quand on partage : l'écran d'ouverture reste léger.
const ShareSheet = lazy(() => import('../share/ShareSheet.jsx'));
const DAY = 86_400_000;

/**
 * Le moment de complétion (PLAN.md 6.2), sous le vinyle qui sort de sa pochette : « Complété le 6 oct. 2026 ·
 * Pressage n° 37 · 6 jours après ta première carte », puis trois actions : noter l'album, le mettre en avant sur son
 * Studio, partager. `full` : actions affichées (le premier album d'un booster ; les suivants gardent la ligne seule).
 */
function CompletionMoment({ a, album, full }) {
  const { t, date, error } = useI18n();
  const { ratings } = useGame();
  const toast = useToast();
  const [rating, setRating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [sharing, setSharing] = useState(false);
  const at = a.at || Date.now();
  const days = a.firstCardAt ? Math.max(0, Math.floor((at - a.firstCardAt) / DAY)) : null;
  const score = ratings?.get(`album:${a.id}`) ?? null;
  // Le Pressage n° est mis en avant (doré) ; sur téléphone, une ligne par information, sans points.
  const parts = [
    { id: 'date', text: t('game.moment.completedOn', { date: date(at) }) },
    a.rank ? { id: 'pressing', text: t('game.moment.pressing', { n: a.rank }) } : null,
    days == null ? null : { id: 'days', text: days === 0 ? t('game.moment.sameDay') : t('game.moment.days', { n: days }) },
  ].filter(Boolean);

  const rate = async (value) => {
    setSaving(true);
    try {
      await put(`/ratings/album/${encodeURIComponent(a.id)}`, { score: value });
      toast(t('game.moment.rated'), 'success');
    } catch (err) {
      toast(error(err?.code), 'error');
    } finally {
      setSaving(false);
    }
  };

  const feature = async () => {
    setSaving(true);
    try {
      await put('/me/studio', { featuredVinyl: a.id });
      setFeatured(true);
      toast(t('game.moment.featured'), 'success');
    } catch (err) {
      toast(error(err?.code), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Image de partage : la vraie pochette dessinée dans le navigateur (repli sur le visuel généré, PLAN.md 7.1).
  const spec = album && {
    format: 'square',
    theme: 'ink',
    title: album.title,
    subtitle: [album.artist, a.rank ? t('game.moment.pressing', { n: a.rank }) : null].filter(Boolean).join(' · '),
    tiles: [{ albumId: a.id, label: album.title, sub: album.artist }],
    footer: 'AlbumMania',
  };

  return (
    <div className="gm-moment">
      <p className="gm-moment__stats mono">
        {parts.map((p, i) => (
          <span key={p.id} className={p.id === 'pressing' ? 'gm-moment__pressing' : undefined}>
            {i > 0 && <span className="gm-moment__dot" aria-hidden="true">· </span>}{p.text}
          </span>
        ))}
      </p>
      {full && (
        <>
          <div className="gm-moment__actions">
            <button type="button" className={`btn btn--ghost btn--sm${rating ? ' is-on' : ''}`} onClick={() => setRating((r) => !r)} aria-expanded={rating}>
              <Icon name="star" size={16} /> {t('game.moment.rate')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={feature} disabled={saving || featured}>
              <Icon name={featured ? 'check' : 'disc'} size={16} /> {featured ? t('game.moment.featuredShort') : t('game.moment.feature')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSharing(true)} disabled={!spec}>
              <Icon name="share" size={16} /> {t('game.moment.share')}
            </button>
          </div>
          {rating && (
            <div className="gm-moment__rate">
              <RatingInput value={score} onChange={rate} disabled={saving} size={26} label={t('game.moment.rateLabel', { title: album?.title || a.id })} />
            </div>
          )}
          {sharing && spec && (
            <Suspense fallback={null}>
              <ShareSheet spec={spec} title={t('game.moment.shareTitle', { title: album.title })} onClose={() => setSharing(false)} />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}

/** Un succès : album complété (vinyle) ou artiste maîtrisé. Les noms viennent du catalogue chargé. */
function Achievement({ a, full }) {
  const { t } = useI18n();
  const isAlbum = a.type === 'album';
  const album = useAlbum(isAlbum ? a.id : null);
  const artist = useArtist(isAlbum ? null : a.id);
  // Le temps du chargement, on affiche l'identifiant (les réponses de l'API apportent d'habitude ces données).
  const name = isAlbum ? album?.title ?? a.id : artist?.name ?? a.id;
  return (
    <>
      <div className={`achievement achievement--${a.type}`}>
        {isAlbum ? (
          <span className="achievement__vinyl">{album ? <Vinyl albumId={a.id} reveal pressing={a.rank} /> : <Icon name="disc" size={28} />}</span>
        ) : (
          <span className="achievement__disc"><Icon name="star" size={28} /></span>
        )}
        <span className="achievement__text">
          <span className="eyebrow">{isAlbum ? t('open.albumDone') : t('open.artistDone')}</span>
          <strong>{isAlbum ? name : t('artist.master', { name })}</strong>
          <span className="muted">{t('open.reward', { r: a.royalties, x: a.xp })}</span>
          <span className="muted small">{isAlbum ? t('open.albumUnlocks') : t('open.artistUnlocks')}</span>
        </span>
      </div>
      {isAlbum && <CompletionMoment a={a} album={album} full={full} />}
    </>
  );
}

export function AchievementList({ achievements }) {
  // Les actions du moment de complétion accompagnent le premier album (un booster ×10 peut en compléter plusieurs).
  const first = achievements.find((a) => a.type === 'album')?.key;
  return achievements.map((a) => <Achievement key={a.key} a={a} full={a.key === first} />);
}

/**
 * Modale de célébration (album complété hors booster, par ex. après un pressage). Titre : « Vinyle débloqué » pour un
 * album, « Discographie maîtrisée » pour un artiste seul (le même titre servait aux deux, PLAN.md 6.2).
 */
export function Celebration({ achievements, onClose }) {
  const { t } = useI18n();
  const open = achievements.length > 0;
  const albums = achievements.some((a) => a.type === 'album');
  const artists = achievements.some((a) => a.type === 'artist');
  useEffect(() => {
    if (open) sound.complete();
  }, [open]);
  const title = albums && artists ? t('game.moment.bothTitle') : albums ? t('open.albumDone') : t('open.artistDone');
  return (
    <Modal open={open} onClose={onClose} title={title} className="modal--celebrate">
      <div className="celebrate">
        <AchievementList achievements={achievements} />
        <button type="button" className="btn btn--primary btn--block" onClick={onClose} data-autofocus>{t('common.close')}</button>
      </div>
    </Modal>
  );
}
