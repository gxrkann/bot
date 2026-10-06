/**
 * Dashboard HTTP sunucusu.
 *
 * Bağımlılık yok — Node'un yerleşik http modülü kullanılıyor. Böylece
 * `npm install` sadece discord.js + dotenv çekiyor.
 *
 * Yönlendirmeler:
 *   GET  /                      → ana sayfa
 *   GET  /auth/login            → Discord OAuth yönlendirmesi
 *   GET  /auth/callback         → OAuth dönüşü
 *   POST /logout                → çıkış
 *   GET  /s/:section            → ayar sayfası
 *   POST /s/:section            → ayar kaydetme
 *   POST /api/*                 → anlık işlemler
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SECTIONS, getPath, setPath } from '../schema.js';
import { listBackups } from '../store.js';
import * as views from './views.js';
import {
  getOAuthConfig, getAllowedIds, isAllowed, createState, consumeState,
  authorizeUrl, exchangeCode, createSession, getSession, destroySession,
  parseCookies, sessionCookie, clearCookie, resolveRedirectUri
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, 'public');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const FLASH_COOKIE = 'guard_flash';

/* ------------------------------------------------------------------ *
 * Sunucu
 * ------------------------------------------------------------------ */

export function createDashboard(client) {
  // dashboard/ modülü, istemciyi burada değil çağıran kod hazırlar. Test
  // aracları ve olası alternatif giriş noktaları için güvenli varsayılan.
  if (!client.guardSettings) client.guardSettings = new Map();

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(client, req, res);
    } catch (error) {
      console.error('Dashboard hatası:', error);
      send(res, 500, '<h1>500</h1><p>Sunucu hatası. Detaylar konsola yazıldı.</p>');
    }
  });

  return server;
}

async function handleRequest(client, req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const cookies = parseCookies(req.headers.cookie);

  /* Panel arkasındayken gerçek adres x-forwarded-* başlıklarında gelir.
     Bunu OAuth redirect URI tahmininde kullanıyoruz. */
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeader(req.headers['x-forwarded-host']) || req.headers.host;
  const redirectUri = resolveRedirectUri(forwardedHost, forwardedProto);

  /* --- Statik dosyalar --- */
  if (url.pathname.startsWith('/static/')) {
    return serveStatic(url.pathname, res);
  }

  /* --- Çerez ısıtma (iframe engelleme) --- */
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  /* --- OAuth --- */
  if (url.pathname === '/auth/login') return handleLogin(req, res, redirectUri);
  if (url.pathname === '/auth/callback') return handleCallback(client, req, res, url, redirectUri);
  if (url.pathname === '/logout' && req.method === 'POST') {
    destroySession(cookies.guard_session);
    return send(res, 302, '', { 'Set-Cookie': clearCookie(), Location: '/auth/login' });
  }

  /* --- Yetkilendirme --- */
  const session = getSession(cookies.guard_session);
  if (!session) {
    return send(res, 302, '', { Location: '/auth/login' });
  }

  /* Giriş yapmış ama izinli değilse (izin listesi sonradan değişmiş olabilir). */
  if (!isAllowed(session.userId)) {
    destroySession(cookies.guard_session);
    return send(res, 403, '<h1>403</h1><p>Bu panele erişim yetkiniz yok.</p>');
  }

  const flash = readFlash(cookies);
  const clearFlash = { 'Set-Cookie': `${FLASH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` };

  /* --- Ayarlar sayfaları --- */
  const sectionMatch = url.pathname.match(/^\/s\/([a-z]+)$/);
  if (sectionMatch) {
    const sectionId = sectionMatch[1];
    const section = SECTIONS.find((item) => item.id === sectionId);
    if (!section) return send(res, 404, views.notFoundPage());

    const guildId = url.searchParams.get('guild') || [...client.guardSettings.keys()][0] || client.guilds.cache.first()?.id;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return send(res, 400, '<h1>Sunucu bulunamadı</h1><p>Bot bu sunucuda değil.</p>');

    const { getGuildSettings } = await import('../guard-utils.js');
    const settings = getGuildSettings(client, guildId);

    const options = { guildOptions: collectGuildOptions(guild) };

    if (req.method === 'POST') {
      return handleSave(client, req, res, { guildId, section, url, options });
    }

    /* Okuma sayfası */
    let body;
    const extra = {};

    switch (section.id) {
      case 'overview': {
        const { getHeatSnapshot } = await import('../heat.js');
        const { getQuarantined } = await import('../anti-nuke.js');
        const { getJoinStats } = await import('../join-raid.js');
        body = views.overviewPage({
          section, guild, settings,
          stats: {
            quarantined: getQuarantined(guildId).length,
            heatTop: getHeatSnapshot(guildId, settings.heat),
            botRoleTop: isBotRoleTop(guild),
            joinStats: getJoinStats(guildId, settings.joinRaid.windowMs)
          }
        });
        break;
      }
      case 'actions': {
        const { getQuarantined } = await import('../anti-nuke.js');
        body = views.actionsPage({
          section, settings,
          quarantined: getQuarantined(guildId),
          backups: await listBackups(guildId)
        });
        break;
      }
      case 'suspects': {
        body = views.suspectsPage({ section, suspects: settings.suspects || [] });
        break;
      }
      default: {
        body = views.settingsPage({
          section, settings,
          guildOptions: options.guildOptions
        });
        break;
      }
    }
    void extra;

    const html = views.layout({
      title: section.title,
      activeSection: section.id,
      sections: SECTIONS,
      body,
      session,
      flash
    });
    return send(res, 200, html, flash ? clearFlash : {});
  }

  /* --- Anlık işlemler --- */
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    return handleApiAction(client, req, res, url);
  }

  /* --- Ana sayfa: ilk sunucuya yönlendir --- */
  if (url.pathname === '/') {
    const first = client.guilds.cache.first();
    if (!first) return send(res, 200, '<h1>Sunucu yok</h1><p>Bot hiçbir sunucuda değil.</p>');
    return send(res, 302, '', { Location: `/s/overview?guild=${first.id}` });
  }

  send(res, 404, views.notFoundPage());
}

