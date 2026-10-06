/**
 * Join Raid — toplu katılım (raid) tespiti.
 *
 * Numaralandırılmış hesapların toplu katılımı bir raid'in en güçlü göstergesidir.
 * Wick'in yaklaşımı: X hesap / Y süre içinde katılırsa raid tetiklenir, uyarı
 * rolleri pinglenir ve katılan hesaplar cezalandırılır.
 *
 * Burada ek olarak "string flag" ile raid hesaplarının kullanıcı adı
 * desenleri de tespit edilir (örn. `=isim` birebir eşleşme, `$isim` sona ek).
 */

/** guildId -> { joins: Array<{userId, tag, joinedAt, flags:string[], accountAgeDays, hasAvatar, idString}> } */
const raidState = new Map();

/** Son N katılımı tutulacak pencere (saat limiti saati aşmamalı). */
const MAX_TRACK_MS = 60 * 60 * 1000;

function state(guildId) {
  if (!raidState.has(guildId)) {
    raidState.set(guildId, { joins: [], triggered: false, triggeredAt: 0 });
  }
  return raidState.get(guildId);
}

/**
 * Bir katılımı kaydeder ve gerekirse raid'i tetikler.
 * @returns {{ triggered:boolean, count:number, flaggedIds:string[] }}
 */
export async function trackJoin(client, guild, member, settings) {
  const config = settings.joinRaid;
  const result = { triggered: false, count: 0, flaggedIds: [] };

  if (!settings.enabled) return result;

  const entry = {
    userId: member.id,
    tag: member.user.tag,
    joinedAt: Date.now(),
    accountAgeDays: (Date.now() - member.user.createdTimestamp) / 86400000,
    hasAvatar: !member.user.displayAvatarURL().includes('embed/avatars/n.png'),
    flags: []
  };

  /* Hesap yaşı bayrağı — JoinGate'den bağımsız çalışır. */
  if (config.flags?.age?.enabled && entry.accountAgeDays < (config.flags.age.maxAgeDays ?? 2)) {
    entry.flags.push('age');
  }

  /* Avatar bayrağı */
  if (config.flags?.noAvatar?.enabled && !entry.hasAvatar) {
    entry.flags.push('noAvatar');
  }

  /* String bayrağı — kullanıcı adı desenleri */
  if (config.flags?.string?.enabled) {
    const matches = matchStringRules(member.user.tag, config.flags.string.rules || []);
    if (matches.length) entry.flags.push('string');
    entry.matchedRules = matches;
  }

  /* ID bayrağı — otomasyon araçlarının ID desenleri (rakam oranı) */
  if (config.flags?.id?.enabled) {
    entry.flags.push('id');
  }

  const s = state(guild.id);
  s.joins.push(entry);

  // Eski kayıtları temizle.
  const cutoff = Date.now() - MAX_TRACK_MS;
  s.joins = s.joins.filter((item) => item.joinedAt >= cutoff);

  result.count = s.joins.length;

  if (!config.enabled) return result;

  // Tetiklenmişse yeniden tetikleme (cooldown).
  if (s.triggered && Date.now() - s.triggeredAt < config.windowMs) return result;

  const windowMs = config.windowMs ?? 600000;
  const windowStart = Date.now() - windowMs;
  const inWindow = s.joins.filter((item) => item.joinedAt >= windowStart);

  // accountType filtresi: sadece şüpheli hesaplar mı sayılsın?
  const candidates = config.accountType === 'suspicious'
    ? inWindow.filter((item) => item.flags.length > 0)
    : inWindow;

  if (candidates.length < (config.count ?? 10)) return result;

  s.triggered = true;
  s.triggeredAt = Date.now();
  result.triggered = true;
  result.flaggedIds = candidates.map((item) => item.userId);

  await triggerRaid(client, guild, candidates, settings);
  return result;
}

