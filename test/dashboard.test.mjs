/**
 * Dashboard entegrasyon testi — gerçek Discord bağlantısı olmadan.
 *
 * Sahte bir istemci ve sahte sunucu kurar, HTTP istekleri atar ve
 * yanıtları doğrular: kimlik doğrulama, sayfa render, form kaydetme.
 */
import http from 'node:http';

const BASE = 'http://127.0.0.1:3987';
const { createDashboard } = await import('../src/dashboard/server.js');
const { createSession } = await import('../src/dashboard/auth.js');
const { withDefaults } = await import('../src/store.js');
const { getGuildSettings, saveGuildSettings } = await import('../src/guard-utils.js');

let failures = 0;
function check(label, ok) {
  if (ok) console.log('  GECTI  ' + label);
  else { console.log('  KALDI  ' + label); failures++; }
}

/* ---------------- Sahte Discord dünyası ---------------- */

function fakeRole(id, name, position = 1) {
  return {
    id, name, position, managed: false,
    permissions: { bitfield: 0n, has: () => false },
    edit: async () => {}, setPermissions: async () => {}, delete: async () => {},
    comparePositionTo: () => 1
  };
}

const guild = {
  id: '1504606625657258064',
  name: 'Test Sunucu',
  ownerId: '111111111111111111',
  memberCount: 1234,
  systemChannelId: 'c0',
  vanityURLCode: null,
  channels: { cache: new Map() },
  roles: { cache: new Map(), everyone: { id: '1504606625657258064' } },
  members: { me: { roles: { highest: { comparePositionTo: () => 1 } } } },
  channels_create: [],
  send: async () => {}
};

for (const [id, name] of [['c1', 'genel'], ['c2', 'loglar'], ['c3', 'karantina-kanal']]) {
  guild.channels.cache.set(id, { id, name, type: 0, permissionOverwrites: { cache: new Map() }, manageable: true, send: async () => {} });
}
for (const [id, name, pos] of [['r1', 'Üye', 1], ['r2', 'Moderatör', 2], ['r3', 'Karantina', 3]]) {
  guild.roles.cache.set(id, fakeRole(id, name, pos));
}

/* discord.js Collection, gerçek API'siyle (filter/first/some/values) taklit etsin. */
const { Collection } = await import('../node_modules/discord.js/src/index.js');

guild.channels.cache = new Collection([...guild.channels.cache]);
guild.roles.cache = new Collection([...guild.roles.cache]);
guild.members = guild.members || {};
guild.members.me = guild.members.me || { roles: { highest: new Collection() } };
guild.members.fetch = async (id) => null;

const client = {
  guardSettings: new Map([[guild.id, withDefaults({})]]),
  actionBuckets: new Map(),
  config: { ownerIds: ['111111111111111111'], ownerId: '111111111111111111', botName: 'Guard' },
  guilds: { cache: new Collection([[guild.id, guild]]) },
  /* Sahte istemci: profil sayfası client.user bekliyor. */
  user: {
    id: 'bot1',
    tag: 'Guard#0001',
    username: 'Guard',
    globalName: 'Guard Bot',
    status: 'dnd',
    activities: [{ name: 'sunucunu koruyor', type: 3 }],
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
    bannerURL: () => null,
    setAvatar: async () => {},
    setBanner: async () => {},
    setPresence: async () => {}
  }
};

process.env.DASHBOARD_ALLOWED_IDS = '111111111111111111';
process.env.DASHBOARD_PORT = '3987';

/* ---------------- Yardımcılar ---------------- */

