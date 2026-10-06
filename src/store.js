/**
 * Kalıcı veri katmanı.
 *
 * Önceki sürümde her ayar değişikliğinde settings.json dosyasının tamamı
 * baştan yazılıyordu. Dashboard eşzamanlı isteklerde (birden fazla tarayıcı,
 * bot ve dashboard aynı anda yazıyor) dosyanın yarım kalma riski vardı.
 *
 * Burada:
 *  - Yazmalar kuyruğa alınır, aynı anda tek yazma olur.
 *  - Yazma önce geçici dosyaya yapılır, sonra rename ile yerine taşınır
 *    (atomik). Yarım kalmış settings.json olmaz.
 *  - Çok hızlı ardışık değişiklikler birleştirilir (debounce).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, '..', 'data');
const settingsFile = path.join(storageDir, 'settings.json');
const backupsDir = path.join(storageDir, 'backups');

const WRITE_DEBOUNCE_MS = 150;
const MAX_BACKUPS = 40;

/* ------------------------------------------------------------------ *
 * Şema
 * ------------------------------------------------------------------ */

export function createDefaultSettings() {
  return {
    /* --- Genel --- */
    enabled: true,
    securityLevel: 'high',
    logChannelId: '',
    modLogChannelId: '',
    mainChannelId: '',
    ownerImmune: true,
    deleteDaysOnBan: 0,

    /* --- Statics / roller --- */
    safeUsers: [],
    safeRoles: [],
    safeBots: [],
    mainRoleIds: [],
    quarantineRoleId: '',
    trustedRoleId: '',
    reviewRoleId: '',
    suspectRoleId: '',

    /* --- Acil durum --- */
    emergencyMode: false,
    lockdown: false,
    panicMode: false,
    /** Kilit sırasında alınan @everyone izin snapshot'ı (kalıcı). */
    lockdownSnapshots: {},

    /* --- Join Gate --- */
    joinGate: {
      enabled: true,
      noAvatar: { enabled: false, action: 'log' },
      newAccount: { enabled: true, action: 'timeout', minAgeDays: 7 },
      botAddition: { enabled: true, action: 'kick' },
      unverifiedBot: { enabled: true, action: 'kick' },
      advertisingName: { enabled: true, action: 'ban' },
      suspiciousAccount: { enabled: true, action: 'timeout' },
      username: {
        enabled: true,
        action: 'log',
        punishOnMatch: false,
        words: ['fivem', 'five m', 'gta', 'gta5', 'mta', 'mtasa', 'server', 'steam']
      }
    },

    /* --- Heat (otomatik moderasyon) --- */
    heat: {
      enabled: true,
      maxHeat: 100,
      decayPerSecond: 4,
      webhookHeat: true,
      resetHeatOnTimeout: true,
      multiplier: true,
      strikesCap: 5,
      timeoutDurationMs: 600000,
      capTimeoutDurationMs: 604800000,
      filters: {
        message: { enabled: true, heat: 18 },
        repetition: { enabled: true, heat: 25 },
        emoji: { enabled: true, heat: 6, maxPerMessage: 5 },
        characters: { enabled: true, heat: 4, perChar: 0.02, max: 60 },
        newLine: { enabled: true, heat: 5, max: 4 },
        mentions: { enabled: true, heat: 12, member: 6, role: 10, everyone: 100, max: 40 },
        attachments: { enabled: true, heat: 15, max: 3 },
        advertisement: { enabled: true, heat: 100 },
        nsfw: { enabled: true, heat: 80 },
        malicious: { enabled: true, heat: 100 },
        words: { enabled: true, heat: 70, list: [] },
        links: { enabled: true, action: 'timeout', list: [] },
        inactiveChannel: { enabled: false, heat: 30, minActivityPerMinute: 3 }
      }
    },

    /* --- Anti-Nuke --- */
    antiNuke: {
      enabled: true,
      /** Dakika bazlı limitler: eşik aşılırsa saldırgan karantinelenir. */
      minuteLimit: { channelCreate: 3, channelDelete: 3, roleCreate: 3, roleDelete: 3, ban: 4, kick: 4, webhookCreate: 2, webhookDelete: 2 },
      hourLimit: { channelCreate: 8, channelDelete: 8, roleCreate: 8, roleDelete: 8, ban: 12, kick: 12, webhookCreate: 5, webhookDelete: 5 },
      action: 'quarantine',
      quarantineHold: true,
      strictMode: false,
      monitorPublicRoles: true,
      monitorChannelPermissions: true,
      vanityProtection: true,
      panic: {
        enabled: false,
        lockServer: true,
        autoUnlock: true,
        durationMs: 600000,
        quarantineRaiders: true,
        warnRoleIds: []
      }
    },

    /* --- Join Raid --- */
    joinRaid: {
      enabled: false,
      count: 10,
      windowMs: 600000,
      accountType: 'suspicious',
      action: 'timeout',
      warnRoleIds: [],
      quarantineRaiders: true,
      flags: {
        string: { enabled: true, rules: [] },
        age: { enabled: true, maxAgeDays: 2 },
        noAvatar: { enabled: true },
        id: { enabled: true, granularity: 'adaptive', marginMs: 86400000, minMatches: 5 }
      }
    },

    /* --- Verification --- */
    verification: {
      enabled: false,
      action: 'quarantine',
      target: 'suspicious',
      mode: 'button',
      durationMs: 300000,
      channelId: '',
      note: ''
    },

    /* --- Backups / Restore --- */
    backups: {
      enabled: false,
      intervalMs: 10800000,
      keep: 20,
      /* Varsayılan kapalı: geri yükleme yedekte olmayan kanalları SİLER.
         İlk kullanımda yanlışlıkla veri kaybı olmasın. */
      autoRestoreOnPanic: false
    },

    /* --- Whitelist (Wick'teki tip bazlı beyaz liste) --- */
    whitelist: {
      spamming: { users: [], roles: [], channels: [], categories: [], webhooks: [] },
      mentions: { users: [], roles: [], channels: [], categories: [], webhooks: [] },
      invites: { users: [], roles: [], channels: [], categories: [], webhooks: [] },
      publicRoles: { users: [], roles: [], channels: [], categories: [], webhooks: [] },
      quarantine: { users: [], roles: [], channels: [], categories: [], webhooks: [] },
      permitRoles: []
    },

    /* --- Eski ayarlar (uyumluluk) --- */
    antiSpam: true,
    antiInvite: true,
    suspiciousAccountThresholdDays: 7,
    punishNewAccounts: true,
    punishKeywordMatches: false,
    actionThreshold: 5,
    actionWindowMs: 10000,
    autoDeleteSuspiciousChannels: true,
    autoDeleteSuspiciousRoles: true,
    autoDeleteSuspiciousMessages: true,
    autoTimeoutSuspiciousUsers: true,
    autoKickUnapprovedBots: true,
    suspects: []
  };
}