/* ------------------------------------------------------------------ *
 * OAuth
 * ------------------------------------------------------------------ */

function handleLogin(req, res, redirectUri) {
  const config = getOAuthConfig();
  if (!config) {
    return send(res, 200, views.loginPage({
      error: 'Dashboard OAuth yapılandırılmamış.',
      hasDiscordLink: false
    }));
  }
  if (!getAllowedIds().length) {
    return send(res, 403, views.loginPage({
      error: 'DASHBOARD_ALLOWED_IDS boş. Panele kimse erişemez (güvenlik için kapalı).',
      hasDiscordLink: false
    }));
  }
  const state = createState('/');
  send(res, 302, '', { Location: authorizeUrl(state, redirectUri) });
}

async function handleCallback(client, req, res, url, redirectUri) {
  const config = getOAuthConfig();
  if (!config) return send(res, 500, '<h1>OAuth yapılandırılmamış</h1>');

  const error = url.searchParams.get('error');
  if (error) {
    return send(res, 200, views.loginPage({
      error: `Discord girişi reddetti: ${error}`,
      hasDiscordLink: true
    }));
  }

  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) return send(res, 400, '<h1>Eksik parametre</h1>');

  const consumed = consumeState(state);
  if (!consumed.ok) {
    return send(res, 400, views.loginPage({ error: consumed.error, hasDiscordLink: true }));
  }

  let identity;
  try {
    identity = await exchangeCode(code, redirectUri);
  } catch (err) {
    return send(res, 400, views.loginPage({
      error: `Token alınamadı: ${err.message}`,
      hasDiscordLink: true
    }));
  }

  if (!isAllowed(identity.user.id)) {
    console.warn(`⛔ Dashboard girişi reddedildi: ${identity.user.username} (${identity.user.id})`);
    return send(res, 403, views.loginPage({
      error: 'Bu hesap panele erişim yetkisine sahip değil.',
      hasDiscordLink: true
    }));
  }

  const sessionId = createSession(identity.user);
  send(res, 302, '', {
    'Set-Cookie': sessionCookie(sessionId),
    Location: consumed.redirectTo || '/'
  });
}

/* ------------------------------------------------------------------ *
 * Kaydetme
 * ------------------------------------------------------------------ */

/**
 * Form verisini ayarlara uygular ve diske yazar.
 * Durum renkli geri bildirim çerezi ile döner.
 */
async function handleSave(client, req, res, { guildId, section, url, options }) {
  const { getGuildSettings, saveGuildSettings } = await import('../guard-utils.js');
  const settings = getGuildSettings(client, guildId);

  const raw = await readBody(req);
  const form = new URLSearchParams(raw);

  const applied = applyForm(section, settings, form, options);

  await saveGuildSettings(client, guildId, settings);

  console.log(`💾 Dashboard: ${url.pathname} güncellendi (${applied} alan)`);

  return send(res, 302, '', {
    'Set-Cookie': flashCookie('success', `${applied} ayar kaydedildi.`),
    Location: `${url.pathname}?guild=${guildId}`
  });
}

