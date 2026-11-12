import { NextResponse, type NextRequest } from 'next/server';
import { castVote, inSession, isPollId, readElection, updateElection } from '@/lib/election';
import { HttpError } from '@/lib/errors';
import { fail, readJson } from '@/lib/http';
import { publicView } from '@/lib/view';
import { deviceOf, identify, rememberDevice } from '@/lib/voter';

export const dynamic = 'force-dynamic';

const notInvited = () =>
  new HttpError(403, 'This vote is only open to guests who scanned the QR code at the event');

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request, 2_000);
    if (!isPollId(body.poll)) throw new HttpError(400, 'Unknown vote');

    // Who is voting is worked out before taking the lock (it may consult the
    // rate limiter), then re-checked against the fresh state inside it.
    const snapshot = await readElection();
    const session = request.headers.get('x-session');
    if (!inSession(snapshot, session)) throw notInvited();
    const voter = await identify(request, snapshot);

    const { election, result: nominee } = await updateElection((draft) => {
      if (!inSession(draft, session)) throw notInvited();
      if (draft.mode !== snapshot.mode) {
        throw new HttpError(409, 'The voting rules just changed — reload the page');
      }
      if (voter.ticket && !draft.tickets[voter.ticket]) {
        throw new HttpError(403, 'That pass code is no longer valid');
      }
      return castVote(
        draft,
        body.poll as 'king' | 'queen',
        body.nomineeId,
        voter.key,
        voter.ticket,
      );
    });

    const response = NextResponse.json({
      ...publicView(election, voter.key),
      votedFor: nominee.name,
    });
    const device = deviceOf(request);
    if (device.fresh) rememberDevice(request, response, device.id);
    return response;
  } catch (error) {
    return fail(error);
  }
}
