# Discord Guard Bot

Sunucu koruma botu + web dashboard. discord.js v14, MongoDB yok, harici bağımlılık yok.

## Kurulum

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyalayıp doldurun:

```bash
cp .env.example .env
```

Sonra slash komutlarını kaydedin:

```bash
npm run register
```

Botu başlatın:

```bash
npm start
```

Geliştirme için `npm run dev` (otomatik yeniden başlatır).

## Discord Geliştirici Portalı Ayarları

İki yeri de ayarlamanız gerekiyor, ikisi de **açık** olmalı:

1. **Bot → Privileged Gateway Intents**: *Server Members Intent* ve *Message Content Intent* açık
2. **OAuth2 → URL Generator**: Redirect URI olarak `http://localhost:3000/auth/callback`, scopes `identify` ve `guilds`

İkinci adımın client id ve secret'ını `.env`'ye `DASHBOARD_CLIENT_ID` / `DASHBOARD_CLIENT_SECRET` olarak yazın.

## Dashboard

Bot başladığında `http://localhost:3000` adresinde açılır. Giriş Discord OAuth ile yapılır.

Panele girebilecek kişileri `.env` içinde belirlersiniz:

```
DASHBOARD_ALLOWED_IDS=1415424467349409832,720756668480356503
```

Bu liste **boşsa kimse giremez**. `OWNER_ID` ve `OWNER_ID_2` otomatik olarak dahil edilir. Panel kapatılmak istenirse `DASHBOARD_ENABLED=false`.

### Yerelden dışarıya açmak

Discord OAuth redirect URI'si `localhost` dışında bir adres istiyorsa iki seçeneğiniz var:

- **Bulut tüneli** (geçici, en kolay): `cloudflared tunnel --url http://localhost:3000` ya da `ngrok http 3000`. Çıkan adresi Discord'a redirect URI olarak ekleyin.
- **Kendi sunucunuz**: reverse proxy + HTTPS (Caddy veya nginx + Let's Encrypt). Caddy en kısası:
  ```
  sunucuadresin.com {
      reverse_proxy localhost:3000
  }
  ```
  Caddy sertifikayı otomatik alır. Ardından `DASHBOARD_REDIRECT_URI=https://sunucuadresin.com/auth/callback`.

Sunucuyu `0.0.0.0`'a açmak tek başına yetmez — Discord redirect URI için HTTPS şarttır.

## Bölümler

| Bölüm | Ne yapar |
|---|---|
| Genel Bakış | Korumanın durumu, kurulum kontrol listesi, en yüksek ısı |
| Statics | Log kanalı, karantina rolü, ana roller gibi botun dayandığı ayarlar |
| Koruma | Ana açma/kapama, sahip muafiyeti |
| Join Gate | Katılan her üyeyi bağımsız filtrelerden geçirir, her filtrenin cezası ayrı |
| Isı Sistemi | Eylemler ısı puanı olarak birikir, eşik aşılınca otomatik timeout |
| Anti-Nuke | Dakika/saat bazlı hız limitleri, karantina, panik modu |
| Join Raid | Kısa sürede çok sayıda hesap katılmasını tespit eder |
| Doğrulama | Yeni üyeler için buton veya kod doğrulaması |
| Yedekleme | Kanal/rol anlık görüntüsü alır ve geri yükler |
| Beyaz Liste | Nesneleri belirli filtrelerden muaf tutar (spam, etiket, davet, karantina) |
| Acil Durum | Acil durum modu, kilit modu, panik modu, yedek yönetimi |
| Şüpheliler | İşaretlenen hesaplar ve gerekçeleri |
| Gelişmiş | Eski ayarlar, ince ayarlar |

## Önemli güvenlik davranışları

**Kullanıcı adı kelimeleri asla ceza üretmez.** Join Gate'teki kullanıcı adı filtresi (`fivem`, `gta`, `server`, `steam` vb.) varsayılan olarak yalnızca loglar ve şüpheli listesine ekler. Ban/kick/timeout uygulanması için *Eşleşmeye ceza uygula* açılmalıdır, o da kapalı başlar.

**Kilit modu geri alınabilir.** Kilit açılırken her kanalın @everyone izinleri kaydedilir, kapatılınca geri yüklenir. Sunucunuzun gerçek izin ayarları silinmez.

**Panik modu önerilmez ama çalışır.** Açık olduğunda Anti-Nuke limiti aşılınca sunucu kilitlenir ve saldırganlar karantinelenir. Süre sonunda kendiliğinden açılır.

**Acil durum modu kalıcı bir anlık görüntü alır.** Rollerin izinleri `data/settings.json` içine yazılır, bu yüzden bot çökse bile geri alınabilir.

## Proje yapısı

```
src/
  index.js            başlangıç, olay bağlama, dashboard'ı ayağa kaldırma
  config.js           .env okuma
  store.js            ayar şeması + atomik disk yazımı
  schema.js           dashboard formlarının tek kaynağı
  guard-utils.js      ortak yardımcılar, log gönderimi, şüpheli değerlendirme
  heat.js             ısı tabanlı otomatik moderasyon
  heat-exempt.js      beyaz liste muafiyetleri
  anti-nuke.js        hız limitleri, karantina, panik modu
  lockdown.js         kilit modu (izin snapshot'ı ile)
  emergency.js        acil durum modu (kalıcı snapshot)
  join-gate.js        katılım filtreleri
  join-raid.js        toplu katılım tespiti
  verification.js     doğrulama akışı
  backup.js           anlık görüntü + geri yükleme
  commands/           slash komutları
  events/             olay işleyicileri
  dashboard/
    server.js         HTTP sunucu ve yönlendirmeler
    auth.js           OAuth2, oturum, izin listesi
    views.js          HTML şablonları
    public/           CSS ve istemci JS
```

Ayar şeması `store.js` içinde, dashboard formları `schema.js` içinde tanımlıdır. İki dosya birbirini tanımaz ama testler tutarlılığını doğrular.

## Slash komutları

`/guard` alt komutları Türkçedir: `durum`, `aktif`, `pasif`, `ayar`, `beyazliste`, `listele`, `supheli`, `acil`, `kilit`, `cezalandir`, `yedek`, `istatistik`. Ayrıca `/supheli` ve `/ping` vardır.

Çoğu ayar artık dashboard'dan yönetiliyor; komutlar acil durum için.

## Veri saklama

Her şey `data/settings.json` içinde. Yazmalar atomiktir (önce geçici dosya, sonra rename) ve kuyruğa alınır, yani yarım kalmış dosya oluşmaz. Dosya bozuksa yedek alınıp sıfırlanır.

Isı, karantina ve Join Raid sayaçları RAM'de tutulur; bot yeniden başlayınca sıfırlanır.

## Testler

```bash
node test/run.js
```

Isı puanlama, muafiyetler, Join Raid string kuralları, şema tutarlılığı, dashboard kimlik doğrulama, form kaydetme ve XSS kaçışı test edilir. Discord bağlantısı gerektirmez.

## Lisans

Bu kod bu depoda özgün olarak yazıldı.
