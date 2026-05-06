import { createHmac } from 'node:crypto';

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Алгоритм:
// 1. parse initData как URLSearchParams
// 2. вытащить hash и убрать его из набора
// 3. собрать data_check_string: пары "key=value", отсортированные по ключу, через "\n"
// 4. secret_key = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
// 5. calculated_hash = hex(HMAC_SHA256(key=secret_key, data=data_check_string))
// 6. сравнить с hash, проверить, что auth_date не старше maxAgeSec.

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
  raw: string;
}

export class InitDataError extends Error {}

export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 60 * 60 * 24,
): VerifiedInitData {
  if (!initData) throw new InitDataError('initData is empty');
  if (!botToken) throw new InitDataError('TELEGRAM_BOT_TOKEN is not configured');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new InitDataError('hash missing in initData');
  params.delete('hash');

  const pairs: string[] = [];
  Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, v]) => pairs.push(`${k}=${v}`));
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculatedHash !== hash) throw new InitDataError('hash mismatch — initData is invalid');

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate) throw new InitDataError('auth_date missing');
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > maxAgeSec) throw new InitDataError(`initData is too old (${ageSec}s)`);

  const userJson = params.get('user');
  if (!userJson) throw new InitDataError('user missing in initData');
  let user: TelegramUser;
  try {
    user = JSON.parse(userJson) as TelegramUser;
  } catch {
    throw new InitDataError('user field is not valid JSON');
  }
  if (typeof user.id !== 'number') throw new InitDataError('user.id missing or not a number');

  return { user, authDate, raw: initData };
}
