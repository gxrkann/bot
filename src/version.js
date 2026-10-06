/**
 * Sürüm damgası.
 *
 * Panellerde sorun ayıtmanın en zor kısmı "hangi kod çalışıyor" bilgisi.
 * Bir panel eski dosyaları silmeden yeni ZIP yükleyebiliyor, ya da kullanıcı
 * hangi servisin logunu okuduğunu karıştırabiliyor. Bu yüzden bot açılışın
 * İLK satırında sürümü yazdırır: konsoldaki satır yeni kodun çalıştığının
 * kanıtıdır.
 */

/** Sürümü package.json ile aynı tut: her işlevsel değişiklikte artır. */
export const VERSION = '1.1.0';

/**
 * Bu sürümde gelen kırılma değişiklikler / teşhis özellikleri.
 * Konsolda listelenir; "benim kodum nerede?" sorusunu tek bakışta çözer.
 */
export const CHANGES = [
  'ortam değişkenleri teşhisi (reportEnv)',
  '/ping ucu + Render keep-alive',
  'ses modülü dinamik import (paket eksikse bot ölmez)',
  'dashboard yedekleme: JSON indir / geri yükle',
  'rol koruması v14 event adları (GuildRoleCreate/Delete/Update, WebhooksUpdate)'
];

/** Konsolun en üstünde tek satır sürüm damgası basar. */
export function printBanner() {
  console.log('');
  console.log(`🛡️  Guard Bot v${VERSION} — bu satır kodun güncel olduğunu gösterir`);
  console.log(`   ${CHANGES.join('\n   ')}`);
  console.log('');
}
