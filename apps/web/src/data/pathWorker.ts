/// <reference lib="webworker" />
// Runs the fastest-path search off the main thread (round 11): up to about a second in bad
// weeks, so the ring keeps animating while it works.
import { answer, type PathReply, type PathRequest } from './fastest';

const scope = self as unknown as { postMessage(reply: PathReply): void };

self.addEventListener('message', (e: MessageEvent<PathRequest>) => {
  answer(e.data, (reply) => scope.postMessage(reply));
});
