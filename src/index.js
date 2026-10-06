import { Client, GatewayIntentBits, Partials, Collection, Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL as toFileUrl } from 'node:url';

import { config, envSource } from './config.js';
import {
  getGuildSettings, saveGuildSettings, deleteGuildSettings,
  parseSuspectActionId, isReviewAuthorized, removeSuspect, getActionableReasons, evaluateMember
} from './guard-utils.js';
import { readAllSettings, flushPendingWrites } from './store.js';
import { createDashboard } from './dashboard/server.js';
import { startCleanupTimer } from './dashboard/auth.js';
import { completeVerification } from './verification.js';
import { startBackupScheduler } from './backup.js';
import { printBanner, VERSION } from './version.js';

/* Sürüm damgası, her şeyden önce basılır. Panelde eski kod çalışıyorsa
   bu satır hiç görünmez — sorunun nerede olduğunu tek bakışta belli eder. */
printBanner();
/* voice.js, @discordjs/voice paketini kendi içinde import ediyor. O paket
   kurulu değilse (panelde npm install eski package.json ile çalışmış
   olabilir) statik import botu hiç açılmadan öldürürdü.

   Bu yüzden ses modülü gerektiğinde dinamik yükleniyor; eksik olsa bile
   bot çalışmaya devam eder, sadece ses özelliği devre dışı kalır. */
let voiceModule = null;
let voiceLoadError = null;

async function loadVoice() {
  if (voiceModule || voiceLoadError) return voiceModule;
  try {
    voiceModule = await import('./voice.js');
  } catch (error) {
    voiceLoadError = error;
    console.warn('⚠️ Ses özelliği yüklenemedi:', error.message);
    console.warn('   @discordjs/voice kurulu değil. Terminalde çalıştır: npm install @discordjs/voice');
  }
  return voiceModule;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------------------------------------------ *
 * Discord istemcisi
 * ------------------------------------------------------------------ */

/* İntent'ler .env ile kontrol edilir. Kapalı bırakılan intent sessizce
   hiçbir şey yapmaz (mesaj içeriği boş gelir), bu yüzden varsayılan açık. */
const intents = [GatewayIntentBits.Guilds];

if (process.env.ENABLE_GUILD_MEMBERS_INTENT !== 'false') intents.push(GatewayIntentBits.GuildMembers);

/* Ses kanalında bekleyebilmek ve kanal hareketlerini görebilmek için
   gerekli. Kapalıysa bot kanala giremez. */
if (process.env.ENABLE_VOICE_STATES_INTENT !== 'false') intents.push(GatewayIntentBits.GuildVoiceStates);
if (process.env.ENABLE_MESSAGE_CONTENT_INTENT !== 'false') intents.push(GatewayIntentBits.MessageContent);

intents.push(
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildEmojisAndStickers
);

const client = new Client({
  intents,
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User]
});

client.commands = new Collection();
client.guardSettings = new Map();
client.actionBuckets = new Map();
client.config = config;

/* ------------------------------------------------------------------ *
 * Modül yükleyici
 * ------------------------------------------------------------------ */

function loadFiles(dirPath, targetArray) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      loadFiles(fullPath, targetArray);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      targetArray.push(fullPath);
    }
  }
}

const commandFiles = [];
const eventFiles = [];
loadFiles(path.join(__dirname, 'commands'), commandFiles);
loadFiles(path.join(__dirname, 'events'), eventFiles);

for (const file of commandFiles) {
  const command = await import(toFileUrl(file).href);
  if (command.default?.data) client.commands.set(command.default.data.name, command.default);
}

for (const file of eventFiles) {
  const eventModule = await import(toFileUrl(file).href);
  const handler = eventModule.default;
  if (!handler?.name) continue;

  // Aynı olay iki dosyada tanımlıysa ikincisi atlanır (roleMembersUpdate.js gibi).
  const existing = client.listenerCount(handler.name);
  if (existing > 0) {
    console.warn(`⚠️ ${path.basename(file)}: ${handler.name} zaten kayıtlı, atlanıyor.`);
    continue;
  }

  client.on(handler.name, (...args) => handler.execute(...args, client));
}

/* ------------------------------------------------------------------ *
 * Hazır olma
 * ------------------------------------------------------------------ */

async function loadPersistedSettings() {
  const saved = await readAllSettings();
  for (const [guildId, settings] of Object.entries(saved)) {
    client.guardSettings.set(guildId, settings);
  }
  return Object.keys(saved).length;
}

