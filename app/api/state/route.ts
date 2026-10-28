import { NextResponse, type NextRequest } from 'next/server';
import { readElection } from '@/lib/election';
import { HttpError } from '@/lib/errors';
import { fail } from '@/lib/http';
import { publicView } from '@/lib/view';
import { checkTicket, deviceOf, deviceVoterKey, rememberDevice } from '@/lib/voter';

export const dynamic = 'force-dynamic';

type PassStatus = 'none' | 'valid' | 'invalid';

/**
 * Polled by every phone and by the live dashboard. Also where a browser gets
 * its device id: the first visit sets the cookie and returns the id so the
 * page can keep a second copy in localStorage.
 */
export async function GET(request: NextRequest) {
  try {
    const election = await readElection();
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
