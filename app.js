import { createScene } from './scene.js';

/* =========================================================
   Yardımcılar
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => performance.now();
const rand = (n, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const randHex = n => rand(n, '0123456789abcdef');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const REGISTRY = 'registry.sirket.com/web-app';
const MAX_SURGE = 1;
const MAX_UNAVAILABLE = 0;
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#d946ef', '#06b6d4', '#f97316', '#84cc16', '#f43f5e'];
const vcolor = v => PALETTE[(v - 1) % PALETTE.length];
const rsHash = v => (Math.imul(v + 11, 2654435761) >>> 0).toString(16).padStart(8, '0');

const LAYERS = [
  { cmd: 'FROM node:20-alpine', cached: true, size: '48MB' },
  { cmd: 'WORKDIR /app', cached: true, size: '0B' },
  { cmd: 'COPY package*.json ./', cached: true, size: '210kB' },
  { cmd: 'RUN npm ci --omit=dev', cached: true, size: '96MB' },
  { cmd: 'COPY . .', cached: false, size: '3.1MB' },
  { cmd: 'RUN npm run build', cached: false, size: '12MB' },
  { cmd: 'CMD ["node","server.js"]', cached: false, size: '0B' },
];
const JSTAGES = [
  ['checkout', 'Checkout'],
  ['test', 'Test'],
  ['build', 'Build'],
  ['push', 'Push'],
  ['deploy', 'Deploy'],
];
const COMMIT_IDEAS = [
  'fix: sepet toplamı düzeltildi', 'feat: karanlık tema', 'perf: ürün listesi hızlandı',
  "feat: kampanya banner'ı", 'fix: giriş sayfası hatası', 'feat: favorilere ekle butonu',
  'chore: logo güncellendi', 'feat: arama önerileri',
];

/* =========================================================
   Durum
   ========================================================= */
const S = {
  speed: 1,
  busy: false,
  paused: 0,
  nextResolve: null,
  nextVersion: 2,
  ideaIdx: 0,
  commits: [{ hash: randHex(7), msg: 'ilk sürüm: web-app v1', v: 1 }],
  tags: [{ v: 1, digest: randHex(12) }],
  deploy: { replicas: 3, version: 1, stable: 1, rolling: false },
  history: [1],            // rollout'u tamamlanan sürümler
  rollbackPending: false,
  rs: new Map(),           // version -> { replicas }
  pods: [],
  nodes: ['node-1', 'node-2', 'node-3'].map(name => ({ name, images: new Set([1]) })),
  crash: new Set(),        // açılışta çöken sürümler
  podSeq: 0,
  traffic: false,
  trafficToken: 0,
  rr: 0,
  responses: [],
  okCount: 0,
  errCount: 0,
  devLines: ['$ git status', 'On branch main', 'Your branch is up to date', "with 'origin/main'."],
};
const dur = ms => ms / S.speed;
const wait = ms => sleep(dur(ms));

/* =========================================================
   Açıklamalar (sağ panel)
   ========================================================= */
const JENKINSFILE = `pipeline {
  agent any
  environment {
    IMAGE = "${REGISTRY}"
    TAG   = "v\${BUILD_NUMBER}"
  }
  stages {
    stage('Checkout') {
      steps { checkout scm }
    }
    stage('Test') {
      steps { sh 'npm ci && npm test' }
    }
    stage('Build image') {
      steps { sh 'docker build -t $IMAGE:$TAG .' }
    }
    stage('Push image') {
      steps { sh 'docker push $IMAGE:$TAG' }
    }
    stage('Deploy') {
      steps {
        sh 'kubectl set image deployment/web-app web=$IMAGE:$TAG'
        sh 'kubectl rollout status deployment/web-app --timeout=120s'
      }
    }
  }
  post {
    failure { mail to: 'ekip@sirket.com', subject: "Build #\${BUILD_NUMBER} kırıldı" }
  }
}`;

const DOCKERFILE = `FROM node:20-alpine        # temel katman: Linux + Node.js
WORKDIR /app
COPY package*.json ./      # önce SADECE bağımlılık listesi
RUN npm ci --omit=dev      # bağımlılıklar (package.json değişmezse CACHED)
COPY . .                   # kaynak kod (her commit'te değişir)
RUN npm run build
CMD ["node", "server.js"]  # container başlayınca çalışacak komut`;

