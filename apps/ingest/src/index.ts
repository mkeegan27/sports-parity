/**
 * The site's Worker. Static files are served by Cloudflare directly; only `/data/*` reaches
 * this code, so the current season can carry live results. A cron every five minutes runs the
 * ingest, which checks ESPN only when a game is on or a periodic sweep is due.
 */
import type { Env, WaitUntil } from './env';
import { runIngest } from './ingest';
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
    ctx.waitUntil(
      runIngest(env, new Date(controller.scheduledTime), fetchText).then(
        (result) => console.log(JSON.stringify(result)),
        (error: unknown) => console.error('ingest failed', error),
      ),
    );
  },
};
