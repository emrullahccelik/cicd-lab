# CI/CD Laboratuvarı

`git push` → GitHub → Jenkins → Docker → Registry → Kubernetes (Rancher) akışını adım adım, görsel olarak gösteren interaktif simülasyon.

## Çalıştırma

Kurulum gerekmez. İki yol var:

- `index.html` dosyasına çift tıkla, ya da
- `python3 -m http.server 8765` çalıştırıp http://localhost:8765 adresini aç

## Neler denenebilir?

| Ne yap | Ne öğrenirsin |
|---|---|
| **git push** | Bütün boru hattı: webhook, Jenkins stage'leri, Docker katmanları, registry, rolling update |
| **Adım adım** + **Devam** (veya Boşluk tuşu) | Her adımda durup açıklamayı okumak |
| **🚦 Trafik** | Service'in trafiği Ready pod'lara dağıtması, güncelleme sırasında kesinti olmaması |
| **Pod'a tıkla** | Self-healing: ReplicaSet silinen pod'un yerine yenisini açar |
| **replica − / +** | Ölçekleme, scheduler, node'ların image çekmesi (pull) |
| **❌ Test kırılıyor** | CI'ın güvenlik ağı: bozuk kod canlıya çıkamaz |
| **💥 Uygulama çöküyor** | CrashLoopBackOff, `maxUnavailable: 0` sayesinde eski sürüm çalışmaya devam eder, ardından **Rollback** |
| **⌨ kubectl get** sekmesi | Aynı durumun gerçek `kubectl` çıktısında nasıl göründüğü |

Kartların başlığındaki **ⓘ** simgesine tıklayınca o parçanın açıklaması, örnek kodu ve YAML'ı sağ panelde açılır.

## Dosyalar

- `index.html`: sayfa iskeleti
- `style.css`: görünüm
- `app.js`: simülasyon (pipeline, Deployment/ReplicaSet controller'ları, pod yaşam döngüsü, trafik) ve Türkçe açıklamalar