/** Kaydedilmiş ayarları varsayılanlarla birleştirir (yeni alanlar otomatik gelir). */
export function withDefaults(saved) {
  const base = createDefaultSettings();
  if (!saved || typeof saved !== 'object') return base;

  const merged = { ...base, ...saved };

  // İç nesneler de tek tek birleştirilir, yoksa eski kayıt yeni alanları siler.
  merged.joinGate = { ...base.joinGate, ...(saved.joinGate || {}) };
  for (const key of Object.keys(base.joinGate)) {
    if (base.joinGate[key] && typeof base.joinGate[key] === 'object') {
      merged.joinGate[key] = { ...base.joinGate[key], ...((saved.joinGate || {})[key] || {}) };
    }
  }

  merged.heat = { ...base.heat, ...(saved.heat || {}) };
  merged.heat.filters = { ...base.heat.filters, ...((saved.heat || {}).filters || {}) };

  merged.antiNuke = { ...base.antiNuke, ...(saved.antiNuke || {}) };
  merged.antiNuke.minuteLimit = { ...base.antiNuke.minuteLimit, ...((saved.antiNuke || {}).minuteLimit || {}) };
  merged.antiNuke.hourLimit = { ...base.antiNuke.hourLimit, ...((saved.antiNuke || {}).hourLimit || {}) };
  merged.antiNuke.panic = { ...base.antiNuke.panic, ...((saved.antiNuke || {}).panic || {}) };

  merged.joinRaid = { ...base.joinRaid, ...(saved.joinRaid || {}) };
  merged.joinRaid.flags = { ...base.joinRaid.flags, ...((saved.joinRaid || {}).flags || {}) };
  for (const key of Object.keys(base.joinRaid.flags)) {
    if (typeof base.joinRaid.flags[key] === 'object' && base.joinRaid.flags[key] !== null) {
      merged.joinRaid.flags[key] = { ...base.joinRaid.flags[key], ...(((saved.joinRaid || {}).flags || {})[key] || {}) };
    }
  }

  merged.verification = { ...base.verification, ...(saved.verification || {}) };
  merged.backups = { ...base.backups, ...(saved.backups || {}) };

  merged.whitelist = { ...base.whitelist, ...(saved.whitelist || {}) };
  for (const key of Object.keys(base.whitelist)) {
    if (typeof base.whitelist[key] === 'object' && base.whitelist[key] !== null) {
      merged.whitelist[key] = { ...base.whitelist[key], ...((saved.whitelist || {})[key] || {}) };
    }
  }

  return merged;
}

