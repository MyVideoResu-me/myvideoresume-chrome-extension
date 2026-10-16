/**
 * content-script-posts — detects a single social post on its own page
 * (LinkedIn post / feed-update pages, X status pages) so the panel can
 * offer a video reply. Feeds with many posts are not guessed at: there the
 * person selects the post's text and uses "Use my selection".
 */
import { announceCleared, announceDetected } from "../../../shared/detection-bus";
import { readPost, type PostPayload } from "./post-parsers";

declare global {
  interface Window {
    __hiredVideoPostsInstalled?: boolean;
  }
}

if (!window.__hiredVideoPostsInstalled) {
  window.__hiredVideoPostsInstalled = true;

  let lastKey: string | null = null;
  let lastUrl = window.location.href;

  const send = (msg: Record<string, unknown>) => {
    try {
      void chrome.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      /* extension reloaded — ignore */
    }
  };

  const detect = (): PostPayload | null => readPost(document, window.location);

  const scan = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (lastKey) {
        lastKey = null;
        send({ action: "postCleared" });
        announceCleared();
      }
    }
    const post = detect();
    if (!post) return;
    const key = `${post.sourceUrl}|${post.text.slice(0, 80)}`;
    if (key === lastKey) return;
    lastKey = key;
    send({ action: "postDetected", payload: post });
    announceDetected("post", post);
  };

  [700, 2000, 4000].forEach((ms) => setTimeout(scan, ms));
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      scan();
    }, 2000);
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== "detectPost") return false;
    sendResponse({ payload: detect(), originUrl: window.location.href });
    return false;
  });
}
