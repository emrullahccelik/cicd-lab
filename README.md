# CI/CD Laboratuvarı

`git push` → GitHub → Jenkins → Docker → Registry → Kubernetes (Rancher) akışını adım adım, görsel olarak gösteren interaktif simülasyon.

## Çalıştırma

> Bu branch (`threejs`) 3D sürümdür. Three.js modül olarak yüklendiği için `index.html`'e çift tıklamak **çalışmaz**; sayfayı bir web sunucusu üzerinden açmak gerekir.

Windows'ta (PowerShell, proje klasöründe):

```powershell
python -m http.server 8765
```

Sonra tarayıcıda http://localhost:8765 adresini aç. Alternatif: `npx serve` ya da VS Code **Live Server** eklentisi.

Three.js (r170) `vendor/three/` klasöründe projeye dahildir, internet gerekmez.

**3D sahnede:** sürükle → döndür, tekerlek → yakınlaş, sağ tık → kaydır. Sağ alttaki butonlarla Genel / Pipeline / Cluster görünümüne geçilir; "kamera akışı takip etsin" açıkken kamera push sırasında kendisi gezer.

## Neler denenebilir?

| Ne yap | Ne öğrenirsin |
|---|---|
| **git push** | Bütün boru hattı: webhook, Jenkins stage'leri, Docker katmanları, registry, rolling update |
| **Adım adım** + **Devam** (veya Boşluk tuşu) | Her adımda durup açıklamayı okumak |
| **🚦 Trafik** | Service'in trafiği Ready pod'lara dağıtması, güncelleme sırasında kesinti olmaması |
| **Pod küpüne tıkla** | Self-healing: ReplicaSet silinen pod'un yerine yenisini açar |
| **replica − / +** | Ölçekleme, scheduler, node'ların image çekmesi (pull) |
| **❌ Test kırılıyor** | CI'ın güvenlik ağı: bozuk kod canlıya çıkamaz |
| **💥 Uygulama çöküyor** | CrashLoopBackOff, `maxUnavailable: 0` sayesinde eski sürüm çalışmaya devam eder, ardından **Rollback** |
| **⌨ kubectl get** sekmesi | Aynı durumun gerçek `kubectl` çıktısında nasıl göründüğü |

Kartların başlığındaki **ⓘ** simgesine tıklayınca o parçanın açıklaması, örnek kodu ve YAML'ı sağ panelde açılır.

## Dosyalar

- `index.html`: sayfa iskeleti
- `style.css`: görünüm
- `app.js`: simülasyon (pipeline, Deployment/ReplicaSet controller'ları, pod yaşam döngüsü, trafik) ve Türkçe açıklamalar
- `scene.js`: Three.js 3D sahnesi (istasyonlar, borular, Docker katmanları, registry rafı, cluster, pod küpleri, trafik topları)
- `vendor/three/`: Three.js kütüphanesi (MIT lisansı)
