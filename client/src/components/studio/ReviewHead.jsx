// En-tête d'une critique du Studio — chantier P1-B : l'album ou le morceau noté (petite pochette + titre), et sur le
// Studio d'un autre le menu ⋯ Signaler (SafetyMenu, PLAN.md 7.2 : tout contenu de joueur se signale).
// Props : { review (entrée de GET /api/users/:u/ratings|reviews : { type, id, ratingId, … }), isSelf }.
import { RatedItemLink } from '../Rating.jsx';
import { SafetyMenu } from '../safety/SafetyMenu.jsx';

export function ReviewHead({ review, isSelf }) {
  return (
    <div className="trk-review__head st-review-head">
      <RatedItemLink type={review.type} id={review.id} className="review__author" coverClassName="review__cover" titleClassName="review__name" />
      {!isSelf && Number.isInteger(review.ratingId) && <SafetyMenu target={{ type: 'review', id: review.ratingId }} />}
    </div>
  );
}

export default ReviewHead;
