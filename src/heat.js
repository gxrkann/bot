/**
 * Wick "Heat" sistemi — mesaj tabanlı, uyarlanabilir (adaptive) otomatik moderasyon.
 *
 * Kullanıcının eylemleri ısı (heat) puanı olarak birikir, zamanla soğur.
 * Isı maksimum eşiği aşarsa otomatik ceza uygulanır. Amaç, normal kullanıcıları
 * asla yanlışlıkla cezalandırmadan spam/raid tespiti yapmaktır.
 *
 * Isı RAM'de tutulur; bot yeniden başlasa da kullanıcılar sıfırdan başlar.
 */
import { PermissionFlagsBits } from 'discord.js';

/* ------------------------------------------------------------------ *
 * Durum
 * ------------------------------------------------------------------ */

/** guildId -> Map<userId, { heat, lastMessage, strikes, lastViolation }> */
const heatState = new Map();
/** guildId -> Map<channelId, number[]> kanal aktivite zaman damgaları */
const channelActivity = new Map();

/* ------------------------------------------------------------------ *
 * Kalıcı olmayan ısı yönetimi
 * ------------------------------------------------------------------ */

function bucket(guildId, userId) {
  if (!heatState.has(guildId)) heatState.set(guildId, new Map());
  const map = heatState.get(guildId);
  if (!map.has(userId)) map.set(userId, { heat: 0, lastMessage: null, strikes: 0, lastViolation: 0 });
  return map.get(userId);
}

/** Zaman geçtiğinde ısıyı soğutur ve güncel değeri döndürür. */
function currentHeat(guildId, userId, settings) {
  const entry = bucket(guildId, userId);
  const decay = settings.decayPerSecond ?? 4;
  if (entry.heat > 0 && entry.lastViolation) {
    const elapsed = (Date.now() - entry.lastViolation) / 1000;
    entry.heat = Math.max(0, entry.heat - elapsed * decay);
    entry.lastViolation = Date.now();
  }
  return entry.heat;
}

function addHeat(guildId, userId, amount, settings) {
  const entry = bucket(guildId, userId);
  currentHeat(guildId, userId, settings);
  entry.heat = Math.min((settings.maxHeat ?? 100) * 2, entry.heat + amount);
  entry.lastViolation = Date.now();
  return entry.heat;
}

export function getHeatSnapshot(guildId, settings) {
  const map = heatState.get(guildId);
  if (!map) return [];
  return [...map.entries()]
    .map(([userId, entry]) => ({
      userId,
      heat: Math.round(currentHeat(guildId, userId, settings)),
      strikes: entry.strikes,
      lastViolation: entry.lastViolation
    }))
    .sort((a, b) => b.heat - a.heat);
}

export function resetHeat(guildId, userId) {
  heatState.get(guildId)?.delete(userId);
}

export function resetAllHeat(guildId) {
  heatState.delete(guildId);
}

/** Panik modunda raider'ları yakalamak için: şüpheli kullanıcıyı ısıya al. */
export function flagUser(guildId, userId, heat = 100) {
  const entry = bucket(guildId, userId);
  entry.heat = Math.max(entry.heat, heat);
  entry.lastViolation = Date.now();
}

export function isFlagged(guildId, userId) {
  const entry = heatState.get(guildId)?.get(userId);
  if (!entry) return false;
  return entry.heat > 0;
}

/* ------------------------------------------------------------------ *
 * Kanal aktivitesi
 * ------------------------------------------------------------------ */

function trackActivity(guildId, channelId) {
  if (!channelActivity.has(guildId)) channelActivity.set(guildId, new Map());
  const map = channelActivity.get(guildId);
  if (!map.has(channelId)) map.set(channelId, []);
  const list = map.get(channelId);

  const now = Date.now();
  const cutoff = now - 60000;
  while (list.length && list[0] < cutoff) list.shift();
  list.push(now);
  return list.length;
}

/* ------------------------------------------------------------------ *
 * Isı hesaplama
 * ------------------------------------------------------------------ */

const INVITE_PATTERN = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[\w-]+/i;
const NSFW_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:xxx|hentai|porn|onlyfans|nudes|nsfw)[^\s]*/i;
const MALICIOUS_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:grabify|ip-grabber|keylogger|discord-nuker|discordtoken|discord-com-stealer|mytoken)[^\s]*/i;

