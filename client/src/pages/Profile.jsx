import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { get, post, del } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Avatar, ConfirmButton, Icon, Modal, Progress, Spinner, useToast } from '../components/ui.jsx';
import { ALBUMS, ALBUM_BY_ID, ARTIST_BY_ID, TRACK_BY_ID } from '@shared/catalog.js';
import { AVATAR_COLORS, SHOWCASE_SLOTS, RARITY } from '@shared/rules.js';
import { VinylShelf, isHoloComplete } from '../components/Vinyl.jsx';
import { RatingHistogram, RatingValue, ReviewList } from '../components/Rating.jsx';

function AvatarPicker({ open, onClose }) {
  const { t, error } = useI18n();
  const { user, stats, achievements, applyState, isAdmin } = useGame();
  const toast = useToast();
  const [avatar, setAvatar] = useState(user.avatar);
  const [color, setColor] = useState(user.avatarColor);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAvatar(user.avatar);
      setColor(user.avatarColor);
    }
  }, [open, user.avatar, user.avatarColor]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await post('/profile/avatar', { avatar, color });
      applyState(res.state);
      toast(t('avatar.saved'), 'success');
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const albums = [...ALBUMS].sort((a, b) => Number(achievements.has(`album:${b.id}`)) - Number(achievements.has(`album:${a.id}`)));

  return (
    <Modal open={open} onClose={onClose} title={t('avatar.title')}>
      <div className="avatar-picker">
        <div className="avatar-picker__preview">
          <Avatar user={{ ...user, avatar, avatarColor: color }} size={112} />
        </div>
        <section>
          <h3 className="eyebrow">{t('avatar.initials')} · {t('avatar.color')}</h3>
          <div className="swatches">
            {AVATAR_COLORS.map((c) => (
              <button key={c} type="button" className={`swatch${avatar === 'initials' && color === c ? ' is-on' : ''}`} style={{ '--sw': c }}
                aria-label={c} aria-pressed={avatar === 'initials' && color === c} onClick={() => { setAvatar('initials'); setColor(c); }} />
            ))}
          </div>
        </section>
        <section>
          <h3 className="eyebrow">{t('avatar.covers')}</h3>
          <p className="small muted">{t('avatar.coversHint')}</p>
          <div className="cover-picks">
            {albums.map((a) => {
              const unlocked = isAdmin || achievements.has(`album:${a.id}`);
              const p = stats.albums[a.id];
              const value = `album:${a.id}`;
              return (
                <button key={a.id} type="button" className={`cover-pick${avatar === value ? ' is-on' : ''}${unlocked ? '' : ' is-locked'}`}
                  disabled={!unlocked} onClick={() => setAvatar(value)} aria-pressed={avatar === value}
                  title={unlocked ? a.title : `${a.title} · ${t('avatar.locked', { owned: p.owned, total: p.total })}`}>
                  <CoverArt art={{ ...a.art, seed: a.id }} />
                  {!unlocked && <span className="cover-pick__lock"><Icon name="lock" size={16} /><span className="mono">{p.owned}/{p.total}</span></span>}
                </button>
              );
            })}
          </div>
        </section>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>{t('common.save')}</button>
        </div>
      </div>
    </Modal>
  );
}

