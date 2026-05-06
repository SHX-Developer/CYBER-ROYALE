// Тонкая обёртка над fetch для общения с backend.
// Базовый URL берётся из VITE_API_URL, по умолчанию — localhost:3000.

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const RETRY_COUNT = 1;
const RETRY_DELAY_MS = 600;

/**
 * fetch с одним повтором на сетевую ошибку или 5xx — чтобы транзиентный
 * connect refused от nginx во время перезапуска backend не ронял UI.
 */
async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status >= 500 && attempt < RETRY_COUNT) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_COUNT) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
    }
  }
  throw lastError ?? new Error('network error');
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, { method: 'GET' });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