/* Kayıtlı profil yazısını ve durumu uygula. Avatar ve banner Discord'a
   yüklenmiş olduğu için otomatik gelir; kaydetmemiz gerekmez. */
async function applySavedProfile() {
  const { readBotProfile } = await import('./store.js');
  const { setActivity } = await import('./profile.js');

  const profile = await readBotProfile();
  const result = await setActivity(client, {
    text: profile.activityText,
    type: profile.activityType,
    status: profile.status,
    state: profile.activityState
  });

  if (!result.ok) console.warn('⚠️ Profil yazısı uygulanamadı:', result.error);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ ${readyClient.user.tag} çalışıyor — ${readyClient.guilds.cache.size} sunucu`);

  for (const guild of readyClient.guilds.cache.values()) {
    if (!client.guardSettings.has(guild.id)) {
      await saveGuildSettings(client, guild.id, getGuildSettings(client, guild.id));
    }

    const settings = getGuildSettings(client, guild.id);

    /* Acil durum / kilit modunda restart olduysa kullanıcıyı uyar. */
    if (settings.emergencyMode) {
      console.warn(`⚠️ ${guild.name}: acil durum modu AÇIK. Dashboard'dan kapatmayı unutma.`);
    }
    if (settings.lockdown) {
      console.warn(`⚠️ ${guild.name}: kilit modu AÇIK. Dashboard'dan açmayı unutma.`);
    }

    startBackupScheduler(client, guild);
  }

  /* Kritik yetkileri denetle — sessizce çalışmayan korumalarda
     kullanıcı neden çalışmadığını anlamak zor olur. */
  const warnings = [];
  if (!readyClient.guilds.cache.size) warnings.push('Bot hiçbir sunucuda değil.');

  for (const guild of readyClient.guilds.cache.values()) {
    const me = guild.members.me;
    if (!me) continue;
    const missing = [];
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) missing.push('Rolleri Yönet');
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('Kanalları Yönet');
    if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) missing.push('Üyeleri Yönet');
    if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) missing.push('Üyeleri Taşı (Move Members) — karantina çalışmaz');
    if (missing.length) warnings.push(`${guild.name}: eksik yetki → ${missing.join(', ')}`);
  }

  if (warnings.length) {
    console.log('\n⚠️  Dikkat gerektirenler:');
    for (const warning of warnings) console.log(`   • ${warning}`);
    console.log('');
  }

  await applySavedProfile();

  await joinConfiguredVoiceChannels();

  await readyClient.user.setPresence({
    status: 'dnd'
  });
});

/* ------------------------------------------------------------------ *
 * Etkileşimler
 * ------------------------------------------------------------------ */

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction, client);
  } catch (error) {
    console.error('Etkileşim hatası:', error);

    const message = { content: 'Komut çalıştırılırken bir hata oluştu.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(message);
      else await interaction.reply(message);
    } catch {
      // Yanıt zaten gönderilmiş.
    }
  }
});