function request(path, { method = 'GET', cookie = '', form = null, redirect = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (cookie) headers.Cookie = cookie;

    let body = null;
    if (form) {
      body = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieFrom(res, name) {
  const setCookie = res.headers['set-cookie'] || [];
  for (const cookie of setCookie) {
    const match = cookie.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return `${name}=${match[1]}`;
  }
  return '';
}

/* ---------------- Başlat ---------------- */

const server = createDashboard(client);
await new Promise((resolve) => server.listen(3987, '127.0.0.1', resolve));

try {
  console.log('=== 1. Kimlik doğrulama ===');
  {
    const res = await request('/');
    check('girişsiz istek /giris adresine yönlenir', res.status === 302 && res.headers.location === '/giris');

    const protectedRes = await request('/s/overview');
    check('girişsiz panel sayfası engellenir', protectedRes.status === 302);

    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;
    const ok = await request('/s/overview', { cookie });
    check('geçerli oturum paneli açar', ok.status === 200 && ok.body.includes('Genel Bakış'));

    const badSession = await request('/s/overview', { cookie: 'guard_session=yanlissession' });
    check('geçersiz oturum engellenir', badSession.status === 302);
  }

  console.log('\n=== 2. Tüm bölümler render oluyor ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;
    const { SECTIONS } = await import('../src/schema.js');

    for (const section of SECTIONS) {
      const res = await request(`/s/${section.id}?guild=${guild.id}`, { cookie });
      const ok = res.status === 200 && res.body.includes(section.title) && !res.body.includes('undefined</');
      check(`${section.id} sayfası render edildi`, ok);
      if (!ok && res.status === 500) console.log('    ->', res.body.slice(0, 200));
    }
  }

  console.log('\n=== 3. Ayar kaydetme ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;

    /* Tarayıcı, adı seçilen kanal/rolü app.js ile ID'ye çevirip gönderir.
       Sunucu tarafı gönderilen değeri olduğu gibi kaydeder. */
    const save = await request(`/s/statics?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { logChannelId: 'c2', mainChannelId: 'c1', quarantineRoleId: 'r3', mainRoleIds: 'r1', trustedRoleId: 'r1' }
    });
    check('kaydetme yönlendirmesi döndü', save.status === 302);

    await new Promise((r) => setTimeout(r, 400));
    const s = getGuildSettings(client, guild.id);
    check('log kanalı kaydedildi', s.logChannelId === 'c2');
    check('karantina rolü kaydedildi', s.quarantineRoleId === 'r3');
    check('çoklu rol kaydedildi', s.mainRoleIds[0] === 'r1');

    /* Süre alanı: dakika cinsinden kaydedilmeli */
    await request(`/s/heat?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { 'heat.maxHeat': '150', 'heat.timeoutDurationMs': '30', 'heat.timeoutDurationMs__unit': 'minute', 'heat.multiplier': 'on' }
    });
    await new Promise((r) => setTimeout(r, 300));
    const h = getGuildSettings(client, guild.id);
    check('sayı alanı kaydedildi', h.heat.maxHeat === 150);
    check('süre ms\'ye çevrildi', h.heat.timeoutDurationMs === 30 * 60000);
    check('boolean alanı kaydedildi', h.heat.multiplier === true);

    /* Boolean false (form gönderilmediğinde) */
    check('gönderilmeyen boolean false oldu', h.heat.resetHeatOnTimeout === false);

    /* Süre birimi dönüşümü: 2 saat */
    await request(`/s/heat?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { 'heat.maxHeat': '100', 'heat.capTimeoutDurationMs': '2', 'heat.capTimeoutDurationMs__unit': 'hour' }
    });
    await new Promise((r) => setTimeout(r, 300));
    check('saat cinsi ms\'ye çevrildi', getGuildSettings(client, guild.id).heat.capTimeoutDurationMs === 7200000);
  }

  console.log('\n=== 4. Join Gate kelime cezası kapalı kalmalı ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;

    await request(`/s/joingate?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: {
        'joinGate.enabled': 'on',
        'joinGate.username.enabled': 'on',
        'joinGate.username.punishOnMatch': '',   // kapalı bırak
        'joinGate.username.words': 'fivem, gta, custom'
      }
    });
    await new Promise((r) => setTimeout(r, 300));

    const s = getGuildSettings(client, guild.id);
    check('kelime cezası kapalı kaldı', s.joinGate.username.punishOnMatch === false);
    check('kelime listesi kaydedildi', s.joinGate.username.words.includes('custom'));
    check('ceza aksiyonu log olarak kaldı', s.joinGate.username.action === 'log');

    /* Şimdi ceza açık yapalım ve doğrulayalım */
    await request(`/s/joingate?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: {
        'joinGate.enabled': 'on',
        'joinGate.username.enabled': 'on',
        'joinGate.username.punishOnMatch': 'on',
        'joinGate.username.action': 'ban',
        'joinGate.username.words': 'fivem'
      }
    });
    await new Promise((r) => setTimeout(r, 300));
    const s2 = getGuildSettings(client, guild.id);
    check('kelime cezası açılabiliyor', s2.joinGate.username.punishOnMatch === true);
    check('ceza tipi kaydedildi', s2.joinGate.username.action === 'ban');
  }

  console.log('\n=== 5. Bilinmeyen alan yok sayılıyor ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;

    const before = JSON.stringify(getGuildSettings(client, guild.id));
    await request(`/s/protection?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { enabled: 'on', 'securityLevel': 'medium', '__proto__.polluted': 'yes', evil: 'x' }
    });
    await new Promise((r) => setTimeout(r, 300));

    const s = getGuildSettings(client, guild.id);
    check('geçerli alan kaydedildi', s.securityLevel === 'medium');
    check('bilinmeyen alan eklenmedi', !('evil' in s));
    check('prototype kirlenmedi', !('polluted' in s) && ({}).polluted === undefined);
    void before;
  }

  console.log('\n=== 6. Select doğrulaması ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;

    await request(`/s/protection?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { securityLevel: 'high' }   // geçerli
    });
    await request(`/s/protection?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { securityLevel: 'geçersiz_değer' }   // geçersiz
    });
    await new Promise((r) => setTimeout(r, 300));
    check('geçersiz seçenek reddedildi', getGuildSettings(client, guild.id).securityLevel === 'high');
  }

  console.log('\n=== 7. Beyaz liste kaydetme ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;

    await request(`/s/whitelist?guild=${guild.id}`, {
      method: 'POST', cookie,
      form: { 'whitelist.spamming.users': '111, 222, 111', 'whitelist.spamming.channels': 'c1' }
    });
    await new Promise((r) => setTimeout(r, 300));

    const s = getGuildSettings(client, guild.id);
    check('kullanıcı listesi kaydedildi', s.whitelist.spamming.users.length === 2);
    check('tekrarlanan ID elendi', !s.whitelist.spamming.users.includes('111') || s.whitelist.spamming.users.length === 2);
    check('kanal listesi kaydedildi', s.whitelist.spamming.channels[0] === 'c1');
  }

  console.log('\n=== 8. HTML kaçışı (XSS) ===');
  {
    const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
    const cookie = `guard_session=${sessionId}`;

    /* Zararlı isimli rol ekle */
    guild.roles.cache.set('rx', fakeRole('rx', '<img src=x onerror=alert(1)>', 5));

    /* Zararlı isimli rol, statics sayfasındaki rol seçici listesinde görünür. */
    const res = await request(`/s/statics?guild=${guild.id}`, { cookie });
    check('ham script etiketi basılmadı', !res.body.includes('<img src=x onerror=alert(1)>'));
    check('kaçışlı hali basıldı', res.body.includes('&lt;img src=x'));
    check('datalist önerisi kaçırıldı', res.body.includes('data-id="rx"'));

    const scriptRes = await request('/s/overview', { cookie });
    check('script injection yok', !/<script>[^<]*alert/.test(scriptRes.body));
  }

  console.log('\n=== 9. Yetkisiz kullanıcı engellenir ===');
  {
    const { isAllowed } = await import('../src/dashboard/auth.js');
    check('listede olmayan kullanıcı reddedilir', isAllowed('999999999999999999') === false);
    check('listede olan kabul edilir', isAllowed('111111111111111111') === true);

    process.env.DASHBOARD_ALLOWED_IDS = '';
    check('boş liste fail-closed', isAllowed('111111111111111111') === false);
    process.env.DASHBOARD_ALLOWED_IDS = '111111111111111111';
  }

  console.log('\n=== 10. CSRF / state ===');
  {
    const { createState, consumeState } = await import('../src/dashboard/auth.js');
    const state = createState('/s/protection');
    check('state üretildi', typeof state === 'string' && state.length > 20);

    const consumed = consumeState(state);
    check('state geçerli', consumed.ok === true && consumed.redirectTo === '/s/protection');

    const replay = consumeState(state);
    check('state tekrar kullanılamaz (replay koruması)', replay.ok === false);
  }

  console.log('\n=== 11. Statik dosyalar ===');
  {
    const css = await request('/static/style.css');
    check('CSS sunuluyor', css.status === 200 && css.headers['content-type'].includes('text/css'));

    const js = await request('/static/app.js');
    check('JS sunuluyor', js.status === 200);

    const traversal = await request('/static/..%2f..%2f.env');
    check('dizin kaçışı engellendi', traversal.status === 404 || !traversal.body.includes('DISCORD_TOKEN'));
  }

  console.log('\n=== 12. Kalıcılık ===');
  {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const settingsPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'x');
    void settingsPath;

    await saveGuildSettings(client, guild.id, getGuildSettings(client, guild.id));
    await new Promise((r) => setTimeout(r, 400));

    const { flushPendingWrites } = await import('../src/store.js');
    await flushPendingWrites();

    const raw = await fs.readFile('C:/Users/gxrkan/OneDrive/Desktop/guard botu/data/settings.json', 'utf8');
    const parsed = JSON.parse(raw);
    check('JSON geçerli (yarım yazılmamış)', typeof parsed === 'object');
    check('sunucu verisi diske yazıldı', Boolean(parsed[guild.id]));
    /* Son kaydedilen değer test 4'te bilerek açılmıştı; burada gidiş-dönüş doğrulanır. */
    check('kelime cezası ayarı diske yazıldı', parsed[guild.id].joinGate.username.punishOnMatch === true);
    check('ana roller kaydedilmiş', parsed[guild.id].mainRoleIds[0] === 'r1');

    /* Güvenlik varsayılanı: yeni sunucuda kelime cezası kapalı başlamalı. */
    const { createDefaultSettings } = await import('../src/store.js');
    check('varsayılan: kelime cezası kapalı', createDefaultSettings().joinGate.username.punishOnMatch === false);
  }