const deploymentYaml = c => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: ${c.r}                 # kaç pod istiyorum?
  selector:
    matchLabels: { app: web-app }
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1             # geçişte en fazla 1 fazladan pod
      maxUnavailable: 0       # hazır pod sayısı asla düşmesin
  template:                   # her pod bu şablondan üretilir
    metadata:
      labels: { app: web-app }
    spec:
      containers:
        - name: web
          image: ${REGISTRY}:v${c.v}
          ports: [{ containerPort: 3000 }]
          readinessProbe:     # "trafik almaya hazır mısın?"
            httpGet: { path: /health, port: 3000 }`;

const EX = {
  intro: {
    t: 'CI/CD Laboratuvarına hoş geldin 👋',
    b: () => `
      <p><b>CI</b> (Continuous Integration): her push'ta kodu otomatik <b>test et ve paketle</b>.<br>
      <b>CD</b> (Continuous Delivery/Deployment): paketi otomatik olarak <b>canlıya çıkar</b>.</p>
      <p>3D sahnede tipik bir şirket akışı var. Arka sıradaki istasyonlar <b>pipeline</b>, öndeki büyük platform <b>Kubernetes cluster</b>'ı:</p>
      <ol>
        <li>💻 Sen <code>git push</code> yaparsın</li>
        <li>🐙 GitHub, Jenkins'e haber verir (<b>webhook</b>)</li>
        <li>🤵 Jenkins kodu çeker, <b>testleri</b> çalıştırır</li>
        <li>🐳 <b>Docker</b> image'ı katman katman üretir</li>
        <li>📦 Image <b>registry</b>'deki rafa konur</li>
        <li>☸️ <b>Kubernetes</b> pod'ları (küpler) tek tek yeni sürüme geçirir</li>
        <li>🐮 <b>Rancher</b> panelinden (üstteki çubuk) hepsini izlersin</li>
      </ol>
      <p class="tip"><b>Nasıl kullanılır?</b><br>
      1) Üstte <b>⬆ git push</b>'a bas. Yavaş gitmek için <b>Adım adım</b>'ı aç.<br>
      2) <b>🚦 Trafik</b>'i aç: soldaki kullanıcılardan pod'lara istekler uçar.<br>
      3) Bir <b>pod küpüne tıkla</b> → öldür, Kubernetes'in yenisini açmasını izle.<br>
      4) <b>replica −/+</b> ile pod sayısını değiştir.<br>
      5) "❌" ve "💥" senaryolarını dene.<br>
      🖱 Sahneyi sürükleyerek döndür, tekerlekle yakınlaş. Etiketlere tıklayınca açıklaması burada açılır.</p>`,
  },

  dev: {
    t: '1 · Geliştirici bilgisayarı',
    b: c => `
      <p>Kodu değiştirdin, <code>commit</code>'ledin ve <code>push</code> ettin. <b>Senin işin burada bitiyor.</b> Bundan sonraki her adım otomatik.</p>
      <p>Push edilen şey Docker image'ı <b>değil</b>, sadece <b>kaynak kod</b> değişikliği (commit: <code>${esc(c.hash)}</code>). Paketlemeyi daha sonra Jenkins yapacak.</p>
      <p class="tip">CI/CD'nin amacı: "benim makinemde çalışıyordu" sorununu bitirmek ve canlıya çıkmayı her seferinde <b>aynı, tekrarlanabilir, otomatik</b> bir sürece çevirmek.</p>`,
    cl: '💻 terminal',
    c: c => `git add .\ngit commit -m "${c.msg}"\ngit push origin main`,
  },

  git: {
    t: '2 · Git sunucusu (GitHub / GitLab)',
    b: c => `
      <p>Commit uzak depoya ulaştı (sunucunun üstündeki disk yığınına yeni bir disk eklendi). Depo ayarlarında bir <b>webhook</b> tanımlı: <i>"main dalına push gelince Jenkins'e haber ver"</i>.</p>
      <p>GitHub, Jenkins'e küçük bir HTTP isteği atar (sarı halkalar). <b>Kodu göndermez</b>, sadece "<i>web-app deposunda yeni commit var: ${esc(c.hash)}</i>" der. Kodu Jenkins kendisi çekecek.</p>
      <p class="tip">Webhook yerine Jenkins'in her dakika depoyu kontrol etmesi (<b>polling</b>) de mümkün, ama webhook anında ve daha verimli.</p>`,
    cl: '📨 GitHub → Jenkins webhook isteği',
    c: c => `POST https://jenkins.sirket.com/github-webhook/
Content-Type: application/json
X-GitHub-Event: push

{
  "ref": "refs/heads/main",
  "after": "${c.hash}",
  "repository": { "full_name": "sirket/web-app" },
  "head_commit": { "message": "${c.msg}" }
}`,
  },

  jenkins: {
    t: '3 · Jenkins (CI sunucusu)',
    b: c => `
      <p>Jenkins webhook'u aldı ve <b>Build #${c.v}</b>'i başlattı. Ne yapacağını depodaki <code>Jenkinsfile</code>'dan okur. Jenkinsfile bir <b>tarif</b>: hangi adım (stage) hangi sırayla çalışacak.</p>
      <p>Adımlar sırayla çalışır (üstteki <b>Jenkins pipeline</b> çubuğu ve 3D'deki Jenkins'in ön yüzündeki ışıklar). <b>Biri başarısız olursa boru hattı durur</b>, sonrakiler hiç çalışmaz. Böylece testi geçmeyen kod asla canlıya çıkamaz.</p>
      <p class="tip">Jenkins yerine GitHub Actions, GitLab CI, ArgoCD gibi araçlar da kullanılır, mantık aynı.</p>`,
    cl: '📄 Jenkinsfile (depoda, kodla birlikte durur)',
    c: () => JENKINSFILE,
  },

  checkout: {
    t: 'Jenkins › Checkout',
    b: c => `<p>Jenkins, commit <code>${esc(c.hash)}</code>'i kendi çalışma klasörüne (<b>workspace</b>) çeker. Artık elinde push ettiğin kodun birebir kopyası var.</p>
      <p>Jenkins'in bütün işleri bu kopya üzerinde yapılır, senin bilgisayarına hiç dokunulmaz.</p>`,
    cl: '⚙️ Jenkins arkada şunu çalıştırıyor',
    c: c => `git clone https://github.com/sirket/web-app.git\ngit checkout ${c.hash}`,
  },

  test: {
    t: 'Jenkins › Test',
    b: () => `<p>Bağımlılıklar kurulur ve otomatik testler çalışır. <b>CI'ın kalbi burası.</b></p>
      <p>Testler kırılırsa süreç burada durur ve geliştiriciye bildirim gider (mail / Slack). Bozuk kod bir sonraki adıma geçemez.</p>`,
    cl: '⚙️ Jenkins arkada şunu çalıştırıyor',
    c: () => `npm ci      # bağımlılıkları kur\nnpm test    # testleri çalıştır (exit code != 0 ise stage FAILED)`,
  },

  testfail: {
    t: '❌ Pipeline durdu: test kırıldı',
    b: c => `<p>Bir test başarısız oldu, Jenkins build'i <b>FAILED</b> olarak işaretledi.</p>
      <ul>
        <li>Docker image <b>üretilmedi</b></li>
        <li>Registry'ye hiçbir şey <b>yüklenmedi</b></li>
        <li>Kubernetes'e <b>dokunulmadı</b>: canlıdaki v${c.stable} hiç etkilenmedi</li>
      </ul>
      <p>Kullanıcılar hiçbir şey fark etmedi. CI'ın sana verdiği <b>güvenlik ağı</b> bu. Geliştirici hatayı düzeltir ve tekrar push eder.</p>
      <p class="tip">Senaryoyu <b>✅ Sorunsuz kod</b> yapıp tekrar push et.</p>`,
  },

  docker: {
    t: '4 · Docker build: image üretimi',
    b: () => `<p>Jenkins <code>docker build</code> çalıştırır. <code>Dockerfile</code>'daki her satır bir <b>katman (layer)</b> üretir ve katmanlar üst üste dizilir. 3D'de Docker istasyonundaki plakalar tam olarak bu.</p>
      <p><b>Önbellek:</b> Değişmeyen katmanlar önceki build'den gelir (<span class="cached">CACHED</span>, açık mavi). Sadece kod değiştiği için <code>COPY . .</code> ve sonrası yeniden üretilir (yeşil). <code>package.json</code> değişseydi <code>npm ci</code> de yeniden çalışırdı. Bu yüzden Dockerfile'da az değişen şeyler üste yazılır.</p>
      <p>Katmanların etrafını saran şeffaf kutu: <b>image</b> = Linux + Node.js + bağımlılıklar + senin kodun. Bu paket her makinede aynı şekilde çalışır.</p>`,
    cl: '📄 Dockerfile',
    c: () => DOCKERFILE,
  },

  registry: {
    t: '5 · Container Registry',
    b: c => `<p>Image şu an sadece Jenkins makinesinde. Kubernetes node'larının onu indirebilmesi için ortak bir depoya koymak gerek: <b>registry</b> (Docker Hub, Harbor, GitHub Container Registry, AWS ECR…).</p>
      <p>Registry, image'lar için GitHub gibi. Her sürüm bir <b>etiket (tag)</b> alır: <code>web-app:v${c.v}</code> (raftaki kutular). Registry'de zaten olan katmanlar tekrar yüklenmez (<i>Layer already exists</i>), sadece değişenler gider.</p>
      <p class="tip">Gerçek hayatta tag olarak çoğunlukla commit hash'i (<code>web-app:${esc(c.hash)}</code>) kullanılır. Böylece canlıda tam olarak hangi kodun çalıştığını bilirsin. <code>latest</code> etiketinden kaçınılır.</p>`,
    cl: '⚙️ Jenkins arkada şunu çalıştırıyor',
    c: c => `docker push ${REGISTRY}:v${c.v}`,
  },

  deploy: {
    t: "6 · Kubernetes'e deploy",
    b: c => `<p>Jenkins, Kubernetes'e tek bir şey söyler: <b>"web-app Deployment'ı artık <code>v${c.v}</code> image'ını kullansın."</b></p>
      <p>Kubernetes'e "<i>şu pod'u kapat, şunu aç</i>" diye adım adım komut vermezsin. <b>İstediğin son durumu</b> tarif edersin (<b>declarative</b>): "<i>v${c.v} image'ından ${c.r} pod çalışsın</i>".</p>
      <p>Kubernetes içindeki <b>controller</b>'lar sürekli <b>istenen durum</b> ile <b>mevcut durumu</b> karşılaştırır ve fark kapanana kadar çalışır. Rancher çubuğundaki <b>İstenen / Güncel / Hazır / Toplam</b> sayaçlarını izle.</p>
      <p>Deployment her sürüm için bir <b>ReplicaSet</b> oluşturur. ReplicaSet'in tek işi "benden N pod olsun" demektir.</p>`,
    cl: '📄 deployment.yaml',
    c: c => `${deploymentYaml(c)}\n\n# Jenkins'in yaptığı aslında sadece image satırını değiştirmek:\n# kubectl set image deployment/web-app web=${REGISTRY}:v${c.v}`,
  },

  rolling: {
    t: 'Rolling update: kesintisiz geçiş',
    b: c => `<p>Kubernetes eski pod'ları bir anda kapatmaz. Deployment ayarlarına göre:</p>
      <ul>
        <li><code>maxSurge: 1</code> → geçiş sırasında en fazla <b>1 fazladan</b> pod açılabilir (${c.r}+1 = ${c.r + 1})</li>
        <li><code>maxUnavailable: 0</code> → <b>hazır</b> pod sayısı asla ${c.r}'in altına inmez</li>
      </ul>
      <p>Döngü: <b>yeni pod aç → Pending → image çek → Running → readiness probe ✓ → bir eski pod kapat</b> → tekrar.</p>
      <p>Küplerin renklerine bak: eski sürüm (<b style="color:${vcolor(c.old)}">v${c.old}</b>) azalırken yeni sürüm (<b style="color:${vcolor(c.v)}">v${c.v}</b>) artıyor. Küplerin altındaki halka durumu gösterir. Image'ı henüz olmayan node önce registry'den <b>pull</b> yapar (mavi halka), bu yüzden ilk pod daha yavaş açılır.</p>
      <p class="tip">🚦 <b>Trafiği aç</b>: sol alttaki yanıt şeridinde renklerin kesintisiz şekilde yeni sürüme kaydığını, hiç kırmızı (hata) olmadığını görürsün.</p>`,
    cl: '⌨ Jenkins şu an bunu bekliyor',
    c: () => `kubectl rollout status deployment/web-app --timeout=120s`,
  },

  crash: {
    t: '💥 CrashLoopBackOff: yeni sürüm çöküyor',
    b: c => `<p>Testler geçti, image üretildi, ama uygulama <b>başlar başlamaz çöküyor</b> (ör: eksik bir ortam değişkeni, yanlış veritabanı adresi gibi testlerin yakalamadığı bir hata).</p>
      <p>Kubernetes container'ı tekrar tekrar başlatmayı dener ve her seferinde biraz daha uzun bekler: <b>CrashLoopBackOff</b> (titreyen kırmızı küp).</p>
      <p>Yeni pod hiçbir zaman <b>Ready</b> olmadığı için <code>maxUnavailable: 0</code> kuralı devreye girer: <b>eski pod'lar kapatılmaz</b>. Kullanıcılar hâlâ v${c.stable}'i kullanıyor, kesinti yok! 🛡️</p>
      <p>Jenkins <code>kubectl rollout status</code> ile bekliyor. Süre dolunca build'i başarısız sayacak.</p>`,
    cl: '🔍 Gerçek hayatta sebebi böyle ararsın',
    c: () => `kubectl get pods\nkubectl describe pod <pod-adı>\nkubectl logs <pod-adı> --previous   # çökmeden önceki loglar`,
  },

  crashFail: {
    t: '⏱️ Rollout zaman aşımı → build FAILED',
    b: c => `<p>Jenkins beklemekten vazgeçti: <code>progress deadline exceeded</code>. Build <b>FAILED</b>.</p>
      <p>Cluster yarım kalmış bir geçişte: v${c.stable} pod'ları hizmet veriyor, v${c.v} pod'u çökmeye devam ediyor.</p>
      <p><b>Çözüm: Rollback.</b> Rancher çubuğundaki <b>↩ Rollback</b> butonuna bas. Deployment bir önceki sürüme döner, çöken pod temizlenir.</p>
      <p class="tip">Birçok ekip bunu Jenkinsfile'a koyar: rollout başarısızsa <b>otomatik rollback</b>.</p>`,
    cl: '⌨ Rollback komutu',
    c: () => `kubectl rollout undo deployment/web-app`,
  },

  rollback: {
    t: '↩ Rollback',
    b: c => `<p><code>kubectl rollout undo</code> Deployment'ın pod şablonunu önceki sürüme (<b>v${c.to}</b>) geri alır. Kubernetes için bu da sıradan bir değişiklik: istenen durum yine değişti, controller'lar farkı kapatıyor.</p>
      <p>Eski ReplicaSet silinmemişti (sadece 0'a ölçeklenmişti), bu yüzden geri dönüş hızlıdır. Rancher'da bu işlem Deployment menüsündeki <b>Rollback</b> butonudur.</p>`,
    cl: '⌨ Komut',
    c: () => `kubectl rollout undo deployment/web-app\nkubectl rollout history deployment/web-app   # geçmiş sürümler`,
  },

  rollbackDone: {
    t: '✓ Rollback tamamlandı',
    b: c => `<p>Canlıda tekrar <b>v${c.v}</b> çalışıyor. Hatayı bulup düzelttikten sonra yeni bir push ile tekrar dene (senaryoyu ✅ yap).</p>`,
  },

  done: {
    t: c => `🎉 Canlıda: v${c.v}`,
    b: c => `<p>Tek bir <code>git push</code> ile:</p>
      <ol>
        <li>GitHub webhook ile Jenkins'i tetikledi</li>
        <li>Jenkins kodu çekti ve testleri çalıştırdı</li>
        <li>Docker image <code>web-app:v${c.v}</code> üretildi</li>
        <li>Image registry'ye yüklendi</li>
        <li>Kubernetes ${c.r} pod'u kesintisiz şekilde yeni sürüme geçirdi</li>
      </ol>
      <p>Toplam süre: <b>${c.secs} sn</b> (simülasyon). Kimse sunucuya SSH yapmadı, kimse elle dosya kopyalamadı.</p>
      <p class="tip">Şimdi dene: bir pod küpüne tıklayıp öldür, replica sayısını değiştir veya "💥" senaryosuyla tekrar push et.</p>`,
  },

  selfheal: {
    t: '🩹 Self-healing: pod silindi',
    b: c => `<p><code>${esc(c.name)}</code> silindi. ReplicaSet controller hemen fark etti: <b>mevcut pod sayısı istenenden az</b>. Fark var → yeni bir pod oluşturdu.</p>
      <p>Pod'un çalıştığı makine çökse, uygulama çökse ya da biri yanlışlıkla silse de aynı şey olur. Bu yüzden pod'lar <b>geçici (ephemeral)</b> kabul edilir: tek tek bakılan evcil hayvanlar değil, sürü gibi yönetilirler 🐄 (<i>pets vs cattle</i>).</p>
      <p>Yeni pod'un adı farklı (sondaki 5 karakter rastgele), IP'si de farklı olacak. Kullanıcılar bunu fark etmez çünkü önlerinde <b>Service</b> var.</p>`,
    cl: '⌨ Komut',
    c: c => `kubectl delete pod ${c.name}\nkubectl get pods -w     # -w: canlı izle`,
  },

  scale: {
    t: c => `📈 Ölçekleme: ${c.old} → ${c.r} pod`,
    b: c => `<p>İstenen pod sayısını <b>${c.old} → ${c.r}</b> yaptın. Kubernetes yine farkı kapatıyor: ${c.r > c.old ? "eksik pod'ları oluşturuyor" : "fazla pod'ları kapatıyor"}.</p>
      <p>Yeni pod'lar <b>Scheduler</b> tarafından en az pod'u olan node'a yerleştirilir. Image'ı daha önce indirmemiş bir node önce image'ı <b>pull</b> eder.</p>
      <p class="tip">Bunu yüke göre otomatik yapan mekanizma: <b>HorizontalPodAutoscaler (HPA)</b>. Örneğin "CPU %70'i geçerse pod sayısını artır, en fazla 10 olsun".</p>`,
    cl: '⌨ Komut',
    c: c => `kubectl scale deployment/web-app --replicas=${c.r}

# otomatik ölçekleme:
kubectl autoscale deployment/web-app --min=2 --max=10 --cpu-percent=70`,
  },

  rancher: {
    t: '🐮 Rancher nedir?',
    b: () => `<p><b>Rancher, Kubernetes'in kendisi değil.</b> Kubernetes cluster'larını yöneten bir <b>web paneli / yönetim platformu</b>.</p>
      <ul>
        <li>Birden fazla cluster'ı (test, prod, farklı bölgeler) tek ekrandan görürsün</li>
        <li>Deployment, pod, log ve event'leri tıklayarak incelersin</li>
        <li>Ölçekleme, rollback, image değiştirme gibi işleri butonla yaparsın</li>
        <li>Kullanıcı ve yetki yönetimi (kim hangi namespace'e erişebilir)</li>
        <li>Yeni cluster kurmayı kolaylaştırır (RKE2, K3s)</li>
      </ul>
      <p>Üstteki Rancher çubuğu, Rancher'daki <i>Workloads → Deployments</i> görünümünün sadeleştirilmiş hali. Oradaki her buton arkada bir Kubernetes API çağrısına (= bir <code>kubectl</code> komutuna) denk gelir.</p>
      <p class="tip">Akılda tut: <b>Docker</b> paketi yapar, <b>Kubernetes</b> paketleri çalıştırır ve ayakta tutar, <b>Rancher</b> Kubernetes'i rahat yönetmeni sağlar, <b>Jenkins</b> bunların hepsini push'a bağlar.</p>`,
  },

  node: {
    t: '🖥️ Node (worker makine)',
    b: () => `<p>Node, pod'ların gerçekten çalıştığı makine (sanal ya da fiziksel sunucu). Cluster platformundaki üç gri plaka üç node. Her node'da <b>kubelet</b> adında bir ajan çalışır: "bu node'da şu pod'lar çalışsın" emrini alır ve container'ları başlatır.</p>
      <p><b>Scheduler</b> yeni bir pod'u hangi node'a koyacağına karar verir (burada: en az yüklü olana). Node etiketindeki <b>image önbelleği</b>, o node'un daha önce indirdiği sürümleri gösterir. Olmayanı registry'den çeker.</p>
      <p>Bir node tamamen çökerse, üzerindeki pod'lar diğer node'larda yeniden oluşturulur.</p>`,
    cl: '⌨ Komut',
    c: () => `kubectl get nodes\nkubectl get pods -o wide   # hangi pod hangi node'da`,
  },

  service: {
    t: '🌐 Ingress & Service: trafik nasıl dağılıyor?',
    b: () => `<p>Pod'lar sürekli ölüp yeniden doğar ve her seferinde <b>IP adresleri değişir</b>. Kullanıcı hangi pod'a gideceğini bilemez.</p>
      <ul>
        <li><b>Ingress</b> (mor kemer): dışarıdan gelen <code>https://app.sirket.com</code> isteğini doğru Service'e yönlendirir.</li>
        <li><b>Service</b> (mavi altıgen): pod'ların önünde sabit bir adres + yük dengeleyici. <code>app=web-app</code> etiketli ve <b>Ready</b> olan pod'lara trafiği dağıtır.</li>
      </ul>
      <p>Readiness probe'u geçmemiş pod'a trafik <b>gönderilmez</b>. Rolling update'in kesintisiz olmasının sırrı bu. Uçan topların rengi, isteği karşılayan pod'un sürümünü gösterir.</p>`,
    cl: '📄 service.yaml + ingress.yaml',
    c: () => `apiVersion: v1
kind: Service
metadata: { name: web-app }
spec:
  selector: { app: web-app }   # bu etiketli pod'lara git
  ports: [{ port: 80, targetPort: 3000 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: web-app }
spec:
  rules:
    - host: app.sirket.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: web-app, port: { number: 80 } } }`,
  },

  pod: {
    t: '📦 Pod ve durumları',
    b: () => `<p><b>Pod</b>, Kubernetes'in en küçük birimi (sahnedeki küpler). İçinde bir (veya birkaç) <b>container</b> çalışır, yani senin image'ından başlatılmış süreç. Küpün rengi sürümü, altındaki halka durumu gösterir:</p>
      <ul>
        <li><b>Pending</b> (gri, şeffaf): pod oluşturuldu, Scheduler node seçiyor</li>
        <li><b>Image çekiliyor</b> (mavi): node image'ı registry'den indiriyor (pull)</li>
        <li><b>ContainerCreating</b> (turuncu): container başlatılıyor</li>
        <li><b>Running 0/1</b> (sarı): çalışıyor ama readiness probe henüz geçmedi → trafik almaz</li>
        <li><b>Running 1/1</b> (yeşil): hazır, Service trafiği buna da gönderir</li>
        <li><b>CrashLoopBackOff</b> (kırmızı, titrer): container sürekli çöküyor</li>
        <li><b>Terminating</b> (küçülür): kapatılıyor, önce trafikten çıkarılır</li>
      </ul>
      <p class="tip">Bir küpün üstüne gelince detayları görürsün, tıklayınca <code>kubectl delete pod</code> çalışır.</p>`,
  },
};

