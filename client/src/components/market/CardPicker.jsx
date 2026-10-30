import { useEffect, useState } from 'react';
import Card from '../Card.jsx';
import { get } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { Spinner } from '../ui.jsx';

// Choix d'une carte pour une vente ou un échange (GET /api/trades/cards) : les miennes, ou celles d'un ami (`user`),
// d'une rareté donnée (`rarity`) ; recherche par titre, artiste ou album. onPick({ trackId, variant, rarity, count }).
export function CardPicker({ user = null, rarity = null, onPick, selected = null, searchLabel }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);

  // La recherche part 300 ms après la dernière frappe.
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    let alive = true;
    setData(null);
    const params = new URLSearchParams();
    if (user) params.set('user', user);
    if (rarity) params.set('rarity', rarity);
    if (query) params.set('q', query);
    get(`/trades/cards?${params}`)
      .then((res) => alive && setData(res))
      .catch(() => alive && setData({ items: [], total: 0 }));
    return () => {
      alive = false;
    };
  }, [user, rarity, query]);

  // Une case par exemplaire distinct (standard et holo à part).
  const cells = (data?.items || []).flatMap((c) => c.variants.map((v) => ({ ...c, variant: v.variant, count: v.count })));
  return (
    <div className="mk-picker">
      <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={searchLabel || t('auctions.form.search')}
        aria-label={searchLabel || t('auctions.form.search')} />
      {!data ? (
        <div className="mk-picker__wait"><Spinner /></div>
      ) : cells.length === 0 ? (
        <p className="muted small">{t('auctions.form.none')}</p>
      ) : (
        <div className="card-grid card-grid--picker mk-picker__grid">
          {cells.map((c) => {
            const on = selected?.trackId === c.trackId && selected?.variant === c.variant;
            return (
              <div key={`${c.trackId}|${c.variant}`} className={`mk-picker__cell${on ? ' is-on' : ''}`}>
                <Card trackId={c.trackId} variant={c.variant} count={c.count} onClick={() => onPick(c)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CardPicker;