/** Verilen mesajın her filtre için katkısını döndürür. */
export function scoreMessage(message, settings) {
  const filters = settings.filters;
  const contributions = [];
  const content = message.content || '';
  const isWebhook = Boolean(message.webhookId);
  const webhookMultiplier = isWebhook && settings.webhookHeat ? 1.5 : 1;

  const push = (key, heat) => {
    if (filters[key]?.enabled && heat > 0) contributions.push({ key, heat: heat * webhookMultiplier });
  };

  /* Normal mesaj — her mesaj katkıda bulunur, spam tespiti için gereklidir. */
  if (!isWebhook || settings.webhookHeat) push('message', filters.message?.heat ?? 18);

  /* Tekrarlayan mesaj */
  const entry = bucket(message.guild.id, message.author.id);
  if (entry.lastMessage) {
    const prev = entry.lastMessage;
    if (prev === content) push('repetition', filters.repetition?.heat ?? 25);
    else if (content.length > 12 && similarity(prev, content) > 0.85) push('repetition', (filters.repetition?.heat ?? 25) * 0.6);
  }

  /* Emoji */
  const emojiCount = (content.match(/<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (emojiCount > (filters.emoji?.maxPerMessage ?? 5)) {
    push('emoji', Math.min(filters.emoji?.heat ?? 6, (filters.emoji?.heat ?? 6) * 0.5) * emojiCount);
  }

  /* Karakter sayısı (duvar metin) */
  if (filters.characters?.enabled) {
    const raw = Math.round(content.length * (filters.characters?.perChar ?? 0.02));
    push('characters', Math.min(raw, filters.characters?.max ?? 60));
  }

  /* Satır sayısı */
  const lines = content.split('\n').length - 1;
  if (lines > (filters.newLine?.max ?? 4)) push('newLine', filters.newLine?.heat ?? 5);

  /* Etiketler */
  const memberMentions = (content.match(/<@!?\d+>/g) || []).length;
  const roleMentions = (content.match(/<@&\d+>/g) || []).length;
  const everyone = /@(everyone|here)\b/i.test(content);
  if (everyone) {
    push('mentions', filters.mentions?.everyone ?? 100);
  } else {
    push('mentions', memberMentions * (filters.mentions?.member ?? 6));
    push('mentions', roleMentions * (filters.mentions?.role ?? 10));
  }
  const totalMentions = memberMentions + roleMentions + (everyone ? 1 : 0);
  if (totalMentions > 10) {
    push('mentions', Math.min(totalMentions * 2, filters.mentions?.max ?? 40));
  }

  /* Ekler */
  const attachments = message.attachments?.size ?? 0;
  if (attachments > (filters.attachments?.max ?? 3)) push('attachments', (filters.attachments?.heat ?? 15) * attachments);

  /* Reklam / NSFW / kötücül */
  if (INVITE_PATTERN.test(content)) push('advertisement', filters.advertisement?.heat ?? 100);
  if (NSFW_PATTERN.test(content)) push('nsfw', filters.nsfw?.heat ?? 80);
  if (MALICIOUS_PATTERN.test(content)) push('malicious', filters.malicious?.heat ?? 100);

  /* Kara liste kelimeleri */
  for (const word of filters.words?.list || []) {
    if (word && content.toLowerCase().includes(String(word).toLowerCase())) {
      push('words', filters.words?.heat ?? 70);
      break;
    }
  }

  /* Düşük aktiviteli kanal */
  if (filters.inactiveChannel?.enabled) {
    const perMinute = trackActivity(message.guild.id, message.channelId);
    if (perMinute > (filters.inactiveChannel?.minActivityPerMinute ?? 3)) {
      push('inactiveChannel', filters.inactiveChannel?.heat ?? 30);
    }
  }

  /* Bağlantı kara listesi — anında ceza (ısı değil) */
  let linkAction = null;
  for (const link of filters.links?.list || []) {
    if (link && content.toLowerCase().includes(String(link).toLowerCase())) {
      linkAction = filters.links?.action || 'timeout';
      break;
    }
  }

  return {
    contributions,
    linkAction,
    totalHeat: contributions.reduce((sum, c) => sum + c.heat, 0),
    isWebhook
  };
}

/** Basit benzerlik oranı (Levenshtein yerine hızlı ikili karşılaştırma). */
function similarity(a, b) {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.length === 0) return 1;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) if (shorter[i] === longer[i]) matches++;
  return matches / longer.length;
}

/* ------------------------------------------------------------------ *
 * Ceza
 * ------------------------------------------------------------------ */