/** Raid tetiklendi: cezalandır, uyar, gerekirse panik moduna geç. */
async function triggerRaid(client, guild, candidates, settings) {
  const config = settings.joinRaid;
  const { sendGuardLog } = await import('./guard-utils.js');

  const action = config.action || 'timeout';
  let punished = 0;

  for (const entry of candidates) {
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;

    // Beyaz listedekilere dokunma.
    if (isWhitelisted(member, settings, client)) continue;

    try {
      if (action === 'timeout') {
        await member.timeout(600000, `JoinRaid: ${entry.flags.join(', ') || 'toplu katılım'}`);
      } else if (action === 'kick') {
        await member.kick('JoinRaid: toplu katılım');
      } else if (action === 'ban') {
        await member.ban({ reason: 'JoinRaid: toplu katılım' });
      }
      punished++;

      if (config.quarantineRaiders) {
        const { quarantineMember } = await import('./anti-nuke.js');
        await quarantineMember(client, guild, member, 'JoinRaid');
      }
    } catch {
      // yetki yoksa devam
    }
  }

  const flagCounts = {};
  for (const entry of candidates) {
    for (const flag of entry.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  }

  await sendGuardLog(
    client,
    guild,
    '🚨 JOIN RAID TESPİT EDİLDİ',
    `${candidates.length} hesap ${Math.round((config.windowMs ?? 600000) / 60000)} dakika içinde katıldı.\n` +
    `Uygulanan işlem: ${action} (${punished} kullanıcı)`,
    0xed4245,
    Object.entries(flagCounts).map(([flag, count]) => ({
      name: flagLabel(flag),
      value: `${count} hesap`,
      inline: true
    }))
  );

  // Uyarı rollerini pingle.
  if (config.warnRoleIds?.length) {
    const channel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
    if (channel) {
      await channel.send({
        content: config.warnRoleIds.map((id) => `<@&${id}>`).join(' '),
        embeds: [{
          title: '⚠️ Join Raid Uyarısı',
          description: `${candidates.length} hesap kısa sürede katıldı ve cezalandırıldı.`,
          color: 0xed4245,
          fields: candidates.slice(0, 15).map((entry, i) => ({
            name: `${i + 1}. ${entry.tag}`,
            value: `Bayraklar: ${entry.flags.join(', ') || 'yok'}\nHesap yaşı: ${entry.accountAgeDays.toFixed(1)} gün`,
            inline: true
          }))
        }]
      }).catch(() => null);
    }
  }

  /* Panik modu ile birleştir. */
  if (settings.antiNuke?.panic?.enabled) {
    const { triggerPanicMode } = await import('./anti-nuke.js');
    await triggerPanicMode(client, guild, 'Join Raid tespit edildi', {
      raiderIds: candidates.map((entry) => entry.userId)
    });
  }
}

function isWhitelisted(member, settings, client) {
  if (member.guild.ownerId === member.id) return true;
  if (settings.ownerImmune && client.config?.ownerIds?.includes(member.id)) return true;
  if (settings.safeUsers?.includes(member.id)) return true;
  if (settings.safeRoles?.some((id) => member.roles.cache.has(id))) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * String bayrak kuralları
 * ------------------------------------------------------------------ */

/**
 * Wick'in regex-benzeri operatörleri:
 *   =kelime  → birebir eşleşme
 *   $kelime  → kelime ile biter
 *   'kelime  → kelime içerir
 *   !kelime  → hariç tut
 *
 * @returns {string[]} eşleşen kurallar
 */
export function matchStringRules(tag, rules) {
  const lower = tag.toLowerCase();
  const excluded = [];
  const included = [];

  for (const raw of rules || []) {
    const rule = String(raw).trim();
    if (!rule) continue;

    if (rule.startsWith('!')) {
      excluded.push(rule.slice(1).toLowerCase());
    } else if (rule.startsWith('=')) {
      included.push({ type: 'exact', value: rule.slice(1).toLowerCase() });
    } else if (rule.startsWith('$')) {
      included.push({ type: 'endsWith', value: rule.slice(1).toLowerCase() });
    } else if (rule.startsWith("'")) {
      included.push({ type: 'contains', value: rule.slice(1).toLowerCase() });
    } else {
      included.push({ type: 'contains', value: rule.toLowerCase() });
    }
  }

  // Hariç tutma kuralları önce kontrol edilir.
  for (const ex of excluded) {
    if (lower.includes(ex)) return [];
  }

  const matches = [];
  for (const rule of included) {
    if (rule.type === 'exact' && lower === rule.value) matches.push(`=${rule.value}`);
    if (rule.type === 'endsWith' && lower.endsWith(rule.value)) matches.push(`$${rule.value}`);
    if (rule.type === 'contains' && lower.includes(rule.value)) matches.push(`'${rule.value}`);
  }
  return matches;
}

function flagLabel(flag) {
  return {
    age: 'Yeni hesap',
    noAvatar: 'Avatarsız',
    string: 'İsim deseni',
    id: 'ID deseni'
  }[flag] || flag;
}

/* ------------------------------------------------------------------ *
 * Durum sorguları
 * ------------------------------------------------------------------ */

export function getJoinStats(guildId, windowMs = 600000) {
  const s = state(guildId);
  const windowStart = Date.now() - windowMs;
  const inWindow = s.joins.filter((item) => item.joinedAt >= windowStart);
  return {
    countInWindow: inWindow.length,
    totalTracked: s.joins.length,
    triggered: s.triggered,
    triggeredAt: s.triggeredAt,
    recent: inWindow.slice(-20).reverse()
  };
}

export function resetRaidState(guildId) {
  raidState.delete(guildId);
}
