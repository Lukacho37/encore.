import { useMemo, useState } from 'react';
import { Modal, Icon } from './ui.jsx';
import { RarityGem } from './Card.jsx';
import { POP_TIERS } from '@shared/catalog.js';
import { FOCUS_CHANCE, RARITIES, RARITY, packOdds } from '@shared/rules.js';
import { useAlbumDetail, useApi, useCatalogInfo } from '../state/catalog.js';
import { useI18n } from '../i18n/index.jsx';

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

export function RarityGuideModal({ open, onClose }) {
  const { t, lang } = useI18n();
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
            <p>{t('rarityGuide.packFocus', { p: new Intl.NumberFormat(lang, { style: 'percent' }).format(FOCUS_CHANCE) })}</p>
          </section>
          <section>
            <h3>{t('rarityGuide.holoTitle')}</h3>
            <p>{t('rarityGuide.holoBody')}</p>
          </section>
          <section>
            <h3><RarityGem rarity="promo" size={13} /> {t('rarityGuide.promoTitle')}</h3>
            <p>{t('rarityGuide.promoBody')}</p>
          </section>
        </div>
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