function ShowcasePicker({ slot, onClose }) {
  const { t, error } = useI18n();
  const { owned, user, applyState } = useGame();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const current = user.showcase || [];

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...owned.keys()]
      .map((id) => TRACK_BY_ID[id])
      .filter((tr) => !current.includes(tr.id))
      .filter((tr) => !q || `${tr.title} ${ARTIST_BY_ID[tr.artistId].name} ${tr.albumId ? ALBUM_BY_ID[tr.albumId].title : ''}`.toLowerCase().includes(q))
      .sort((a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank || a.title.localeCompare(b.title))
      .slice(0, 60);
  }, [owned, query, current]);

  const pick = async (trackId) => {
    const slots = Array.from({ length: SHOWCASE_SLOTS }, (_, i) => current[i] || null);
    slots[slot] = trackId;
    try {
      const res = await post('/profile/showcase', { slots });
      applyState(res.state);
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  return (
    <Modal open={slot !== null} onClose={onClose} title={t('studio.pick')} className="modal--wide">
      <div className="picker">
        <label className="search">
          <Icon name="search" />
          <input id="showcase-search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('studio.search')} data-autofocus />
        </label>
        {owned.size === 0 ? <p className="empty">{t('studio.noCards')}</p> : list.length === 0 ? <p className="empty">{t('studio.noResult')}</p> : (
          <div className="card-grid card-grid--picker">
            {list.map((tr) => {
              const mine = owned.get(tr.id);
              return <Card key={tr.id} trackId={tr.id} variant={mine.holo ? 'holo' : 'std'} onClick={() => pick(tr.id)} />;
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function FriendAction({ profile, onChange }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await onChange();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  switch (profile.friendship) {
    case 'none':
      return <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => post('/friends/request', { username: profile.username }))}><Icon name="plus" /> {t('profile.add')}</button>;
    case 'outgoing':
      return (
        <span className="friend-state">
          <span className="chip">{t('profile.pending')}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/decline`))}>{t('friends.cancel')}</button>
        </span>
      );
    case 'incoming':
      return <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/accept`))}>{t('profile.accept')}</button>;
    case 'friends':
      return (
        <span className="friend-state">
          <span className="chip chip--new"><Icon name="check" size={14} /> {t('profile.friends')}</span>
          <ConfirmButton className="btn btn--ghost btn--sm" confirmLabel={t('friends.removeConfirm', { name: profile.username })}
            onConfirm={() => run(() => del(`/friends/${profile.id}`))}>{t('friends.remove')}</ConfirmButton>
        </span>
      );
    default:
      return null;
  }
}

function RatingsSection({ username, isSelf, refreshKey }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    get(`/users/${encodeURIComponent(username)}/ratings`).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [username, refreshKey]);
  if (!data) return null;
  const s = data.stats;
  const itemLink = (r) => {
    if (r.type === 'album') return `/album/${r.id}`;
    const albumId = TRACK_BY_ID[r.id]?.albumId;
    return albumId ? `/album/${albumId}` : '/collection/promos';
  };
  const itemTitle = (r) => (r.type === 'album' ? ALBUM_BY_ID[r.id].title : TRACK_BY_ID[r.id].title);
  const itemArt = (r) => {
    const album = r.type === 'album' ? ALBUM_BY_ID[r.id] : TRACK_BY_ID[r.id].albumId ? ALBUM_BY_ID[TRACK_BY_ID[r.id].albumId] : null;
    return album ? { ...album.art, seed: album.id } : { ...TRACK_BY_ID[r.id].art, seed: r.id };
  };
  return (
    <section className="ratings-profile">
      <header className="studio__head"><h2>{t('ratingsProfile.title')}</h2></header>
      {s.count === 0 ? (
        <p className="empty">{isSelf ? t('ratingsProfile.emptySelf') : t('ratingsProfile.emptyOther', { name: username })}</p>
      ) : (
        <div className="ratings-profile__grid">
          <div className="panel ratings-profile__stats">
            <dl className="mini-stats">
              <div><dt>{t('ratingsProfile.statRatings')}</dt><dd className="mono">{s.count}</dd></div>
              <div><dt>{t('ratingsProfile.statAlbums')}</dt><dd className="mono">{s.albums}</dd></div>
              <div><dt>{t('ratingsProfile.statReviews')}</dt><dd className="mono">{s.reviews}</dd></div>
              <div><dt>{t('ratingsProfile.statAverage')}</dt><dd><RatingValue value={s.average} average size={13} /></dd></div>
            </dl>
            <RatingHistogram distribution={s.distribution} />
          </div>
          {(data.topAlbums.length > 0 || data.topTracks.length > 0) && (
            <div className="ratings-profile__top">
              {data.topAlbums.length > 0 && <h3 className="studio__label">{t('ratingsProfile.favAlbums')}</h3>}
              <div className="top-albums">
                {data.topAlbums.map((r) => (
                  <Link key={r.id} to={`/album/${r.id}`} className="top-album">
                    <span className="top-album__cover"><CoverArt art={itemArt(r)} /></span>
                    <span className="top-album__title">{itemTitle(r)}</span>
                    <RatingValue value={r.score} size={12} />
                  </Link>
                ))}
              </div>
              {data.topTracks.length > 0 && (
                <>
                  <h3 className="studio__label">{t('ratingsProfile.favTracks')}</h3>
                  <ol className="top-tracks">
                    {data.topTracks.map((r) => (
                      <li key={r.id}>
                        <Link to={itemLink(r)} className="top-tracks__item">
                          <span className="top-tracks__cover"><CoverArt art={itemArt(r)} /></span>
                          <span className="top-tracks__title">{itemTitle(r)}</span>
                          <RatingValue value={r.score} size={11} />
                        </Link>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
          {data.reviews.length > 0 && (
            <div className="ratings-profile__reviews">
              <h3 className="studio__label">{t('ratingsProfile.recent')}</h3>
              <ReviewList reviews={data.reviews} renderItem={(r) => (
                <Link to={itemLink(r)} className="review__author">
                  <span className="review__cover"><CoverArt art={itemArt(r)} /></span>
                  <span className="review__name">{itemTitle(r)}</span>
                </Link>
              )} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Profil du joueur connecté, construit à partir de l'état local. */
function useOwnProfile() {
  const { user, stats, achievements, owned } = useGame();
  return useMemo(() => {
    const vinyls = [...achievements.entries()].filter(([k]) => k.startsWith('album:')).sort((a, b) => a[1] - b[1])
      .map(([k, at]) => ({ albumId: k.slice(6), at, edition: isHoloComplete(k.slice(6), owned) ? 'holo' : 'black' }));
    const keys = [...achievements.keys()];
    return {
      self: true,
      username: user.username,
      avatar: user.avatar,
      avatarColor: user.avatarColor,
      level: user.level,
      createdAt: user.createdAt,
      role: user.role,
      stats: {
        unique: stats.total.owned, total: stats.total.total, albumsCompleted: stats.albumsCompleted,
        artistsMastered: stats.artistsMastered, promos: stats.promos.owned, promosTotal: stats.promos.total,
      },
      showcase: Array.from({ length: SHOWCASE_SLOTS }, (_, i) => {
        const id = user.showcase?.[i];
        const mine = id && owned.get(id);
        return mine ? { trackId: id, variant: mine.holo ? 'holo' : 'std' } : null;
      }),
      completedAlbums: keys.filter((k) => k.startsWith('album:')).sort((a, b) => achievements.get(a) - achievements.get(b)).map((k) => k.slice(6)),
      masteredArtists: keys.filter((k) => k.startsWith('artist:')).map((k) => k.slice(7)),
      albumProgress: stats.albums,
      vinyls,
    };
  }, [user, stats, achievements, owned]);
}

export default function Profile() {
  const { username } = useParams();
  const { user, applyState } = useGame();
  const { t, date, error } = useI18n();
  const navigate = useNavigate();
  const openCard = useCardModal();
  const toast = useToast();
  const own = useOwnProfile();
  const { ratings } = useGame();
  // Change dès qu'une de mes notes change : la section « Notes & critiques » se recharge alors.
  const ratingsSignature = useMemo(() => [...ratings].map(([k, v]) => `${k}=${v}`).join('|'), [ratings]);
  const isSelf = !username || username.toLowerCase() === user.username.toLowerCase();
  const [other, setOther] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [slot, setSlot] = useState(null);

  const load = useCallback(async () => {
    if (isSelf) return;
    try {
      setOther(await get(`/users/${encodeURIComponent(username)}`));
      setNotFound(false);
    } catch {
      setNotFound(true);
    }
  }, [isSelf, username]);

  useEffect(() => {
    setOther(null);
    load();
  }, [load]);

  if (!isSelf && notFound) {
    return <div className="empty-page"><p>{error('user_not_found')}</p><Link to="/friends" className="btn btn--ghost">{t('nav.friends')}</Link></div>;
  }
  const profile = isSelf ? own : other;
  if (!profile) return <div className="boot boot--inline"><Spinner /></div>;

  const removeFromShowcase = async (i) => {
    const slots = Array.from({ length: SHOWCASE_SLOTS }, (_, k) => user.showcase?.[k] || null);
    slots[i] = null;
    try {
      const res = await post('/profile/showcase', { slots });
      applyState(res.state);
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const lvl = profile.level;
  const s = profile.stats;
  const upcoming = ALBUMS.filter((a) => !profile.completedAlbums.includes(a.id) && profile.albumProgress[a.id].owned > 0)
    .sort((a, b) => profile.albumProgress[b.id].pct - profile.albumProgress[a.id].pct)
    .slice(0, profile.vinyls.length ? 2 : 3)
    .map((a) => ({ albumId: a.id, progress: profile.albumProgress[a.id] }));

  return (
    <div className="profile">
      <section className="profile-head">
        <div className="profile-head__avatar">
          <Avatar user={profile} size={120} />
          {isSelf && (
            <button type="button" className="profile-head__edit" onClick={() => setAvatarOpen(true)} aria-label={t('profile.edit')} title={t('profile.edit')}>
              <Icon name="edit" size={16} />
            </button>
          )}
        </div>
        <div className="profile-head__info">
          <h1>
            {profile.username}
            {profile.role === 'admin' && <span className="role-tag">{t('profile.admin')}</span>}
          </h1>
          <div className="level-line">
            <span className="level-chip mono">{t('profile.level', { n: lvl.level })}</span>
            <Progress value={lvl.xp - lvl.floor} max={lvl.next - lvl.floor} color="var(--cue)" size="sm" />
            <span className="small muted">{t('profile.xpToNext', { n: lvl.next - lvl.xp, l: lvl.level + 1 })}</span>
          </div>
          <p className="muted small">{t('profile.memberSince', { date: date(profile.createdAt) })}</p>
          {profile.masteredArtists.length > 0 && (
            <div className="masters">
              {profile.masteredArtists.map((id) => (
                <span key={id} className="master-tag"><Icon name="star" size={12} /> {t('artist.master', { name: ARTIST_BY_ID[id].name })}</span>
              ))}
            </div>
          )}
          {!isSelf && <FriendAction profile={profile} onChange={load} />}
        </div>
        <dl className="profile-stats">
          <div><dt>{t('profile.stats.unique')}</dt><dd className="mono">{s.unique}<small>/{s.total}</small></dd></div>
          <div><dt>{t('profile.stats.albums')}</dt><dd className="mono">{s.albumsCompleted}<small>/{ALBUMS.length}</small></dd></div>
          <div><dt>{t('profile.stats.artists')}</dt><dd className="mono">{s.artistsMastered}</dd></div>
          <div><dt>{t('profile.stats.promos')}</dt><dd className="mono">{s.promos}<small>/{s.promosTotal}</small></dd></div>
        </dl>
      </section>

      <VinylShelf
        vinyls={profile.vinyls}
        upcoming={upcoming}
        mine={isSelf}
        title={isSelf ? t('vinyl.shelf') : t('vinyl.shelfOther', { name: profile.username })}
        emptyText={isSelf ? t('vinyl.emptySelf') : t('vinyl.emptyOther')}
      />

      <section className="studio">
        <header className="studio__head">
          <h2>{isSelf ? t('studio.title') : t('studio.titleOther', { name: profile.username })}</h2>
        </header>

        <div className="studio__desk">
          <div className="studio__desk-head">
            <h3 className="studio__label">{isSelf ? t('studio.selection') : t('studio.selectionOther')}</h3>
            {isSelf && <p className="small muted">{t('studio.selectionHint')}</p>}
          </div>
          <div className="showcase">
            {profile.showcase.map((item, i) => (
              item ? (
                <div key={i} className="showcase__slot">
                  <Card trackId={item.trackId} variant={item.variant} onClick={() => openCard(item.trackId)} />
                  {isSelf && <button type="button" className="showcase__remove" onClick={() => removeFromShowcase(i)} aria-label={t('studio.remove')}><Icon name="close" size={14} /></button>}
                </div>
              ) : isSelf ? (
                <button key={i} type="button" className="showcase__empty" onClick={() => setSlot(i)}>
                  <Icon name="plus" size={22} />
                  <span>{t('studio.add')}</span>
                </button>
              ) : (
                <div key={i} className="showcase__empty showcase__empty--static"><span>{t('studio.empty')}</span></div>
              )
            ))}
          </div>
        </div>
      </section>

      <RatingsSection username={profile.username} isSelf={isSelf} refreshKey={isSelf ? ratingsSignature : profile.id} />

      {isSelf && (
        <>
          <AvatarPicker open={avatarOpen} onClose={() => setAvatarOpen(false)} />
          <ShowcasePicker slot={slot} onClose={() => setSlot(null)} />
          <div className="profile-actions">
            <button type="button" className="btn btn--ghost" onClick={() => navigate('/friends')}><Icon name="users" /> {t('nav.friends')}</button>
          </div>
        </>
      )}
    </div>
  );
}