/**
 * Mesajı analiz eder, ısıyı günceller ve eşik aşıldıysa ceza uygular.
 * @returns {{ heat:number, action:string|null, contributions:Array }}
 */
export async function analyzeMessage(message, client, settings) {
  const guildId = message.guild.id;
  const userId = message.author.id;
  const entry = bucket(guildId, userId);

  const result = scoreMessage(message, settings);
  entry.lastMessage = (message.content || '').slice(0, 500);

  if (result.totalHeat > 0) addHeat(guildId, userId, result.totalHeat, settings);

  const heat = currentHeat(guildId, userId, settings);
  const max = settings.maxHeat ?? 100;

  /* Düşük ısı: sadece izle. */
  if (heat < max) {
    return { heat: Math.round(heat), action: null, contributions: result.contributions };
  }

  /* Bağlantı kara listesi doğrudan ceza verir. */
  if (result.linkAction) {
    entry.strikes++;
    await applyAction(message, client, settings, result.linkAction, 'Kara liste bağlantısı');
    if (settings.resetHeatOnTimeout) resetHeat(guildId, userId);
    return { heat: Math.round(heat), action: result.linkAction, contributions: result.contributions };
  }

  /* Eşik aşıldı: ceza uygula, ısıyı sıfırla. */
  const reachedCap = entry.strikes + 1 >= (settings.strikesCap ?? 5);
  entry.strikes++;

  let duration = settings.timeoutDurationMs ?? 600000;
  if (reachedCap) duration = settings.capTimeoutDurationMs ?? 604800000;
  else if (settings.multiplier && entry.strikes > 1) duration = Math.min(duration * entry.strikes, 2419200000);

  await applyAction(message, client, settings, 'timeout', `Isı limiti aşıldı (${Math.round(heat)}/${max})`, duration);
  if (settings.resetHeatOnTimeout) resetHeat(guildId, userId);

  return {
    heat: Math.round(heat),
    action: 'timeout',
    reachedCap,
    contributions: result.contributions
  };
}

async function applyAction(message, client, settings, action, reason, duration) {
  const member = message.member;
  if (!member) return;

  /* Beyaz listeden / yetkiden gelenler dokunulmaz. */
  if (isExempt(member, message, settings, client)) return;

  try {
    if (action === 'timeout') {
      const time = Math.min(duration ?? 600000, 2419200000);
      await member.timeout(time, `Guard: ${reason}`);
    } else if (action === 'kick') {
      await member.kick(`Guard: ${reason}`);
    } else if (action === 'ban') {
      await member.ban({ reason: `Guard: ${reason}` });
    } else if (action === 'delete') {
      await message.delete().catch(() => null);
    }
  } catch {
    // Bot yetkisi yoksa sessiz geç.
  }
}

/** Beyaz liste, yetki ve rol koruması. */
function isExempt(member, message, settings, client) {
  const guild = message.guild;
  if (guild.ownerId === member.id) return true;
  if (settings.ownerImmune && client.config?.ownerIds?.includes(member.id)) return true;
  if (settings.safeUsers?.includes(member.id)) return true;
  if (settings.safeRoles?.some((id) => member.roles.cache.has(id))) return true;
  if (settings.safeBots?.includes(member.id)) return true;

  /* Botları ısı sistemi cezalandırmaz (Join Gate ayrıca bakıyor). */
  if (member.user.bot) return true;

  /* Yönetici / mesaj yönetimi yetkisi olanları otomatik cezalandırma. */
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;

  /* Isı sistemine özel beyaz liste: kullanıcı, rol, kanal, kategori */
  const wl = settings.whitelist?.spamming;
  if (wl) {
    if (wl.users?.includes(member.id)) return true;
    if (member.roles.cache.some((role) => wl.roles?.includes(role.id))) return true;
    if (wl.channels?.includes(message.channelId)) return true;
    if (wl.categories?.includes(message.channel?.parentId)) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ *
 * Panik modu ısısı
 * ------------------------------------------------------------------ */

/**
 * Join Raid tetiklendiğinde şüpheli hesapları yüksek ısıya alır,
 * böylece ısı sistemi onları izlemeye devam eder.
 */
export function flagSuspicious(guildId, userIds, maxHeat = 100) {
  for (const userId of userIds) flagUser(guildId, userId, maxHeat);
}

/** Test/panel kullanımı: ısıyı sıfırla. */
export function clearState(guildId) {
  resetAllHeat(guildId);
  channelActivity.delete(guildId);
}

export { heatState, channelActivity };