/**
 * Sadece şemada tanımlı alanları kabul eder.
 * Bilinmeyen anahtarlar yok sayılır — istemciden gelen veri ayarlara sızmaz.
 */
function applyForm(section, settings, form) {
  let count = 0;

  const applyField = (field) => {
    const rawValue = form.get(field.name);
    if (rawValue === null) {
      // Boolean alanlar form gönderilmediğinde false olur.
      if (field.type === 'boolean') setPath(settings, field.name, false);
      return;
    }

    switch (field.type) {
      case 'boolean':
        setPath(settings, field.name, rawValue === 'on' || rawValue === 'true');
        break;
      case 'number': {
        let num = Number(rawValue);
        if (!Number.isFinite(num)) num = 0;
        if (field.min != null) num = Math.max(field.min, num);
        if (field.max != null) num = Math.min(field.max, num);
        setPath(settings, field.name, num);
        break;
      }
      case 'duration': {
        const unit = form.get(`${field.name}__unit`) || 'minute';
        const amount = Math.max(0, Number(rawValue) || 0);
        const multiplier = unit === 'day' ? 86400000 : unit === 'hour' ? 3600000 : 60000;
        setPath(settings, field.name, amount * multiplier);
        break;
      }
      case 'select':
        if ((field.options || []).includes(rawValue)) setPath(settings, field.name, rawValue);
        break;
      case 'channel':
      case 'role':
      case 'text':
        setPath(settings, field.name, String(rawValue).trim());
        break;
      case 'roleMulti':
      case 'list': {
        const values = form.getAll(field.name)
          .flatMap((value) => String(value).split(','))
          .map((value) => value.trim())
          .filter(Boolean);
        setPath(settings, field.name, [...new Set(values)]);
        break;
      }
      default:
        setPath(settings, field.name, rawValue);
    }
    count++;
  };

  /* Bölüm alanları */
  for (const field of section.fields || []) {
    if (field.name.endsWith('__unit')) continue;
    applyField(field);
  }

  /* Grup alanları */
  for (const group of section.groups || []) {
    if (group.actionFilter) {
      const prefix = group.id === 'panic' ? 'antiNuke.panic' : `joinGate.${group.id}`;
      applyField({ name: `${prefix}.enabled`, type: 'boolean' });
      applyField({ name: `${prefix}.action`, type: 'select', options: ['log', 'timeout', 'kick', 'ban', 'quarantine'] });
    }
    if (group.heatFilter !== undefined) {
      applyField({ name: `heat.filters.${group.id}.enabled`, type: 'boolean' });
      if (group.heatFilter === false) {
        applyField({ name: `heat.filters.${group.id}.action`, type: 'select', options: ['timeout', 'kick', 'ban'] });
      } else {
        applyField({ name: `heat.filters.${group.id}.heat`, type: 'number', min: 0, max: 200 });
      }
    }
    if (group.listPath) {
      applyField({ name: group.listPath, type: 'list' });
    }
    for (const field of group.fields || []) {
      applyField(field);
    }
  }

  /* Anti-Nuke limit tablosu */
  if (section.limits) {
    for (const action of section.limits.actions) {
      applyField({ name: `antiNuke.minuteLimit.${action}`, type: 'number', min: 1, max: 100 });
      applyField({ name: `antiNuke.hourLimit.${action}`, type: 'number', min: 1, max: 500 });
    }
  }

  /* Beyaz liste */
  if (section.whitelistTypes) {
    for (const type of section.whitelistTypes) {
      for (const kind of ['users', 'roles', 'channels', 'categories', 'webhooks']) {
        applyField({ name: `whitelist.${type.id}.${kind}`, type: 'list' });
      }
    }
  }

  return count;
}

/* ------------------------------------------------------------------ *
 * Anlık işlemler
 * ------------------------------------------------------------------ */

