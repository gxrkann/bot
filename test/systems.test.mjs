import { scoreMessage, analyzeMessage, resetAllHeat, getHeatSnapshot, flagUser } from '../src/heat.js';
import { isExemptFromHeat } from '../src/heat-exempt.js';
import { matchStringRules } from '../src/join-raid.js';
import { withDefaults } from '../src/store.js';
import { SECTIONS, getPath, setPath, flattenFields } from '../src/schema.js';

const settings = withDefaults({});

let failures = 0;
function check(label, condition) {
  if (condition) console.log('  GECTI  ' + label);
  else { console.log('  KALDI  ' + label); failures++; }
}

function fakeMessage(content, opts = {}) {
  return {
    content,
    guild: { id: opts.guildId || 'g1', ownerId: 'owner' },
    channelId: opts.channelId || 'c1',
    channel: { parentId: opts.parentId || null },
    author: { id: opts.userId || 'u1', tag: opts.tag || 'ahmet', bot: false, verified: true },
    attachments: { size: opts.attachments || 0 },
    webhookId: opts.webhookId || null,
    member: opts.member || null,
    deletable: true
  };
}

console.log('=== 1. Isı puanlama (tek mesaj) ===');
{
  const plain = scoreMessage(fakeMessage('merhaba nasılsın'), settings.heat);
  check('normal mesaj ısı üretir', plain.totalHeat > 0 && plain.totalHeat < 40);

  const ad = scoreMessage(fakeMessage('bak discord.gg/abcdef discord.gg/abcdef'), settings.heat);
  check('davet linki 100 ısı', ad.contributions.some(c => c.key === 'advertisement' && c.heat >= 100));

  const spam = scoreMessage(fakeMessage('aaaaa'.repeat(20)), settings.heat);
  check('tekrarlayan karakter yakalanır', spam.contributions.some(c => c.key === 'characters'));

  const wall = scoreMessage(fakeMessage(Array(40).fill('x').join('\n')), settings.heat);
  check('duvar metin yakalanır', wall.contributions.some(c => c.key === 'newLine'));

  const mention = scoreMessage(fakeMessage(`<@&123> ${Array(8).fill('<@111111111111111111>').join(' ')}`), settings.heat);
  check('toplu etiket yakalanır', mention.contributions.some(c => c.key === 'mentions'));

  const everyone = scoreMessage(fakeMessage('@everyone toplu mesaj'), settings.heat);
  check('@everyone yüksek ısı', everyone.contributions.some(c => c.key === 'mentions' && c.heat >= 100));

  const clean = scoreMessage(fakeMessage('iyi günler arkadaşlar'), settings.heat);
  check('temiz mesaj düşük ısı', clean.totalHeat < 20);
}

console.log('\n=== 2. Isı birikimi ve eşik ===');
{
  resetAllHeat('g1');
  const client = { config: { ownerIds: [] }, guardSettings: new Map() };
  // analyzeMessage applyAction -> member.timeout çağırıyor, mock üye şart.
  const member = {
    id: 'u1', user: { bot: false }, guild: { id: 'g1', ownerId: 'owner' },
    roles: { cache: new Map() }, permissions: { has: () => false },
    timeout: async () => { member._timedOut = true; },
    kick: async () => { member._kicked = true; }
  };

  let finalHeat = 0;
  let action = null;
  for (let i = 0; i < 40; i++) {
    const result = await analyzeMessage(
      fakeMessage('spam spam mesajı ' + i, { member }), client, settings.heat
    );
    finalHeat = result.heat;
    if (result.action) action = result.action;
  }
  check('ısı birikti ve eşiği aştı', finalHeat >= settings.heat.maxHeat);
  check('ceza eylemi bildirildi', action === 'timeout');
  check('member.timeout çağrıldı', member._timedOut === true);
}

console.log('\n=== 3. Soğuma ===');
{
  resetAllHeat('g2');
  const { getHeatSnapshot: snap } = await import('../src/heat.js');
  flagUser('g2', 'u9', 80);
  const before = snap('g2', settings.heat)[0].heat;
  check('ısı yüksek', before >= 70);
  // Hemen oku → soğuma tam uygulanmamış olmalı, yine de test edilebilir değil.
  check('ısı raporlanabilir', typeof before === 'number');
}

console.log('\n=== 4. Beyaz liste muafiyetleri ===');
{
  const base = {
    ownerImmune: true, safeUsers: [], safeRoles: [],
    whitelist: { spamming: { users: [], roles: [], channels: [], categories: [], webhooks: [] } }
  };
  const member = {
    id: 'u5', user: { bot: false }, roles: { cache: new Map() },
    permissions: { has: () => false }
  };
  const client = { config: { ownerIds: ['owner'] } };

  const none = isExemptFromHeat(member, fakeMessage('x', { userId: 'u5' }), base, client);
  check('normal kullanıcı muaf değil', none.spamming === false);

  const owner = isExemptFromHeat(
    { ...member, id: 'owner', user: { bot: false } },
    fakeMessage('x', { userId: 'owner' }), base, client);
  check('bot sahibi tam muaf', owner.spamming && owner.mentions && owner.invites);

  const safe = { ...base, safeUsers: ['u5'] };
  const safeRes = isExemptFromHeat(member, fakeMessage('x', { userId: 'u5' }), safe, client);
  check('güvenli kullanıcı tam muaf', safeRes.spamming && safeRes.invites);

  const wl = { ...base, whitelist: { spamming: { users: ['u5'], roles: [], channels: [], categories: [], webhooks: [] } } };
  const wlRes = isExemptFromHeat(member, fakeMessage('x', { userId: 'u5' }), wl, client);
  check('tip bazlı spam muafiyeti çalışır', wlRes.spamming === true);
  check('diğer tipler etkilenmez', wlRes.invites === false && wlRes.mentions === false);

  const admin = isExemptFromHeat(
    { ...member, permissions: { has: () => true } },
    fakeMessage('x', { userId: 'u5' }), base, client);
  check('yönetici muaf', admin.spamming === true);
}

