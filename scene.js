import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* =========================================================
   Sahne yerleşimi (dünya birimleri)
   ========================================================= */
const STATIONS = {
  dev:      { pos: [-36, -18], icon: '💻', title: 'Geliştirici', sub: 'senin bilgisayarın' },
  git:      { pos: [-18, -18], icon: '🐙', title: 'GitHub', sub: 'sirket/web-app' },
  jenkins:  { pos: [0, -18],   icon: '🤵', title: 'Jenkins', sub: 'CI sunucusu' },
  docker:   { pos: [18, -18],  icon: '🐳', title: 'Docker Build', sub: 'Dockerfile → image' },
  registry: { pos: [36, -18],  icon: '📦', title: 'Registry', sub: 'registry.sirket.com' },
};
const CLUSTER = { x: 2, z: 10, w: 42, d: 16 };
const NODE_X = [-11, 2, 15];
const NODE_W = 11, NODE_D = 13.2;
const EDGE = { users: [-37, 10], ingress: [-30.5, 10], service: [-24.5, 10] };
const SLOTS = [[-2.6, -4.8], [2.6, -4.8], [-2.6, -1.6], [2.6, -1.6], [-2.6, 1.6], [2.6, 1.6], [-2.6, 4.8], [2.6, 4.8]];
const VIEWS = {
  overview: { pos: [0, 50, 66], tgt: [0, 0, 9] },
  pipeline: { pos: [0, 40, 30], tgt: [0, 2, -8] },
  cluster:  { pos: [-1, 42, 68], tgt: [-1, 0, 16] },
};

const COLORS = {
  idle: 0xd5dce8, active: 0x3b82f6, done: 0x22c55e, failed: 0xef4444,
  ringPending: 0x94a3b8, ringCreating: 0xf59e0b, ringPull: 0x38bdf8, ringNotReady: 0xeab308,
  ringReady: 0x22c55e, ringCrash: 0xef4444,
};
const PACKET_KIND = {
  commit: 0x3b82f6, webhook: 0xf59e0b, build: 0x8b5cf6, source: 0x64748b,
  image: 0x0ea5e9, k8s: 0x6366f1, fail: 0xef4444,
};

const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutBack = k => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);

