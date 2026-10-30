import { useMemo, useState } from 'react';
import { Modal, Icon } from './ui.jsx';
import { RarityGem } from './Card.jsx';
import { BoosterOdds, usePct } from './game/odds.jsx';
import {
  POP_TIERS, RARITIES, RARITY, packOdds, ADVANCED_ALBUMS, ADVANCED_FOCUS, FOCUS_CHANCE, PITY_AFTER, PITY_SLOT, PROMO_FOCUS,
  WISHLIST_FOCUS, WISHLIST_SLOTS, WISHLIST_BONUS_LEVELS, SHOWCASE_SLOTS, SHOWCASE_BONUS_LEVELS, THEMED_BOOSTER_EVERY, ECONOMY,
} from '@shared/rules.js';
import { LEVEL_COSMETICS } from '@shared/cosmetics.js';
import { useAlbumDetail, useApi, useCatalogInfo } from '../state/catalog.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import '../styles/game.css';

// Guide des raretés : chaque règle du jeu de collection y est publiée (PLAN.md 6.4 à 6.6, 6.10, 7.1) — ciblage des
// boosters, pitié douce, promos ciblées et pressables, raretés gelées, paliers de niveau, boosters spéciaux.
// Les chiffres viennent de shared/rules.js, les mêmes que ceux du serveur et de la démo.

/**
 * Un exemple de morceau par rareté (le plus populaire trouvé). Le catalogue entier n'est pas chargé :
 * on prend les deux albums les plus populaires (des classiques qui couvrent toutes les raretés) et une promo.
 */
function useRarityExamples() {
  const popular = useApi('/catalog/albums?sort=popular&limit=2').data;
  const [firstId, secondId] = popular?.items?.map((a) => a.id) || [];
  const first = useAlbumDetail(firstId).data;
  const second = useAlbumDetail(secondId).data;
  const promos = useApi('/catalog/promos?limit=1').data;
  return useMemo(() => {
    const best = {};
    for (const tr of [...(first?.tracks || []), ...(second?.tracks || []), ...(promos?.items || [])]) {
      if (tr?.rarity && (!best[tr.rarity] || (tr.pop ?? 0) > (best[tr.rarity].pop ?? 0))) best[tr.rarity] = tr;
    }
    return best;
  }, [first, second, promos]);
}

