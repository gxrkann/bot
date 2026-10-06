import { Client, GatewayIntentBits, Partials, Collection, Events, ActivityType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL as toFileUrl } from 'node:url';

import { config } from './config.js';
import {
  getGuildSettings, saveGuildSettings, deleteGuildSettings,
  parseSuspectActionId, isReviewAuthorized, removeSuspect, getActionableReasons, evaluateMember
} from './guard-utils.js';
import { readAllSettings, flushPendingWrites } from './store.js';
import { createDashboard } from './dashboard/server.js';
import { startCleanupTimer } from './dashboard/auth.js';
import { completeVerification } from './verification.js';
import { startBackupScheduler } from './backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------------------------------------------ *
 * Discord istemcisi
 * ------------------------------------------------------------------ */

/* İntent'ler .env ile kontrol edilir. Kapalı bırakılan intent sessizce
   hiçbir şey yapmaz (mesaj içeriği boş gelir), bu yüzden varsayılan açık. */
const intents = [GatewayIntentBits.Guilds];

if (process.env.ENABLE_GUILD_MEMBERS_INTENT !== 'false') intents.push(GatewayIntentBits.GuildMembers);
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

  await readyClient.user.setPresence({
    activities: [{ name: 'sunucunu koruyor', type: ActivityType.Watching }],
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
      console.log(`   Panelden atadığı subdomain: ${process.env.DASHBOARD_PUBLIC_URL || '(panelden bak)'}`);
    } else {
      console.log(`🌐 Dashboard: http://localhost:${port}`);
    }
  });

  startCleanupTimer();
}

/* ------------------------------------------------------------------ *
 * Başlat
 * ------------------------------------------------------------------ */

async function boot() {
  if (!config.token) {
    console.error('❌ .env dosyasında DISCORD_TOKEN eksik.');
    process.exit(1);
  }

  const count = await loadPersistedSettings();
  console.log(`💾 ${count} sunucunun ayarı yüklendi.`);

  await client.login(config.token);

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
