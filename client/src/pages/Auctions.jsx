import { useState } from 'react';
import { Link } from 'react-router';
import Card from '../components/Card.jsx';
import CardPicker from '../components/market/CardPicker.jsx';
import { ErrorBox, EmptyState } from '../components/feedback.jsx';
import { Icon, Modal, Royalties, Spinner, formatDuration, useNow, useToast } from '../components/ui.jsx';
import { get, post } from '../api.js';
import { useApi, useTrack } from '../state/catalog.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { RARITIES } from '@shared/rules.js';
import '../styles/market.css';

// Enchères (server/market.js) : ventes des autres joueurs, mes ventes, mes offres ; mise en vente d'une carte.
const TABS = ['open', 'mine', 'bids'];
const HOURS = [1, 6, 24, 72];

function AuctionItem({ a, onChanged }) {
  const { t, error, num } = useI18n();
  const toast = useToast();
  const now = useNow(1000);
  const { user } = useGame();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const left = a.endsAt - now;
  const open = a.status === 'open' && left > 0;
  const act = async (path, body, done) => {
    setBusy(true);
    try {
      await post(path, body);
      toast(done, 'success');
      setAmount('');
      onChanged();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  const bid = Number(amount) || a.nextBid;
  return (
    <article className={`mk-auction${a.leading ? ' is-leading' : ''}`} data-auction={a.id}>
      <Card trackId={a.trackId} variant={a.variant} />
      <div className="mk-auction__body">
        <p className="mk-auction__price">
          <span className="small muted">{a.bid != null ? t('auctions.currentBid') : t('auctions.startPrice')}</span>
          <Royalties value={a.bid ?? a.startPrice} />
        </p>
        <p className="small muted">{a.bids ? t('auctions.bids', { n: a.bids }) : t('auctions.noBid')}</p>
        <p className="small mono">{open ? t('auctions.endsIn', { time: formatDuration(left) }) : a.status === 'open' ? t('auctions.ended') : t(`auctions.status.${a.status}`, { n: num(a.bid ?? 0) })}</p>
        {!a.mine && a.seller && <p className="small muted">{t('auctions.seller', { name: a.seller.username })}</p>}
        {a.leading && open && <span className="chip chip--sm mk-auction__lead">{t('auctions.leading')}</span>}
        {open && !a.mine && !a.leading && (
          <form className="mk-auction__bid" onSubmit={(e) => { e.preventDefault(); act(`/auctions/${a.id}/bid`, { amount: bid }, t('auctions.placed', { n: num(bid) })); }}>
            <input className="input" type="number" inputMode="numeric" min={a.nextBid} max={user?.royalties ?? undefined} value={amount} placeholder={String(a.nextBid)}
              onChange={(e) => setAmount(e.target.value)} aria-label={t('auctions.bidAmount', { n: a.nextBid })} />
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>{t('auctions.bid')}</button>
          </form>
        )}
        {open && a.mine && a.bids === 0 && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act(`/auctions/${a.id}/cancel`, {}, t('auctions.cancelled'))}>
            {t('auctions.cancel')}
          </button>
        )}
      </div>
    </article>
  );
}

function SellDialog({ open, onClose, onDone }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [card, setCard] = useState(null);
  const [price, setPrice] = useState('100');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const track = useTrack(card?.trackId);
  const submit = async (e) => {
    e.preventDefault();
    if (!card) return;
    setBusy(true);
    try {
      await post('/auctions', { trackId: card.trackId, variant: card.variant, startPrice: Number(price), hours });
      toast(t('auctions.form.done'), 'success');
      setCard(null);
      onDone();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('auctions.form.title')} className="mk-dialog">
      {!card ? (
        <>
          <p className="small muted">{t('auctions.form.pick')}</p>
          <CardPicker onPick={setCard} />
        </>
      ) : (
        <form className="mk-form" onSubmit={submit}>
          <div className="mk-form__card">
            <Card trackId={card.trackId} variant={card.variant} count={card.count} />
            <button type="button" className="link-btn small" onClick={() => setCard(null)}>{t('trades.form.change')}</button>
          </div>
          <div className="mk-form__fields">
            {track && <p className="mk-form__title">{track.title} <span className="muted">· {track.artist}</span></p>}
            {card.count <= 1 && <p className="small mk-warn" role="note">{t('auctions.form.lastCopy')}</p>}
            <label className="field">
              <span>{t('auctions.form.price')}</span>
              <input className="input" type="number" inputMode="numeric" min="10" max="1000000" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </label>
            <label className="field">
              <span>{t('auctions.form.hours')}</span>
              <span className="select">
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {HOURS.map((h) => <option key={h} value={h}>{t('auctions.form.hour', { n: h })}</option>)}
                </select>
              </span>
            </label>
            <button type="submit" className="btn btn--primary" disabled={busy}>{t('auctions.form.submit')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function Auctions() {
  const { t } = useI18n();
  const [tab, setTab] = useState('open');
  const [rarity, setRarity] = useState('');
  const [selling, setSelling] = useState(false);
  const [extra, setExtra] = useState([]);
  const [next, setNext] = useState(undefined);
  const path = `/auctions?tab=${tab}${rarity ? `&rarity=${rarity}` : ''}`;
  const { data, error, reload } = useApi(path, { keep: false, onData: () => { setExtra([]); setNext(undefined); } });
  const items = [...(data?.items || []), ...extra];
  const nextOffset = next === undefined ? data?.nextOffset : next;
  const more = async () => {
    const res = await get(`${path}&offset=${nextOffset}`);
    setExtra((list) => [...list, ...res.items]);
    setNext(res.nextOffset);
  };
  return (
    <div className="mk-page" data-page="auctions">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('auctions.kicker')}</span>
          <h1>{t('auctions.title')}</h1>
          <p className="mk-page__intro">{t('auctions.intro')}</p>
        </div>
        <div className="mk-page__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setSelling(true)}><Icon name="pack" size={16} /> {t('auctions.sell')}</button>
          <Link to="/trades" className="btn btn--ghost btn--sm"><Icon name="swap" size={16} /> {t('auctions.tradesLink')}</Link>
        </div>
      </header>
      <div className="mk-toolbar">
        <nav className="seg" aria-label={t('auctions.title')}>
          {TABS.map((k) => (
            <button key={k} type="button" className={`seg__btn${tab === k ? ' is-on' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>{t(`auctions.tabs.${k}`)}</button>
          ))}
        </nav>
        <label className="select">
          <span className="sr-only">{t('auctions.allRarities')}</span>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
            <option value="">{t('auctions.allRarities')}</option>
            {RARITIES.map((r) => <option key={r} value={r}>{t(`rarity.${r}`)}</option>)}
          </select>
        </label>
      </div>
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? (
        <div className="mk-wait"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState icon="gavel" title={t(`auctions.empty.${tab}`)} />
      ) : (
        <>
          <div className="mk-grid">{items.map((a) => <AuctionItem key={a.id} a={a} onChanged={reload} />)}</div>
          {nextOffset != null && <button type="button" className="btn btn--ghost mk-more" onClick={more}>{t('auctions.more')}</button>}
        </>
      )}
      <SellDialog open={selling} onClose={() => setSelling(false)} onDone={() => {
        setSelling(false);
        // Changer d'onglet recharge déjà la liste ; recharger l'ancienne en plus l'afficherait par-dessus.
        if (tab === 'mine') reload();
        else setTab('mine');
      }} />
    </div>
  );
}
