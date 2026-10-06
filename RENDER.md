# Render ücretsiz plan notları

## Uyku modu ve keep-alive

Render, ücretsiz servisi **15 dakika gelen trafik olmayınca** kapatıyor (spins down).

Discord'a WebSocket ile bağlanmak **giden** trafiktir, Render'ın sayacına girmez — yani
koruma sistemleri açıkken bot Discord'dan düşerdi.

Bu yüzden bot periyodik olarak kendi `/ping` ucunu çağırır (10 dakikada bir). Bu **gelen**
trafik sayılır, servis uyanık kalır. `src/index.js` içindeki `startKeepAlive()` bunu yapar.

Kapalıysa `HEALTHCHECK` uçlarını tercih etmek daha temizdir ama Discord botu için
kendi kendine istek atmak en güvenilir yöntem.

## Dosya sistemi kalıcı değil

Ücretsiz planda **kalıcı disk bağlanamaz**. `data/settings.json` her şu olayda silinir:

- yeni deploy
- restart
- spin-down

### Sonuçları

Her deploy sonrası dashboard'daki ayarlar sıfırlanır. Bot ilk açılışta `data/` klasörünü
kendisi oluşturur ve varsayılan ayarlarla çalışır, ama log kanalı, karantina rolü,
beyaz liste gibi senin girdiklerin gider.

### Çözüm seçenekleri

**A) Her deploy'dan sonra panelden ayarları gir.** Ücretsiz planın dürüst çözümü.

**B) Ayar dosyasını dışarıda tut, dashboard'dan yedekle.**
Dashboard'da her ayar sayfasının altında "JSON indir" düğmesi olsaydı tek tıkla
kaydedersin. (İstenirse eklerim.)

**C) Ücretli plana geç** (`starter` 7$/ay). Kalıcı disk bağlanabilir, uyku modu olmaz.

## Aylık kullanım

Ücretsiz plan **750 saat/ay** veriyor. 7/24 çalışan bir servis ~720 saat harcar.
Tek servis sığar, ikinci bir servis eklemezsin.

## Bölge

Dashboard'ın Avrupa (Frankfurt) seçildi. Türkiye'ye yakın, gecikme düşük.

## Render'ın kısıtları (ücretsiz)

| Kısıt | Etki |
|---|---|
| 0.1 CPU / 512 MB RAM | Bot ~150 MB kullanır, rahat sığar |
| Kalıcı disk yok | Ayar dosyası her deploy'da silinir |
| SSH erişimi yok | Konsoldan yönetilir |
| Otomatik restart | Render istediği zaman restart edebilir |
| 18012/18013/19099 portları kapalı | Kullanmıyoruz |

## Discord Portal ayarları

Kodda intent açık olması yetmez, Portal'da da açık olmalı:

**Bot → Privileged Gateway Intents**

- Server Members Intent ✓
- Message Content Intent ✓
- Server Voice Intents ✓ (ses özelliği için)
