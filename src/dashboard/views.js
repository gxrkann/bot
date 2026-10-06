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
    <nav class="nav">${nav}</nav>
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

export function notFoundPage() {
  return `<h1>Sayfa bulunamadı</h1><p><a href="/">Ana sayfaya dön</a></p>`;
}

export function loginPage({ error, hasDiscordLink }) {
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
    ${hasDiscordLink
      ? '<a class="btn btn-primary btn-block btn-lg" href="/auth/login">Discord ile Giriş Yap</a>'
      : `<div class="alert alert-warn">
           <strong>Yapılandırma eksik.</strong>
           <p>.env dosyasına şu değerleri ekle:</p>
           <pre>DASHBOARD_CLIENT_ID=
DASHBOARD_CLIENT_SECRET=
DASHBOARD_REDIRECT_URI=
DASHBOARD_ALLOWED_IDS=</pre>
         </div>`}
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
