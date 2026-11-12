/**
 * The site's Worker. Static files are served by Cloudflare directly; only `/data/*` reaches
 * this code, so the current season can carry live results. A cron every five minutes runs the
 * ingest, which checks ESPN only when a game is on or a periodic sweep is due.
 */
import type { Env, WaitUntil } from './env';
import { runIngest } from './ingest';
import { LIVE_LEAGUES } from './leagues';
import { serveData } from './serve';

const fetchText = async (url: string) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.text();
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return serveData(request, env);
  },

  scheduled(controller: { scheduledTime: number }, env: Env, ctx: WaitUntil): void {
    const now = new Date(controller.scheduledTime);
    // Each league on its own, so one failing source can't hold up another.
    for (const league of LIVE_LEAGUES) {
      ctx.waitUntil(
        runIngest(env, now, fetchText, league).then(
          (result) => console.log(league.id, JSON.stringify(result)),
          (error: unknown) => console.error(`ingest failed: ${league.id}`, error),
        ),
      );
    }
  },
};
