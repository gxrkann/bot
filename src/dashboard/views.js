/**
 * Dashboard arayüzü — sunucu tarafında render edilen HTML.
 *
 * Derleme adımı yok, framework yok. Şablon fonksiyonları doğrudan string
 * üretir; böylece botu çalıştırmak için sadece npm install yeterli.
 *
 * HTML kaçışı `esc()` ile zorunlu kılınır — kullanıcı adı, kanal adı gibi
 * Discord'dan gelen veriler şablona girerken daima kaçırılır.
 */

/* ------------------------------------------------------------------ *
 * Kaçış yardımcıları
 * ------------------------------------------------------------------ */

export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa`;
  return `${Math.round(hours / 24)} gün`;
}

function formatTimestamp(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('tr-TR');
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export function layout({ title, activeSection, sections, body, session, flash }) {
  const nav = sections
    .filter((section) => !section.hidden)
    .map((section) => `
      <a class="nav-item ${section.id === activeSection ? 'active' : ''}" href="/s/${esc(section.id)}">
        <span class="nav-icon">${section.icon}</span>
        <span>${esc(section.title)}</span>
      </a>`)
    .join('');

  const banner = flash
    ? `<div class="flash flash-${esc(flash.type)}">${esc(flash.message)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Guard Bot</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">🛡️</span>
      <div>
        <div class="brand-name">Guard Bot</div>
        <div class="brand-sub">Koruma paneli</div>
      </div>
    </div>
    <nav class="nav">${nav}
      <a class="nav-item ${activeSection === 'backup' ? 'active' : ''}" href="/yedek">
        <span class="nav-icon">💾</span>
        <span>Yedekle</span>
      </a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-chip">
        <img src="https://cdn.discordapp.com/avatars/${esc(session.avatar || 0)}/${esc(session.avatar || 'index')}.png" alt="" class="avatar" onerror="this.src='/static/avatar.svg'">
        <span>${esc(session.globalName || session.tag)}</span>
      </div>
      <form method="post" action="/logout"><button class="btn btn-ghost btn-block">Çıkış</button></form>
    </div>
  </aside>
  <main class="content">
    ${banner}
    ${body}
  </main>
</div>
<script src="/static/app.js"></script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * Bileşenler
 * ------------------------------------------------------------------ */

function sectionHeader(section) {
  return `
    <header class="section-header">
      <h1><span class="section-icon">${section.icon}</span> ${esc(section.title)}</h1>
      ${section.description ? `<p class="section-desc">${esc(section.description)}</p>` : ''}
    </header>`;
}

/** Anahtar/açıklama satırı. */
function row(label, help, control) {
  return `
    <div class="row">
      <div class="row-info">
        <div class="row-label">${esc(label)}</div>
        ${help ? `<div class="row-help">${esc(help)}</div>` : ''}
      </div>
      <div class="row-control">${control}</div>
    </div>`;
}

function toggle(name, checked, disabled = false) {
  return `
    <label class="switch ${disabled ? 'disabled' : ''}">
      <input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-bool>
      <span class="slider"></span>
    </label>`;
}

function textInput(name, value, placeholder = '', disabled = false) {
  return `<input type="text" name="${esc(name)}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" ${disabled ? 'disabled' : ''}>`;
}

function numberInput(name, value, min, max, disabled = false) {
  return `<input type="number" name="${esc(name)}" value="${esc(value ?? 0)}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} ${disabled ? 'disabled' : ''}>`;
}

/** Süre alanı: birim seçimi + sayı. */
function durationInput(name, ms) {
  const minutes = Math.round((ms ?? 0) / 60000);
  const unit = minutes >= 1440 && minutes % 1440 === 0 ? 'day'
    : minutes >= 60 && minutes % 60 === 0 ? 'hour'
      : 'minute';
  const value = unit === 'day' ? minutes / 1440 : unit === 'hour' ? minutes / 60 : minutes;

  return `
    <div class="duration">
      <input type="number" name="${esc(name)}" value="${value}" min="0">
      <select name="${esc(name)}__unit" data-duration-unit="${esc(name)}">
        <option value="minute" ${unit === 'minute' ? 'selected' : ''}>dakika</option>
        <option value="hour" ${unit === 'hour' ? 'selected' : ''}>saat</option>
        <option value="day" ${unit === 'day' ? 'selected' : ''}>gün</option>
      </select>
    </div>`;
}

function selectInput(name, value, options, labels = {}, disabled = false) {
  const opts = options
    .map((option) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(labels[option] || option)}</option>`)
    .join('');
  return `<select name="${esc(name)}" ${disabled ? 'disabled' : ''}>${opts}</select>`;
}

/** Discord nesnesi seçimi: metin alanı + datalist önerileri. */
function pickerInput(name, value, options, placeholder) {
  const listId = `dl-${name.replace(/[^a-z0-9]/gi, '-')}`;
  const items = options
    .map((option) => `<option value="${esc(option.name)}" data-id="${esc(option.id)}">${esc(option.hint || '')}</option>`)
    .join('');

  return `
    <div class="picker">
      <input type="text" name="${esc(name)}" value="${esc(value || '')}"
             placeholder="${esc(placeholder)}" list="${listId}" data-picker="${listId}">
      <datalist id="${listId}">${items}</datalist>
    </div>`;
}

function multiPickerInput(name, values, options, placeholder) {
  const listId = `dl-${name.replace(/[^a-z0-9]/gi, '-')}`;
  const items = options
    .map((option) => `<option value="${esc(option.name)}" data-id="${esc(option.id)}">${esc(option.hint || '')}</option>`)
    .join('');

  const chips = (values || [])
    .map((value) => {
      const match = options.find((option) => option.id === value);
      return `<span class="chip">${esc(match?.name || value)}<input type="hidden" name="${esc(name)}" value="${esc(value)}"><button type="button" data-chip-remove>×</button></span>`;
    })
    .join('');

  return `
    <div class="picker multi">
      <input type="text" placeholder="${esc(placeholder)}" list="${listId}" data-picker="${listId}" data-multi="${esc(name)}">
      <datalist id="${listId}">${items}</datalist>
      <div class="chips">${chips}</div>
    </div>`;
}

function listInput(name, values, placeholder = '', help = '') {
  const items = (values || [])
    .map((value) => `<span class="chip">${esc(value)}<button type="button" data-chip-remove>×</button></span>`)
    .join('');

  return `
    <div class="list-input" data-list="${esc(name)}">
      <div class="chips">${items}</div>
      <div class="list-add">
        <input type="text" placeholder="${esc(placeholder)}" data-list-add>
        <button type="button" class="btn btn-ghost btn-sm" data-list-commit>Ekle</button>
      </div>
      ${help ? `<div class="row-help">${esc(help)}</div>` : ''}
    </div>`;
}

function statusPill(on, onLabel = 'Açık', offLabel = 'Kapalı') {
  return `<span class="pill ${on ? 'pill-on' : 'pill-off'}">${on ? esc(onLabel) : esc(offLabel)}</span>`;
}

/* ------------------------------------------------------------------ *
 * Bölüm sayfaları
 * ------------------------------------------------------------------ */

export function overviewPage({ section, guild, settings, stats }) {
  const tiles = [
    { label: 'Koruma', value: statusPill(settings.enabled, 'Aktif', 'Kapalı') },
    { label: 'Anti-Nuke', value: statusPill(settings.antiNuke.enabled) },
    { label: 'Isı Sistemi', value: statusPill(settings.heat.enabled) },
    { label: 'Join Gate', value: statusPill(settings.joinGate.enabled) },
    { label: 'Join Raid', value: statusPill(settings.joinRaid.enabled) },
    { label: 'Doğrulama', value: statusPill(settings.verification.enabled) },
    { label: 'Karantina', value: `${stats.quarantined} üye` },
    { label: 'Şüpheli', value: `${(settings.suspects || []).length} hesap` }
  ];

  const dangerCards = [
    settings.panicMode ? { label: 'Panik modu', value: 'AKTİF', tone: 'danger' } : null,
    settings.lockdown ? { label: 'Kilit modu', value: 'AKTİF', tone: 'danger' } : null,
    settings.emergencyMode ? { label: 'Acil durum', value: 'AKTİF', tone: 'danger' } : null
  ].filter(Boolean);

  const setupChecks = [
    { label: 'Karantina rolü', done: Boolean(settings.quarantineRoleId) },
    { label: 'Log kanalı', done: Boolean(settings.logChannelId) },
    { label: 'Ana roller', done: (settings.mainRoleIds || []).length > 0 },
    { label: 'Şüpheli inceleme rolü', done: Boolean(settings.reviewRoleId) },
    { label: 'Bot rolü sunucuda en üstte', done: stats.botRoleTop }
  ];

  const missing = setupChecks.filter((check) => !check.done);

  return `
    ${sectionHeader(section)}

    ${dangerCards.length ? `
      <div class="alert alert-danger">
        ${dangerCards.map((card) => `<strong>${esc(card.label)}: ${esc(card.value)}</strong>`).join(' · ')}
        <p>Bu modlar açıkken sunucu kısıtlıdır. Durumu aşağıdaki Acil Durum sayfasından kapatabilirsin.</p>
      </div>` : ''}

    <div class="tiles">
      ${tiles.map((tile) => `
        <div class="tile">
          <div class="tile-label">${esc(tile.label)}</div>
          <div class="tile-value">${tile.value}</div>
        </div>`).join('')}
    </div>

    <div class="card">
      <h2>Kurulum durumu</h2>
      ${missing.length === 0
        ? `<p class="ok">✅ Kurulum tamamlandı. Tüm statics ayarlanmış.</p>`
        : `<p class="warn">⚠️ ${missing.length} ayar eksik. Anti-Nuke düzgün çalışmaz.</p>
           <ul class="checklist">
             ${setupChecks.map((check) => `
               <li class="${check.done ? 'done' : 'todo'}">
                 ${check.done ? '✅' : '⬜'} ${esc(check.label)}
                 ${check.done ? '' : `<a href="/s/statics">düzenle</a>`}
               </li>`).join('')}
           </ul>`}
    </div>

    <div class="card">
      <h2>Sunucu</h2>
      <div class="stats-grid">
        <div><span>Üye</span><strong>${guild.memberCount ?? '?'}</strong></div>
        <div><span>Kanal</span><strong>${guild.channels?.cache?.size ?? 0}</strong></div>
        <div><span>Rol</span><strong>${guild.roles?.cache?.size ?? 0}</strong></div>
        <div><span>Sahip</span><strong>${esc(guild.ownerId)}</strong></div>
      </div>
    </div>

    ${stats.heatTop.length ? `
      <div class="card">
        <h2>En yüksek ısı</h2>
        <table class="table">
          <thead><tr><th>Kullanıcı</th><th>Isı</th><th>Strike</th></tr></thead>
          <tbody>
            ${stats.heatTop.slice(0, 8).map((row) => `
              <tr>
                <td><span class="mono">${esc(row.userId)}</span></td>
                <td>${row.heat}</td>
                <td>${row.strikes}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}`;
}

export function settingsPage({ section, settings, guildOptions }) {
  const groups = (section.groups || []).map((group) => {
    let control = '';

    if (group.actionFilter) {
      const prefix = group.id === 'panic' ? 'antiNuke.panic' : `joinGate.${group.id}`;
      const cfg = getNested(settings, prefix) || {};
      const actionOptions = ['log', 'timeout', 'kick', 'ban', 'quarantine'];
      const actionLabels = {
        log: 'Sadece logla', timeout: 'Timeout', kick: 'Kick', ban: 'Ban', quarantine: 'Karantina'
      };
      control = `
        <div class="inline-controls">
          ${toggle(`${prefix}.enabled`, cfg.enabled)}
          ${selectInput(`${prefix}.action`, cfg.action || 'log', actionOptions, actionLabels)}
        </div>`;
    } else if (group.heatFilter) {
      /* heatFilter: false olan link filtresi doğrudan ceza verir,
         ısı puanı değil — bu yüzden ayrı çizildi. */
      const cfg = getNested(settings, `heat.filters.${group.id}`) || {};
      control = `
        <div class="inline-controls">
          ${toggle(`heat.filters.${group.id}.enabled`, cfg.enabled)}
          ${group.heatFilter === false ? `
            <label class="inline-label">yakalanınca
              <select name="heat.filters.${group.id}.action">
                ${['timeout', 'kick', 'ban'].map((action) =>
                  `<option value="${action}" ${cfg.action === action ? 'selected' : ''}>${action}</option>`).join('')}
              </select>
            </label>` : `
            <label class="inline-label">ısı
              <input type="number" name="heat.filters.${group.id}.heat" value="${cfg.heat ?? 0}" min="0" max="200">
            </label>`}
        </div>`;
    } else if (group.listPath) {
      control = listInput(group.listPath, getNested(settings, group.listPath), 'her satıra bir tane');
    }

    const extras = (group.fields || []).map((field) => {
      const value = getNested(settings, field.name);
      return row(field.label, field.help, renderField(field, value, guildOptions));
    }).join('');

    return `
      <div class="subcard">
        <div class="subcard-head">
          <div>
            <div class="subcard-title">${esc(group.label)}</div>
            ${group.description ? `<div class="subcard-desc">${esc(group.description)}</div>` : ''}
          </div>
          ${control}
        </div>
        ${extras ? `<div class="subcard-body">${extras}</div>` : ''}
      </div>`;
  }).join('');

  const fields = (section.fields || []).map((field) =>
    row(field.label, field.help, renderField(field, getNested(settings, field.name), guildOptions))
  ).join('');

  const limits = section.limits ? renderLimits(section.limits, settings) : '';
  const whitelist = section.whitelistTypes ? renderWhitelist(section.whitelistTypes, settings) : '';

  return `
    ${sectionHeader(section)}
    <form method="post" action="/s/${esc(section.id)}">
      ${fields ? `<div class="card">${fields}<div class="card-footer"><button class="btn btn-primary">Kaydet</button></div></div>` : ''}
      ${groups ? `<div class="stack">${groups}</div>` : ''}
      ${limits}
      ${whitelist}
      ${fields || groups || limits || whitelist ? `<div class="sticky-save"><button class="btn btn-primary btn-lg">Değişiklikleri Kaydet</button></div>` : ''}
    </form>`;
}

function renderField(field, value, guildOptions) {
  switch (field.type) {
    case 'boolean':
      return toggle(field.name, value);
    case 'number':
      return numberInput(field.name, value, field.min, field.max);
    case 'text':
      return `<input type="text" name="${esc(field.name)}" value="${esc(value || '')}">`;
    case 'duration':
      return durationInput(field.name, value);
    case 'select':
      return selectInput(field.name, value, field.options, field.labels);
    case 'channel':
      return pickerInput(field.name, value, guildOptions.channels, 'Kanal adı veya ID');
    case 'role':
      return pickerInput(field.name, value, guildOptions.roles, 'Rol adı veya ID');
    case 'roleMulti':
      return multiPickerInput(field.name, value, guildOptions.roles, 'Rol ekle');
    case 'list':
      return listInput(field.name, value, field.placeholder || '', field.help);
    default:
      return textInput(field.name, value);
  }
}

function renderLimits(limits, settings) {
  const minute = getNested(settings, 'antiNuke.minuteLimit') || {};
  const hour = getNested(settings, 'antiNuke.hourLimit') || {};

  const rows = limits.actions.map((action) => `
    <tr>
      <td>${esc(limits.labels[action] || action)}</td>
      <td><input type="number" name="antiNuke.minuteLimit.${action}" value="${minute[action] ?? 0}" min="1" max="100"></td>
      <td><input type="number" name="antiNuke.hourLimit.${action}" value="${hour[action] ?? 0}" min="1" max="500"></td>
    </tr>`).join('');

  return `
    <div class="card">
      <h2>${esc(limits.label)}</h2>
      <table class="table">
        <thead><tr><th>Eylem</th><th>Dakika limiti</th><th>Saat limiti</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderWhitelist(types, settings) {
  const cards = types.map((type) => {
    const cfg = getNested(settings, `whitelist.${type.id}`) || {};
    const fields = ['users', 'roles', 'channels', 'categories', 'webhooks']
      .map((kind) => row(whitelistLabel(kind), '', textInput(`whitelist.${type.id}.${kind}`, (cfg[kind] || []).join(', '), 'ID, ID, ID')))
      .join('');

    return `
      <div class="subcard">
        <div class="subcard-head">
          <div>
            <div class="subcard-title">${esc(type.label)}</div>
            <div class="subcard-desc">${esc(type.note || '')}</div>
          </div>
        </div>
        <div class="subcard-body">${fields}</div>
      </div>`;
  }).join('');

  return `<div class="stack">${cards}</div>`;
}

function whitelistLabel(kind) {
  return {
    users: 'Kullanıcı ID\'leri', roles: 'Rol ID\'leri', channels: 'Kanal ID\'leri',
    categories: 'Kategori ID\'leri', webhooks: 'Webhook ID\'leri'
  }[kind] || kind;
}

/* ------------------------------------------------------------------ *
 * Aksiyon sayfaları
 * ------------------------------------------------------------------ */

export function actionsPage({ section, settings, quarantined, backups }) {
  const emergencyActive = settings.emergencyMode;
  const lockdownActive = settings.lockdown;
  const panicActive = settings.panicMode;

  return `
    ${sectionHeader(section)}

    <div class="alert alert-danger">
      <strong>Dikkat:</strong> Bu butonlar sunucuyu anında değiştirir. Emin değilsen kullanma.
    </div>

    <div class="card">
      <h2>${emergencyActive ? '🟢' : '🔴'} Acil durum modu: ${emergencyActive ? 'AÇIK' : 'KAPALI'}</h2>
      <p>Tüm rollerden yönetici iznini kaldırır ve sunucuyu yönetilemez hale getirir. Bot yeniden başlasa bile geri alınmaz — elle açmak zorundasın.</p>
      <form method="post" action="/api/emergency" class="inline-form">
        <input type="hidden" name="enable" value="${emergencyActive ? 'false' : 'true'}">
        <button class="btn ${emergencyActive ? 'btn-primary' : 'btn-danger'}">
          ${emergencyActive ? 'Acil durumu kapat' : 'Acil durumu aç'}
        </button>
      </form>
    </div>

    <div class="card">
      <h2>${lockdownActive ? '🟢' : '🔴'} Kilit modu: ${lockdownActive ? 'AÇIK' : 'KAPALI'}</h2>
      <p>Tüm metin kanallarında @everyone için yazma iznini kaldırır. Açarken orijinal izinler kaydedilir, kapatınca geri yüklenir.</p>
      <form method="post" action="/api/lockdown" class="inline-form">
        <input type="hidden" name="enable" value="${lockdownActive ? 'false' : 'true'}">
        <button class="btn ${lockdownActive ? 'btn-primary' : 'btn-danger'}">
          ${lockdownActive ? 'Kilidi aç' : 'Sunucuyu kilitle'}
        </button>
      </form>
    </div>

    <div class="card">
      <h2>${panicActive ? '🟢' : '🔴'} Panik modu: ${panicActive ? 'AÇIK' : 'KAPALI'}</h2>
      <p>Anti-Nuke limiti aşıldığında otomatik tetiklenir. Şu an tetiklenmemiş hesapları listeler.</p>
      <form method="post" action="/api/panic" class="inline-form">
        <input type="hidden" name="enable" value="${panicActive ? 'false' : 'true'}">
        <button class="btn ${panicActive ? 'btn-primary' : 'btn-danger'}">
          ${panicActive ? 'Panik modunu bitir' : 'Panik modunu başlat'}
        </button>
      </form>
      ${quarantined.length ? `
        <form method="post" action="/api/release-all" class="inline-form">
          <button class="btn btn-ghost">Tüm karantineli üyeleri serbest bırak (${quarantined.length})</button>
        </form>` : ''}
    </div>

    <div class="card">
      <h2>Yedekler</h2>
      <form method="post" action="/api/backup/create" class="inline-form">
        <button class="btn btn-primary">Şimdi yedek al</button>
      </form>
      ${backups.length ? `
        <table class="table">
          <thead><tr><th>Tarih</th><th>Boyut</th><th>İşlem</th></tr></thead>
          <tbody>
            ${backups.slice(0, 15).map((backup) => `
              <tr>
                <td>${formatTimestamp(backup.createdAt)}</td>
                <td>${(backup.size / 1024).toFixed(1)} KB</td>
                <td>
                  <form method="post" action="/api/backup/restore" class="inline-form" data-confirm="Yedek geri yüklenecek. Silinen kanallar ve roller oluşturulacak. Emin misin?">
                    <input type="hidden" name="file" value="${esc(backup.file)}">
                    <button class="btn btn-sm btn-ghost">Geri yükle</button>
                  </form>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="muted">Henüz yedek yok.</p>'}
    </div>`;
}

export function suspectsPage({ section, suspects }) {
  return `
    ${sectionHeader(section)}

    <div class="alert alert-info">
      Kelime eşleşmesi olan hesaplar burada listelenir ama <strong>otomatik ceza almamıştır</strong>.
      Listede olmak ceza değildir; sadece gözden geçirme içindir.
    </div>

    <div class="card">
      ${suspects.length ? `
        <table class="table">
          <thead><tr><th>Kullanıcı</th><th>Gerekçe</th><th>Tarih</th><th></th></tr></thead>
          <tbody>
            ${suspects.map((suspect) => `
              <tr>
                <td><span class="mono">${esc(suspect.userTag || suspect.userId)}</span><br><span class="muted mono">${esc(suspect.userId)}</span></td>
                <td>${(suspect.reasons || []).map((reason) => `<span class="tag">${esc(reason)}</span>`).join(' ')}</td>
                <td class="muted">${formatTimestamp(suspect.joinedAt)}</td>
                <td>
                  <form method="post" action="/api/suspects/remove" class="inline-form">
                    <input type="hidden" name="userId" value="${esc(suspect.userId)}">
                    <button class="btn btn-sm btn-ghost">Listeden çıkar</button>
                  </form>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`
        : '<p class="muted">Listede şüpheli hesap yok.</p>'}
    </div>`;
}

export function profilePage({ section, profile, info, limits }) {
  if (!info) {
    return `${sectionHeader(section)}<div class="alert alert-warn">Bot profili okunamadı.</div>`;
  }

  const activityOptions = ['playing', 'watching', 'listening', 'competing', 'custom'];
  const activityLabels = {
    playing: 'Playing (oynuyor)', watching: 'Watching (izliyor)',
    listening: 'Listening (dinliyor)', competing: 'Competing (yarışıyor)',
    custom: 'Custom (sadece yazı)'
  };
  const statusOptions = ['online', 'idle', 'dnd', 'invisible'];
  const statusLabels = { online: 'Çevrimiçi', idle: 'Görünmez', dnd: 'Meşgul', invisible: 'Tamamen gizli' };

  return `
    ${sectionHeader(section)}

    <!-- Önizleme -->
    <div class="card profile-preview">
      <div class="profile-avatar-box">
        <img src="${esc(info.avatarUrl)}" alt="Avatar" class="profile-avatar">
        <div class="profile-name">${esc(info.displayName)}</div>
        <div class="profile-tag muted">${esc(info.tag)}</div>
        <div class="profile-activity">
          ${statusPill(info.status !== 'offline', statusLabels[info.status] || info.status)}
          ${info.activities.map((a) => `<span class="pill pill-on">${esc(a.type)}: ${esc(a.name)}</span>`).join(' ')}
        </div>
      </div>
      ${info.hasBanner
        ? `<img src="${esc(info.bannerUrl)}" alt="Banner" class="profile-banner">`
        : '<div class="profile-banner profile-banner-empty">Banner yok</div>'}
    </div>

    <div class="grid-2">
      <!-- Avatar -->
      <div class="card">
        <h2>Profil Fotoğrafı (PP)</h2>
        <p class="muted">Discord en az 128x128 istiyor, 512x512 önerilir. Maksimum ${Math.round(limits.avatarKb)} KB.</p>
        <form method="post" action="/api/profile/avatar">
          <input type="file" name="gorsel" accept="image/png,image/jpeg,image/gif,image/webp" data-image-input="avatarData" required>
          <input type="hidden" name="avatarData">
          <div class="upload-preview"></div>
          <div class="form-actions">
            <button class="btn btn-primary">Avatar Yükle</button>
          </div>
        </form>
        <form method="post" action="/api/profile/avatar-remove" class="inline-form" data-confirm="Avatar varsayılana döndürülsün mü?">
          <button class="btn btn-ghost btn-sm">Avatarı Kaldır</button>
        </form>
      </div>

      <!-- Banner -->
      <div class="card">
        <h2>Banner</h2>
        <p class="muted">Discord en az 600x240 istiyor, 1200x480 önerilir. Maksimum ${limits.bannerMb} MB.</p>
        <form method="post" action="/api/profile/banner">
          <input type="file" name="gorsel" accept="image/png,image/jpeg,image/gif,image/webp" data-image-input="bannerData" required>
          <input type="hidden" name="bannerData">
          <div class="upload-preview"></div>
          <div class="form-actions">
            <button class="btn btn-primary">Banner Yükle</button>
          </div>
        </form>
        <form method="post" action="/api/profile/banner-remove" class="inline-form" data-confirm="Banner kaldırılsın mü?">
          <button class="btn btn-ghost btn-sm">Bannerı Kaldır</button>
        </form>
      </div>
    </div>

    <!-- Oyun adı -->
    <div class="card">
      <h2>Profil Yazısı (Oyun Adı)</h2>
      <div class="alert alert-info">
        Discord'da iki farklı yazı vardır. <strong>Rich Presence</strong> ("X oyunu oynuyor")
        yalnızca masaüstü uygulamasının RPC kanalıyla çalışır ve botlar kullanamaz.
        Buradan ayarladığımız şey botun <strong>Activity</strong>'sidir ve profil altında görünür.
      </div>
      <form method="post" action="/api/profile/activity">
        ${row('Görünecek yazı', 'En fazla 128 karakter. Boş bırakırsan kaldırılır.',
          `<input type="text" name="text" value="${esc(profile.activityText)}" maxlength="128" placeholder="5 sunucuyu koruyor">`)}
        ${row('Etiket', 'Yazının önüne gelen kelime.',
          selectInput('type', profile.activityType, activityOptions, activityLabels))}
        ${row('Ek satır', 'Yalnızca "Custom" seçilirse görünür.',
          `<input type="text" name="state" value="${esc(profile.activityState || '')}" maxlength="128" placeholder="opsiyonel">`)}
        ${row('Durum', 'Profildeki görünürlük durumu.',
          selectInput('status', profile.status, statusOptions, statusLabels))}
        <div class="card-footer">
          <button class="btn btn-primary">Kaydet ve Uygula</button>
        </div>
      </form>
    </div>

    <!-- Kullanıcı adı / avatar kısayolları -->
    <div class="card">
      <h2>Kısayollar</h2>
      <p class="muted">Aynı işlemleri Discord komutuyla da yapabilirsin. Komutlar sadece bot sahibine açıktır.</p>
      <pre>/profil gorunum
/profil avatar
/profil banner
/profil banner-kaldir
/profil oyun "5 sunucuyu koruyor" watching</pre>
    </div>`;
}

export function voicePage({ section, settings, state, channels, permissions }) {
  const connected = Boolean(state);
  const currentName = channels.find((c) => c.id === state?.channelId)?.name || state?.channelId;

  return `
    ${sectionHeader(section)}

    <div class="alert alert-info">
      <strong>Discord botları ses akışına erişemez.</strong>
      Bot kanalda görünür olur ve kimin hangi kanalda olduğunu biliriz,
      ancak konuşmaları <em>duyamaz</em>, kaydedemez veya anlayamaz.
      Bu yüzden bot kendini susturur ve sağırlaştırır. Koruma için
      kanal nüfusu ve hareketleri izlenebilir, ses içeriği okunamaz.
    </div>

    ${permissions.missing.length ? `
      <div class="alert alert-warn">
        <strong>Eksik yetkiler:</strong> ${permissions.missing.join(', ')}
        <p>Bot rolünü sunucuda yukarı taşı veya izinleri aç.</p>
      </div>` : ''}

    <!-- Durum -->
    <div class="card voice-status-card">
      <h2>${connected ? '🟢 Kanalda' : '🔴 Kanalda değil'}</h2>
      ${connected ? `
        <div class="stats-grid">
          <div><span>Kanal</span><strong>${esc(currentName)}</strong></div>
          <div><span>Katılma</span><strong>${new Date(state.joinedAt).toLocaleTimeString('tr-TR')}</strong></div>
          <div><span>Yeniden bağlanma</span><strong>${state.reconnects || 0}</strong></div>
          <div><span>Bağlantı</span><strong>${esc(state.connection?.state?.status || 'Bilinmiyor')}</strong></div>
        </div>`
      : '<p class="muted">Bot şu anda hiçbir ses kanalında değil.</p>'}
    </div>

    <div class="grid-2">
      <!-- Kanal seçimi -->
      <div class="card">
        <h2>Kanal Seçimi</h2>
        ${channels.length ? `
          <form method="post" action="/api/voice/join">
            <div class="voice-list">
              ${channels.map((channel) => `
                <label class="voice-item">
                  <input type="radio" name="channelId" value="${esc(channel.id)}"
                         ${settings.voice.channelId === channel.id ? 'checked' : ''}>
                  <span class="voice-name">#${esc(channel.name)}</span>
                  ${channel.members ? `<span class="pill pill-off">${channel.members} kişi</span>` : ''}
                  ${channel.full ? '<span class="pill pill-on">dolu</span>' : ''}
                </label>`).join('')}
            </div>
            <div class="card-footer">
              <button class="btn btn-primary">Seçili Kanala Gir</button>
            </div>
          </form>`
        : '<p class="muted">Bu sunucuda ses kanalı yok.</p>'}
      </div>

      <!-- Ayarlar -->
      <div class="card">
        <h2>Bağlantı Ayarları</h2>
        ${row('Kendini sustur', 'Bot mikrofonu açmaz. Konuşma duyulmaz.',
          toggle('voice.selfMute', settings.voice.selfMute))}
        ${row('Kendini sağırlaştır', 'Bot sesi duymaz.',
          toggle('voice.selfDeaf', settings.voice.selfDeaf))}
        ${row('Otomatik geri bağlan', 'Kanal dışına itilirse geri döner.',
          toggle('voice.autoRejoin', settings.voice.autoRejoin))}

        <div class="card-footer">
          <form method="post" action="/api/voice/settings" class="inline-form">
            <button class="btn btn-primary">Ayarları Kaydet</button>
          </form>
          <form method="post" action="/api/voice/leave" class="inline-form" data-confirm="Bot ses kanalından çıksın mı?">
            <button class="btn btn-danger" ${connected ? '' : 'disabled'}>Kanaldan Çık</button>
          </form>
        </div>
      </div>
    </div>

    <!-- Kanal nüfusu -->
    ${channels.length ? `
      <div class="card">
        <h2>Kanal Durumu</h2>
        <table class="table">
          <thead><tr><th>Kanal</th><th>Kişi</th><th>Limit</th><th>Doluluk</th></tr></thead>
          <tbody>
            ${channels.map((channel) => {
              const pct = channel.userLimit
                ? Math.min(100, Math.round((channel.members / channel.userLimit) * 100))
                : null;
              return `<tr>
                <td>#${esc(channel.name)}</td>
                <td>${channel.members}</td>
                <td>${channel.userLimit || '∞'}</td>
                <td>${pct === null ? '—' : pct + ' %'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : ''}`;
}

/**
 * Yedekleme / geri yükleme sayfası.
 *
 * Render gibi ortamlarda disk kalıcı değildir: her deploy'da data/ silinir
 * ve ayarlar varsayılanlara döner. Kullanıcının ayarlarını kaybetmemesi için
 * JSON indirip geri yükleyebilmesi gerekiyor.
 */
export function backupPage({ guilds, counts, savedAt, lastImport }) {
  const guildRows = guilds.length
    ? guilds.map((guild) => `
        <tr>
          <td><strong>${esc(guild.name)}</strong></td>
          <td><code>${esc(guild.id)}</code></td>
          <td>${guild.guildId ? '<span class="pill pill-on">bu botta</span>' : '<span class="pill pill-off">diğer sunucu</span>'}</td>
        </tr>`).join('')
    : '<tr><td colspan="3">Yedeklenecek sunucu yok.</td></tr>';

  return `
    <header class="section-header">
      <h1><span class="section-icon">💾</span> Yedekle</h1>
      <p class="section-desc">Ayarlarını JSON olarak indir, istediğin zaman geri yükle.</p>
    </header>

    <div class="alert alert-warn">
      <strong>Bunu neden yapıyoruz?</strong>
      <p>Render'ın ücretsiz planında disk kalıcı değil. Her yeni deploy, restart veya
      uykuya dönüşte <code>data/</code> klasörü silinir ve ayarların varsayılana döner.
      Bu sayfa sayesinde kaybettiğin ayarları 10 saniyede geri getirebilirsin.</p>
    </div>

    <div class="card">
      <h2>1. Yedeği indir</h2>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">
        Tüm sunucu ayarların ve bot profilin (avatar, banner, oyun adı) tek dosyada.
      </p>
      <a class="btn btn-primary" href="/api/backup/download">⬇️ JSON indir</a>
      ${savedAt ? `<p style="font-size:12px;opacity:.7;margin-top:10px">Son yedek alındı: ${esc(savedAt)}</p>` : ''}
    </div>

    <div class="card">
      <h2>2. Yedeği geri yükle</h2>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">
        JSON dosyasını aç, içeriğini aşağıya yapıştır. Mevcut ayarların tamamı
        bununla değiştirilir.
      </p>
      <form method="post" action="/api/backup/restore">
        <textarea name="payload" rows="10" required spellcheck="false"
                  placeholder='{ "kind": "guard-bot-settings", ... }'
                  style="width:100%;padding:12px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);font-family:ui-monospace,Consolas,monospace;font-size:12px;margin-bottom:12px"></textarea>
        <button class="btn btn-primary" type="submit">⬆️ Geri yükle</button>
      </form>
      ${lastImport ? `<p style="font-size:12px;opacity:.7;margin-top:10px">Son geri yükleme: ${esc(lastImport)}</p>` : ''}
    </div>

    <div class="card">
      <h2>Yedekte ne var</h2>
      <div class="stats-grid">
        <div><strong>${counts.guilds}</strong><span>sunucu</span></div>
        <div><strong>${counts.whitelist}</strong><span>beyaz liste</span></div>
        <div><strong>${counts.logChannels}</strong><span>log kanalı</span></div>
        <div><strong>${counts.profile ? 'var' : 'yok'}</strong><span>bot profili</span></div>
      </div>
      <table class="table" style="margin-top:16px">
        <thead><tr><th>Sunucu</th><th>ID</th><th>Durum</th></tr></thead>
        <tbody>${guildRows}</tbody>
      </table>
    </div>`;
}

/** Yalnızca bölüm başlığı (hata sayfaları için). */
export function sectionHeaderOnly(section) {
  return sectionHeader(section);
}

export function notFoundPage() {
  return `<h1>Sayfa bulunamadı</h1><p><a href="/">Ana sayfaya dön</a></p>`;
}

export function loginPage({ error, hasDiscordLink, notes, passwordLogin }) {
  const noteHtml = (notes || []).length
    ? `<div class="alert alert-warn">
         ${notes.map((note, index) =>
           note.startsWith('http')
             ? `<pre>${esc(note)}</pre>`
             : `<p style="margin:${index ? '8px' : '0'} 0 0">${esc(note)}</p>`
         ).join('')}
       </div>`
    : '';

  const passwordForm = passwordLogin
    ? [
      '<form method="post" action="/auth/password" class="password-form">',
      '<input type="password" name="password" placeholder="Panel şifresi"',
      'autocomplete="current-password" required autofocus>',
      '<button class="btn btn-primary btn-block btn-lg">Giriş Yap</button>',
      '</form>',
      hasDiscordLink ? '<div class="login-divider"><span>veya</span></div>' : ''
    ].join('')
    : '';

  const discordButton = hasDiscordLink
    ? '<a class="btn btn-ghost btn-block" href="/auth/login">Discord ile Giriş Yap</a>'
    : [
      '<div class="alert alert-warn">',
      '<strong>Panel şifresi tanımlı değil.</strong>',
      '<p>.env dosyasına <code>DASHBOARD_PASSWORD</code> ekle (en az 8 karakter).</p>',
      '</div>'
    ].join('');

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Giriş — Guard Bot</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="login-body">
  <div class="login-card">
    <div class="brand brand-centered">
      <span class="brand-mark">🛡️</span>
      <div class="brand-name">Guard Bot</div>
    </div>
    ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
    ${noteHtml}
    ${passwordForm}
    ${discordButton}
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

function getNested(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export { formatDuration, formatTimestamp, json, esc as escapeHtml };