async function handleButton(interaction) {
  /* Doğrulama butonu */
  if (interaction.customId.startsWith('verify:')) {
    const settings = getGuildSettings(client, interaction.guildId);
    const member = interaction.member;
    const result = await completeVerification(client, interaction.guild, member, settings);

    await interaction.reply({
      content: result.ok
        ? '✅ Doğrulandın, aramıza hoş geldin!'
        : `❌ ${result.reason}`,
      flags: result.ok ? 0 : MessageFlags.Ephemeral
    });
    return;
  }

  /* Şüpheli işlem butonları */
  const { action, guildId, userId } = parseSuspectActionId(interaction.customId);
  if (!guildId || !userId || guildId !== interaction.guildId) return;

  const settings = getGuildSettings(client, guildId);

  if (!isReviewAuthorized(client, interaction, settings)) {
    await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Sunucu bulunamadı.', flags: MessageFlags.Ephemeral });
    return;
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    await interaction.reply({ content: 'Hedef kullanıcı sunucuda bulunamadı.', flags: MessageFlags.Ephemeral });
    await removeSuspect(client, guildId, userId).catch(() => null);
    return;
  }

  if (action === 'suspect-ban') {
    await member.ban({ reason: 'Şüpheli kullanıcı işlemi' }).catch(() => null);
    await removeSuspect(client, guildId, userId);
    await interaction.reply({ content: `✅ ${member.user.tag} banlandı.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'suspect-kick') {
    await member.kick('Şüpheli kullanıcı işlemi').catch(() => null);
    await removeSuspect(client, guildId, userId);
    await interaction.reply({ content: `✅ ${member.user.tag} sunucudan atıldı.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'suspect-timeout') {
    await member.timeout(10 * 60 * 1000, 'Şüpheli kullanıcı zaman aşımı').catch(() => null);
    await removeSuspect(client, guildId, userId);
    await interaction.reply({ content: `✅ ${member.user.tag} için 10 dakikalık zaman aşımı verildi.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'suspect-test') {
    /* Sadece gerçek şüphe sebepleri teste takılır; kullanıcı adındaki
       kelimeler testi geçmesini engellemez. */
    const actionReasons = getActionableReasons(member, settings);
    if (actionReasons) {
      await interaction.reply({
        content: `❌ ${member.user.tag} testi geçemedi: ${actionReasons.join(', ')}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!settings.trustedRoleId) {
      await interaction.reply({ content: 'Güvenilir rol ayarlanmamış.', flags: MessageFlags.Ephemeral });
      return;
    }

    const role = guild.roles.cache.get(settings.trustedRoleId);
    if (!role) {
      await interaction.reply({ content: 'Güvenilir rol sunucuda bulunamadı.', flags: MessageFlags.Ephemeral });
      return;
    }

    await member.roles.add(role, 'Şüphe testi geçti').catch(() => null);
    await removeSuspect(client, guildId, userId);

    const evaluation = evaluateMember(member, settings);
    const note = evaluation.noticeReasons.length
      ? `\n\nNot: Kullanıcı adı kontrolü işaretlendi ama ceza uygulanmadı (${evaluation.noticeReasons.join(', ')}).`
      : '';

    await interaction.reply({ content: `✅ Testten geçti ve ${role.name} verildi.${note}`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: 'Bilinmeyen işlem.', flags: MessageFlags.Ephemeral });
}

/* Sunucudan ayrılınca ayarları sil. */
client.on(Events.GuildDelete, async (guild) => {
  await deleteGuildSettings(client, guild.id).catch(() => null);
});

/* ------------------------------------------------------------------ *
 * Ses olayları
 * ------------------------------------------------------------------ */

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const voice = await loadVoice();
  voice?.handleVoiceStateUpdate?.(client, oldState, newState);
});

client.on(Events.ChannelDelete, (channel) => {
  voiceModule?.handleChannelDelete?.(channel);
});

/** Bot açılırken kayıtlı ses kanalına katılır. */
async function joinConfiguredVoiceChannels() {
  const voice = await loadVoice();
  if (!voice) return;

  for (const guild of client.guilds.cache.values()) {
    const settings = getGuildSettings(client, guild.id);
    if (!settings.voice?.enabled || !settings.voice.channelId) continue;

    /* signalling durumunda takılan bağlantılar bazen ikinci denemede
       başarılı olur (UDP el sıkışması ilk denemede düşmüş olabilir).
       Bu yüzden iki kez deniyoruz. */
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await voice.joinVoiceChannel(client, guild, settings.voice.channelId, {
        selfMute: settings.voice.selfMute,
        selfDeaf: settings.voice.selfDeaf
      }).catch(() => ({ ok: false, error: 'bilinmiyor' }));

      if (result.ok) break;
      if (attempt < 2) {
        console.log(`🔁 ${guild.name}: ses bağlantısı ${result.status || 'hata'} sonrası tekrar deneniyor...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (result.ok) {
      const name = guild.channels.cache.get(settings.voice.channelId)?.name || settings.voice.channelId;
      console.log(`🔊 ${guild.name}: ses kanalına katıldı (#${name})`);
    } else {
      console.warn(`⚠️ ${guild.name}: ses kanalına katılamadı — ${result.error}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

/**
 * Dashboard'ı başlatır.
 *
 * Hosting ortamı (bot-hosting.net, Railway, Fly) bir port TAHSiS EDER ve
 * bunu PORT ortam değişkeninde bildirir. Yerelde çalışırken DASHBOARD_PORT
 * kullanılır, yoksa 3000.
 *
 * Adres: 0.0.0.0 — panelden gelen isteklerin kabul edilmesi için şart.
 * 'localhost' dinlemek sunucu tarafından kabul edilir ama dışarıdan erişilemez.
 */
function startDashboard() {
  const port = Number(process.env.PORT) || Number(process.env.DASHBOARD_PORT) || 3000;
  const host = process.env.DASHBOARD_HOST || '0.0.0.0';
  const server = createDashboard(client);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Dashboard portu ${port} dolu.`);
      return;
    }
    console.error('Dashboard hatası:', error.message);
  });

  server.listen(port, host, () => {
    if (host === '0.0.0.0') {
      console.log(`🌐 Dashboard ${port} portunda dinliyor (0.0.0.0)`);
      console.log(`   Panel adresi: ${process.env.DASHBOARD_PUBLIC_URL || '(Render otomatik verir)'}`);
    } else {
      console.log(`🌐 Dashboard: http://localhost:${port}`);
    }

    /* Render gibi uykuya düşen ortamlarda gerekir. */
    startKeepAlive(port);
  });

  startCleanupTimer();
}

/**
 * Render ücretsiz plan koruması.
 *
 * Render, 15 dakika GELEN trafik olmayınca ücretsiz servisi kapatıyor
 * (spins down). Discord bağlantısı giden trafik olduğu için bunu
 * engellemiyor — bot koruma sistemleri devrede olmasına rağmen
 * Discord'dan düşüyor.
 *
 * Çözüm: bot periyodik olarak kendi /ping ucunu çağırıyor. Bu gelen
 * trafik sayılıyor, servis uyanık kalıyor.
 *
 * Aralık 10 dakika: 15 dakikalık eşiğin altında, ama Discord'un
 * bağlantı zaman aşımına (yaklaşık 1-2 dakika) takılmayacak kadar
 * sık değil. Aslında amacımız Discord bağlantısını canlı tutmak;
 * /ping çağrısı aynı zamanda botun ayakta olduğunu da doğruluyor.
 */
function startKeepAlive(port) {
  const url = `http://127.0.0.1:${port}/ping`;

  const ping = async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) console.warn(`⚠️ Keep-alive ${response.status} döndü`);
    } catch {
      // Zaman aşımı normaldir (bot kendi event loop'unda meşgulken).
    }
  };

  // İlk ping biraz gecikmeli: sunucu tamamen ayağa kalkmadan istek atmamalı.
  setTimeout(ping, 15000);
  const timer = setInterval(ping, 10 * 60 * 1000);
  if (timer.unref) timer.unref();

  console.log('⏱️  Keep-alive açık (10 dakikada bir) — ücretsiz plan uykuya düşmez');
}

