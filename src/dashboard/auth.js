/**
 * Dashboard oturum yönetimi — Discord OAuth2 ile giriş.
 *
 * Erişim bir "izin listesi" ile sınırlıdır: DASHBOARD_ALLOWED_IDS içindeki
 * Discord kullanıcıları giriş yapabilir. Boşsa giriş tamamen kapalıdır
 * (fail-closed) — yanlışlıkla herkese açık bir panel açılmaz.
 *
 * Oturumlar RAM'de tutulur, çerez httpOnly + sameSite=strict.
 */
import crypto from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

/** state -> { userId, createdAt, redirectTo } (CSRF koruması) */
const oauthStates = new Map();
/** sessionId -> { userId, tag, createdAt, expiresAt } */
const sessions = new Map();

/* ------------------------------------------------------------------ *
 * Yapılandırma
 * ------------------------------------------------------------------ */

export function getOAuthConfig() {
  const clientId = process.env.DASHBOARD_CLIENT_ID || '';
  const clientSecret = process.env.DASHBOARD_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.DASHBOARD_REDIRECT_URI || ''
  };
}

/**
 * İstekten redirect URI tahmin eder.
 *
 * Panel (bot-hosting.net gibi) botu bir subdomain arkasında çalıştırır ve
 * istekler proxy üzerinden gelir. Bu durumda gerçek adres isteğin
 * Host başlığındadır. DASHBOARD_REDIRECT_URI yoksa buradan üretiyoruz.
 *
 * Uyarı: Host başlığı istemciden gelir, bu yüzden tahmin edilen değer
 * Discord redirect URI listesiyle eşleşmezse giriş başarısız olur.
 * DASHBOARD_REDIRECT_URI'yi elle doğru ayarlamak en güvenlisi.
 *
 * @param {string} hostHeader  req.headers.host
 * @param {string} [forwardedProto] x-forwarded-proto başlığı
 */
export function guessRedirectUri(hostHeader, forwardedProto) {
  if (!hostHeader) return '';
  // Host başlığındaki portu temizle (443 varsayılan olduğu için).
  const host = String(hostHeader).replace(/:\d+$/, '');
  const protocol = forwardedProto || (process.env.DASHBOARD_TRUST_PROXY === 'true' ? 'https' : 'http');
  return `${protocol}://${host}/auth/callback`;
}

/** Etkin redirect URI: elle ayarlanmış varsa o, yoksa istekten tahmin. */
export function resolveRedirectUri(hostHeader, forwardedProto) {
  const config = getOAuthConfig();
  if (!config) return '';
  if (config.redirectUri) return config.redirectUri;
  return guessRedirectUri(hostHeader, forwardedProto);
}

/**
 * Panele girebilecek kullanıcı ID'leri.
 * @returns {string[]}
 */
export function getAllowedIds() {
  const raw = [
    process.env.DASHBOARD_ALLOWED_IDS,
    process.env.OWNER_ID,
    process.env.OWNER_ID_2,
    process.env.OWNER_IDS
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean));

  return [...new Set(raw)];
}

export function isAllowed(userId) {
  return getAllowedIds().includes(String(userId));
}

/* ------------------------------------------------------------------ *
 * OAuth akışı
 * ------------------------------------------------------------------ */

export function createState(redirectTo = '/') {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { createdAt: Date.now(), redirectTo });
  return state;
}

/**
 * @returns {{ ok:boolean, error?:string, redirectTo?:string }}
 */
export function consumeState(state) {
  const entry = oauthStates.get(state);
  oauthStates.delete(state);
  if (!entry) return { ok: false, error: 'Geçersiz veya süresi dolmuş durum.' };
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return { ok: false, error: 'Durum anahtarı süresi doldu. Tekrar deneyin.' };
  return { ok: true, redirectTo: entry.redirectTo };
}

export function authorizeUrl(state, redirectUri) {
  const config = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: 'identify guilds',
    state
  });
  // Discord, redirect_uri parametresi verilmezse kayıtlı olanı kullanır.
  // Yanlış adres göndermek "redirect_uri_mismatch" hatası verir, o yüzden
  // yalnızca kesin bildiğimizde gönderiyoruz.
  if (redirectUri) params.set('redirect_uri', redirectUri);
  return `https://discord.com/oauth2/authorize?${params}`;
}

/**
 * Yetkilendirme kodunu token ile değiştirir ve kullanıcı bilgisini alır.
 */
export async function exchangeCode(code, redirectUri) {
  const config = getOAuthConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code
  });
  if (redirectUri) body.set('redirect_uri', redirectUri);

  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!tokenResponse.ok) {
    throw new Error(`Token değişimi başarısız (${tokenResponse.status}): ${await tokenResponse.text()}`);
  }

  const { access_token: accessToken } = await tokenResponse.json();

  const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!userResponse.ok) {
    throw new Error(`Kullanıcı bilgisi alınamadı (${userResponse.status})`);
  }

  return { user: await userResponse.json(), accessToken };
}

/* ------------------------------------------------------------------ *
 * Oturumlar
 * ------------------------------------------------------------------ */

export function createSession(user) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(id, {
    userId: user.id,
    tag: user.username,
    globalName: user.global_name || null,
    avatar: user.avatar || null,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  });
  return id;
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function destroySession(sessionId) {
  if (sessionId) sessions.delete(sessionId);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(sessionId) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `guard_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return 'guard_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

/** Süresi geçmiş oturumları ve state'leri temizler. */
export function startCleanupTimer() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now > session.expiresAt) sessions.delete(id);
    }
    for (const [state, entry] of oauthStates.entries()) {
      if (now - entry.createdAt > STATE_TTL_MS) oauthStates.delete(state);
    }
  }, 300000);
  if (timer.unref) timer.unref();
  return timer;
}

export { SESSION_TTL_MS };