/* =========================================================
   Log
   ========================================================= */
const logEl = $('#log');
function log(src, msg, kind = '') {
  const ts = new Date().toTimeString().slice(0, 8);
  const ln = document.createElement('div');
  ln.className = 'ln ' + kind;
  ln.innerHTML = `<span class="ts">${ts}</span><span class="src src-${src}">${src}</span><span class="msg"></span>`;
  ln.lastChild.textContent = msg;
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  logEl.appendChild(ln);
  while (logEl.children.length > 400) logEl.firstChild.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

/* =========================================================
   Açıklama paneli
   ========================================================= */
function defaultCtx() {
  const last = S.commits[0];
  const prevDone = S.history.length > 1 ? S.history[S.history.length - 2] : S.deploy.version;
  return {
    v: S.deploy.version, hash: last.hash, msg: last.msg, stable: S.deploy.stable,
    old: prevDone, r: S.deploy.replicas, name: 'web-app-xxxx', to: S.deploy.stable, secs: '?',
  };
}
function highlight(code) {
  return code.split('\n').map(line => {
    const e = esc(line);
    return e.replace(/(^|\s)(#|\/\/)(\s.*|$)/, (m, a, b, c) => `${a}<span class="cm">${b}${c}</span>`);
  }).join('\n');
}
function explain(key, ctx = {}) {
  const e = EX[key];
  if (!e) return;
  const c = { ...defaultCtx(), ...ctx };
  const val = x => (typeof x === 'function' ? x(c) : (x || ''));
  $('#exTitle').textContent = val(e.t);
  $('#exBody').innerHTML = val(e.b);
  $('#exCodeLabel').textContent = val(e.cl);
  $('#exCode').innerHTML = highlight(val(e.c));
  const box = $('#explain');
  box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  box.scrollTop = 0;
}

/* =========================================================
   Kubernetes simülasyonu
   ========================================================= */
const live = () => S.pods.filter(p => p.status !== 'Terminating');
const liveOf = v => live().filter(p => p.version === v);
const isReady = p => p.status === 'Running' && p.ready;
const readyOf = v => liveOf(v).filter(isReady).length;
const readyAll = () => live().filter(isReady).length;
const nodeOf = p => S.nodes.find(n => n.name === p.node);
const sumReplicas = () => [...S.rs.values()].reduce((a, r) => a + r.replicas, 0);
const getRS = v => { if (!S.rs.has(v)) S.rs.set(v, { replicas: 0 }); return S.rs.get(v); };

function pickNode() {
  const counts = S.nodes.map(n => ({ n, c: live().filter(p => p.node === n.name).length }));
  counts.sort((a, b) => a.c - b.c);
  return counts[0].n;
}

function createPod(v, instant = false) {
  const node = pickNode();
  const t = now();
  const p = {
    id: ++S.podSeq, name: `web-app-${rsHash(v)}-${rand(5)}`, version: v, node: node.name,
    status: 'Pending', ready: false, restarts: 0, born: t, t: t + dur(700), req: 0, pulling: false,
  };
  if (instant) { p.status = 'Running'; p.ready = true; p.t = Infinity; p.born = t - 2 * 86400e3; }
  S.pods.push(p);
  if (!instant) log('k8s', `ReplicaSet web-app-${rsHash(v)}: yeni pod oluşturuldu → ${p.name} (Pending)`);
  return p;
}

function terminatePod(p, reason) {
  if (p.status === 'Terminating') return;
  p.status = 'Terminating';
  p.ready = false;
  p.t = now() + dur(1200);
  log('k8s', `${p.name} (v${p.version}) kapatılıyor: ${reason}`);
}

function setReplicas(v, n) {
  const rs = getRS(v);
  if (rs.replicas === n) return;
  const dir = n > rs.replicas ? 'up' : 'down';
  rs.replicas = n;
  log('k8s', `Deployment: Scaled ${dir} replica set web-app-${rsHash(v)} (v${v}) to ${n}`);
}

// Pod yaşam döngüsü: Pending → ContainerCreating → Running(0/1) → Running(1/1)
function advancePods() {
  const t = now();
  for (const p of [...S.pods]) {
    if (t < p.t) continue;
    switch (p.status) {
      case 'Pending': {
        const node = nodeOf(p);
        p.pulling = !node.images.has(p.version);
        p.status = 'ContainerCreating';
        p.t = t + dur(p.pulling ? 1900 : 600);
        log('k8s', `Scheduler: ${p.name} → ${p.node}`);
        if (p.pulling) log('k8s', `${p.node}: Pulling image "${REGISTRY}:v${p.version}" (node'da yok, registry'den indiriliyor)`);
        break;
      }
      case 'ContainerCreating':
        nodeOf(p).images.add(p.version);
        p.pulling = false;
        if (S.crash.has(p.version)) {
          p.status = 'CrashLoopBackOff';
          p.restarts = 1;
          p.t = t + dur(1800);
          log('k8s', `${p.name}: container başladı ve hemen çöktü (Error: DATABASE_URL tanımlı değil, exit code 1)`, 'err');
        } else {
          p.status = 'Running';
          p.ready = false;
          p.t = t + dur(900);
          log('k8s', `${p.name}: container çalışıyor, readiness probe bekleniyor (GET /health)`);
        }
        break;
      case 'Running':
        if (!p.ready) {
          p.ready = true;
          p.t = Infinity;
          log('k8s', `${p.name}: readiness probe ✓ → Service artık bu pod'a trafik gönderiyor`, 'ok');
        }
        break;
      case 'CrashLoopBackOff':
        p.restarts++;
        p.t = t + dur(Math.min(1800 * p.restarts, 6000));
        log('k8s', `${p.name}: Back-off restarting failed container (restart #${p.restarts})`, 'err');
        break;
      case 'Terminating':
        S.pods.splice(S.pods.indexOf(p), 1);
        break;
    }
  }
}

// Deployment controller: ReplicaSet'lerin replica sayılarını ayarlar (rolling update dahil)
function deploymentController() {
  const d = S.deploy;
  const nrs = getRS(d.version);
  const olds = [...S.rs.entries()].filter(([v, r]) => v !== d.version && r.replicas > 0);

  if (!olds.length) {
    setReplicas(d.version, d.replicas);
    if (d.rolling && liveOf(d.version).length === d.replicas && readyOf(d.version) === d.replicas && live().length === d.replicas) {
      d.rolling = false;
      d.stable = d.version;
      S.history.push(d.version);
      log('k8s', `Deployment web-app: rollout tamamlandı ✓ (${d.replicas}/${d.replicas} pod v${d.version})`, 'ok');
      if (S.rollbackPending) {
        S.rollbackPending = false;
        $('#rollbackBtn').classList.remove('attn');
        view.setStation('cluster', 'done');
        explain('rollbackDone', { v: d.version });
      }
    }
    return;
  }

  // 1) Yeni ReplicaSet'i büyüt (en fazla replicas + maxSurge toplam)
  const total = sumReplicas();
  const maxTotal = d.replicas + MAX_SURGE;
  if (total < maxTotal && nrs.replicas < d.replicas) {
    setReplicas(d.version, Math.min(d.replicas, nrs.replicas + (maxTotal - total)));
  }

  // 2) Eski ReplicaSet'leri küçült (hazır pod sayısı minAvailable'ın altına düşmesin)
  const minAvailable = d.replicas - MAX_UNAVAILABLE;
  const newUnavailable = nrs.replicas - readyOf(d.version);
  let maxDown = sumReplicas() - minAvailable - newUnavailable;
  for (const [v, r] of olds) {           // önce sağlıksız eski pod'ları temizle
    const unhealthy = Math.max(0, r.replicas - readyOf(v));
    const k = Math.min(maxDown, unhealthy);
    if (k > 0) { setReplicas(v, r.replicas - k); maxDown -= k; }
  }
  let canDown = readyAll() - minAvailable;
  for (const [v, r] of olds) {
    const k = Math.min(r.replicas, canDown);
    if (k > 0) { setReplicas(v, r.replicas - k); canDown -= k; }
  }
}

// ReplicaSet controller: "benden N pod olsun"
function rsController() {
  for (const [v, r] of S.rs) {
    const pods = liveOf(v);
    if (pods.length < r.replicas) {
      for (let i = pods.length; i < r.replicas; i++) createPod(v);
    } else if (pods.length > r.replicas) {
      // önce hazır olmayanları, sonra en yenileri sil
      const sorted = pods.slice().sort((a, b) => (isReady(a) - isReady(b)) || (b.born - a.born));
      sorted.slice(0, pods.length - r.replicas).forEach(p => terminatePod(p, `ReplicaSet v${v} küçültüldü`));
    }
  }
}

/* =========================================================
   3D sahne
   ========================================================= */
const view = createScene($('#scene'), {
  vcolor,
  onExplain: key => explain(key),
  onPodClick: id => killPod(S.pods.find(p => p.id === id)),
  getPod: id => S.pods.find(p => p.id === id),
});
window.__sceneReady = true;
$('#loading').classList.add('hidden');

const follow = name => { if ($('#follow').checked) view.focus(name); };

/* =========================================================
   Render
   ========================================================= */
function podStatusText(p) {
  switch (p.status) {
    case 'Pending': return 'Pending';
    case 'ContainerCreating': return p.pulling ? '⬇ image çekiliyor' : 'ContainerCreating';
    case 'Running': return p.ready ? '● Running 1/1' : '◌ readiness…';
    case 'CrashLoopBackOff': return `CrashLoop ↻${p.restarts}`;
    default: return 'Terminating';
  }
}

function renderWorkload() {
  const d = S.deploy;
  const crashing = liveOf(d.version).some(p => p.status === 'CrashLoopBackOff');
  const settled = !d.rolling && readyAll() === d.replicas && live().length === d.replicas;
  const badge = $('#wlBadge');
  if (crashing) { badge.textContent = 'Degraded'; badge.className = 'badge degraded'; }
  else if (!settled) { badge.textContent = 'Updating'; badge.className = 'badge updating'; }
  else { badge.textContent = 'Active'; badge.className = 'badge active'; }
  $('#wlImage').textContent = `image: ${REGISTRY}:v${d.version}`;
  const set = (id, val, warn) => { const el = $(id); el.textContent = val; el.parentElement.classList.toggle('warn', !!warn); };
  set('#cDesired', d.replicas);
  set('#cUpdated', liveOf(d.version).length, liveOf(d.version).length !== d.replicas);
  set('#cReady', readyAll(), readyAll() !== d.replicas);
  set('#cTotal', live().length, live().length !== d.replicas);
  $('#replicas').textContent = d.replicas;
}

function renderCommits() {
  view.setCommits(S.commits);
  view.setStatus('git', `${S.commits[0].hash} ${S.commits[0].msg}`);
}

function renderTags() {
  view.setTags(S.tags, S.deploy.version, S.crash);
  if (!S.busy) {
    const d = S.deploy;
    view.setStatus('registry', `${S.tags.length} image · v${d.version}${S.crash.has(d.version) ? ' 💥' : ' ● canlıda'}`);
  }
}

function renderJStages() {
  $('#jstages').innerHTML = JSTAGES.map(([id, label]) =>
    `<div class="jst" data-s="${id}" data-st="idle"><div class="row"><span class="dot"></span>${label}</div><span class="time"></span></div>`).join('');
  JSTAGES.forEach(([id]) => view.setJ(id, 'idle'));
}
function setJ(id, st, time = '') {
  const el = $(`.jst[data-s="${id}"]`);
  el.dataset.st = st;
  el.querySelector('.time').textContent = time || (st === 'running' ? 'çalışıyor…' : st === 'skipped' ? 'atlandı' : '');
  view.setJ(id, st);
  const label = JSTAGES.find(s => s[0] === id)[1];
  if (st === 'running') view.setStatus('jenkins', `▶ ${label}`);
  if (st === 'failed') view.setStatus('jenkins', `✗ ${label} başarısız`);
}

function renderLayers(states) {
  view.setLayers(states);
  const done = states.filter(s => s === 'cached' || s === 'built').length;
  const cached = states.filter(s => s === 'cached').length;
  const runIdx = states.indexOf('run');
  view.setStatus('docker', runIdx >= 0
    ? `katman ${runIdx + 1}/${LAYERS.length}: ${LAYERS[runIdx].cmd}`
    : `${done}/${LAYERS.length} katman · ${cached} CACHED`);
}

function renderDev() {
  S.devLines = S.devLines.slice(-13);
  view.setDevLines(S.devLines);
}

function pad(cols, widths) { return cols.map((c, i) => String(c).padEnd(widths[i])).join('').trimEnd(); }
function age(p) {
  const s = Math.max(0, Math.floor((now() - p.born) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function renderKubectl() {
  const el = $('#kubectl');
  if (el.classList.contains('hidden')) return;
  const d = S.deploy;
  const L = [];
  L.push('$ kubectl get deployment web-app');
  L.push(pad(['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE'], [10, 8, 12, 10]));
  L.push(pad(['web-app', `${readyAll()}/${d.replicas}`, liveOf(d.version).length, readyAll()], [10, 8, 12, 10]));
  L.push('', '$ kubectl get replicasets');
  L.push(pad(['NAME', 'DESIRED', 'CURRENT', 'READY', 'IMAGE'], [20, 9, 9, 7, 10]));
  [...S.rs.entries()].sort((a, b) => b[0] - a[0]).forEach(([v, r]) =>
    L.push(pad([`web-app-${rsHash(v)}`, r.replicas, liveOf(v).length, readyOf(v), `web-app:v${v}`], [20, 9, 9, 7, 10])));
  L.push('', '$ kubectl get pods -o wide');
  L.push(pad(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', 'NODE'], [25, 7, 19, 10, 6, 8]));
  S.pods.slice().sort((a, b) => a.version - b.version || a.id - b.id).forEach(p =>
    L.push(pad([p.name, isReady(p) ? '1/1' : '0/1', p.status, p.restarts, age(p), p.node], [25, 7, 19, 10, 6, 8])));
  el.textContent = L.join('\n');
}

function rollbackTarget() {
  const d = S.deploy;
  if (d.version !== d.stable) return d.stable;
  for (let i = S.history.length - 2; i >= 0; i--) if (S.history[i] !== d.version) return S.history[i];
  return null;
}

function updateControls() {
  $('#pushBtn').disabled = S.busy;
  $('#pushBtn').textContent = S.busy ? '⏳ pipeline çalışıyor…' : '⬆ git push';
  $('#scenario').disabled = S.busy;
  const target = rollbackTarget();
  const rb = $('#rollbackBtn');
  rb.disabled = S.busy || target == null;
  rb.textContent = target != null ? `↩ Rollback (v${target})` : '↩ Rollback';
}

function render() {
  view.syncPods(S.pods, S.nodes, isReady, podStatusText);
  renderWorkload();
  renderTags();
  renderKubectl();
  updateControls();
}

/* =========================================================
   Pipeline
   ========================================================= */
function gate() {
  if (!$('#stepMode').checked) return Promise.resolve();
  const nb = $('#nextBtn');
  nb.disabled = false;
  nb.classList.add('pulse');
  const t = now();
  return new Promise(res => {
    S.nextResolve = () => {
      S.nextResolve = null;
      nb.disabled = true;
      nb.classList.remove('pulse');
      S.paused += now() - t;
      res();
    };
  });
}

async function jStage(id, fn) {
  setJ(id, 'running');
  const t = now(), p0 = S.paused;
  const ok = await fn();
  const secs = ((now() - t - (S.paused - p0)) * S.speed / 1000).toFixed(1);
  setJ(id, ok ? 'success' : 'failed', secs + ' sn');
  return ok;
}

async function typeDev(lines) {
  for (const l of lines) {
    S.devLines.push(l);
    renderDev();
    await wait(l.startsWith('$') ? 450 : 200);
  }
}

const movePacket = (to, ms = 1300) => view.movePacket(to, dur(ms));

async function waitRollout(v, ctx) {
  let last = '', crashShown = false, simElapsed = 0, prev = now();
  for (;;) {
    const d = S.deploy;
    if (d.version !== v) return false;
    if (!d.rolling) return true;
    const avail = readyOf(v);
    const oldLeft = live().filter(p => p.version !== v).length;
    const m = avail < d.replicas
      ? `Waiting for deployment "web-app" rollout to finish: ${avail} of ${d.replicas} updated replicas are available...`
      : `Waiting for deployment "web-app" rollout to finish: ${oldLeft} old replicas are pending termination...`;
    if (m !== last) { log('jenkins', '[Deploy] ' + m); last = m; }
    view.setStatus('jenkins', `▶ Deploy: ${avail}/${d.replicas} hazır`);
    if (!crashShown && liveOf(v).some(p => p.status === 'CrashLoopBackOff')) {
      crashShown = true;
      explain('crash', ctx);
    }
    const t = now();
    simElapsed += (t - prev) * S.speed;
    prev = t;
    if (simElapsed > 6000 + 4000 * d.replicas) return false;
    await sleep(200);
  }
}

function resetPipelineUI(v) {
  ['dev', 'git', 'jenkins', 'docker', 'registry', 'cluster'].forEach(id => view.setStation(id, ''));
  view.resetTubes();
  renderJStages();
  renderLayers(LAYERS.map(() => 'wait'));
  view.setImage(false);
  $('#buildNo').textContent = `Build #${v} çalışıyor`;
  view.setStatus('jenkins', `Build #${v} kuyrukta`);
  view.setStatus('registry', 'yeni image bekleniyor');
  S.devLines = [];
  renderDev();
}

async function runPipeline() {
  if (S.busy) return;
  S.busy = true;
  S.paused = 0;
  updateControls();

  const scenario = $('#scenario').value;
  const msg = $('#commitMsg').value.trim() || 'küçük düzeltme';
  const v = S.nextVersion++;
  const hash = randHex(7);
  const prevHash = S.commits[0].hash;
  const ctx = { v, hash, msg, stable: S.deploy.stable, old: S.deploy.version, r: S.deploy.replicas };
  const t0 = now();
  resetPipelineUI(v);
  follow('pipeline');
  log('sys', `──────── yeni push: "${msg}" (senaryo: ${$('#scenario').selectedOptions[0].text}) ────────`);

  try {
    // 1) Geliştirici
    view.setStation('dev', 'active');
    view.setStatus('dev', '$ git push origin main');
    explain('dev', ctx);
    await typeDev(['$ git add .', `$ git commit -m "${msg}"`, `[main ${hash}] ${msg}`, ' 2 files changed, 14 insertions(+)', '$ git push origin main']);
    log('git', `$ git push origin main  (commit ${hash})`);
    await gate();
    view.placePacket('dev', `📄 commit ${hash}`, 'commit');
    await wait(450);
    await movePacket('git');
    view.setStation('dev', 'done');
    view.setStatus('dev', `push edildi ✓ ${hash}`);

    // 2) GitHub
    view.setStation('git', 'active');
    S.commits.unshift({ hash, msg, v });
    renderCommits();
    await typeDev(['To github.com:sirket/web-app.git', `   ${prevHash}..${hash}  main -> main`]);
    log('git', `GitHub: main dalı güncellendi ${prevHash}..${hash}`);
    explain('git', ctx);
    await wait(900);
    view.webhookPulse();
    view.labelPacket('🔔 webhook: yeni commit!', 'webhook');
    log('git', 'Webhook → POST https://jenkins.sirket.com/github-webhook/ … 200 OK');
    await wait(900);
    await gate();
    await movePacket('jenkins');
    view.setStation('git', 'done');

    // 3) Jenkins
    view.setStation('jenkins', 'active');
    explain('jenkins', ctx);
    view.labelPacket(`🤵 Build #${v}`, 'build');
    log('jenkins', `Started by GitHub push (${hash}) — Build #${v}`);
    log('jenkins', 'Jenkinsfile okunuyor… 5 stage bulundu');
    await wait(1000);
    await gate();

    await jStage('checkout', async () => {
      explain('checkout', ctx);
      log('jenkins', '[Checkout] git clone https://github.com/sirket/web-app.git');
      await wait(800);
      log('jenkins', `[Checkout] HEAD is now at ${hash} ${msg}`);
      await wait(500);
      return true;
    });
    await gate();

    const testOk = await jStage('test', async () => {
      explain('test', ctx);
      log('jenkins', '[Test] $ npm ci');
      await wait(900);
      log('jenkins', '[Test] added 312 packages in 4s');
      log('jenkins', '[Test] $ npm test');
      await wait(400);
      const tests = ['anasayfa render ediliyor', 'kullanıcı girişi', 'sepete ürün ekleme', 'toplam fiyat hesaplama', 'GET /health 200 dönüyor'];
      for (let i = 0; i < tests.length; i++) {
        await wait(380);
        if (scenario === 'testfail' && i === 3) {
          log('jenkins', `[Test]   ✗ ${tests[i]}`, 'err');
          log('jenkins', '[Test]     expect(sepet.toplam()).toBe(120)  → Received: 100', 'err');
          log('jenkins', '[Test] Tests: 1 failed, 3 passed, 5 total', 'err');
          return false;
        }
        log('jenkins', `[Test]   ✓ ${tests[i]}`, 'ok');
        view.setStatus('jenkins', `▶ Test ${i + 1}/${tests.length} ✓`);
      }
      log('jenkins', '[Test] Tests: 5 passed, 5 total', 'ok');
      await wait(300);
      return true;
    });
    if (!testOk) {
      ['build', 'push', 'deploy'].forEach(s => setJ(s, 'skipped'));
      view.setStation('jenkins', 'failed');
      view.labelPacket(`✗ Build #${v} FAILED`, 'fail');
      $('#buildNo').textContent = `Build #${v} ✗`;
      log('jenkins', `Build #${v}: Finished: FAILURE ❌`, 'err');
      log('jenkins', 'post { failure } → ekip@sirket.com adresine "Build kırıldı" maili gönderildi');
      explain('testfail', ctx);
      setTimeout(() => { if (!S.busy) view.hidePacket(); }, 4000);
      return;
    }
    await gate();

    // 4) Docker build
    await jStage('build', async () => {
      log('jenkins', `[Build] $ docker build -t ${REGISTRY}:v${v} .`);
      view.labelPacket('📁 kaynak kod', 'source');
      await movePacket('docker');
      view.setStation('docker', 'active');
      explain('docker', ctx);
      const st = LAYERS.map(() => 'wait');
      renderLayers(st);
      for (let i = 0; i < LAYERS.length; i++) {
        st[i] = 'run';
        renderLayers(st);
        await wait(LAYERS[i].cached ? 420 : 1100);
        st[i] = LAYERS[i].cached ? 'cached' : 'built';
        renderLayers(st);
        log('docker', `#${i + 2} [${i + 1}/${LAYERS.length}] ${LAYERS[i].cmd}${LAYERS[i].cached ? '   CACHED' : '   DONE'}`);
      }
      log('docker', `Successfully tagged ${REGISTRY}:v${v}`, 'ok');
      view.setImage(true);
      view.setStatus('docker', `🐳 web-app:v${v} · 159MB`);
      view.labelPacket(`🐳 image web-app:v${v}`, 'image');
      await wait(700);
      return true;
    });
    view.setStation('docker', 'done');
    await gate();

    // 5) Registry push
    await jStage('push', async () => {
      log('jenkins', `[Push] $ docker push ${REGISTRY}:v${v}`);
      await movePacket('registry');
      view.setStation('registry', 'active');
      explain('registry', ctx);
      view.setStatus('registry', `⬆ web-app:v${v} yükleniyor`);
      for (const l of LAYERS.slice().reverse()) {
        if (l.size === '0B') continue;
        await wait(l.cached ? 220 : 750);
        log('docker', `${randHex(12)}: ${l.cached ? 'Layer already exists' : 'Pushed'}  (${l.cmd})`);
      }
      const digest = randHex(12);
      S.tags.unshift({ v, digest });
      log('docker', `v${v}: digest: sha256:${digest}… size: 2204`, 'ok');
      view.setStatus('registry', `web-app:v${v} rafta ✓`);
      await wait(600);
      return true;
    });
    view.setStation('registry', 'done');
    await gate();

    // 6) Kubernetes deploy
    const deployed = await jStage('deploy', async () => {
      log('jenkins', `[Deploy] $ kubectl set image deployment/web-app web=${REGISTRY}:v${v}`);
      view.labelPacket(`☸️ v${v} → Kubernetes`, 'k8s');
      follow('cluster');
      await movePacket('cluster', 1700);
      view.setStation('cluster', 'active');
      view.hidePacket();
      if (scenario === 'crash') S.crash.add(v);
      ctx.old = S.deploy.version;
      ctx.r = S.deploy.replicas;
      S.deploy.version = v;
      S.deploy.rolling = true;
      getRS(v);
      log('k8s', `deployment.apps/web-app image updated (v${ctx.old} → v${v}): istenen durum değişti`);
      explain('deploy', ctx);
      if ($('#stepMode').checked) await gate(); else await wait(3500);
      explain('rolling', { ...ctx, r: S.deploy.replicas });
      log('jenkins', '[Deploy] $ kubectl rollout status deployment/web-app --timeout=120s');
      return waitRollout(v, ctx);
    });

    if (deployed) {
      view.setStation('cluster', 'done');
      view.setStation('jenkins', 'done');
      $('#buildNo').textContent = `Build #${v} ✓`;
      view.setStatus('jenkins', `Build #${v} ✓ SUCCESS`);
      log('jenkins', '[Deploy] deployment "web-app" successfully rolled out', 'ok');
      log('jenkins', `Build #${v}: Finished: SUCCESS ✅`, 'ok');
      const secs = ((now() - t0 - S.paused) * S.speed / 1000).toFixed(1);
      explain('done', { ...ctx, r: S.deploy.replicas, secs });
    } else {
      view.setStation('cluster', 'failed');
      view.setStation('jenkins', 'failed');
      $('#buildNo').textContent = `Build #${v} ✗`;
      view.setStatus('jenkins', `Build #${v} ✗ rollout zaman aşımı`);
      log('jenkins', '[Deploy] error: deployment "web-app" exceeded its progress deadline', 'err');
      log('jenkins', `Build #${v}: Finished: FAILURE ❌`, 'err');
      explain('crashFail', ctx);
      $('#rollbackBtn').classList.add('attn');
    }
  } finally {
    S.busy = false;
    const nb = $('#nextBtn');
    nb.disabled = true;
    nb.classList.remove('pulse');
    $('#commitMsg').value = COMMIT_IDEAS[S.ideaIdx++ % COMMIT_IDEAS.length];
    view.setStatus('dev', 'git push bekleniyor');
    updateControls();
  }
}

/* =========================================================
   Kullanıcı etkileşimleri
   ========================================================= */
function scale(delta) {
  const d = S.deploy;
  const old = d.replicas;
  const r = Math.max(1, Math.min(8, old + delta));
  if (r === old) return;
  d.replicas = r;
  log('k8s', `$ kubectl scale deployment/web-app --replicas=${r}`);
  explain('scale', { old, r });
}

function rollback() {
  const to = rollbackTarget();
  if (S.busy || to == null) return;
  const from = S.deploy.version;
  log('k8s', '$ kubectl rollout undo deployment/web-app');
  log('k8s', `deployment.apps/web-app rolled back (v${from} → v${to})`);
  S.deploy.version = to;
  S.deploy.rolling = true;
  S.rollbackPending = true;
  view.setStation('cluster', 'active');
  follow('cluster');
  explain('rollback', { to, from });
}

function killPod(p) {
  if (!p || p.status === 'Terminating') return;
  log('k8s', `$ kubectl delete pod ${p.name}`);
  terminatePod(p, 'kullanıcı sildi');
  explain('selfheal', { name: p.name });
}

/* ---------- trafik ---------- */
function toggleTraffic() {
  S.traffic = !S.traffic;
  const b = $('#trafficBtn');
  b.textContent = S.traffic ? '🚦 Trafik: açık' : '🚦 Trafik: kapalı';
  b.classList.toggle('on', S.traffic);
  if (S.traffic) {
    const token = ++S.trafficToken;
    const loop = () => {
      if (!S.traffic || token !== S.trafficToken) return;
      sendRequest();
      setTimeout(loop, dur(420));
    };
    loop();
    explain('service');
    log('sys', 'Kullanıcı trafiği başladı (https://app.sirket.com)');
  }
}

function sendRequest() {
  const ready = S.pods.filter(isReady);
  const p = ready.length ? ready[S.rr++ % ready.length] : null;
  view.sendRequest(p ? p.id : null, p ? vcolor(p.version) : null, dur(450), () => {
    if (p) { p.req++; view.hitPod(p.id); }
    record(p ? p.version : null);
  });
}

function record(v) {
  S.responses.push(v);
  if (S.responses.length > 40) S.responses.shift();
  if (v == null) S.errCount++; else S.okCount++;
  $('#respStrip').innerHTML = S.responses.map(x =>
    `<i style="background:${x == null ? 'var(--err)' : vcolor(x)}" title="${x == null ? '503 hata' : '200 OK · v' + x}"></i>`).join('');
  const byV = {};
  S.responses.forEach(x => { if (x != null) byV[x] = (byV[x] || 0) + 1; });
  const parts = Object.keys(byV).sort((a, b) => a - b).map(k => `<b style="color:${vcolor(+k)}">v${k}</b> %${Math.round(byV[k] / S.responses.length * 100)}`);
  $('#respStats').innerHTML = `✓ ${S.okCount} başarılı · ✗ ${S.errCount} hata<br>${parts.join(' · ')}`;
}

/* =========================================================
   Başlangıç
   ========================================================= */
function init() {
  renderJStages();
  renderLayers(LAYERS.map(() => 'idle'));
  view.setStatus('docker', 'son image: web-app:v1');
  view.setStatus('jenkins', 'son build: #1 ✓');
  view.setStatus('dev', 'git push bekleniyor');
  renderCommits();
  renderDev();
  S.rs.set(1, { replicas: 3 });
  for (let i = 0; i < 3; i++) createPod(1, true);
  render();
  explain('intro');
  log('sys', 'Cluster hazır: web-app v1, 3 pod çalışıyor. Bir push at!');

  setInterval(() => {
    advancePods();
    deploymentController();
    rsController();
    render();
  }, 200);

  $('#pushBtn').addEventListener('click', runPipeline);
  $('#commitMsg').addEventListener('keydown', e => { if (e.key === 'Enter') runPipeline(); });
  $('#nextBtn').addEventListener('click', () => S.nextResolve && S.nextResolve());
  $('#stepMode').addEventListener('change', e => { if (!e.target.checked && S.nextResolve) S.nextResolve(); });
  document.addEventListener('keydown', e => {
    if (e.key === ' ' && S.nextResolve && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
      e.preventDefault();
      S.nextResolve();
    }
  });
  $('#speed').addEventListener('input', e => {
    S.speed = +e.target.value;
    $('#speedVal').textContent = S.speed + 'x';
  });
  $('#helpBtn').addEventListener('click', () => explain('intro'));
  $('#scaleUp').addEventListener('click', () => scale(+1));
  $('#scaleDown').addEventListener('click', () => scale(-1));
  $('#rollbackBtn').addEventListener('click', rollback);
  $('#trafficBtn').addEventListener('click', toggleTraffic);
  $('#clearLog').addEventListener('click', () => { logEl.innerHTML = ''; });
  $$('[data-view]').forEach(b => b.addEventListener('click', () => view.focus(b.dataset.view)));

  document.addEventListener('click', e => {
    const ex = e.target.closest('[data-ex]');
    if (ex) explain(ex.dataset.ex);
  });
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#log').classList.toggle('hidden', t.dataset.tab !== 'log');
    $('#kubectl').classList.toggle('hidden', t.dataset.tab !== 'kubectl');
    renderKubectl();
  }));
}

init();