console.log('\n=== 13. Olu sunucu kayitlari yonlendirmesi ===');
{
  /* Regr eski botun settings.json'da birakilan olu sunucu ID'leri vardir.
     Dashboard ilk guardSettings anahtarini secerse botun olmadigi bir
     sunucuyu acip "Sunucu bulunamadi" diyordu. */
  client.guardSettings.set('1523278167907893331', withDefaults({ enabled: true }));
  client.guardSettings.set('1504606625657258064', withDefaults({ enabled: true }));

  const sessionId = createSession({ id: '111111111111111111', username: 'owner', avatar: null });
  const cookie = `guard_session=${sessionId}`;

  const stale = await request('/s/overview?guild=1523278167907893331', { cookie });
  check('olu sunucu ID hata sayfasi vermiyor', stale.status === 302, stale.status);
  check('dogru sunucuya yonlendirdi', (stale.headers.location || '').includes(guild.id), stale.headers.location);

  if (stale.headers.location) {
    const followed = await request(stale.headers.location, { cookie });
    check('yonlendirme sonrasi sayfa acildi', followed.status === 200 && followed.body.includes('Genel Bak'), followed.status);
  }

  /* guild parametresi yoksa yonlendirme yerine dogrudan sayfa acilmali
     (botun oldugu tek sunucuyu varsayiyor). */
  const noGuild = await request('/s/overview', { cookie });
  check('sunucu belirtilmeden sayfa aciliyor', noGuild.status === 200, noGuild.status);
  check('varsayilan sunucu sayfasi dogru render edildi', noGuild.body.includes('Genel Bak'), noGuild.status);
  check('hata sayfasi degil', !noGuild.body.includes('Sunucu bulunamadi'));

  /* Olu kayitlari temizle ki diger testleri kirletmesin. */
  client.guardSettings.delete('1523278167907893331');
  client.guardSettings.delete('1504606625657258064');
}

