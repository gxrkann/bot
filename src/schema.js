/**
 * Ayar şemasının tek kaynağı.
 *
 * Dashboard formlarını ve doğrulamayı buradan üretir: her alan için tip,
 * sınırlar ve etiket tanımlı. Yeni bir ayar eklediğinde dashboard otomatik
 * olarak güncellenir, iki yerde ayrı ayrı kod yazılmaz.
 */

export const ACTIONS = ['log', 'timeout', 'kick', 'ban', 'quarantine'];
export const SECURITY_LEVELS = ['low', 'medium', 'high'];

/** Yardımcı: alan tanımı üretici */
function f(name, label, type = 'boolean', extra = {}) {
  return { name, label, type, ...extra };
}

/* ------------------------------------------------------------------ *
 * Bölümler
 * ------------------------------------------------------------------ */

export const SECTIONS = [
  /* ---------------------------------------------------------- */
  {
    id: 'profile',
    title: 'Bot Profili',
    icon: '🖼️',
    description: 'Avatar, banner ve profil altında görünecek yazı. Aynı işlemleri /profil komutuyla da yapabilirsin.',
    readOnly: true
  },

  /* ---------------------------------------------------------- *
   * Section order: overview, statics, protection, joingate, heat,
   * antinuke, joinraid, verification, backups, whitelist, actions,
   * suspects, advanced
   *
   * Profil bölümü kullanıcıya yakın durması için overview'ın hemen
   * arkasına eklendi.
   * ---------------------------------------------------------- */

  /* ---------------------------------------------------------- */
  {
    id: 'overview',
    title: 'Genel Bakış',
    icon: '📊',
    description: 'Korumanın açık olup olmadığı ve sunucunun anlık durumu.',
    readOnly: true
  },

  /* ---------------------------------------------------------- */
  {
    id: 'statics',
    title: 'Statics',
    icon: '🧱',
    description: 'Botun dayandığı roller ve kanallar. Diğer tüm ayarlar bunlara bağlı.',
    fields: [
      f('logChannelId', 'Log kanalı', 'channel'),
      f('modLogChannelId', 'Moderasyon log kanalı', 'channel'),
      f('mainChannelId', 'Ana kanal', 'channel'),
      f('quarantineRoleId', 'Karantina rolü', 'role', { help: 'Anti-Nuke ve Join Gate karantineleri bu role verilir. En yüksek rollerin altına taşı.' }),
      f('reviewRoleId', 'Şüpheli inceleme rolü', 'role'),
      f('trustedRoleId', 'Güvenilir rol (test sonrası)', 'role'),
      f('suspectRoleId', 'Şüpheli rolü', 'role'),
      f('mainRoleIds', 'Ana roller', 'roleMulti', { help: 'Doğrulama başarısında bu roller verilir.' })
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'protection',
    title: 'Koruma',
    icon: '🛡️',
    description: 'Ana açık/kapalı ayarları ve sahipleri muaf tutma.',
    fields: [
      f('enabled', 'Koruma sistemi', 'boolean'),
      f('securityLevel', 'Güvenlik seviyesi', 'select', { options: SECURITY_LEVELS }),
      f('ownerImmune', 'Sahipleri muaf tut', 'boolean', { help: 'Sunucu sahibi ve bot sahipleri hiçbir otomatik cezaya uğramaz.' })
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'joingate',
    title: 'Join Gate',
    icon: '🚪',
    description: 'Katılan her üyeyi bağımsız filtrelerden geçirir. Her filtrenin cezası ayrı ayrı seçilir.',
    fields: [
      f('joinGate.enabled', 'Join Gate açık', 'boolean')
    ],
    groups: [
      {
        id: 'noAvatar',
        label: 'Avatarsız hesaplar',
        actionFilter: true,
        description: 'Profil fotoğrafı olmayan hesaplar.'
      },
      {
        id: 'newAccount',
        label: 'Yeni hesaplar',
        actionFilter: true,
        extra: [f('joinGate.newAccount.minAgeDays', 'Minimum hesap yaşı (gün)', 'number', { min: 0, max: 3650 })]
      },
      { id: 'botAddition', label: 'Yetkisiz bot ekleme', actionFilter: true, description: 'Sunucu sahibi dışında hiçbir kimse bot ekleyemez.' },
      { id: 'unverifiedBot', label: 'Doğrulanmamış botlar', actionFilter: true },
      { id: 'advertisingName', label: 'Adında davet linki', actionFilter: true },
      { id: 'suspiciousAccount', label: 'Şüpheli hesaplar', actionFilter: true, description: 'Değerlendirme sonucu gerçek şüphe üreten hesaplar.' },
      {
        id: 'username',
        label: 'Kullanıcı adı filtresi',
        actionFilter: true,
        fields: [
          f('joinGate.username.punishOnMatch', 'Eşleşmeye ceza uygula', 'boolean', {
            help: 'Kapalıyken kullanıcı adındaki kelimeler SADECE loglanır. Ban/kick uygulanmaz.'
          }),
          f('joinGate.username.words', 'Anahtar kelimeler', 'list', {
            placeholder: 'kelime başka',
            help: 'Her satıra ya da virgülle ayırarak yaz.'
          })
        ]
      }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'heat',
    title: 'Isı Sistemi (Otomatik Moderasyon)',
    icon: '🌡️',
    description: 'Kullanıcı eylemleri ısı puanı olarak birikir, zamanla soğur. Isı maksimum eşiği aşınca otomatik ceza uygulanır.',
    fields: [
      f('heat.enabled', 'Isı sistemi açık', 'boolean'),
      f('heat.maxHeat', 'Maksimum ısı (ceza eşiği)', 'number', { min: 10, max: 1000 }),
      f('heat.decayPerSecond', 'Saniyede soğuma', 'number', { min: 0, max: 100 }),
      f('heat.strikesCap', 'Ceza üst sınırı (strike)', 'number', { min: 1, max: 50 }),
      f('heat.timeoutDurationMs', 'İlk ceza süresi (dk)', 'duration'),
      f('heat.capTimeoutDurationMs', 'Üst sınıra ulaşınca (saat)', 'duration'),
      f('heat.multiplier', 'Çarpan (her ihlalde süre artsın)', 'boolean'),
      f('heat.resetHeatOnTimeout', 'Ceza sonrası ısıyı sıfırla', 'boolean'),
      f('heat.webhookHeat', 'Webhook mesajlarını 1.5x say', 'boolean')
    ],
    groups: [
      { id: 'message', label: 'Normal mesaj', heatFilter: true },
      { id: 'repetition', label: 'Tekrarlayan mesaj', heatFilter: true },
      { id: 'emoji', label: 'Emoji', heatFilter: true },
      { id: 'characters', label: 'Karakter sayısı (duvar metin)', heatFilter: true },
      { id: 'newLine', label: 'Satır sayısı', heatFilter: true },
      { id: 'mentions', label: 'Etiketler', heatFilter: true },
      { id: 'attachments', label: 'Ekler', heatFilter: true },
      { id: 'advertisement', label: 'Reklam / davet linki', heatFilter: true },
      { id: 'nsfw', label: 'NSFW', heatFilter: true },
      { id: 'malicious', label: 'Zararlı bağlantı', heatFilter: true },
      { id: 'words', label: 'Kara liste kelimeleri', heatFilter: true, listPath: 'heat.filters.words.list' },
      { id: 'links', label: 'Bağlantı kara listesi', listPath: 'heat.filters.links.list', heatFilter: false },
      { id: 'inactiveChannel', label: 'Düşük aktiviteli kanal', heatFilter: true }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'antinuke',
    title: 'Anti-Nuke',
    icon: '🚫',
    description: 'Hızlı toplu eylemleri yakalar, saldırganı karantina rolüyle izole eder.',
    fields: [
      f('antiNuke.enabled', 'Anti-Nuke açık', 'boolean'),
      f('antiNuke.action', 'Limit aşılınca', 'select', { options: ACTIONS }),
      f('antiNuke.quarantineHold', 'Quarantine koruması', 'boolean', { help: 'Karantineli üyeye rol vermeye çalışanı cezalandır.' }),
      f('antiNuke.strictMode', 'Katı mod (herkese açık roller dahil)', 'boolean'),
      f('antiNuke.monitorPublicRoles', 'Ana rolleri izle', 'boolean'),
      f('antiNuke.monitorChannelPermissions', 'Kanal izinlerini izle', 'boolean'),
      f('antiNuke.vanityProtection', 'Vanity URL koruması', 'boolean')
    ],
    limits: {
      label: 'Eylem limitleri (dakika / saat)',
      actions: ['channelCreate', 'channelDelete', 'roleCreate', 'roleDelete', 'ban', 'kick', 'webhookCreate', 'webhookDelete'],
      labels: {
        channelCreate: 'Kanal oluşturma',
        channelDelete: 'Kanal silme',
        roleCreate: 'Rol oluşturma',
        roleDelete: 'Rol silme',
        ban: 'Ban',
        kick: 'Kick',
        webhookCreate: 'Webhook oluşturma',
        webhookDelete: 'Webhook silme'
      }
    },
    groups: [
      {
        id: 'panic',
        label: 'Panik modu',
        description: 'Nuke tespit edildiğinde sunucuyu kilitler ve saldırganları izole eder.',
        fields: [
          f('antiNuke.panic.enabled', 'Panik modu açık', 'boolean'),
          f('antiNuke.panic.lockServer', 'Sunucuyu kilitle', 'boolean'),
          f('antiNuke.panic.autoUnlock', 'Süre sonunda otomatik aç', 'boolean'),
          f('antiNuke.panic.durationMs', 'Panik süresi', 'duration'),
          f('antiNuke.panic.quarantineRaiders', 'Saldırganları karantinele', 'boolean'),
          f('antiNuke.panic.warnRoleIds', 'Uyarılacak roller', 'roleMulti')
        ]
      }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'joinraid',
    title: 'Join Raid',
    icon: '🐴',
    description: 'Kısa sürede çok sayıda hesap katılmasını tespit eder.',
    fields: [
      f('joinRaid.enabled', 'Join Raid açık', 'boolean'),
      f('joinRaid.count', 'Tetikleme eşiği (hesap)', 'number', { min: 3, max: 500 }),
      f('joinRaid.windowMs', 'Süre penceresi', 'duration'),
      f('joinRaid.accountType', 'Hangi hesaplar sayılsın', 'select', { options: ['all', 'suspicious'], labels: { all: 'Tüm hesaplar', suspicious: 'Sadece şüpheli işaretli hesaplar' } }),
      f('joinRaid.action', 'Uygulanacak ceza', 'select', { options: ACTIONS }),
      f('joinRaid.quarantineRaiders', 'Saldırganları karantinele', 'boolean'),
      f('joinRaid.warnRoleIds', 'Uyarılacak roller', 'roleMulti')
    ],
    groups: [
      {
        id: 'age',
        label: 'Bayrak: Hesap yaşı',
        fields: [
          f('joinRaid.flags.age.enabled', 'Açık', 'boolean'),
          f('joinRaid.flags.age.maxAgeDays', 'Maksimum gün', 'number', { min: 0, max: 365 })
        ]
      },
      {
        id: 'noAvatar',
        label: 'Bayrak: Avatarsız',
        fields: [f('joinRaid.flags.noAvatar.enabled', 'Açık', 'boolean')]
      },
      {
        id: 'string',
        label: 'Bayrak: İsim deseni',
        fields: [
          f('joinRaid.flags.string.enabled', 'Açık', 'boolean'),
          f('joinRaid.flags.string.rules', 'Kurallar', 'list', {
            placeholder: "=ad, $son, 'içerir, !hariç",
            help: "= birebir eşleşme, $ ile biter, ' içerir, ! hariç tutar."
          })
        ]
      },
      {
        id: 'id',
        label: 'Bayrak: ID deseni',
        fields: [
          f('joinRaid.flags.id.enabled', 'Açık', 'boolean'),
          f('joinRaid.flags.id.granularity', 'Zamanlama', 'select', { options: ['daily', 'monthly', 'adaptive'] }),
          f('joinRaid.flags.id.minMatches', 'Asgari eşleşme', 'number', { min: 1, max: 100 })
        ]
      }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'verification',
    title: 'Doğrulama',
    icon: '🔐',
    description: 'Yeni gelen üyelerin sunucuya girmeden önce doğrulanmasını sağlar.',
    fields: [
      f('verification.enabled', 'Doğrulama açık', 'boolean'),
      f('verification.mode', 'Mod', 'select', { options: ['button', 'code'], labels: { button: 'Buton (tıkla geç)', code: 'Kod gir' } }),
      f('verification.target', 'Hedef', 'select', { options: ['all', 'suspicious'], labels: { all: 'Tüm yeni üyeler', suspicious: 'Sadece şüpheli hesaplar' } }),
      f('verification.action', 'Başarısızlıkta', 'select', { options: ACTIONS }),
      f('verification.durationMs', 'Doğrulama süresi', 'duration'),
      f('verification.channelId', 'Doğrulama kanalı', 'channel', { help: 'Boşsa ana kanal kullanılır.' }),
      f('verification.note', 'Ek not', 'text')
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'backups',
    title: 'Yedekleme ve Geri Yükleme',
    icon: '💾',
    description: 'Sunucunun kanal ve rol anlık görüntülerini alır, nuke sonrası geri yükler.',
    fields: [
      f('backups.enabled', 'Otomatik yedekleme açık', 'boolean'),
      f('backups.intervalMs', 'Yedekleme aralığı', 'duration'),
      f('backups.keep', 'Saklanacak yedek sayısı', 'number', { min: 1, max: 100 }),
      f('backups.autoRestoreOnPanic', 'Panik sonrası otomatik geri yükle', 'boolean', {
        help: '24 saatten eski yedekler kullanılmaz; hasarı artırabilir.'
      })
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'whitelist',
    title: 'Beyaz Liste',
    icon: '⚪',
    description: 'Belirli nesneleri belirli filtrelerden muaf tutar. Yanlış pozitifleri önlemenin en etkili yolu.',
    whitelistTypes: [
      { id: 'spamming', label: 'Spam filtrelerinden muaf', note: 'Isı, tekrarlama, karakter, satır filtreleri' },
      { id: 'mentions', label: 'Etiket spamından muaf', note: 'Üye ve rol etiketleme' },
      { id: 'invites', label: 'Davet linki paylaşımından muaf', note: 'discord.gg / davet bağlantıları' },
      { id: 'publicRoles', label: '@everyone / ana rol pinginden muaf', note: 'Toplu ping' },
      { id: 'quarantine', label: 'Karantineli üyeye dokunabilir', note: 'Karantineli üyeye rol verme izni (dikkatli kullanın)' }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    id: 'actions',
    title: 'Acil Durum',
    icon: '🚨',
    description: 'Acil durum modu ve kilit modu. İkisi de anında uygulanır.',
    readOnly: true
  },

  /* ---------------------------------------------------------- */
  {
    id: 'suspects',
    title: 'Şüpheliler',
    icon: '🔍',
    description: 'İşaretlenen hesaplar ve gerekçeleri. Kelime eşleşmesi olan hesaplar burada görünür ama ceza almamıştır.',
    readOnly: true
  },

  /* ---------------------------------------------------------- */
  {
    id: 'advanced',
    title: 'Gelişmiş',
    icon: '⚙️',
    description: 'Eski ayarlar ve ince ayarlar.',
    fields: [
      f('suspiciousAccountThresholdDays', 'Şüpheli hesap eşiği (gün)', 'number', { min: 0, max: 365 }),
      f('punishNewAccounts', 'Yeni hesaplara otomatik ceza', 'boolean'),
      f('punishKeywordMatches', 'Kullanıcı adı kelimesine ceza', 'boolean', {
        help: 'ÖNERİLMEZ. Kapalı bırakırsan kullanıcı adındaki kelimeler sadece loglanır, ban/kick uygulanmaz.'
      }),
      f('actionThreshold', 'Eşik (toplu eylem)', 'number', { min: 2, max: 100 }),
      f('actionWindowMs', 'Eşik penceresi', 'duration'),
      f('autoDeleteSuspiciousChannels', 'Şüpheli kanalı sil', 'boolean'),
      f('autoDeleteSuspiciousRoles', 'Şüpheli rolü sil', 'boolean'),
      f('autoDeleteSuspiciousMessages', 'Şüpheli mesajı sil', 'boolean'),
      f('autoTimeoutSuspiciousUsers', 'Şüpheli kullanıcıya timeout', 'boolean'),
      f('autoKickUnapprovedBots', 'Onaysız botu at', 'boolean', {
        help: 'Kapalı bırakman önerilir — yetkili biri sunucuya bot eklediğinde hemen atılır.'
      }),
      f('deleteDaysOnBan', 'Banda silinecek mesaj günü', 'number', { min: 0, max: 7 })
    ]
  }
];

/* ------------------------------------------------------------------ *
 * Yol yardımcıları
 * ------------------------------------------------------------------ */

/** 'heat.filters.words.list' gibi bir yolu nesnede okur/atar. */
export function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof current[keys[i]] !== 'object' || current[keys[i]] === null) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return obj;
}

/** Alan listesini düzleştirir (iç içe yollar dahil). */
export function flattenFields(settings) {
  const out = [];
  for (const section of SECTIONS) {
    for (const field of section.fields || []) {
      out.push({ ...field, section: section.id, value: getPath(settings, field.name) });
    }
    for (const group of section.groups || []) {
      for (const field of group.fields || []) {
        out.push({ ...field, section: section.id, group: group.id, value: getPath(settings, field.name) });
      }
    }
  }
  return out;
}
