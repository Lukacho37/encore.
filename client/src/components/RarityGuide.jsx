import { useMemo, useState } from 'react';
import { Modal, Icon } from './ui.jsx';
import { RarityGem } from './Card.jsx';
import { TRACKS, POP_TIERS } from '@shared/catalog.js';
import { RARITIES, RARITY, packOdds } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';

/** Tableau des raretés : signification, popularité, chance par booster, nombre de cartes et un exemple. */
export function RarityTable() {
  const { t, lang } = useI18n();
  const pct = (x) => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: x < 0.1 ? 1 : 0 }).format(x);
  const rows = useMemo(() => {
    const odds = packOdds();
    // Même ordre que la liste validée : ⚪ commune → ⭐ légendaire, puis 🟥 promo.
    return RARITIES.map((r) => {
      const tier = POP_TIERS.find((x) => x.rarity === r);
      const cards = TRACKS.filter((tr) => tr.rarity === r);
      // Exemple : le morceau le plus populaire de la rareté
      const example = [...cards].sort((a, b) => b.pop - a.pop)[0];
      return { r, tier, count: cards.length, odds: odds[r], example };
    });
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
            <th className="num">{t('rarityGuide.colCards')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, tier, count, odds, example }) => (
            <tr key={r}>
              <td><span className="rarity-name" style={{ color: RARITY[r].color }}><RarityGem rarity={r} size={14} /> {t(`rarity.${r}`)}</span></td>
              <td>
                <span className="rarity-meaning">{t(`rarityGuide.meaning.${r}`)}</span>
                {example && <span className="small muted rarity-example">{t('rarityGuide.example', { title: example.title })}</span>}
              </td>
              <td className="num mono">{tier ? `${tier.min}–${tier.max}` : t('rarityGuide.promoRange')}</td>
              <td className="num mono">{pct(odds)}</td>
              <td className="num mono">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RarityGuideModal({ open, onClose }) {
  const { t } = useI18n();
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
            <h3>{t('rarityGuide.holoTitle')}</h3>
            <p>{t('rarityGuide.holoBody')}</p>
          </section>
          <section>
            <h3><RarityGem rarity="promo" size={13} /> {t('rarityGuide.promoTitle')}</h3>
            <p>{t('rarityGuide.promoBody')}</p>
          </section>
        </div>
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
