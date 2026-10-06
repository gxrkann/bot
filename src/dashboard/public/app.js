/**
 * Dashboard istemci tarafı davranışı.
 *
 * Ağ isteği yapmaz — yalnızca form verisini düzenler ve onay diyalogları
 * gösterir. Sayfa yeniden yüklenmeden kaydedilir.
 */

(function () {
  'use strict';

  /* ---------------- Süre birimi dönüşümü ---------------- */

  const UNIT_MS = { minute: 60000, hour: 3600000, day: 86400000 };

  document.querySelectorAll('[data-duration-unit]').forEach((select) => {
    const input = select.parentElement.querySelector('input[type="number"]');
    if (!input) return;

    select.addEventListener('change', () => {
      const from = select.dataset.previousUnit || select.value;
      const to = select.value;
      select.dataset.previousUnit = to;

      if (!UNIT_MS[from] || !UNIT_MS[to] || from === to) return;

      const current = Number(input.value) || 0;
      const converted = (current * UNIT_MS[from]) / UNIT_MS[to];
      input.value = Math.round(converted * 100) / 100;
    });

    select.dataset.previousUnit = select.value;
  });

  /* ---------------- Chip kaldırma ---------------- */

  document.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-chip-remove]');
    if (!remove) return;
    const chip = remove.closest('.chip');
    if (!chip) return;

    // Chip içindeki hidden input silinmezse sunucuya gönderilir.
    chip.querySelector('input[type="hidden"]')?.remove();
    chip.remove();
  });

  /* ---------------- Çoklu seçim (rol ekleme) ---------------- */

  document.querySelectorAll('[data-multi]').forEach((input) => {
    input.addEventListener('change', () => {
      const fieldName = input.dataset.multi;
      const listId = input.dataset.picker;
      const option = document.querySelector(`#${CSS.escape(listId)} option[value="${CSS.escape(input.value)}"]`);
      if (!option) return;

      const id = option.dataset.id;
      if (!id) return;

      const container = input.closest('.picker');
      const chips = container.querySelector('.chips');

      // Aynı ID zaten ekliyse tekrar ekleme.
      const exists = [...chips.querySelectorAll('input[type="hidden"]')]
        .some((hidden) => hidden.value === id);
      if (exists) {
        input.value = '';
        return;
      }

      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = option.value;
      chip.insertAdjacentHTML('beforeend',
        `<input type="hidden" name="${fieldName}" value="${id}"><button type="button" data-chip-remove>×</button>`);

      chips.appendChild(chip);
      input.value = '';
    });
  });

  /* ---------------- Liste girişi ---------------- */

  document.querySelectorAll('[data-list]').forEach((container) => {
    const fieldName = container.dataset.list;
    const chips = container.querySelector('.chips');
    const input = container.querySelector('[data-list-add]');

    const add = () => {
      const values = input.value.split(',').map((v) => v.trim()).filter(Boolean);
      if (!values.length) return;

      for (const value of values) {
        const exists = [...chips.querySelectorAll('.chip')]
          .some((chip) => chip.firstChild.textContent.trim() === value);
        if (exists) continue;

        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = value;
        chip.insertAdjacentHTML('beforeend',
          `<input type="hidden" name="${fieldName}" value="${value}"><button type="button" data-chip-remove>×</button>`);
        chips.appendChild(chip);
      }
      input.value = '';
    };

    container.querySelector('[data-list-commit]')?.addEventListener('click', add);
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      }
    });
  });

  /* ---------------- İsim/ID dönüşümü ---------------- */

  // Kullanıcı kanal/rol adı yazıp datalist'ten seçince ID'ye çevrilir.
  document.querySelectorAll('[data-picker]').forEach((input) => {
    input.addEventListener('change', () => {
      const option = document.querySelector(
        `#${CSS.escape(input.dataset.picker)} option[value="${CSS.escape(input.value)}"]`
      );
      if (option?.dataset.id) input.value = option.dataset.id;
    });
  });

  /* ---------------- Onay diyalogları ---------------- */

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  /* ---------------- Kaydedilmemiş değişiklik uyarısı ---------------- */

  let dirty = false;

  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('submit', () => { dirty = false; });
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
