// Panneau « Boosters spéciaux » (accueil, sous la rangée Boutique / Doublons / Blind test) — chantier P1-D
// (PLAN.md 6.10, 9.2). Props (contrat) : aucune.
// Inventaire user_boosters (GET /me/boosters) : boosters thématiques (genre, décennie, « À ton goût », événement) et
// boosters d'album (offert ou « au choix »), gagnés en jouant (paliers de niveau, quêtes de la semaine, accueil,
// événements). Ouverture avec l'écran d'ouverture inchangé (useBoosterFlow().openSpecial) ; « Voir les chances »
// publie les chances de chacun.
// Achat (P2-D, PLAN.md 6.10) : un booster thématique (un genre, une décennie ou « À ton goût ») coûte
// THEMED_BOOSTER_PRICE royalties, jamais d'argent réel (POST /me/boosters/buy) ; mêmes chances par carte qu'un
// booster normal. Inventaire vide : le panneau se réduit à cette offre.
// Monte aussi le message de niveau (LevelUpToast) : l'accueil est la page où l'on ouvre les boosters.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PackArt } from '../PackOpening.jsx';
import { Icon, Modal, Royalties, RoyaltyIcon, Spinner, useToast } from '../ui.jsx';
import { SearchCombobox } from '../search/SearchCombobox.jsx';
import { onApiResponse, post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useApi, useAlbum } from '../../state/catalog.js';
import { useBoosterFlow } from '../../state/boosterFlow.js';
import { THEMED_BOOSTER_PRICE, THEMED_DECADES, THEME_GENRES, parseBoosterTheme } from '@shared/rules.js';
import { BoosterOdds, useThemeName } from './odds.jsx';
import { LevelUpToast } from './LevelUpToast.jsx';
import '../../styles/game.css';
import '../../styles/workshop.css';

/** Origine d'un booster : « Palier du niveau 10 », « Quête de la semaine »… */
function useSourceName() {
  const { t } = useI18n();
  return (source) => {
    const s = String(source || '');
    const level = /^level:(\d+)$/.exec(s);
    if (level) return t('game.special.source.level', { n: Number(level[1]) });
    const kind = s.split(':')[0];
    return ['quest', 'onboarding', 'event', 'badge', 'shop', 'demo'].includes(kind) ? t(`game.special.source.${kind}`) : t('game.special.source.other');
  };
}

/**
 * Étiquette courte collée sur le petit paquet (le nom complet est écrit à côté) : « Rap », « 1990 », « Au choix »,
 * « Ton goût », le nom de l'événement.
 */
function useStickerName() {
  const { t } = useI18n();
  const themeName = useThemeName();
  return (theme) => {
    const p = parseBoosterTheme(theme);
    if (p?.kind === 'genre') return themeName(theme).split('/')[0].trim();
    if (p?.kind === 'decade') return String(p.value);
    if (p?.kind === 'choice' || p?.kind === 'taste') return t(`game.special.sticker.${p.kind}`);
    return themeName(theme);
  };
}

/** Le booster dessiné en petit : visuel de la série (avec l'étiquette du thème) ou pochette de l'album offert. */
function MiniBooster({ theme }) {
  const parsed = parseBoosterTheme(theme);
  const album = useAlbum(parsed?.kind === 'album' ? parsed.value : null);
  const sticker = useStickerName();
  if (parsed?.kind === 'album') {
    return <span className="gm-pack gm-pack--album"><PackArt album={album || undefined} /></span>;
  }
  return (
    <span className={`gm-pack gm-pack--${parsed?.kind || 'standard'}`}>
      <PackArt />
      <span className="gm-pack__sticker">{sticker(theme)}</span>
    </span>
  );
}

/** Choix de l'album d'un booster « au choix », puis ouverture. */
function ChooseAlbum({ booster, onClose, onChosen }) {
  const { t, error } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const pick = async (result) => {
    if (result?.kind !== 'album' || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await post(`/me/boosters/${booster.id}/choose`, { albumId: result.id });
      onChosen(booster.id);
    } catch (err) {
      setFailed(error(err?.code));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('game.special.chooseTitle')} className="gm-choose">
      <p className="muted">{t('game.special.chooseBody')}</p>
      <div className="gm-choose__search">
        <SearchCombobox scope="album" variant="inline" placeholder={t('game.special.choosePlaceholder')} label={t('game.special.chooseTitle')}
          onPick={pick} onSubmit={() => {}} autoFocus recent={false} />
      </div>
      {busy && <p className="small muted" role="status"><Spinner /> {t('common.loading')}</p>}
      {failed && <p className="small gm-choose__error" role="alert">{failed}</p>}
    </Modal>
  );
}