/** Tableau des raretés : signification, popularité, chance par booster, nombre de cartes et un exemple. */
export function RarityTable() {
  const { t, lang, num } = useI18n();
  const pct = (x) => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: x < 0.1 ? 1 : 0 }).format(x);
  // Nombre de cartes par rareté dans tout le catalogue, calculé par le serveur.
  const counts = useCatalogInfo()?.totals?.rarity;
  const examples = useRarityExamples();
  const rows = useMemo(() => {
    const odds = packOdds();
    // Même ordre que la liste validée : ⚪ commune → ⭐ légendaire, puis 🟥 promo.
    return RARITIES.map((r) => ({ r, tier: POP_TIERS.find((x) => x.rarity === r), odds: odds[r] }));
  }, []);
  return (
    <div className="table-wrap">
      <table className="table rarity-table">
        <thead>
          <tr>
            <th>{t('rarityGuide.colTier')}</th>
            <th>{t('rarityGuide.colMeaning')}</th>
            <th className="num">{t('rarityGuide.colPop')}</th>
            <th className="num" title={t('rarityGuide.oddsHint')}>{t('rarityGuide.colOdds')}</th>
            <th className="num" title={t('rarityGuide.cardsHint')}>{t('rarityGuide.colCards')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, tier, odds }) => {
            const example = examples[r];
            return (
              <tr key={r}>
                <td><span className="rarity-name" style={{ color: RARITY[r].color }}><RarityGem rarity={r} size={14} /> {t(`rarity.${r}`)}</span></td>
                <td>
                  <span className="rarity-meaning">{t(`rarityGuide.meaning.${r}`)}</span>
                  {example && (
                    <span className="small muted rarity-example">
                      {t('rarityGuide.example', { title: example.artist ? `${example.title} · ${example.artist}` : example.title })}
                    </span>
                  )}
                </td>
                {/* data-label : sur téléphone, le tableau s'empile et chaque chiffre reprend le nom de sa colonne. */}
                <td className="num mono" data-label={t('rarityGuide.colPop')}>{tier ? `${tier.min}–${tier.max}` : t('rarityGuide.promoRange')}</td>
                <td className="num mono" data-label={t('rarityGuide.colOdds')}>{pct(odds)}</td>
                <td className="num mono" data-label={t('rarityGuide.colCards')}>{counts ? num(counts[r] || 0) : '…'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Paliers de niveau : cosmétiques et places gagnées, rangés par niveau. */
function LevelTrack() {
  const { t } = useI18n();
  const rows = useMemo(() => {
    const byLevel = new Map();
    const add = (level, text) => byLevel.set(level, [...(byLevel.get(level) || []), text]);
    for (const c of LEVEL_COSMETICS) add(c.level, { cosmetic: c });
    for (const l of WISHLIST_BONUS_LEVELS) add(l, { wishlist: true });
    for (const l of SHOWCASE_BONUS_LEVELS) add(l, { showcase: true });
    return [...byLevel.entries()].sort((a, b) => a[0] - b[0]);
  }, []);
  const label = (item) => {
    if (item.wishlist) return t('rarityGuide.slotsWishlist');
    if (item.showcase) return t('rarityGuide.slotsShowcase');
    const { kind, key } = item.cosmetic;
    return t('cosmetics.named', { kind: t(`cosmetics.kind.${kind}`), name: t(`cosmetics.${kind}.${key}`) });
  };
  return (
    <ul className="gm-guide__levels">
      {rows.map(([level, items]) => (
        <li key={level}>
          <span className="gm-guide__level mono">{t('rarityGuide.levelRow', { n: level })}</span>
          <span>{items.map(label).join(' · ')}</span>
        </li>
      ))}
    </ul>
  );
}

export function RarityGuideModal({ open, onClose }) {
  const { t } = useI18n();
  const { user } = useGame() || {};
  const pct = usePct();
  const info = useCatalogInfo();
  const hits = PITY_SLOT.ultra + PITY_SLOT.legendary + PITY_SLOT.promo;
  return (
    <Modal open={open} onClose={onClose} title={t('rarityGuide.title')} className="modal--wide">
      <div className="rarity-guide">
        <p className="rarity-guide__intro">{t('rarityGuide.intro')}</p>
        <RarityTable />
        <p className="small muted">{t('rarityGuide.oddsHint')}</p>
        <div className="rarity-guide__notes">
          <section>
            <h3>{t('rarityGuide.packTitle')}</h3>
            <p>{t('rarityGuide.packBody')}</p>
          </section>
          <section>
            <h3>{t('rarityGuide.focusTitle')}</h3>
            <p>
              {t('rarityGuide.focusBody', {
                albums: info?.totals?.albums ?? '…', w: pct(WISHLIST_FOCUS), a: pct(ADVANCED_FOCUS), n: ADVANCED_ALBUMS, f: pct(FOCUS_CHANCE),
              })}
            </p>
            <p className="small muted">{t('rarityGuide.wishlistSlots', { n: WISHLIST_SLOTS, levels: WISHLIST_BONUS_LEVELS.join(', ') })}</p>
          </section>
          <section>
            <h3>{t('rarityGuide.pityTitle')}</h3>
            <p>
              {t('rarityGuide.pityBody', {
                n: PITY_AFTER - 1, u: pct(PITY_SLOT.ultra / hits), l: pct(PITY_SLOT.legendary / hits), p: pct(PITY_SLOT.promo / hits),
              })}
            </p>
            {user?.pity != null && <p className="small muted">{t('rarityGuide.pityNow', { n: user.pity })}</p>}
          </section>
          <section>
            <h3>{t('rarityGuide.holoTitle')}</h3>
            <p>{t('rarityGuide.holoBody')}</p>
          </section>
          <section>
            <h3><RarityGem rarity="promo" size={13} /> {t('rarityGuide.promoTitle')}</h3>
            <p>{t('rarityGuide.promoBody', { p: pct(PROMO_FOCUS) })}</p>
          </section>
          <section>
            <h3>{t('rarityGuide.getTitle')}</h3>
            <p>{t('rarityGuide.getBody')}</p>
          </section>
          <section>
            <h3>{t('rarityGuide.freezeTitle')}</h3>
            <p>{t('rarityGuide.freezeBody')}</p>
          </section>
          <section>
            <h3><Icon name="pack" size={15} /> {t('rarityGuide.specialTitle')}</h3>
            <p>{t('rarityGuide.specialBody', { price: ECONOMY.albumPackPrice })}</p>
          </section>
          <section>
            <h3><Icon name="trophy" size={15} /> {t('rarityGuide.levelTitle')}</h3>
            <p>{t('rarityGuide.levelBody', { every: THEMED_BOOSTER_EVERY, showcase: SHOWCASE_SLOTS })}</p>
          </section>
        </div>
        <section className="gm-guide__block">
          <h3>{t('rarityGuide.levelTrackTitle')}</h3>
          <LevelTrack />
        </section>
        <details className="gm-guide__block gm-guide__details">
          <summary>{t('rarityGuide.slotsTitle')}</summary>
          <BoosterOdds theme={null} pity={user?.pity ?? null} />
        </details>
        {/* Séparation entre le jeu et les œuvres (PLAN.md 7.1) : rien ici n'est un droit ni une valeur réelle. */}
        <section className="rarity-guide__game">
          <h3>{t('rarityGuide.gameTitle')}</h3>
          <p>{t('rarityGuide.gameBody')}</p>
          <p>{t('rarityGuide.gameRoyalties')}</p>
        </section>
      </div>
    </Modal>
  );
}

/** Lien « Comment marchent les raretés ? » qui ouvre le guide. */
export function RarityGuideButton({ className = 'link-btn', label }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="star" size={14} /> {label || t('home.rarityHelp')}
      </button>
      <RarityGuideModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
