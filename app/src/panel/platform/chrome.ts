/**
 * Thin promise wrappers over the chrome.* APIs the panel uses. Every
 * other module goes through these, so nothing else touches `chrome`
 * directly (and tests can stub one module).
 */

export function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => resolve(data?.[key] as T | undefined));
  });
}

export function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(values, () => resolve()));
}

export function storageRemove(keys: string | string[]): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}

export function onStorageChange(key: string, listener: (value: unknown) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && key in changes) listener(changes[key].newValue);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export async function sessionGet<T>(key: string): Promise<T | undefined> {
  const data = await chrome.storage.session.get(key);
  return data?.[key] as T | undefined;
}

export function sessionSet(values: Record<string, unknown>): Promise<void> {
  return chrome.storage.session.set(values);
}

/** Read and clear a one-shot value in session storage. */
export async function takeSessionValue<T>(key: string): Promise<T | undefined> {
  const data = await chrome.storage.session.get(key);
  if (data?.[key] === undefined) return undefined;
  await chrome.storage.session.remove(key);
  return data[key] as T;
}

/** Message the service worker; resolves undefined when nobody answered. */
export function sendToWorker<T>(message: Record<string, unknown>): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(undefined);
      else resolve(response as T);
    });
  });
}

export type RuntimeMessage = { action?: string; [key: string]: unknown };

export function onRuntimeMessage(listener: (message: RuntimeMessage) => void): () => void {
  const handler = (message: RuntimeMessage) => {
    listener(message);
    return false;
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

export function onTabActivated(listener: () => void): () => void {
  const handler = () => listener();
  chrome.tabs.onActivated.addListener(handler);
  return () => chrome.tabs.onActivated.removeListener(handler);
}

export async function activeTabUrl(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

export function openTab(url: string): void {
  chrome.tabs.create({ url });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function extensionUrl(path: string): string {
  return chrome.runtime.getURL(path);
}