/** Choix et achat d'un booster thématique (fenêtre) : thème, aperçu, chances, prix en royalties. */
function ThemedShop({ onClose, onBought }) {
  const { t, error, num } = useI18n();
  const toast = useToast();
  const { user } = useGame();
  const themeName = useThemeName();
  const [theme, setTheme] = useState('taste');
  const [showOdds, setShowOdds] = useState(false);
  const [busy, setBusy] = useState(false);
  const royalties = user?.royalties ?? 0;
  const short = Math.max(0, THEMED_BOOSTER_PRICE - royalties);
  const buy = async () => {
    if (busy || short) return;
    setBusy(true);
    try {
      const res = await post('/me/boosters/buy', { theme });
      toast(t('workshop.themed.bought', { name: themeName(res.booster.theme) }), 'success');
      onBought?.(res.booster);
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
      setBusy(false);
    }
  };
  const chip = (value, label) => (
    <button key={value} type="button" className={`chip chip--toggle${theme === value ? ' is-on' : ''}`} aria-pressed={theme === value}
      onClick={() => setTheme(value)} data-theme-pick={value}>
      {label}
    </button>
  );
  return (
    <Modal open onClose={onClose} title={t('workshop.themed.title')} className="ws-themed">
      <div className="ws-themed__body" data-sheet="themed">
        <p className="muted">{t('workshop.themed.intro')}</p>
        <div className="ws-themed__group" role="group" aria-label={t('workshop.themed.taste')}>
          {chip('taste', t('workshop.themed.taste'))}
          <span className="small muted">{t('workshop.themed.tasteHint')}</span>
        </div>
        <div className="ws-themed__group" role="group" aria-labelledby="ws-themed-genres">
          <span className="eyebrow" id="ws-themed-genres">{t('workshop.themed.genres')}</span>
          <div className="ws-themed__chips">{THEME_GENRES.map((g) => chip(`genre:${g}`, t(`genre.${g}`)))}</div>
        </div>
        <div className="ws-themed__group" role="group" aria-labelledby="ws-themed-decades">
          <span className="eyebrow" id="ws-themed-decades">{t('workshop.themed.decades')}</span>
          <div className="ws-themed__chips">{THEMED_DECADES.map((d) => chip(`decade:${d}`, t('decade', { d })))}</div>
        </div>
        <div className="ws-themed__pick">
          <MiniBooster theme={theme} />
          <div className="ws-themed__pick-text">
            <strong className="gm-special__name">{themeName(theme)}</strong>
            <span className="small muted">{t('game.special.kind.theme')}</span>
            <button type="button" className="link-btn small" onClick={() => setShowOdds((v) => !v)} aria-expanded={showOdds}>
              <Icon name="star" size={14} /> {t('workshop.themed.odds')}
            </button>
          </div>
        </div>
        {showOdds && <div className="ws-themed__odds"><BoosterOdds theme={theme} pity={user?.pity ?? null} /></div>}
        <p className="small muted">{t('workshop.themed.note')}</p>
      </div>
      <footer className="ws-sheet__foot">
        <Royalties value={royalties} className="pill" />
        {short > 0 && <span className="small muted">{t('workshop.themed.short', { n: num(short) })}</span>}
        <button type="button" className="btn btn--primary" onClick={buy} disabled={busy || short > 0} data-buy-themed>
          {busy ? <Spinner /> : <RoyaltyIcon size={16} />} {t('workshop.themed.buy', { price: num(THEMED_BOOSTER_PRICE) })}
        </button>
      </footer>
    </Modal>
  );
}

/** Ligne d'achat du panneau : « Booster thématique · 180 royalties » et « Choisir un thème ». */
function ThemedOffer({ onOpen, compact = false }) {
  const { t, num } = useI18n();
  return (
    <div className={`ws-offer-row${compact ? ' ws-offer-row--alone' : ''}`} data-themed-offer>
      <span className="ws-offer-row__pack" aria-hidden="true"><MiniBooster theme="taste" /></span>
      <div className="ws-offer-row__text">
        <strong>{t('workshop.themed.title')}</strong>
        <span className="small muted">{compact ? t('workshop.themed.empty', { price: num(THEMED_BOOSTER_PRICE) }) : t('workshop.themed.intro')}</span>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen} data-open-themed>
        <RoyaltyIcon size={14} /> <span className="mono">{num(THEMED_BOOSTER_PRICE)}</span> · {t('workshop.themed.cta')}
      </button>
    </div>
  );
}