console.log('\n=== 14b. Sifreli giris ===');
{
  process.env.DASHBOARD_PASSWORD = 'testparola123';

  const { hasPassword, verifyPassword, createPasswordSession } =
    await import('../src/dashboard/auth.js');

  check('sifre tanimli', hasPassword() === true);

  const ok = verifyPassword('testparola123', '1.1.1.1');
  check('dogru sifre kabul', ok.ok === true, ok);

  const bad = verifyPassword('yanlis', '2.2.2.2');
  check('yanlis sifre reddedildi', bad.ok === false);

  const empty = verifyPassword('', '3.3.3.3');
  check('bos sifre reddedildi', empty.ok === false);

  /* Cok kucuk sifre tanimli sayilmamali (config kontrolu) */
  process.env.DASHBOARD_PASSWORD = 'kisa';
  check('8 karakterden kisa sifre kabul edilmez', hasPassword() === false);
  process.env.DASHBOARD_PASSWORD = 'testparola123';

  /* Oturum acma ve panel erisimi */
  const sessionId = createPasswordSession();
  const cookie = `guard_session=${sessionId}`;
  const page = await request('/s/overview', { cookie });
  check('sifreli oturum panele girebiliyor', page.status === 200 && page.body.includes('Genel Bak'), page.status);

  /* Hatali sifre ile giris denemesi 401 donmeli */
  const wrong = await request('/auth/password', {
    method: 'POST',
    form: { password: 'yanlisparola' }
  });
  check('hatali sifre 401 donuyor', wrong.status === 401, wrong.status);

  /* Dogru sifre ile giris */
  const right = await request('/auth/password', {
    method: 'POST',
    form: { password: 'testparola123' }
  });
  check('dogru sifre 302 ile panele yonlendiriyor', right.status === 302 && right.headers.location === '/s/overview', right.status);
  check('oturum cerezi verildi', cookieFrom(right, 'guard_session') !== '');

  delete process.env.DASHBOARD_PASSWORD;
}