/* Panel ortamında teşhis: hangi değişkenler geldi?
   DEĞERLERİ YAZDIRILMAZ, sadece isimleri ve dolu/boş durumu.
   Panelde isim farkı ya da yazım hatası varsa tek bakışta görülür. */
const REQUIRED_ENV = [
  'DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'OWNER_ID',
  'OWNER_ID_2', 'DASHBOARD_PASSWORD', 'DASHBOARD_ALLOWED_IDS',
  'DASHBOARD_CLIENT_ID', 'DASHBOARD_CLIENT_SECRET', 'DASHBOARD_PORT',
  'PORT', 'ENABLE_VOICE_STATES_INTENT', 'ENABLE_GUILD_MEMBERS_INTENT',
  'ENABLE_MESSAGE_CONTENT_INTENT'
];

function reportEnv() {
  const present = REQUIRED_ENV.filter((key) => process.env[key] !== undefined && process.env[key] !== '');
  const missing = REQUIRED_ENV.filter((key) => !present.includes(key));

  /* Token hangi dosyadan geldi? Panelde hiçbir dosya yoksa bu satır
     "tokenı panelden girmen gerekiyor" der. Tek bakışta teşhis. */
  const hasToken = Boolean(config.token);
  const source = envSource.file;

  console.log('🔧 Ortam değişkenleri (değerler yazdırılmaz):');
  console.log(`   kaynak: ${source ? source : 'yalnızca process.env (panel)'}`);
  if (present.length === 0) {
    console.log('   HİÇBİRİ YOK — bot dışarıdan hiçbir ayar almamış.');
  } else {
    for (const key of present) {
      const length = String(process.env[key]).length;
      console.log(`   ✓ ${key} (${length} karakter)`);
    }
  }
  if (missing.length) {
    console.log(`   tanımsız: ${missing.join(', ')}`);
  }

  /* Token varsa şekil kontrolü: geçersiz bir token Discord'a bağlanırken
     "An invalid token was provided" hatası verir ve nedenini anlamak
     zor olur. Burada önceden söylüyoruz. */
  if (hasToken && !/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}$/.test(config.token)) {
    console.log('   ⚠️ DISCORD_TOKEN bir Discord bot token\'ı gibi görünmüyor.');
    console.log('      Tırnak, boşluk veya satır sonu kalmış olabilir.');
  }
  console.log('');
}

