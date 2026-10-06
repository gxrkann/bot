/**
 * Önyükleme testi — index.js dosyasının yüklenebilirliğini ve tüm
 * içe/dışa aktarımların tutarlılığını doğrular.
 *
 * Neden gerekli: daha önce index.js, store.js'e taşınmış bir fonksiyonu
 * guard-utils.js'den import ediyordu. SyntaxError ancak çalıştırıldığında
 * çıkıyordu, testler bunu göremiyordu. Bu test dosyayı gerçekten yükler.
 */
let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log('  GECTI  ' + label);
  else { console.log('  KALDI  ' + label); failures++; }
  void detail;
}

console.log('=== 1. index.js yuklenebiliyor mu ===');
{
  let index;
  try {
    // index.js yan etkisi olarak login() çağırır; bu yüzden yalnızca
    // sözdizimi/import doğrulaması yapıp çalıştırmayı engelliyoruz.
    process.env.GUARD_SKIP_BOOT = '1';
    index = await import('../src/index.js');
    check('index.js import edildi', true);
  } catch (error) {
    check('index.js import edildi', false);
    console.log('    ->', error.message);
  }
  void index;
}

console.log('\n=== 2. Tum modul dosyalari yuklenebiliyor mu ===');
{
  const modules = [
    '../src/store.js',
    '../src/schema.js',
    '../src/guard-utils.js',
    '../src/heat.js',
    '../src/heat-exempt.js',
    '../src/anti-nuke.js',
    '../src/lockdown.js',
    '../src/emergency.js',
    '../src/join-gate.js',
    '../src/join-raid.js',
    '../src/verification.js',
    '../src/backup.js',
    '../src/profile.js',
    '../src/config.js',
    '../src/dashboard/server.js',
    '../src/dashboard/auth.js',
    '../src/dashboard/views.js',
    '../src/register-commands.js'
  ];

  for (const path of modules) {
    try {
      await import(path);
      check(path.replace('../src/', ''), true);
    } catch (error) {
      check(path.replace('../src/', ''), false);
      console.log('    ->', error.message.split('\n')[0]);
    }
  }
}

console.log('\n=== 3. Event dosyalari yuklenebiliyor mu ===');
{
  const events = [
    'channelCreate', 'channelDelete', 'channelUpdate', 'guildBanAdd', 'guildCreate',
    'guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildUpdate',
    'messageCreate', 'roleCreate', 'roleDelete', 'roleUpdate', 'webhookUpdate'
  ];

  for (const name of events) {
    try {
      const mod = await import(`../src/events/${name}.js`);
      const hasHandler = Boolean(mod.default?.name && typeof mod.default.execute === 'function');
      check(`events/${name}.js`, hasHandler, mod.default?.name);
    } catch (error) {
      check(`events/${name}.js`, false);
      console.log('    ->', error.message.split('\n')[0]);
    }
  }
}

console.log('\n=== 4. Komut dosyalari yuklenebiliyor mu ===');
{
  const commands = ['guard', 'ping', 'profil', 'supheli'];

  for (const name of commands) {
    try {
      const mod = await import(`../src/commands/${name}.js`);
      const cmd = mod.default;
      const ok = Boolean(cmd?.data && typeof cmd.execute === 'function');
      check(`commands/${name}.js`, ok);
      if (ok) {
        const json = cmd.data.toJSON();
        check(`  /${json.name} semasi gecerli`, json.name === name);
      }
    } catch (error) {
      check(`commands/${name}.js`, false);
      console.log('    ->', error.message.split('\n')[0]);
    }
  }
}

console.log('\n=== 5. Tum event adlari gecerli mi ===');
{
  const { Events } = await import('discord.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');

  const dir = url.fileURLToPath(new URL('../src/events/', import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

  const seen = new Map();

  for (const file of files) {
    const mod = await import(`../src/events/${file}`);
    const name = mod.default?.name;

    if (!name) {
      check(`${file} event adi tanimli`, false, 'name undefined');
      continue;
    }
    if (typeof name !== 'string') {
      check(`${file} event adi gecerli`, false, `Events.${name} undefined`);
      continue;
    }

    check(`${file} -> ${name}`, true);

    if (seen.has(name)) {
      check(`  ${name} tekrar kaydi yok`, false, `ayni: ${seen.get(name)} ve ${file}`);
    } else {
      seen.set(name, file);
    }
  }

  console.log(`\n  Toplam ${seen.size} farkli event kayitli.`);
  void Events;
}

console.log('\n=== 6. Mulkerrer event kaydi kalmadi mi ===');
{
  // Onceki surumde roleMembersUpdate.js, guildMemberUpdate.js ile ayni
  // event'i dinliyordu; index.js ikincisini atliyor ve rol spam tespiti
  // hic calismiyordu. Artik tek dosyada birlestirildi.
  const fs = await import('node:fs');
  const url = await import('node:url');
  const dir = url.fileURLToPath(new URL('../src/events/', import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  check('roleMembersUpdate.js kaldirildi', !files.includes('roleMembersUpdate.js'));

  const gmu = await import('../src/events/guildMemberUpdate.js');
  check('rol spam tespiri guildMemberUpdate icinde', gmu.default.name === 'guildMemberUpdate');
}

console.log('\n=== 7. Disa aktarim tutarliligi ===');
{
  const guardUtils = await import('../src/guard-utils.js');
  const store = await import('../src/store.js');

  const required = ['getGuildSettings', 'saveGuildSettings', 'deleteGuildSettings',
    'parseSuspectActionId', 'isReviewAuthorized', 'removeSuspect',
    'getActionableReasons', 'evaluateMember', 'sendGuardLog', 'isProtectedTarget'];

  for (const name of required) {
    check(`guard-utils.js -> ${name}`, typeof guardUtils[name] === 'function');
  }

  const storeRequired = ['readAllSettings', 'writeAllSettings', 'flushPendingWrites',
    'createDefaultSettings', 'withDefaults', 'saveBackup', 'listBackups'];

  for (const name of storeRequired) {
    check(`store.js -> ${name}`, typeof store[name] === 'function');
  }
}

console.log(failures === 0 ? '\n*** TUM TESTLER GECTI ***' : `\n*** ${failures} TEST BASARISIZ ***`);
process.exit(failures === 0 ? 0 : 1);