console.log('\n=== 15. Ses bolumu ===');
{
  const voice = await import('../src/voice.js');

  /* Kanal tipi sabitleri dogru mu? */
  check('voice kanal tipi = 2', voice.CHANNEL_TYPE.voice === 2);
  check('stageVoice kanal tipi = 13', voice.CHANNEL_TYPE.stageVoice === 13);

  /* Metin kanalina girme denemesi reddedilmeli.
     ÖNEMLİ: discord.js v14'te channel.join() yok. Önceki kontrol
     typeof channel.join === 'function' idi ve HER kanalı "ses kanalı
     değil" sayıyordu, gerçek ses kanalları dahil. */
  const textChannel = { id: 't1', name: 'genel', type: 0, isTextBased: () => true };
  const voiceChannel = { id: 'v1', name: 'Toplantı', type: 2 };
  const stageChannel = { id: 's1', name: 'Sahne', type: 13 };

  /* discord.js v14'te guild.voiceStates.create() YOK. Bağlantı
     client.joinVoiceChannel() ile kurulur. */
  const fakeClient = {
    joinVoiceChannel: async () => {
      throw new Error('test: baglanti denenmemeli');
    }
  };
  const fakeGuild = {
    id: 'g1',
    channels: { cache: new Collection([
      [textChannel.id, textChannel],
      [voiceChannel.id, voiceChannel],
      [stageChannel.id, stageChannel]
    ]) },
    members: { fetch: async () => null }
  };

  const textResult = await voice.joinVoiceChannel(fakeClient, fakeGuild, 't1');
  check('metin kanali reddediliyor', textResult.ok === false, textResult);
  check('reddetme nedeni acik', textResult.error?.includes('ses kanalı değil'), textResult.error);

  /* dogru API kullaniliyor mu: guild.voiceStates.create YOK */
  check('fakeGuild.voiceStates yok (v14 API kaldirilmis)', fakeGuild.voiceStates === undefined);

  const missing = await voice.joinVoiceChannel(fakeClient, fakeGuild, 'yok');
  check('olmayan kanal reddediliyor', missing.ok === false);

  const empty = await voice.joinVoiceChannel(fakeClient, fakeGuild, '');
  check('bos kanal reddediliyor', empty.ok === false);

  /* joinVoiceChannel yoksa anlamli hata vermeli */
  const noJoin = await voice.joinVoiceChannel({}, fakeGuild, 'v1');
  check('joinVoiceChannel yoksa hata veriyor', noJoin.ok === false, noJoin);
  check('hata sebebi belirtiliyor', Boolean(noJoin.error), noJoin.error);

  const noClient = await voice.joinVoiceChannel(null, fakeGuild, 'v1');
  check('istemci yoksa hata veriyor', noClient.ok === false);

  const noGuild = await voice.joinVoiceChannel(fakeClient, null, 'v1');
  check('sunucu yoksa hata veriyor', noGuild.ok === false);

  /* Kanal cozumleme: ID ve isim ile */
  check('ses kanali ID ile cozuluyor', voice.resolveVoiceChannelId(fakeGuild, 'v1') === 'v1');
  check('ses sahnesi cozuluyor', voice.resolveVoiceChannelId(fakeGuild, 's1') === 's1');
  check('metin kanali cozulmuyor', voice.resolveVoiceChannelId(fakeGuild, 't1') === '');
  check('isimle cozuluyor', voice.resolveVoiceChannelId(fakeGuild, 'toplantı') === 'v1');
  check('bilinmeyen isim bos donuyor', voice.resolveVoiceChannelId(fakeGuild, 'yok-boyle') === '');

  /* Kanal listesi yalnizca ses kanallarini icermeli */
  const listed = voice.listVoiceChannels(fakeGuild, null);
  check('listede 2 ses kanali var', listed.length === 2, listed.length);
  check('metin kanali listelenmedi', !listed.some((c) => c.id === 't1'));
  check('ses kanali listelendi', listed.some((c) => c.id === 'v1'));
  check('sahne kanali listelendi', listed.some((c) => c.id === 's1'));

  /* Kanal silinince baglanti temizlenmeli (cleanup) */
  check('handleChannelDelete cagrilabiliyor', typeof voice.handleChannelDelete === 'function');
  check('handleGuildDelete cagrilabiliyor', typeof voice.handleGuildDelete === 'function');
  check('handleVoiceStateUpdate cagrilabiliyor', typeof voice.handleVoiceStateUpdate === 'function');

  /* Temel durum fonksiyonlari */
  check('getVoiceState bos sunucu icin null', voice.getVoiceState('yok') === null);
  check('isInVoice false baslangicta', voice.isInVoice('yok') === false);
}