export function createScene(container, { vcolor, onExplain, onPodClick, getPod }) {
  const W = () => container.clientWidth, H = () => container.clientHeight;

  /* ---------- renderer, kamera, ışık ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(W(), H());
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xeef3fb, 130, 240);

  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.5, 400);
  camera.position.set(...VIEWS.overview.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...VIEWS.overview.tgt);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.36;
  controls.minDistance = 10;
  controls.maxDistance = 170;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6deec, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(24, 56, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 48, bottom: -48, near: 1, far: 170 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xf3f6fb, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(260, 130, 0xd6deeb, 0xe4e9f2);
  grid.position.y = 0.01;
  scene.add(grid);

  /* ---------- yardımcılar ---------- */
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, ...o });
  const rbox = (w, h, d, r = 0.2) => new RoundedBoxGeometry(w, h, d, 3, r);
  function mesh(geo, mat, { x = 0, y = 0, z = 0, cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
  function label(html, cls, onClick) {
    const div = document.createElement('div');
    div.className = 'lbl ' + cls;
    div.innerHTML = html;
    if (onClick) {
      div.classList.add('clickable');
      div.addEventListener('click', onClick);
    }
    return new CSS2DObject(div);
  }

  const tweens = new Set();
  function tween(ms, step, done) {
    const t = { start: performance.now(), ms: Math.max(1, ms), step, done };
    tweens.add(t);
    return t;
  }
  const tweenP = (ms, step) => new Promise(r => tween(ms, step, r));

  /* ---------- istasyonlar ---------- */
  const stations = {};
  const anchor = id => (id === 'cluster'
    ? new THREE.Vector3(CLUSTER.x, 5.5, CLUSTER.z)
    : new THREE.Vector3(STATIONS[id].pos[0], 6.2, STATIONS[id].pos[1]));

  for (const [id, s] of Object.entries(STATIONS)) {
    const g = new THREE.Group();
    g.position.set(s.pos[0], 0, s.pos[1]);
    scene.add(g);
    g.add(mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.5, 48), M(0xffffff), { y: 0.25 }));
    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.idle });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.95, 0.13, 12, 72), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    g.add(ring);
    const card = label(
      `<div class="st-h"><span class="ic">${s.icon}</span><div><b>${s.title}</b><small>${s.sub}</small></div><span class="i">ⓘ</span></div><div class="st-s"></div>`,
      'st-card', () => onExplain(id));
    card.position.set(0, 0.3, 5.3);
    g.add(card);
    stations[id] = { g, ring, ringMat, card, state: '' };
  }

  // 💻 laptop + terminal ekranı
  const devCanvas = document.createElement('canvas');
  devCanvas.width = 512; devCanvas.height = 340;
  const devCtx = devCanvas.getContext('2d');
  const devTex = new THREE.CanvasTexture(devCanvas);
  devTex.colorSpace = THREE.SRGBColorSpace;
  {
    const g = stations.dev.g;
    g.add(mesh(rbox(4.4, 0.3, 3.1, 0.12), M(0x64748b), { y: 0.66 }));
    g.add(mesh(new THREE.BoxGeometry(3.7, 0.04, 1.5), M(0x334155), { y: 0.83, z: 0.45 }));
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.8, -1.45);
    hinge.rotation.x = -0.22;
    hinge.add(mesh(rbox(4.4, 3.0, 0.18, 0.08), M(0x64748b), { y: 1.5 }));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.05, 2.66), new THREE.MeshBasicMaterial({ map: devTex, toneMapped: false }));
    scr.position.set(0, 1.5, 0.095);
    hinge.add(scr);
    g.add(hinge);
  }
  function setDevLines(lines) {
    devCtx.fillStyle = '#0b1220';
    devCtx.fillRect(0, 0, 512, 340);
    devCtx.font = '600 19px "JetBrains Mono", Consolas, monospace';
    lines.slice(-11).forEach((l, i) => {
      devCtx.fillStyle = l.startsWith('$') ? '#4ade80' : '#cbd5e1';
      devCtx.fillText(l.length > 40 ? l.slice(0, 39) + '…' : l, 16, 34 + i * 28);
    });
    devTex.needsUpdate = true;
  }

  // 🐙 git sunucusu + commit diski yığını
  const discGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.32, 40);
  const gitStack = new THREE.Group();
  {
    const g = stations.git.g;
    g.add(mesh(rbox(3.3, 1.5, 3.3, 0.3), M(0x24292f), { y: 1.25 }));
    gitStack.position.y = 2.0;
    g.add(gitStack);
  }
  let lastCommitKey = '';
  function setCommits(commits) {
    const list = commits.slice(0, 6);
    const key = list.map(c => c.hash).join(',');
    if (key === lastCommitKey) return;
    const isNew = lastCommitKey !== '' && list.length && !lastCommitKey.includes(list[0].hash);
    lastCommitKey = key;
    gitStack.children.slice().forEach(c => { gitStack.remove(c); c.material.dispose(); });
    list.slice().reverse().forEach((c, i) => {
      const d = mesh(discGeo, M(vcolor(c.v)), { y: 0.16 + i * 0.38 });
      gitStack.add(d);
      if (isNew && i === list.length - 1) {
        const y0 = d.position.y;
        tween(600, k => { d.position.y = y0 + 4 * (1 - easeOutBack(k)); });
      }
    });
  }
  function webhookPulse() {
    for (let n = 0; n < 3; n++) {
      setTimeout(() => {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 64),
          new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(STATIONS.git.pos[0], 0.6, STATIONS.git.pos[1]);
        scene.add(m);
        tween(1300, k => { m.scale.setScalar(1 + k * 9); m.material.opacity = 1 - k; }, () => {
          scene.remove(m); m.geometry.dispose(); m.material.dispose();
        });
      }, n * 280);
    }
  }

  // 🤵 jenkins: stage ışıkları + dönen dişli
  const jLights = {};
  const JORDER = ['checkout', 'test', 'build', 'push', 'deploy'];
  let gear;
  {
    const g = stations.jenkins.g;
    g.add(mesh(rbox(3.4, 3.8, 2.8, 0.3), M(0xffffff), { y: 2.4 }));
    g.add(mesh(rbox(3.7, 0.5, 3.1, 0.2), M(0xd24939), { y: 4.5 }));
    const lg = rbox(1.9, 0.42, 0.14, 0.06);
    JORDER.forEach((s, i) => {
      const m = mesh(lg, M(COLORS.idle), { y: 3.75 - i * 0.62, z: 1.42, cast: false });
      g.add(m);
      jLights[s] = { m, st: 'idle' };
    });
    gear = mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.35, 10), M(0x94a3b8), { y: 5.0 });
    g.add(gear);
  }
  function setJ(stage, st) {
    const l = jLights[stage];
    if (!l) return;
    l.st = st;
    const c = { idle: COLORS.idle, running: COLORS.active, success: COLORS.done, failed: COLORS.failed, skipped: 0xeef1f6 }[st];
    l.m.material.color.setHex(c);
    l.m.material.emissive.setHex(st === 'idle' || st === 'skipped' ? 0x000000 : c);
    l.m.material.emissiveIntensity = 0.5;
  }

  // 🐳 docker: katmanlar üst üste
  const layerMeshes = [];
  let layerStates = [];
  let imageBox;
  {
    const g = stations.docker.g;
    g.add(mesh(rbox(3.6, 0.3, 3.0, 0.12), M(0xe0f2fe), { y: 0.65 }));
    const lg = rbox(3.0, 0.34, 2.4, 0.1);
    for (let i = 0; i < 7; i++) {
      const m = mesh(lg, M(0xe2e8f0), { y: 1.0 + i * 0.4 });
      m.userData.y = m.position.y;
      g.add(m);
      layerMeshes.push(m);
    }
    imageBox = mesh(rbox(3.7, 3.35, 3.1, 0.3),
      M(0x38bdf8, { transparent: true, opacity: 0.2, depthWrite: false }), { y: 2.3, cast: false });
    imageBox.visible = false;
    g.add(imageBox);
  }
  function setLayers(states) {
    states.forEach((st, i) => {
      const m = layerMeshes[i];
      const prev = layerStates[i];
      m.visible = st !== 'wait';
      const c = { idle: 0xe2e8f0, run: 0x93c5fd, cached: 0x7dd3fc, built: 0x4ade80, wait: 0xe2e8f0 }[st];
      m.material.color.setHex(c);
      m.material.emissive.setHex(st === 'run' ? 0x3b82f6 : 0x000000);
      if (st === 'run' && prev !== 'run') {
        tween(350, k => { m.position.y = m.userData.y + 2.5 * (1 - ease(k)); });
      }
    });
    layerStates = states.slice();
  }
  function setImage(visible) {
    imageBox.visible = visible;
    if (visible) tween(500, k => { imageBox.scale.setScalar(0.6 + 0.4 * easeOutBack(k)); });
  }

  // 📦 registry: raf + image kutuları
  const regGroup = new THREE.Group();
  const regBoxGeo = rbox(1.05, 1.05, 1.05, 0.15);
  {
    const g = stations.registry.g;
    const post = new THREE.BoxGeometry(0.25, 4.0, 2.2);
    g.add(mesh(post, M(0xcbd5e1), { x: -2.05, y: 2.5 }));
    g.add(mesh(post, M(0xcbd5e1), { x: 2.05, y: 2.5 }));
    const board = rbox(4.3, 0.2, 2.4, 0.08);
    g.add(mesh(board, M(0xf1f5f9), { y: 0.95 }));
    g.add(mesh(board, M(0xf1f5f9), { y: 2.65 }));
    g.add(mesh(board, M(0xf1f5f9), { y: 4.4 }));
    g.add(regGroup);
  }
  let lastTagKey = '';
  function setTags(tags, deployedV, crash) {
    const list = tags.slice(0, 6);
    const key = list.map(t => `${t.v}${t.v === deployedV ? '*' : ''}${crash.has(t.v) ? '!' : ''}`).join(',');
    if (key === lastTagKey) return;
    const oldTop = lastTagKey.split(',')[0].replace(/\D/g, '');
    const isNew = lastTagKey !== '' && list.length && String(list[0].v) !== oldTop;
    lastTagKey = key;
    regGroup.children.slice().forEach(c => {
      regGroup.remove(c);
      c.children.forEach(ch => ch.element && ch.element.remove());
      c.material.dispose();
    });
    list.forEach((t, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      const y = row === 0 ? 3.25 : 1.6;
      const live = t.v === deployedV && !crash.has(t.v);
      const m = mesh(regBoxGeo, M(vcolor(t.v), { emissive: live ? vcolor(t.v) : 0x000000, emissiveIntensity: 0.35 }),
        { x: -1.3 + col * 1.3, y });
      const tag = crash.has(t.v) ? ' 💥' : live ? ' ●' : '';
      const l = label(`v${t.v}${tag}`, 'tag-lbl' + (live ? ' live' : '') + (crash.has(t.v) ? ' bad' : ''));
      l.position.set(0, 0.85, 0);
      m.add(l);
      regGroup.add(m);
      if (isNew && i === 0) tween(600, k => { m.position.y = y + 4 * (1 - easeOutBack(k)); });
    });
  }

  /* ---------- borular (pipeline hattı) ---------- */
  const curves = {};
  const tubes = {};
  function arc(a, b, h) {
    const mid = a.clone().lerp(b, 0.5);
    mid.y += h;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }
  [['dev', 'git'], ['git', 'jenkins'], ['jenkins', 'docker'], ['docker', 'registry'], ['registry', 'cluster']].forEach(([a, b]) => {
    const c = arc(anchor(a), anchor(b), b === 'cluster' ? 9 : 2.5);
    curves[a + '>' + b] = c;
    const t = new THREE.Mesh(new THREE.TubeGeometry(c, 80, 0.11, 10),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.75, roughness: 0.4 }));
    t.castShadow = true;
    scene.add(t);
    tubes[a + '>' + b] = t;
  });
  function resetTubes() { Object.values(tubes).forEach(t => t.material.color.setHex(0xcbd5e1)); }

  /* ---------- cluster ---------- */
  const clusterEdge = mesh(rbox(CLUSTER.w + 0.8, 0.4, CLUSTER.d + 0.8, 0.2), M(0xc7d2fe), { x: CLUSTER.x, y: 0.2, z: CLUSTER.z });
  scene.add(clusterEdge);
  scene.add(mesh(rbox(CLUSTER.w, 0.6, CLUSTER.d, 0.25), M(0xffffff), { x: CLUSTER.x, y: 0.32, z: CLUSTER.z }));
  {
    const l = label('☸️ <b>Kubernetes</b> · prod-cluster <span class="i">ⓘ</span>', 'cl-lbl', () => onExplain('deploy'));
    l.position.set(CLUSTER.x + CLUSTER.w / 2 + 5.5, 0.7, CLUSTER.z);
    scene.add(l);
  }
  const nodeLabels = {};
  NODE_X.forEach((x, i) => {
    const name = `node-${i + 1}`;
    scene.add(mesh(rbox(NODE_W, 0.3, NODE_D, 0.12), M(0xf1f5f9), { x, y: 0.75, z: CLUSTER.z }));
    const l = label('', 'node-lbl', () => onExplain('node'));
    l.position.set(x, 0.95, CLUSTER.z + NODE_D / 2 + 0.2);
    scene.add(l);
    nodeLabels[name] = { l, html: '' };
  });

  // kullanıcılar → ingress → service
  {
    const [ux, uz] = EDGE.users;
    scene.add(mesh(new THREE.CylinderGeometry(2.0, 2.2, 0.3, 40), M(0xffffff), { x: ux, y: 0.15, z: uz }));
    const capsule = new THREE.CapsuleGeometry(0.38, 0.8, 6, 16);
    [[-0.8, -0.6, 0xf472b6], [0.8, -0.5, 0x60a5fa], [0, 0.7, 0xfbbf24]].forEach(([dx, dz, c]) => {
      scene.add(mesh(capsule, M(c), { x: ux + dx, y: 1.05, z: uz + dz }));
      scene.add(mesh(new THREE.SphereGeometry(0.34, 20, 14), M(0xfde68a), { x: ux + dx, y: 2.0, z: uz + dz }));
    });
    const [ix, iz] = EDGE.ingress;
    const arch = mesh(new THREE.TorusGeometry(1.6, 0.26, 14, 40, Math.PI), M(0x8b5cf6), { x: ix, y: 0.3, z: iz });
    arch.rotation.y = Math.PI / 2;
    scene.add(arch);
    const [sx, sz] = EDGE.service;
    scene.add(mesh(new THREE.CylinderGeometry(1.35, 1.35, 1.3, 6), M(0x2563eb), { x: sx, y: 0.95, z: sz }));
    const line = new THREE.Mesh(new THREE.BoxGeometry(sx - ux, 0.08, 0.3), M(0xcbd5e1));
    line.position.set((sx + ux) / 2, 0.05, uz);
    scene.add(line);
    [['👥 Kullanıcılar', ux], ['Ingress', ix], ['Service', sx]].forEach(([t, x]) => {
      const l = label(`${t} <span class="i">ⓘ</span>`, 'edge-lbl', () => onExplain('service'));
      l.position.set(x, 0.3, uz + 3.0);
      scene.add(l);
    });
  }

  /* ---------- pod'lar ---------- */
  const podGeo = rbox(2.4, 1.7, 2.4, 0.3);
  const ringGeo = new THREE.TorusGeometry(1.75, 0.11, 10, 48);
  const podObjs = new Map();
  const slotsUsed = {};
  NODE_X.forEach((_, i) => { slotsUsed[`node-${i + 1}`] = new Set(); });
  const podBodies = [];

  function podPos(node, slot) {
    const ni = +node.split('-')[1] - 1;
    const s = SLOTS[slot % SLOTS.length];
    const lift = slot >= SLOTS.length ? 2 : 0;
    return new THREE.Vector3(NODE_X[ni] + s[0], 1.8 + lift, CLUSTER.z + s[1]);
  }

  function createPodObj(p) {
    const used = slotsUsed[p.node];
    let slot = 0;
    while (used.has(slot)) slot++;
    used.add(slot);
    const pos = podPos(p.node, slot);
    const g = new THREE.Group();
    g.position.copy(pos);
    const body = mesh(podGeo, M(vcolor(p.version), { transparent: true }));
    body.userData.podId = p.id;
    g.add(body);
    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.ringPending });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.82;
    g.add(ring);
    const lbl = label('', 'pod-lbl');
    lbl.position.set(0, 1.65, 0);
    g.add(lbl);
    g.scale.setScalar(0.01);
    scene.add(g);
    podBodies.push(body);
    const o = { g, body, ring, ringMat, lbl, slot, node: p.node, base: pos.clone(), st: '', html: '', removing: false, opacity: 1 };
    tween(450, k => { if (!o.removing) g.scale.setScalar(Math.max(0.01, easeOutBack(k))); });
    return o;
  }

  function podVisualState(p, isReady) {
    switch (p.status) {
      case 'Pending': return 'pending';
      case 'ContainerCreating': return p.pulling ? 'pull' : 'creating';
      case 'Running': return isReady(p) ? 'ready' : 'notready';
      case 'CrashLoopBackOff': return 'crash';
      default: return 'terminating';
    }
  }

  function applyPodState(o, st) {
    o.st = st;
    const ringC = { pending: COLORS.ringPending, creating: COLORS.ringCreating, pull: COLORS.ringPull,
      notready: COLORS.ringNotReady, ready: COLORS.ringReady, crash: COLORS.ringCrash, terminating: COLORS.ringCrash }[st];
    o.ringMat.color.setHex(ringC);
    o.opacity = { pending: 0.3, creating: 0.55, pull: 0.55, notready: 0.85, ready: 1, crash: 1, terminating: 0.25 }[st];
    o.body.material.emissive.setHex(st === 'crash' ? 0xef4444 : 0x000000);
  }

  function syncPods(pods, nodes, isReady, statusText) {
    const seen = new Set();
    for (const p of pods) {
      seen.add(p.id);
      let o = podObjs.get(p.id);
      if (!o) { o = createPodObj(p); podObjs.set(p.id, o); }
      const st = podVisualState(p, isReady);
      if (st !== o.st) applyPodState(o, st);
      const html = `<span class="pv" style="background:${vcolor(p.version)}">v${p.version}</span>${p.name.split('-').pop()}<div class="ps ps-${st}">${statusText(p)}</div>`;
      if (html !== o.html) { o.lbl.element.innerHTML = html; o.html = html; }
    }
    for (const [id, o] of podObjs) {
      if (seen.has(id) || o.removing) continue;
      o.removing = true;
      const s0 = o.g.scale.x;
      tween(220, k => o.g.scale.setScalar(Math.max(0.01, s0 * (1 - k))), () => {
        scene.remove(o.g);
        o.lbl.element.remove();
        o.body.material.dispose();
        o.ringMat.dispose();
        podBodies.splice(podBodies.indexOf(o.body), 1);
        slotsUsed[o.node].delete(o.slot);
        podObjs.delete(id);
      });
    }
    for (const n of nodes) {
      const count = pods.filter(p => p.node === n.name && p.status !== 'Terminating').length;
      const chips = [...n.images].sort((a, b) => a - b).map(v => `<span class="ci" style="background:${vcolor(v)}">v${v}</span>`).join('');
      const html = `<b>🖥️ ${n.name}</b> · ${count} pod <span class="i">ⓘ</span><div class="cache">image önbelleği: ${chips}</div>`;
      const nl = nodeLabels[n.name];
      if (nl && nl.html !== html) { nl.l.element.innerHTML = html; nl.html = html; }
    }
  }

  function hitPod(id) {
    const o = podObjs.get(id);
    if (!o || o.removing) return;
    tween(220, k => { if (!o.removing) o.g.scale.setScalar(1 + 0.14 * Math.sin(k * Math.PI)); });
  }

  /* ---------- trafik ---------- */
  const reqGeo = new THREE.SphereGeometry(0.32, 16, 12);
  function sendRequest(podId, color, hopMs, onArrive) {
    const m = new THREE.Mesh(reqGeo, new THREE.MeshBasicMaterial({ color: 0x334155 }));
    const a = new THREE.Vector3(EDGE.users[0], 2.2, EDGE.users[1]);
    const s = new THREE.Vector3(EDGE.service[0], 2.2, EDGE.service[1]);
    m.position.copy(a);
    scene.add(m);
    const cleanup = () => { scene.remove(m); m.material.dispose(); };
    tween(hopMs, k => m.position.lerpVectors(a, s, k), () => {
      const o = podId != null ? podObjs.get(podId) : null;
      if (!o) {
        m.material.color.setHex(0xef4444);
        m.material.transparent = true;
        tween(hopMs, k => { m.scale.setScalar(1 + k * 1.5); m.material.opacity = 1 - k; }, () => { cleanup(); onArrive && onArrive(); });
        return;
      }
      m.material.color.set(color);
      const target = o.base.clone().add(new THREE.Vector3(0, 0.6, 0));
      const c = arc(s, target, 3.5);
      tween(hopMs * 1.25, k => m.position.copy(c.getPoint(k)), () => { cleanup(); onArrive && onArrive(); });
    });
  }

  /* ---------- paket ---------- */
  const packet = new THREE.Group();
  const packetMat = M(PACKET_KIND.commit, { emissive: PACKET_KIND.commit, emissiveIntensity: 0.35 });
  const packetMesh = mesh(rbox(1.3, 1.3, 1.3, 0.25), packetMat);
  packet.add(packetMesh);
  const haloMat = new THREE.MeshBasicMaterial({ color: PACKET_KIND.commit, transparent: true, opacity: 0.16, depthWrite: false });
  packet.add(new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 16), haloMat));
  const packetLabel = label('', 'pk-lbl');
  packetLabel.position.set(0, 1.7, 0);
  packet.add(packetLabel);
  packet.visible = false;
  packetLabel.visible = false;
  scene.add(packet);
  let packetAt = null;
  let activeTube = null;

  function setPacketKind(kind) {
    const c = PACKET_KIND[kind] || PACKET_KIND.commit;
    packetMat.color.setHex(c);
    packetMat.emissive.setHex(c);
    haloMat.color.setHex(c);
    packetMesh.scale.setScalar(kind === 'image' ? 1.35 : 1);
    packetLabel.element.classList.toggle('fail', kind === 'fail');
  }
  function placePacket(id, text, kind) {
    packet.position.copy(anchor(id));
    packetAt = id;
    labelPacket(text, kind);
    packet.visible = true;
    packetLabel.visible = true;
    packet.scale.setScalar(0.01);
    tween(350, k => packet.scale.setScalar(Math.max(0.01, easeOutBack(k))));
  }
  function labelPacket(text, kind) {
    packetLabel.element.textContent = text;
    if (kind) setPacketKind(kind);
  }
  function movePacket(to, ms) {
    const key = packetAt + '>' + to;
    const curve = curves[key] || arc(anchor(packetAt), anchor(to), 3);
    const tube = tubes[key];
    if (tube) { tube.material.color.setHex(COLORS.active); activeTube = tube; }
    packetAt = to;
    return tweenP(ms, k => packet.position.copy(curve.getPoint(ease(k)))).then(() => {
      if (tube) tube.material.color.setHex(0x86efac);
      activeTube = null;
    });
  }
  function hidePacket() {
    packetAt = null;
    tween(300, k => packet.scale.setScalar(Math.max(0.01, 1 - k)), () => {
      packet.visible = false;
      packetLabel.visible = false;
    });
  }

  /* ---------- istasyon durumu ---------- */
  function setStation(id, st) {
    if (id === 'cluster') {
      clusterEdge.material.color.setHex(st === 'active' ? 0x93c5fd : st === 'done' ? 0x86efac : st === 'failed' ? 0xfca5a5 : 0xc7d2fe);
      return;
    }
    const s = stations[id];
    s.state = st;
    s.ringMat.color.setHex(st === 'active' ? COLORS.active : st === 'done' ? COLORS.done : st === 'failed' ? COLORS.failed : COLORS.idle);
    s.ring.scale.setScalar(1);
    const el = s.card.element;
    el.classList.remove('active', 'done', 'failed');
    if (st) el.classList.add(st);
  }
  function setStatus(id, text) {
    const el = stations[id].card.element.querySelector('.st-s');
    if (el.textContent !== text) el.textContent = text;
  }

  /* ---------- kamera ---------- */
  function focus(name, ms = 1300) {
    const v = VIEWS[name];
    if (!v) return;
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = new THREE.Vector3(...v.pos), t1 = new THREE.Vector3(...v.tgt);
    tween(ms, k => {
      const e = ease(k);
      camera.position.lerpVectors(p0, p1, e);
      controls.target.lerpVectors(t0, t1, e);
    });
  }

  /* ---------- fare: pod hover / tıklama ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tooltip = document.getElementById('tooltip');
  let downAt = null;
  function pickPod(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(podBodies, false)[0];
    return hit ? hit.object.userData.podId : null;
  }
  renderer.domElement.addEventListener('pointermove', ev => {
    const id = pickPod(ev);
    const p = id != null ? getPod(id) : null;
    renderer.domElement.style.cursor = p && p.status !== 'Terminating' ? 'pointer' : '';
    if (!p) { tooltip.classList.add('hidden'); return; }
    const r = container.getBoundingClientRect();
    tooltip.innerHTML = `<b>${p.name}</b><br>v${p.version} · ${p.status}${p.status === 'Running' ? (p.ready ? ' (1/1)' : ' (0/1)') : ''}<br>${p.node} · ${p.req} istek · ${p.restarts} restart<br><span class="tt-hint">tıkla → kubectl delete pod</span>`;
    tooltip.style.left = (ev.clientX - r.left + 14) + 'px';
    tooltip.style.top = (ev.clientY - r.top + 14) + 'px';
    tooltip.classList.remove('hidden');
  });
  renderer.domElement.addEventListener('pointerleave', () => tooltip.classList.add('hidden'));
  renderer.domElement.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!downAt) return;
    const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
    downAt = null;
    if (moved > 6) return;
    const id = pickPod(ev);
    if (id != null) { onPodClick(id); tooltip.classList.add('hidden'); }
  });

  /* ---------- döngü ---------- */
  new ResizeObserver(() => {
    renderer.setSize(W(), H());
    labelRenderer.setSize(W(), H());
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
  }).observe(container);

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    for (const tw of tweens) {
      const k = Math.min(1, (t - tw.start) / tw.ms);
      tw.step(k);
      if (k >= 1) { tweens.delete(tw); tw.done && tw.done(); }
    }

    for (const s of Object.values(stations)) {
      if (s.state === 'active') s.ring.scale.setScalar(1 + 0.035 * Math.sin(t / 140));
    }
    let jRunning = false;
    for (const l of Object.values(jLights)) {
      if (l.st === 'running') { jRunning = true; l.m.material.emissiveIntensity = 0.35 + 0.35 * Math.sin(t / 90); }
    }
    if (jRunning || stations.jenkins.state === 'active') gear.rotation.y += dt * 2.5;
    layerMeshes.forEach((m, i) => { if (layerStates[i] === 'run') m.material.emissiveIntensity = 0.3 + 0.3 * Math.sin(t / 80); });
    if (activeTube) activeTube.material.opacity = 0.6 + 0.3 * Math.sin(t / 90);

    for (const o of podObjs.values()) {
      if (o.removing) continue;
      const mat = o.body.material;
      mat.opacity += (o.opacity - mat.opacity) * Math.min(1, dt * 6);
      o.g.position.x = o.base.x;
      if (o.st === 'crash') {
        o.g.position.x = o.base.x + Math.sin(t / 25) * 0.07;
        mat.emissiveIntensity = 0.3 + 0.3 * Math.sin(t / 150);
      } else if (o.st === 'creating' || o.st === 'pull' || o.st === 'notready') {
        o.ring.scale.setScalar(1 + 0.08 * Math.sin(t / 110));
      } else if (o.st === 'terminating') {
        const s = o.g.scale.x + (0.6 - o.g.scale.x) * Math.min(1, dt * 5);
        o.g.scale.setScalar(s);
      } else {
        o.ring.scale.setScalar(1);
      }
    }

    if (packet.visible) {
      packetMesh.rotation.y += dt * 1.4;
      packetMesh.rotation.x = Math.sin(t / 700) * 0.25;
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return {
    setStation, setStatus, setDevLines, setCommits, webhookPulse, setJ, setLayers, setImage, setTags,
    placePacket, labelPacket, movePacket, hidePacket, resetTubes,
    syncPods, hitPod, sendRequest, focus,
  };
}