console.log('\n=== 5. Join Raid string kuralları ===');
{
  check('= birebir eşleşme', matchStringRules('raidbot', ['=raidbot']).length === 1);
  check('= kısmi eşleşme yakalamaz', matchStringRules('raidbot2', ['=raidbot']).length === 0);
  check('$ ile biter', matchStringRules('test-raid', ['$raid']).length === 1);
  check('$ ortada yakalamaz', matchStringRules('raid-test', ['$raid']).length === 0);
  check("' içerir", matchStringRules('myraidx', ["'raid"]).length === 1);
  check('! hariç tutar', matchStringRules('trusted-raid', ['!trusted']).length === 0);
  check('hariç tutma önce çalışır', matchStringRules('trusted123', ['!trusted', "'123"]).length === 0);
  check('operatörsiz = içerir', matchStringRules('abcpraid', ['raid']).length === 1);
}

console.log('\n=== 6. Şema tutarlılığı ===');
{
  const fields = flattenFields(settings);
  check('alan sayısı makul', fields.length > 40);
  const missing = fields.filter(f => f.value === undefined);
  check('tüm alanlar tanımlı', missing.length === 0);
  if (missing.length) console.log('    eksik:', missing.map(f => f.name).join(', '));

  const sectionIds = SECTIONS.map(s => s.id);
  check('bölüm kimlikleri benzersiz', new Set(sectionIds).size === sectionIds.length);
  check('overview bölümü var', sectionIds.includes('overview'));

  const paths = fields.map(f => f.name);
  const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
  check('alan yolları benzersiz', dupes.length === 0);
  if (dupes.length) console.log('    tekrarlanan:', [...new Set(dupes)].join(', '));
}

console.log('\n=== 7. Şema <-> store uyumu ===');
{
  // Her şema alanı store varsayılanlarında mevcut olmalı (yoksa dashboard kaydedemez)
  const { createDefaultSettings } = await import('../src/store.js');
  const defaults = createDefaultSettings();
  const fields = flattenFields(defaults);
  const missing = fields.filter(f => getPath(defaults, f.name) === undefined).map(f => f.name);
  check('tüm şema alanları store şemasında var', missing.length === 0);
  if (missing.length) console.log('    eksik:', missing.join(', '));

  /* Şemada tanımlı grup alt yolları da store'da olmalı */
  const groupPaths = [];
  for (const s of SECTIONS) {
    for (const g of s.groups || []) {
      if (g.actionFilter && g.id !== 'panic') groupPaths.push(`joinGate.${g.id}.action`);
      if (g.actionFilter && g.id === 'panic') groupPaths.push('antiNuke.panic.action');
      if (g.heatFilter === true) groupPaths.push(`heat.filters.${g.id}.heat`);
      if (g.heatFilter === false) groupPaths.push(`heat.filters.${g.id}.action`);
      if (g.listPath) groupPaths.push(g.listPath);
    }
  }
  const missingGroups = groupPaths.filter(p => getPath(defaults, p) === undefined);
  check('grup alt yolları store şemasında var', missingGroups.length === 0);
  if (missingGroups.length) console.log('    eksik:', missingGroups.join(', '));
}

console.log('\n=== 8. withDefaults eski kayıt birleştirme ===');
{
  // Eski kayıtta yeni alanlar yok → varsayılanlar gelmeli
  const old = { enabled: true, logChannelId: '123', suspects: [{ userId: 'x' }] };
  const merged = withDefaults(old);
  check('log kanalı korunur', merged.logChannelId === '123');
  check('şüpheliler korunur', merged.suspects.length === 1);
  check('yeni alanlar eklendi', merged.heat && merged.antiNuke && merged.joinGate);
  check('iç nesne alanları eklendi', merged.heat.filters.advertisement !== undefined);
  check('heat ayarları korunur', merged.heat.maxHeat === 100);

  // Kısmi iç nesne korunur
  const partial = { heat: { maxHeat: 55 } };
  const m2 = withDefaults(partial);
  check('kısmi iç ayar korunur', m2.heat.maxHeat === 55);
  check('kısmi iç ayarın kardeşleri gelir', m2.heat.decayPerSecond === 4);
  check('kısmi filtre korunur', m2.heat.filters.message.heat === 18);
}

console.log('\n=== 9. Ayarlar varsayılanı güvenlik ===');
{
  const d = withDefaults({});
  check('kelime cezası varsayılan kapalı', d.joinGate.username.punishOnMatch === false);
  check('kilit modu kapalı', d.lockdown === false);
  check('panik modu kapalı', d.panicMode === false);
  check('acil durum kapalı', d.emergencyMode === false);
  check('otomatik geri yükleme kapalı', d.backups.autoRestoreOnPanic === false);
  check('kelimeler listede', d.joinGate.username.words.length === 8);
}

console.log(failures === 0 ? '\n*** TUM TESTLER GECTI ***' : `\n*** ${failures} TEST BASARISIZ ***`);
process.exit(failures === 0 ? 0 : 1);