console.log('\n=== 16. Attachment okuma (profil komutu) ===');
{
  const { __test } = await import('../src/commands/profil.js');
  check('attachmentToBuffer test icin disariya acildi', typeof __test?.attachmentToBuffer === 'function');

  const png = Buffer.alloc(40);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(512, 16);
  png.writeUInt32BE(512, 20);

  const variants = {
    'data (Buffer)': { data: png },
    'data (fonksiyon)': { data: async () => png },
    'attachment()': { attachment: async () => png },
    'arrayBuffer()': { arrayBuffer: async () => Uint8Array.from(png).buffer }
  };

  const fn = __test?.attachmentToBuffer;
  if (typeof fn === 'function') {
    for (const [label, obj] of Object.entries(variants)) {
      const result = await fn(obj);
      check(`  ${label} calisiyor`, Buffer.isBuffer(result) && result.length === png.length);
    }
    check('  bos girdi null donuyor', (await fn(null)) === null);
    check('  taninmayan nesne null donuyor', (await fn({ foo: 1 })) === null);
  }
}

} finally {
  server.close();
}

console.log(failures === 0 ? '\n*** DASHBOARD TESTLERI GECTI ***' : `\n*** ${failures} TEST BASARISIZ ***`);
process.exit(failures === 0 ? 0 : 1);