async function handleApiAction(client, req, res, url) {
  const raw = await readBody(req);
  const form = new URLSearchParams(raw);
  const action = url.pathname.replace('/api/', '');
  const guildId = form.get('guild') || [...client.guardSettings.keys()][0] || client.guilds.cache.first()?.id;
  const guild = client.guilds.cache.get(guildId);

  const back = (message, type = 'success') => send(res, 302, '', {
    'Set-Cookie': flashCookie(type, message),
    Location: `/s/actions?guild=${guildId}`
  });

  if (!guild) return back('Sunucu bulunamadı.', 'error');

  const { getGuildSettings, saveGuildSettings } = await import('../guard-utils.js');
  const settings = getGuildSettings(client, guildId);
  const enable = form.get('enable') === 'true';

  switch (action) {
    case 'emergency': {
      const { enableEmergencyMode, disableEmergencyMode } = await import('../emergency.js');
      if (enable) await enableEmergencyMode(client, guild);
      else await disableEmergencyMode(client, guild);
      return back(enable ? 'Acil durum modu açıldı.' : 'Acil durum modu kapatıldı.', enable ? 'error' : 'success');
    }

    case 'lockdown': {
      const { triggerLockdown, releaseLockdown } = await import('../lockdown.js');
      if (enable) {
        const result = await triggerLockdown(client, guild);
        return back(`Kilit açıldı: ${result.locked} kanal.`, 'error');
      }
      const result = await releaseLockdown(client, guild);
      return back(`Kilit kapatıldı: ${result.unlocked} kanal geri yüklendi.`);
    }

    case 'panic': {
      const { triggerPanicMode, stopPanicMode } = await import('../anti-nuke.js');
      if (enable) {
        const result = await triggerPanicMode(client, guild, 'Dashboard üzerinden manuel tetikleme');
        return back(`Panik modu başlatıldı. ${result.quarantined} kullanıcı karantinelendi.`, 'error');
      }
      const result = await stopPanicMode(client, guild);
      return back(`Panik modu bitti. ${result.released} kullanıcı serbest bırakıldı.`);
    }

    case 'release-all': {
      const { releaseAll } = await import('../anti-nuke.js');
      const count = await releaseAll(client, guild);
      return back(`${count} kullanıcı karantinadan çıkarıldı.`);
    }

    case 'backup/create': {
      const { createBackup } = await import('../backup.js');
      const file = await createBackup(client, guild, settings, 'dashboard');
      return back(file ? `Yedek alındı: ${file}` : 'Yedek alınamadı.', file ? 'success' : 'error');
    }

    case 'backup/restore': {
      const { restoreBackup } = await import('../backup.js');
      const file = form.get('file');
      const result = await restoreBackup(client, guild, file, {
        deleteUnknown: form.get('deleteUnknown') === 'true',
        restoreSettings: false
      });
      if (!result.ok) return back(result.error, 'error');
      return back(`Geri yükleme: ${result.channelsCreated} kanal +${result.rolesCreated} rol oluşturuldu, ${result.channelsRenamed + result.rolesUpdated} güncellendi.`);
    }

    case 'suspects/remove': {
      const { removeSuspect } = await import('../guard-utils.js');
      const userId = form.get('userId');
      if (!userId) return back('Kullanıcı belirtilmedi.', 'error');
      await removeSuspect(client, guildId, userId);
      return back('Kullanıcı listeden çıkarıldı.');
    }

    default:
      return back('Bilinmeyen işlem.', 'error');
  }

  void settings;
  void saveGuildSettings;
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

function collectGuildOptions(guild) {
  return {
    channels: guild.channels.cache
      .filter((channel) => channel.type !== 4)
      .map((channel) => ({ id: channel.id, name: channel.name, hint: channel.type === 0 ? 'metin' : 'kanal' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: guild.roles.cache
      .filter((role) => !role.managed && role.id !== guild.id)
      .map((role) => ({ id: role.id, name: role.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

function isBotRoleTop(guild) {
  const me = guild.members.me;
  if (!me) return false;
  const highest = guild.roles.cache
    .filter((role) => !role.managed)
    .sort((a, b) => b.position - a.position)[0];
  if (!highest) return false;
  return me.roles.highest.comparePositionTo(highest) > 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // 1 MB sınırı — dashboard formları bu kadarını aşmamalı.
      if (data.length > 1_000_000) {
        reject(new Error('Gövde çok büyük'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** "https,http" gibi virgüllü başlıkların ilk değerini alır. */
function firstHeader(value) {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw).split(',')[0].trim();
}

function send(res, status, body, headers = {}) {
  const isRedirect = status === 302;
  res.writeHead(status, {
    'Content-Type': isRedirect ? 'text/plain' : 'text/html; charset=utf-8',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': isRedirect ? 'no-store' : 'no-store',
    ...headers
  });
  res.end(body || '');
}

async function serveStatic(pathname, res) {
  const name = path.basename(pathname);
  const file = path.join(staticDir, name);
  const ext = path.extname(name);

  try {
    const content = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}

function flashCookie(type, message) {
  const value = encodeURIComponent(JSON.stringify({ type, message }));
  return `${FLASH_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=30`;
}

function readFlash(cookies) {
  const raw = cookies[FLASH_COOKIE];
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export { getPath, setPath };