async function boot() {
  reportEnv();

  /* Panel ortamı olup olmadığını ayırt et. .env yoksa kod kesinlikle
     panelde çalışıyor demektir ve tek çözüm ortam değişkeni girmektir. */
  const envFile = path.join(__dirname, '..', '.env');
  const hasEnvFile = existsSync(envFile);
  const onPanel = !hasEnvFile;

  if (!config.token) {
    console.error('');
    console.error(`❌ DISCORD_TOKEN tanımlı değil — Guard Bot v${VERSION}`);
    console.error('');

    if (hasEnvFile) {
      console.error('   .env dosyası var ama içinde DISCORD_TOKEN yok veya boş.');
      console.error(`   Dosya: ${envFile}`);
      console.error('   Satır şu şekilde olmalı (tırnak/boşluk yok):');
      console.error('     DISCORD_TOKEN=buraya_tokenin');
    } else {
      /* Panelde çalışıyor ve ortam değişkeni yok.
         Panellerde tek ayarlanabilir yer çoğu zaman "başlangıç komutu".
         Oraya export'ları gömerek çözüm sunuyoruz: token ne ZIP'e girer
         ne de depoya. Kullanıcı tek satırı kopyalamak zorunda. */
      console.error('   Konum: panel (çalışma dizininde .env dosyası yok).');
      console.error('');
      console.error('   ÇÖZÜM — paneldeki başlangıç komutunu şu satırla değiştir:');
      console.error('');
      console.error('   export DISCORD_TOKEN=<token> && export CLIENT_ID=1556800308422643802 \\');
      console.error('     && export GUILD_ID=1555388276779782214 \\');
      console.error('     && export OWNER_ID=281867375626813470 \\');
      console.error('     && export DASHBOARD_PASSWORD=gZ7Q2pLZ8oav \\');
      console.error('     && npm install && exec node src/index.js');
      console.error('');
      console.error('   Hazır hali PANEL-COMMAND.txt dosyasında.');
      console.error('');
      console.error('   Panelde ortam değişkeni alanı varsa daha kısa yol:');
      console.error('     DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID,');
      console.error('     DASHBOARD_PASSWORD  →  5 satır ekle.');
    }

    console.error('');
    process.exit(1);
  }

  const count = await loadPersistedSettings();
  console.log(`💾 ${count} sunucunun ayarı yüklendi.`);

  /* Discord'a bağlanma hatasını düz cümleye çeviriyoruz. discord.js
     ham hata kodları veriyor ("TokenInvalid", "An invalid token was
     provided") ve bunların ne anlama geldiğini ayırmak zaman alıyor. */
  try {
    await client.login(config.token);
  } catch (error) {
    const code = error?.code || '';
    console.error('');
    console.error(`❌ Discord'a bağlanılamadı — Guard Bot v${VERSION}`);
    console.error('');

    if (code === 'TokenInvalid') {
      console.error('   Sorun: token geçersiz.');
      console.error('   Portal\'da token\'ı kopyalarken satır sonu veya boşluk');
      console.error('   girdiyse düzelt. Emin değilsen token\'ı yeniden üret:');
      console.error('     Developer Portal → Bot → Reset Token');
    } else if (code === 'TokenMissing') {
      console.error('   Sorun: token boş.');
    } else if (code === 'DisallowedIntents') {
      console.error('   Sorun: bir intent panelde açık değil.');
      console.error('   Developer Portal → Bot → Privileged Gateway Intents:');
      console.error('     Server Members Intent   → aç');
      console.error('     Message Content Intent  → aç');
      console.error('     Server Voice Intents    → aç');
    } else if (code === 'WSRateLimited' || String(code).includes('429')) {
      console.error('   Sorun: Discord bağlantıyı sınırlandırdı.');
      console.error('   Panelde aynı anda iki kopya çalışıyor olabilir.');
    } else if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
      console.error('   Sorun: Discord\'a ulaşılamıyor (panel ağ kısıtı olabilir).');
    } else {
      console.error(`   Discord hatası: ${error.message}`);
    }

    console.error('');
    process.exit(1);
  }

  if (process.env.DASHBOARD_ENABLED !== 'false') {
    startDashboard();
  }
}

/* GUARD_SKIP_BOOT yalnızca testler içindir: dosyayı yükleyip import
   hatalarını yakalamak isteriz ama Discord'a bağlanmayız. */
if (process.env.GUARD_SKIP_BOOT !== '1') {
  boot().catch((error) => {
    console.error('❌ Başlatma hatası:', error.message);
    process.exit(1);
  });
}

/* Kapanırken bekleyen yazmaları tamamla. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log('\n👋 Kapatılıyor...');
    await flushPendingWrites();
    process.exit(0);
  });
}
