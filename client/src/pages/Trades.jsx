import { useState } from 'react';
import { Link } from 'react-router';
import Card from '../components/Card.jsx';
import CardPicker from '../components/market/CardPicker.jsx';
import { ErrorBox, EmptyState } from '../components/feedback.jsx';
import { Icon, Modal, Spinner, useToast } from '../components/ui.jsx';
import { post } from '../api.js';
import { useApi } from '../state/catalog.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import '../styles/market.css';

// Échanges entre amis (server/market.js) : une carte contre une carte de même rareté.

function TradeRow({ trade, side, onChanged }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const { user } = useGame();
  const [busy, setBusy] = useState(false);
  // Destinataire de la proposition (reçue ou terminée) : il donne la carte demandée et reçoit la carte proposée.
  const incoming = side === 'incoming' || (side === 'history' && trade.toId === user?.id);
  const mine = incoming ? trade.want : trade.give;
  const theirs = incoming ? trade.give : trade.want;
  const other = incoming ? trade.from : trade.to;
  const act = async (action) => {
    setBusy(true);
    try {
      const res = await post(`/trades/${trade.id}/${action}`);
      if (res.failed) toast(t('trades.failedNow'), 'error');
      else if (action === 'accept') toast(t('trades.accepted'), 'success');
      onChanged();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="mk-trade" data-trade={trade.id}>
      <p className="mk-trade__who">{t(incoming ? 'trades.offerFrom' : 'trades.offerTo', { name: other?.username || '?' })}</p>
      <div className="mk-trade__cards">
        <figure>
          <figcaption className="small muted">{t('trades.youGive')}</figcaption>
          <Card trackId={mine.trackId} variant={mine.variant} />
        </figure>
        <Icon name="swap" />
        <figure>
          <figcaption className="small muted">{t('trades.youGet')}</figcaption>
          <Card trackId={theirs.trackId} variant={theirs.variant} />
        </figure>
      </div>
      {side === 'history' ? (
        <p className="small muted">{t(`trades.status.${trade.status}`)}</p>
      ) : (
        <div className="mk-trade__actions">
          {incoming ? (
            <>
              <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => act('accept')}>{t('trades.accept')}</button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act('decline')}>{t('trades.decline')}</button>
            </>
          ) : (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act('cancel')}>{t('trades.cancel')}</button>
          )}
        </div>
      )}
    </article>
  );
}

function ProposeDialog({ open, onClose, onDone, friends }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [friend, setFriend] = useState('');
  const [give, setGive] = useState(null);
  const [want, setWant] = useState(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setGive(null);
    setWant(null);
  };
  const submit = async () => {
    setBusy(true);
    try {
      await post('/trades', { to: friend, give: { trackId: give.trackId, variant: give.variant }, want: { trackId: want.trackId, variant: want.variant } });
      toast(t('trades.form.sent', { name: friend }), 'success');
      reset();
      onDone();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('trades.form.title')} className="mk-dialog">
      <label className="field">
        <span>{t('trades.form.friend')}</span>
        <span className="select">
          <select value={friend} onChange={(e) => { setFriend(e.target.value); reset(); }}>
            <option value="">{t('trades.form.chooseFriend')}</option>
            {friends.map((f) => <option key={f.user.id} value={f.user.username}>{f.user.username}</option>)}
          </select>
        </span>
      </label>
      {friend && !give && (
        <section className="mk-step">
          <h3 className="mk-step__title">{t('trades.form.mine')}</h3>
          <CardPicker onPick={setGive} />
        </section>
      )}
      {friend && give && (
        <section className="mk-step">
          <div className="mk-step__chosen">
            <Card trackId={give.trackId} variant={give.variant} />
            <button type="button" className="link-btn small" onClick={reset}>{t('trades.form.change')}</button>
          </div>
          <h3 className="mk-step__title">{t('trades.form.theirs', { name: friend })}</h3>
          <p className="small muted">{t('trades.form.sameRarity', { name: friend, rarity: t(`rarity.${give.rarity}`) })}</p>
          {!want ? (
            <CardPicker user={friend} rarity={give.rarity} onPick={setWant} searchLabel={t('trades.form.search')} />
          ) : (
            <div className="mk-step__chosen">
              <Card trackId={want.trackId} variant={want.variant} />
              <button type="button" className="link-btn small" onClick={() => setWant(null)}>{t('trades.form.change')}</button>
            </div>
          )}
          {want && <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>{t('trades.form.submit')}</button>}
        </section>
      )}
    </Modal>
  );
}

export default function Trades() {
  const { t } = useI18n();
  const [proposing, setProposing] = useState(false);
  const { data, error, reload } = useApi('/trades', { keep: false });
  const { data: friendsData } = useApi('/friends');
  const friends = friendsData?.friends || [];
  return (
    <div className="mk-page" data-page="trades">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('trades.kicker')}</span>
          <h1>{t('trades.title')}</h1>
          <p className="mk-page__intro">{t('trades.intro')}</p>
        </div>
        <div className="mk-page__actions">
          {friends.length > 0 ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setProposing(true)}><Icon name="swap" size={16} /> {t('trades.propose')}</button>
          ) : (
            <Link to="/friends" className="btn btn--ghost btn--sm">{t('trades.friendsLink')}</Link>
          )}
          <Link to="/auctions" className="btn btn--ghost btn--sm">{t('auctions.title')}</Link>
        </div>
      </header>
      {friendsData && friends.length === 0 && <p className="small muted">{t('trades.noFriends')}</p>}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? (
        <div className="mk-wait"><Spinner /></div>
      ) : (
        <>
          <section className="mk-section">
            <h2 className="mk-section__title">{t('trades.incoming')}</h2>
            {data.incoming.length ? data.incoming.map((tr) => <TradeRow key={tr.id} trade={tr} side="incoming" onChanged={reload} />)
              : <EmptyState icon="swap" title={t('trades.emptyIncoming')} />}
          </section>
          <section className="mk-section">
            <h2 className="mk-section__title">{t('trades.outgoing')}</h2>
            {data.outgoing.length ? data.outgoing.map((tr) => <TradeRow key={tr.id} trade={tr} side="outgoing" onChanged={reload} />)
              : <p className="small muted">{t('trades.emptyOutgoing')}</p>}
          </section>
          {data.history.length > 0 && (
            <section className="mk-section">
              <h2 className="mk-section__title">{t('trades.history')}</h2>
              {data.history.map((tr) => <TradeRow key={tr.id} trade={tr} side="history" onChanged={reload} />)}
            </section>
          )}
        </>
      )}
      <ProposeDialog open={proposing} onClose={() => setProposing(false)} friends={friends} onDone={() => { setProposing(false); reload(); }} />
    </div>
  );
}
