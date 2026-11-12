import { NextResponse, type NextRequest } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { inSession, readElection } from '@/lib/election';
import { HttpError } from '@/lib/errors';
import { fail } from '@/lib/http';
import { guestView, publicView } from '@/lib/view';
import { checkTicket, deviceOf, deviceVoterKey, rememberDevice } from '@/lib/voter';

export const dynamic = 'force-dynamic';

type PassStatus = 'none' | 'valid' | 'invalid';

/**
 * Polled by every phone and by the Live screen.
 *
 * Only the admin and guests who joined the open session (by its QR code) get
 * the show; everyone else gets the holding page and no device id, so an early
 * arrival is not a voter at all. Joined guests get their device id here: the
 * first visit sets the cookie and returns the id for a second copy in storage.
 */
export async function GET(request: NextRequest) {
  try {
    const election = await readElection();
    if (isAdmin(request.headers.get('x-admin-token'))) {
      return NextResponse.json({ ...publicView(election, null), pass: 'none', device: null });
    }
    if (!inSession(election, request.headers.get('x-session'))) {
      return NextResponse.json(guestView(election));
    }

    const device = deviceOf(request);
    let voterKey: string | null = null;
    let pass: PassStatus = 'none';
    if (election.mode === 'device') {
      voterKey = deviceVoterKey(device.id);
    } else if (request.headers.get('x-ticket')) {
      try {
        voterKey = `t:${await checkTicket(request, election)}`;
        pass = 'valid';
      } catch (error) {
        if (!(error instanceof HttpError) || error.status === 429) throw error;
        pass = 'invalid';
      }
    }

    const response = NextResponse.json({
      ...publicView(election, voterKey),
      pass,
      device: device.id,
    });
    if (device.fresh) rememberDevice(request, response, device.id);
    return response;
  } catch (error) {
    return fail(error);
  }
}