/* ------------------------------------------------------------------ *
 * Atomik yazma + kuyruk
 * ------------------------------------------------------------------ */

let writeQueue = Promise.resolve();
let pendingSnapshot = null;
let debounceTimer = null;

async function flushToDisk(snapshot) {
  const temp = `${settingsFile}.${process.pid}.tmp`;
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.rename(temp, settingsFile);
}

/**
 * Tüm ayarları diske yazar. Aynı anda yalnızca bir yazma çalışır;
 * sırası bekleyenler en son duruma göre birleşir.
 */
export function writeAllSettings(settings) {
  pendingSnapshot = settings;
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    writeQueue = writeQueue.then(() => flushToDisk(snapshot)).catch((error) => {
      console.error('❌ Ayar dosyası yazılamadı:', error.message);
    });
  }, WRITE_DEBOUNCE_MS);

  return writeQueue;
}

/** Testler ve kapanış için: bekleyen yazmayı hemen tamamla. */
export async function flushPendingWrites() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    if (snapshot) {
      writeQueue = writeQueue.then(() => flushToDisk(snapshot)).catch((error) => {
        console.error('❌ Ayar dosyası yazılamadı:', error.message);
      });
    }
  }
  await writeQueue;
}

export async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
  try {
    await fs.access(settingsFile);
  } catch {
    await fs.writeFile(settingsFile, '{}', 'utf8');
  }
}

export async function readAllSettings() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(settingsFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    // Bozuk JSON: veri kaybetmemek için yedek alıp sıfırla.
    const broken = `${settingsFile}.broken.${Date.now()}`;
    console.error(`❌ settings.json okunamadı (${error.message}). Yedek: ${broken}`);
    try {
      await fs.rename(settingsFile, broken);
    } catch { /* yoksay */ }
    await fs.writeFile(settingsFile, '{}', 'utf8');
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Bot profili (sunucuya özel değil, bot geneli)
 * ------------------------------------------------------------------ */

const profileFile = path.join(storageDir, 'bot-profile.json');

export function createDefaultBotProfile() {
  return {
    activityText: 'sunucunu koruyor',
    activityType: 'watching',
    activityState: '',
    status: 'dnd',
    updatedAt: 0
  };
}

export async function readBotProfile() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(profileFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return { ...createDefaultBotProfile(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return createDefaultBotProfile();
  }
}

export async function saveBotProfile(profile) {
  await ensureStorage();
  const merged = { ...createDefaultBotProfile(), ...profile, updatedAt: Date.now() };
  const temp = `${profileFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(merged, null, 2), 'utf8');
  await fs.rename(temp, profileFile);
  return merged;
}

/* ------------------------------------------------------------------ *
 * Yedekler
 * ------------------------------------------------------------------ */

export { storageDir, settingsFile, backupsDir };

export async function listBackups(guildId) {
  await ensureStorage();
  const entries = await fs.readdir(backupsDir).catch(() => []);
  const files = entries.filter((name) => name.endsWith('.json') && name.startsWith(`${guildId}-`));
  const backups = [];
  for (const name of files) {
    const full = path.join(backupsDir, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    backups.push({ file: name, createdAt: stat.mtimeMs, size: stat.size });
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveBackup(guildId, payload, keep = MAX_BACKUPS) {
  await ensureStorage();
  const file = `${guildId}-${Date.now()}.json`;
  await fs.writeFile(path.join(backupsDir, file), JSON.stringify(payload, null, 2), 'utf8');

  // Eski yedekleri temizle.
  const backups = await listBackups(guildId);
  for (const old of backups.slice(Math.max(1, keep))) {
    await fs.unlink(path.join(backupsDir, old.file)).catch(() => null);
  }
  return file;
}

export async function readBackup(guildId, file) {
  // Dizin dışına çıkmaya çalışan istekleri reddet.
  const safeName = path.basename(file);
  if (!safeName.endsWith('.json') || !safeName.startsWith(`${guildId}-`)) return null;
  const raw = await fs.readFile(path.join(backupsDir, safeName), 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteBackup(guildId, file) {
  const safeName = path.basename(file);
  if (!safeName.endsWith('.json') || !safeName.startsWith(`${guildId}-`)) return false;
  await fs.unlink(path.join(backupsDir, safeName)).catch(() => null);
  return true;
}

export { MAX_BACKUPS };
