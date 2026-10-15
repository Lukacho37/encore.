// Chances d'un booster, telles que le serveur les publie (GET /api/boosters/odds, shared/rules.js boosterOdds) —
// chantier P1-D (PLAN.md 6.5, 6.10, 7.1 : les chances de chaque tirage sont affichées). Calculées ici avec la même
// fonction partagée que le serveur et la démo : rien à charger, toujours à jour.
import { useMemo } from 'react';
import { RarityGem } from '../Card.jsx';
import { RARITIES, RARITY, boosterOdds, parseBoosterTheme } from '@shared/rules.js';
import { getAlbum } from '../../state/catalog.js';
import { useI18n } from '../../i18n/index.jsx';
import '../../styles/game.css';

/** Pourcentage lisible : 0,6 %, 5 %, 27 %. */
export function usePct() {
  const { lang } = useI18n();
  return useMemo(() => {
    const fine = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 });
    const round = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
    return (x) => (x > 0 && x < 0.1 ? fine : round).format(x);
  }, [lang]);
}

/** Nom d'un booster spécial : « Rock », « Années 70 », « À ton goût », « Album au choix », titre de l'album. */
export function useThemeName() {
  const { t } = useI18n();
  return (theme) => {
    const p = parseBoosterTheme(theme);
    if (!p) return t('game.special.theme.standard');
    if (p.kind === 'genre') return t(`genre.${p.value}`);
    if (p.kind === 'decade') return t('decade', { d: p.value });
    if (p.kind === 'taste') return t('game.special.theme.taste');
    if (p.kind === 'choice') return t('game.special.theme.choice');
    if (p.kind === 'event') {
      const name = t(`game.special.events.${p.value}`);
      return name.startsWith('game.') ? p.value : name;
    }
    return getAlbum(p.value)?.title || t('game.special.theme.album');
  };
}

/** Tableau des emplacements : chance de chaque rareté pour chacune des 5 cartes. */
function SlotTable({ slots, caption }) {
  const { t } = useI18n();
  const pct = usePct();
  const shown = RARITIES.filter((r) => slots.some((s) => s[r]));
  return (
    <div className="table-wrap">
      <table className="table gm-odds__table">
        <caption className="small muted">{caption}</caption>
        <thead>
          <tr>
            <th>{t('game.odds.card')}</th>
            {shown.map((r) => (
              <th key={r} className="num"><span className="gm-odds__rarity" style={{ color: RARITY[r].color }}><RarityGem rarity={r} size={11} /> {t(`rarity.${r}`)}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, i) => {
            const total = Object.values(slot).reduce((s, w) => s + w, 0);
            return (
              <tr key={i}>
                <th scope="row" className="mono">{t('game.odds.slot', { n: i + 1 })}</th>
                {shown.map((r) => (
                  <td key={r} className="num mono" data-label={t(`rarity.${r}`)}>{slot[r] ? pct(slot[r] / total) : '–'}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Chances d'un booster (`theme` : null pour le booster standard, « genre:rock », « album:choice »…) : emplacements,
 * pitié douce, ciblage, holo ; booster d'album : cartes manquantes d'abord puis poids par rareté.
 */
export function BoosterOdds({ theme = null, pity = null }) {
  const { t } = useI18n();
  const pct = usePct();
  const odds = useMemo(() => boosterOdds(theme), [theme]);
  const holo = <p className="small muted">{t('game.odds.holo', { p: pct(odds.holo), top: pct(odds.holoTop) })}</p>;

  if (odds.albumWeights) {
    const total = Object.values(odds.albumWeights).reduce((s, w) => s + w, 0);
    return (
      <div className="gm-odds">
        <p>{t('game.odds.album')}</p>
        <ul className="gm-odds__weights">
          {RARITIES.map((r) => (
            <li key={r}>
              <span className="gm-odds__rarity" style={{ color: RARITY[r].color }}><RarityGem rarity={r} size={11} /> {t(`rarity.${r}`)}</span>
              <span className="mono">{pct(odds.albumWeights[r] / total)}</span>
            </li>
          ))}
        </ul>
        <p className="small muted">{t('game.odds.albumNote')}</p>
        {holo}
      </div>
    );
  }

  const { ultra, legendary, promo } = odds.pity.slot;
  const hitTotal = ultra + legendary + promo;
  return (
    <div className="gm-odds">
      <p>{odds.kind === 'standard' ? t('game.odds.standard') : t('game.odds.themed')}</p>
      <SlotTable slots={odds.slots} caption={t('game.odds.caption')} />
      <p className="gm-odds__rule">
        <strong>{t('rarityGuide.pityTitle')}.</strong>{' '}
        {t('rarityGuide.pityBody', { n: odds.pity.after - 1, u: pct(ultra / hitTotal), l: pct(legendary / hitTotal), p: pct(promo / hitTotal) })}
        {pity != null && <> {t('rarityGuide.pityNow', { n: pity })}</>}
      </p>
      {odds.focus && (
        <p className="gm-odds__rule">
          <strong>{t('rarityGuide.focusTitle')}.</strong>{' '}
          {t('game.odds.focus', { w: pct(odds.focus.wishlist), a: pct(odds.focus.advanced), n: odds.focus.advancedAlbums, p: pct(odds.focus.promo) })}
        </p>
      )}
      {holo}
    </div>
  );
}