export function SpecialBoosters() {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useGame();
  const { data, error, reload } = useApi(user ? '/me/boosters' : null, { keep: false });
  const flow = useBoosterFlow({ onClose: () => reload() });
  const themeName = useThemeName();
  const sourceName = useSourceName();
  const [oddsFor, setOddsFor] = useState(undefined);
  const [choosing, setChoosing] = useState(null);
  const [shopping, setShopping] = useState(false);
  const shop = shopping && <ThemedShop onClose={() => setShopping(false)} onBought={() => reload()} />;

  // Un booster spécial gagné ailleurs (palier des dizaines en ouvrant un booster du héros, quête, badge) : la réponse
  // le signale (`levelUp.themed`, `boosters`), l'inventaire est rechargé.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  useEffect(() => onApiResponse((res, { path } = {}) => {
    if (path?.startsWith('/me/boosters')) return;
    if (res?.levelUp?.themed > 0 || res?.boosters?.granted > 0) reloadRef.current();
  }), []);

  // Boosters identiques (même thème) réunis en une pile « ×3 » ; on ouvre le plus ancien d'abord.
  const stacks = useMemo(() => {
    const byTheme = new Map();
    for (const b of data?.items || []) {
      const list = byTheme.get(b.theme) || [];
      list.push(b);
      byTheme.set(b.theme, list);
    }
    return [...byTheme.values()].map((list) => {
      const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
      return { theme: sorted[0].theme, next: sorted[0], count: sorted.length };
    });
  }, [data]);

  const open = (stack) => {
    if (flow.opening) return;
    if (stack.theme === 'album:choice') setChoosing(stack.next);
    else flow.openSpecial(stack.next.id);
  };

  const total = data?.items?.length || 0;
  const leveltoast = <LevelUpToast />;
  if (error) {
    // Erreur de chargement : un petit encart discret plutôt qu'un trou (l'accueil reste utilisable).
    return (
      <>
        {leveltoast}
        <section className="panel gm-special gm-special--error">
          <p className="small muted">{t('game.special.error')}</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => reload()}>{t('feedback.retry')}</button>
        </section>
      </>
    );
  }
  if (!total) {
    // Inventaire vide : seulement l'offre d'achat, en petit (l'accueil garde son héros et sa rangée en tête).
    return (
      <>
        {leveltoast}
        {data && (
          <section className="panel gm-special ws-special--shop" aria-labelledby="gm-special-title" id="boosters-speciaux">
            <h2 className="panel__title" id="gm-special-title"><Icon name="pack" /> {t('game.special.title')}</h2>
            <ThemedOffer onOpen={() => setShopping(true)} compact />
          </section>
        )}
        {shop}
        {flow.overlay}
      </>
    );
  }

  return (
    <>
      {leveltoast}
      <section className="panel gm-special" aria-labelledby="gm-special-title" id="boosters-speciaux">
        <header className="gm-special__head">
          <h2 className="panel__title" id="gm-special-title">
            <Icon name="pack" /> {t('game.special.title')}
            <span className="chip mono gm-special__count">{t('game.special.count', { n: total })}</span>
          </h2>
          <button type="button" className="link-btn" onClick={() => setOddsFor(null)}>
            <Icon name="star" size={14} /> {t('game.special.odds')}
          </button>
        </header>
        <p className="small muted gm-special__intro">{t('game.special.intro')}</p>
        <ul className="gm-special__list">
          {stacks.map((stack) => {
            const name = themeName(stack.theme);
            const parsed = parseBoosterTheme(stack.theme);
            const isAlbum = parsed?.kind === 'album' || parsed?.kind === 'choice';
            return (
              <li key={stack.theme} className="gm-special__item">
                <button type="button" className="gm-special__art" onClick={() => open(stack)} disabled={flow.opening}
                  aria-label={`${t('game.special.open')} · ${name}`}>
                  <MiniBooster theme={stack.theme} />
                  {stack.count > 1 && <span className="gm-special__stack mono" aria-hidden="true">×{stack.count}</span>}
                </button>
                <div className="gm-special__text">
                  <strong className="gm-special__name">{name}</strong>
                  <span className="small muted">{isAlbum ? t('game.special.kind.album') : t('game.special.kind.theme')}</span>
                  <span className="small muted">{sourceName(stack.next.source)}</span>
                </div>
                <div className="gm-special__actions">
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => open(stack)} disabled={flow.opening}>
                    {stack.theme === 'album:choice' ? t('game.special.choose') : t('game.special.open')}
                  </button>
                  <button type="button" className="link-btn small" onClick={() => setOddsFor(stack.theme)}>{t('game.special.oddsShort')}</button>
                </div>
              </li>
            );
          })}
        </ul>
        <ThemedOffer onOpen={() => setShopping(true)} />
      </section>
      {shop}
      <Modal open={oddsFor !== undefined} onClose={() => setOddsFor(undefined)} className="modal--wide gm-odds-modal"
        title={oddsFor ? t('game.special.oddsTitle', { name: themeName(oddsFor) }) : t('game.special.oddsStandard')}>
        {oddsFor !== undefined && <BoosterOdds theme={oddsFor} pity={user?.pity ?? null} />}
      </Modal>
      {choosing && (
        <ChooseAlbum booster={choosing} onClose={() => setChoosing(null)}
          onChosen={(id) => {
            setChoosing(null);
            toast(t('game.special.chosen'), 'success');
            flow.openSpecial(id);
          }} />
      )}
      {flow.overlay}
    </>
  );
}

export default SpecialBoosters;
