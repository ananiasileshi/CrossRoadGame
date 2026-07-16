// ============================================================
// Chicken Cross 3D — an advanced Crossy Road clone
// Plain HTML/CSS/JS + Three.js (r99)
// ============================================================

const counterDOM = document.getElementById('counter');
const bestDOM = document.getElementById('best');
const coinsDOM = document.getElementById('coins');
const endDOM = document.getElementById('end');
const startDOM = document.getElementById('start');
const pausedDOM = document.getElementById('paused');
const finalScoreDOM = document.getElementById('final-score');
const finalBestDOM = document.getElementById('final-best');
const newBestDOM = document.getElementById('new-best');
const muteDOM = document.getElementById('mute');

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
const zoom = 2;
const chickenSize = 15;
const positionWidth = 42;
const columns = 17;
const boardWidth = positionWidth * columns;
const stepTime = 190;          // ms per hop
const LOG_TOP = 5 * zoom;      // chicken z while standing on a log
const TRAIN_HALF = 140 * zoom; // half length of the train, for collisions
const MAX_QUEUED_MOVES = 3;

const laneSpeeds = [2, 2.5, 3];
const logSpeeds = [1.2, 1.6, 2];
const vehicleColors = [0xa52523, 0xbdb638, 0x78b14b, 0x2d78c9, 0xd66a2c, 0x7a4dbf];
const treeHeights = [20, 45, 60];

const ROTATION = { forward: 0, left: Math.PI / 2, right: -Math.PI / 2, backward: Math.PI };

const columnToX = c => (c * positionWidth + positionWidth / 2) * zoom - boardWidth * zoom / 2;
const xToColumn = x => Math.round(((x + boardWidth * zoom / 2) / zoom - positionWidth / 2) / positionWidth);
const laneToY = l => l * positionWidth * zoom;
const lerp = (a, b, t) => a + (b - a) * t;

// Lanes get slightly faster the further you go
const difficultyFor = index => Math.min(1 + Math.max(0, index - 8) / 50, 2);

// ------------------------------------------------------------
// Audio — tiny synth, no asset files
// ------------------------------------------------------------
let audioCtx = null;
let muted = localStorage.getItem('cc-muted') === '1';

function ensureAudio() {
  if (muted) return;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(f0, f1, duration, type, volume, delay = 0) {
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noiseBurst(duration, volume, filterFreq) {
  const t0 = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(t0);
}

function playSound(name) {
  if (muted || !audioCtx) return;
  try {
    switch (name) {
      case 'jump': tone(320, 520, 0.09, 'square', 0.05); break;
      case 'coin': tone(880, 880, 0.07, 'square', 0.06); tone(1320, 1320, 0.12, 'square', 0.06, 0.07); break;
      case 'crash': noiseBurst(0.25, 0.2, 900); tone(180, 50, 0.3, 'sawtooth', 0.15); break;
      case 'splash': noiseBurst(0.35, 0.15, 500); tone(260, 80, 0.25, 'sine', 0.08); break;
      case 'warning': tone(660, 660, 0.09, 'square', 0.04); break;
      case 'train': tone(220, 220, 0.5, 'square', 0.05); tone(277, 277, 0.5, 'square', 0.05); break;
      case 'gameover': tone(392, 392, 0.18, 'triangle', 0.08); tone(311, 311, 0.18, 'triangle', 0.08, 0.2); tone(233, 233, 0.32, 'triangle', 0.08, 0.4); break;
    }
  } catch (e) { /* audio is best-effort */ }
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem('cc-muted', muted ? '1' : '0');
  muteDOM.textContent = muted ? '🔇' : '🔊';
  if (!muted) ensureAudio();
}
muteDOM.textContent = muted ? '🔇' : '🔊';

// ------------------------------------------------------------
// Scene, camera, lights, renderer
// ------------------------------------------------------------
const scene = new THREE.Scene();

const distance = 500;
const camera = new THREE.OrthographicCamera(
  window.innerWidth / -2, window.innerWidth / 2,
  window.innerHeight / 2, window.innerHeight / -2,
  0.1, 10000
);
camera.rotation.x = 50 * Math.PI / 180;
camera.rotation.y = 20 * Math.PI / 180;
camera.rotation.z = 10 * Math.PI / 180;

const initialCameraPositionY = -Math.tan(camera.rotation.x) * distance;
const initialCameraPositionX = Math.tan(camera.rotation.y) * Math.sqrt(distance ** 2 + initialCameraPositionY ** 2);
camera.position.y = initialCameraPositionY;
camera.position.x = initialCameraPositionX;
camera.position.z = distance;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
scene.add(hemiLight);

const initialDirLightPositionX = -100;
const initialDirLightPositionY = -100;
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(initialDirLightPositionX, initialDirLightPositionY, 200);
dirLight.castShadow = true;
scene.add(dirLight);

dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
const d = 500;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;

const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
fillLight.position.set(200, 200, 150);
scene.add(fillLight);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.left = window.innerWidth / -2;
  camera.right = window.innerWidth / 2;
  camera.top = window.innerHeight / 2;
  camera.bottom = window.innerHeight / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------
// Model factories
// ------------------------------------------------------------
function Texture(width, height, rects) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(0,0,0,0.6)';
  rects.forEach(rect => context.fillRect(rect.x, rect.y, rect.w, rect.h));
  return new THREE.CanvasTexture(canvas);
}

const carFrontTexture = new Texture(40, 80, [{ x: 0, y: 10, w: 30, h: 60 }]);
const carBackTexture = new Texture(40, 80, [{ x: 10, y: 10, w: 30, h: 60 }]);
const carRightSideTexture = new Texture(110, 40, [{ x: 10, y: 0, w: 50, h: 30 }, { x: 70, y: 0, w: 30, h: 30 }]);
const carLeftSideTexture = new Texture(110, 40, [{ x: 10, y: 10, w: 50, h: 30 }, { x: 70, y: 10, w: 30, h: 30 }]);
const truckFrontTexture = new Texture(30, 30, [{ x: 15, y: 0, w: 10, h: 30 }]);
const truckRightSideTexture = new Texture(25, 30, [{ x: 0, y: 15, w: 10, h: 10 }]);
const truckLeftSideTexture = new Texture(25, 30, [{ x: 0, y: 5, w: 10, h: 10 }]);

function box(w, h, dpt, material) {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(w * zoom, h * zoom, dpt * zoom), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
const lambert = opts => new THREE.MeshLambertMaterial(Object.assign({ flatShading: true }, opts));
const phong = opts => new THREE.MeshPhongMaterial(Object.assign({ flatShading: true }, opts));

function Wheel() {
  const wheel = box(12, 33, 12, lambert({ color: 0x333333 }));
  wheel.position.z = 6 * zoom;
  return wheel;
}

function Car() {
  const car = new THREE.Group();
  const color = vehicleColors[Math.floor(Math.random() * vehicleColors.length)];

  const main = box(60, 30, 15, phong({ color }));
  main.position.z = 12 * zoom;
  car.add(main);

  const cabin = new THREE.Mesh(
    new THREE.BoxBufferGeometry(33 * zoom, 24 * zoom, 12 * zoom),
    [
      phong({ color: 0xcccccc, map: carBackTexture }),
      phong({ color: 0xcccccc, map: carFrontTexture }),
      phong({ color: 0xcccccc, map: carRightSideTexture }),
      phong({ color: 0xcccccc, map: carLeftSideTexture }),
      phong({ color: 0xcccccc }),
      phong({ color: 0xcccccc })
    ]
  );
  cabin.position.x = 6 * zoom;
  cabin.position.z = 25.5 * zoom;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  car.add(cabin);

  const frontWheel = new Wheel();
  frontWheel.position.x = -18 * zoom;
  car.add(frontWheel);

  const backWheel = new Wheel();
  backWheel.position.x = 18 * zoom;
  car.add(backWheel);

  return car;
}

function Truck() {
  const truck = new THREE.Group();
  const color = vehicleColors[Math.floor(Math.random() * vehicleColors.length)];

  const base = box(100, 25, 5, lambert({ color: 0xb4c6fc }));
  base.position.z = 10 * zoom;
  truck.add(base);

  const cargo = box(75, 35, 40, phong({ color: 0xb4c6fc }));
  cargo.position.x = 15 * zoom;
  cargo.position.z = 30 * zoom;
  truck.add(cargo);

  const cabin = new THREE.Mesh(
    new THREE.BoxBufferGeometry(25 * zoom, 30 * zoom, 30 * zoom),
    [
      phong({ color }),
      phong({ color, map: truckFrontTexture }),
      phong({ color, map: truckRightSideTexture }),
      phong({ color, map: truckLeftSideTexture }),
      phong({ color }),
      phong({ color })
    ]
  );
  cabin.position.x = -40 * zoom;
  cabin.position.z = 20 * zoom;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  truck.add(cabin);

  [-38, -10, 30].forEach(x => {
    const wheel = new Wheel();
    wheel.position.x = x * zoom;
    truck.add(wheel);
  });

  return truck;
}

function Train() {
  const train = new THREE.Group();
  const bodies = [
    { x: -105, color: 0x8f2f2f, h: 36 }, // engine
    { x: -35, color: 0x5a5a66, h: 30 },
    { x: 35, color: 0x8a6f3c, h: 30 },
    { x: 105, color: 0x5a5a66, h: 30 }
  ];
  bodies.forEach(part => {
    const wagon = box(62, 28, part.h, phong({ color: part.color }));
    wagon.position.x = part.x * zoom;
    wagon.position.z = (part.h / 2 + 6) * zoom;
    train.add(wagon);
    const chassis = box(66, 20, 6, lambert({ color: 0x2b2b2b }));
    chassis.position.x = part.x * zoom;
    chassis.position.z = 3 * zoom;
    train.add(chassis);
  });
  train.visible = false;
  return train;
}

function RailSignal() {
  const signal = new THREE.Group();
  const pole = box(3, 3, 32, lambert({ color: 0x555555 }));
  pole.position.z = 16 * zoom;
  signal.add(pole);
  const head = box(14, 4, 8, lambert({ color: 0x333333 }));
  head.position.z = 30 * zoom;
  signal.add(head);
  const lightMats = [
    new THREE.MeshLambertMaterial({ color: 0x330000 }),
    new THREE.MeshLambertMaterial({ color: 0x330000 })
  ];
  [-4, 4].forEach((x, i) => {
    const light = new THREE.Mesh(new THREE.BoxBufferGeometry(4 * zoom, 3 * zoom, 4 * zoom), lightMats[i]);
    light.position.x = x * zoom;
    light.position.z = 30 * zoom;
    signal.add(light);
  });
  signal.lightMats = lightMats;
  return signal;
}

function Tree() {
  const tree = new THREE.Group();

  const trunk = box(15, 15, 20, phong({ color: 0x4d2926 }));
  trunk.position.z = 10 * zoom;
  tree.add(trunk);

  const height = treeHeights[Math.floor(Math.random() * treeHeights.length)];
  const crown = box(30, 30, height, lambert({ color: 0x7aa21d }));
  crown.position.z = (height / 2 + 20) * zoom;
  crown.receiveShadow = false;
  tree.add(crown);

  return tree;
}

function Log(lengthUnits) {
  const log = box(lengthUnits, 26, 8, phong({ color: 0x8a5a32 }));
  log.position.z = 1 * zoom;
  log.userData.len = lengthUnits * zoom;
  return log;
}

function Coin() {
  const coin = new THREE.Mesh(
    new THREE.CylinderBufferGeometry(7 * zoom, 7 * zoom, 2.5 * zoom, 16),
    phong({ color: 0xffd34d })
  );
  coin.castShadow = true;
  coin.position.z = 12 * zoom;
  return coin;
}

function Chicken() {
  const chicken = new THREE.Group(); // built facing +y (forward)

  [-4, 4].forEach(x => {
    const foot = box(3, 4, 6, lambert({ color: 0xe08e28 }));
    foot.position.set(x * zoom, 0, 3 * zoom);
    chicken.add(foot);
  });

  const body = box(15, 17, 15, phong({ color: 0xffffff }));
  body.position.z = 13 * zoom;
  chicken.add(body);

  [-8.5, 8.5].forEach(x => {
    const wing = box(3, 10, 8, phong({ color: 0xf0f0f0 }));
    wing.position.set(x * zoom, -1 * zoom, 13 * zoom);
    chicken.add(wing);
  });

  const tail = box(6, 4, 7, phong({ color: 0xf0f0f0 }));
  tail.position.set(0, -10 * zoom, 16 * zoom);
  chicken.add(tail);

  const head = box(11, 11, 11, phong({ color: 0xffffff }));
  head.position.set(0, 5 * zoom, 25 * zoom);
  chicken.add(head);

  const comb = box(4, 6, 5, lambert({ color: 0xd93b3b }));
  comb.position.set(0, 3 * zoom, 32 * zoom);
  chicken.add(comb);

  const beak = box(6, 4, 4, lambert({ color: 0xe08e28 }));
  beak.position.set(0, 12 * zoom, 25 * zoom);
  chicken.add(beak);

  const wattle = box(4, 3, 4, lambert({ color: 0xd93b3b }));
  wattle.position.set(0, 11 * zoom, 21 * zoom);
  chicken.add(wattle);

  [-5.7, 5.7].forEach(x => {
    const eye = box(1.5, 2.5, 2.5, lambert({ color: 0x222222 }));
    eye.position.set(x * zoom, 8 * zoom, 27 * zoom);
    chicken.add(eye);
  });

  return chicken;
}

// Three ground sections side by side so the board fills wide screens
function groundSections(midColor, sideColor, useBox, boxHeight) {
  const group = new THREE.Group();
  const createSection = color => {
    const geometry = useBox
      ? new THREE.BoxBufferGeometry(boardWidth * zoom, positionWidth * zoom, boxHeight * zoom)
      : new THREE.PlaneBufferGeometry(boardWidth * zoom, positionWidth * zoom);
    return new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color }));
  };
  const middle = createSection(midColor);
  middle.receiveShadow = true;
  group.add(middle);
  const left = createSection(sideColor);
  left.position.x = -boardWidth * zoom;
  group.add(left);
  const right = createSection(sideColor);
  right.position.x = boardWidth * zoom;
  group.add(right);
  return group;
}

function Grass() {
  const grass = groundSections(0xbaf455, 0x99c846, true, 3);
  grass.position.z = 1.5 * zoom;
  return grass;
}

function Road() {
  return groundSections(0x454a59, 0x393d49, false);
}

function Water() {
  return groundSections(0x3f9fd0, 0x358ebc, false);
}

function RailBed() {
  const rail = groundSections(0x6e6a63, 0x5c584f, false);
  for (let i = 0; i < columns; i += 2) {
    const sleeper = box(8, 26, 1, lambert({ color: 0x53422f }));
    sleeper.receiveShadow = true;
    sleeper.position.set(columnToX(i), 0, 0.5 * zoom);
    rail.add(sleeper);
  }
  [-8, 8].forEach(y => {
    const track = new THREE.Mesh(
      new THREE.BoxBufferGeometry(boardWidth * zoom * 3, 2 * zoom, 1.5 * zoom),
      lambert({ color: 0x999999 })
    );
    track.position.set(0, y * zoom, 1.2 * zoom);
    rail.add(track);
  });
  return rail;
}

// ------------------------------------------------------------
// Lanes
// ------------------------------------------------------------
function pickLaneType(index, prev, prev2) {
  if (index <= 0) return 'grass';
  if (index <= 2) return Math.random() < 0.6 ? 'grass' : 'forest'; // safe start zone
  const pool = [];
  const add = (type, weight) => { for (let i = 0; i < weight; i++) pool.push(type); };
  add('car', 30);
  add('truck', 15);
  add('forest', 20);
  add('grass', 10);
  if (index >= 5) {
    if (!(prev === 'river' && prev2 === 'river')) add('river', 16);
    if (prev !== 'rail') add('rail', 10);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function maybeSpawnCoin(lane, chance) {
  if (lane.index <= 0 || Math.random() > chance) return;
  let column = 2 + Math.floor(Math.random() * (columns - 4));
  if (lane.occupiedPositions && lane.occupiedPositions.has(column)) return;
  const mesh = new Coin();
  mesh.position.x = columnToX(column);
  lane.mesh.add(mesh);
  lane.coin = { column, mesh, collected: false };
}

function Lane(index, prev, prev2) {
  this.index = index;
  this.type = pickLaneType(index, prev, prev2);
  this.removed = false;
  const speedScale = difficultyFor(index);

  switch (this.type) {
    case 'grass': {
      this.mesh = new Grass();
      maybeSpawnCoin(this, 0.3);
      break;
    }
    case 'forest': {
      this.mesh = new Grass();
      this.occupiedPositions = new Set();
      this.trees = [1, 2, 3, 4].map(() => {
        const tree = new Tree();
        let position;
        do {
          position = Math.floor(Math.random() * columns);
        } while (this.occupiedPositions.has(position));
        this.occupiedPositions.add(position);
        tree.position.x = columnToX(position);
        this.mesh.add(tree);
        return tree;
      });
      maybeSpawnCoin(this, 0.25);
      break;
    }
    case 'car': {
      this.mesh = new Road();
      this.direction = Math.random() >= 0.5;
      const occupiedPositions = new Set();
      this.vehicles = [1, 2, 3].map(() => {
        const vehicle = new Car();
        let position;
        do {
          position = Math.floor(Math.random() * columns / 2);
        } while (occupiedPositions.has(position));
        occupiedPositions.add(position);
        vehicle.position.x = (position * positionWidth * 2 + positionWidth / 2) * zoom - boardWidth * zoom / 2;
        if (!this.direction) vehicle.rotation.z = Math.PI;
        this.mesh.add(vehicle);
        return vehicle;
      });
      this.speed = laneSpeeds[Math.floor(Math.random() * laneSpeeds.length)] * speedScale;
      break;
    }
    case 'truck': {
      this.mesh = new Road();
      this.direction = Math.random() >= 0.5;
      const occupiedPositions = new Set();
      this.vehicles = [1, 2].map(() => {
        const vehicle = new Truck();
        let position;
        do {
          position = Math.floor(Math.random() * columns / 3);
        } while (occupiedPositions.has(position));
        occupiedPositions.add(position);
        vehicle.position.x = (position * positionWidth * 3 + positionWidth / 2) * zoom - boardWidth * zoom / 2;
        if (!this.direction) vehicle.rotation.z = Math.PI;
        this.mesh.add(vehicle);
        return vehicle;
      });
      this.speed = laneSpeeds[Math.floor(Math.random() * laneSpeeds.length)] * speedScale;
      break;
    }
    case 'river': {
      this.mesh = new Water();
      this.direction = Math.random() >= 0.5;
      const occupiedPositions = new Set();
      this.logs = [1, 2, 3].map(() => {
        const lengths = [2, 2.5, 3];
        const log = new Log(lengths[Math.floor(Math.random() * lengths.length)] * positionWidth);
        let position;
        do {
          position = Math.floor(Math.random() * columns / 3);
        } while (occupiedPositions.has(position));
        occupiedPositions.add(position);
        log.position.x = (position * positionWidth * 3 + positionWidth / 2) * zoom - boardWidth * zoom / 2;
        this.mesh.add(log);
        return log;
      });
      this.speed = logSpeeds[Math.floor(Math.random() * logSpeeds.length)] * speedScale;
      break;
    }
    case 'rail': {
      this.mesh = new RailBed();
      this.signal = new RailSignal();
      this.signal.position.set(columnToX(2), -14 * zoom, 0);
      this.mesh.add(this.signal);
      this.train = new Train();
      this.mesh.add(this.train);
      this.phase = null; // initialised lazily on first update
      break;
    }
  }
}

// ------------------------------------------------------------
// Game state
// ------------------------------------------------------------
let lanes = [];
let decorLanes = [];
let gameState = 'ready'; // ready | playing | dying | paused | gameover
let gameTime = 0;
let previousTimestamp = null;

let currentLane = 0;
let currentColumn = Math.floor(columns / 2);
let maxLane = 0;
let score = 0;
let coinsCollected = 0;
let best = parseInt(localStorage.getItem('cc-best'), 10) || 0;

let moves = [];
let stepping = null;
let deathType = null;
let deathStart = 0;

const chicken = new Chicken();
scene.add(chicken);
dirLight.target = chicken;

function disposeObject(root) {
  root.traverse(node => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(m => m.dispose()); // shared canvas textures are kept alive on purpose
    }
  });
}

function removeLaneMesh(lane) {
  scene.remove(lane.mesh);
  disposeObject(lane.mesh);
  lane.removed = true;
}

function addLane() {
  const index = lanes.length;
  const prev = lanes[index - 1] ? lanes[index - 1].type : null;
  const prev2 = lanes[index - 2] ? lanes[index - 2].type : null;
  const lane = new Lane(index, prev, prev2);
  lane.mesh.position.y = laneToY(index);
  scene.add(lane.mesh);
  lanes.push(lane);
}

function ensureLanes(upTo) {
  while (lanes.length <= upTo) addLane();
}

function cleanupLanes() {
  lanes.forEach(lane => {
    if (!lane.removed && lane.index < currentLane - 12) removeLaneMesh(lane);
  });
  if (currentLane > 12 && decorLanes.length) {
    decorLanes.forEach(mesh => { scene.remove(mesh); disposeObject(mesh); });
    decorLanes = [];
  }
}

function resetGame() {
  lanes.forEach(lane => { if (!lane.removed) removeLaneMesh(lane); });
  decorLanes.forEach(mesh => { scene.remove(mesh); disposeObject(mesh); });
  lanes = [];
  decorLanes = [];

  for (let i = -9; i < 0; i++) {
    const grass = new Grass();
    grass.position.y = laneToY(i);
    scene.add(grass);
    decorLanes.push(grass);
  }
  ensureLanes(15);

  currentLane = 0;
  currentColumn = Math.floor(columns / 2);
  maxLane = 0;
  score = 0;
  coinsCollected = 0;
  moves = [];
  stepping = null;
  deathType = null;

  chicken.position.set(0, 0, 0);
  chicken.rotation.set(0, 0, 0);
  chicken.scale.set(1, 1, 1);

  updateHUD();
}

function updateHUD() {
  counterDOM.textContent = score;
  bestDOM.textContent = best;
  coinsDOM.textContent = coinsCollected;
}

function startGame() {
  if (gameState !== 'ready') return;
  gameState = 'playing';
  startDOM.classList.add('hidden');
}

function retryGame() {
  resetGame();
  endDOM.classList.add('hidden');
  gameState = 'playing';
}

function togglePause() {
  if (gameState === 'playing') {
    gameState = 'paused';
    pausedDOM.classList.remove('hidden');
  } else if (gameState === 'paused') {
    gameState = 'playing';
    pausedDOM.classList.add('hidden');
  }
}

function startDeath(type) {
  if (gameState !== 'playing') return;
  gameState = 'dying';
  deathType = type;
  deathStart = gameTime;
  stepping = null;
  moves = [];
  playSound(type === 'sink' ? 'splash' : 'crash');
}

function endGame() {
  gameState = 'gameover';
  const isNewBest = score > best;
  if (isNewBest) {
    best = score;
    localStorage.setItem('cc-best', best);
  }
  finalScoreDOM.textContent = 'Score ' + score;
  finalBestDOM.textContent = 'Best ' + best;
  newBestDOM.classList.toggle('hidden', !isNewBest);
  endDOM.classList.remove('hidden');
  playSound('gameover');
  updateHUD();
}

// ------------------------------------------------------------
// Movement
// ------------------------------------------------------------
function applyMove(position, direction) {
  if (direction === 'forward') return { lane: position.lane + 1, column: position.column };
  if (direction === 'backward') return { lane: position.lane - 1, column: position.column };
  if (direction === 'left') return { lane: position.lane, column: position.column - 1 };
  return { lane: position.lane, column: position.column + 1 };
}

function isBlocked(position) {
  if (position.lane < 0 || position.column < 0 || position.column > columns - 1) return true;
  ensureLanes(position.lane + 12);
  const lane = lanes[position.lane];
  return lane.type === 'forest' && lane.occupiedPositions.has(position.column);
}

function move(direction) {
  if (gameState === 'ready') startGame();
  if (gameState !== 'playing') return;
  if (moves.length >= MAX_QUEUED_MOVES) return;

  let position = stepping
    ? { lane: stepping.targetLane, column: stepping.targetColumn }
    : { lane: currentLane, column: xToColumn(chicken.position.x) };
  for (const queued of moves) position = applyMove(position, queued);
  position = applyMove(position, direction);
  if (isBlocked(position)) return;

  moves.push(direction);
}

function beginStep() {
  const direction = moves.shift();
  const position = applyMove(
    { lane: currentLane, column: xToColumn(chicken.position.x) },
    direction
  );
  if (isBlocked(position)) return; // world may have shifted since the move was queued

  stepping = {
    startTime: gameTime,
    startX: chicken.position.x,
    startY: chicken.position.y,
    startZ: chicken.position.z,
    targetX: columnToX(position.column),
    targetY: laneToY(position.lane),
    targetZ: lanes[position.lane].type === 'river' ? LOG_TOP : 0,
    targetLane: position.lane,
    targetColumn: position.column,
    direction
  };
  chicken.rotation.z = ROTATION[direction];
  playSound('jump');
}

function updateStep() {
  const t = Math.min((gameTime - stepping.startTime) / stepTime, 1);
  chicken.position.x = lerp(stepping.startX, stepping.targetX, t);
  chicken.position.y = lerp(stepping.startY, stepping.targetY, t);
  chicken.position.z = lerp(stepping.startZ, stepping.targetZ, t) + Math.sin(t * Math.PI) * 8 * zoom;
  if (t >= 1) endStep();
}

function endStep() {
  currentLane = stepping.targetLane;
  currentColumn = stepping.targetColumn;
  chicken.position.set(stepping.targetX, stepping.targetY, stepping.targetZ);
  const direction = stepping.direction;
  stepping = null;

  if (direction === 'forward' && currentLane > maxLane) {
    maxLane = currentLane;
    score += 1;
    updateHUD();
    ensureLanes(currentLane + 15);
    cleanupLanes();
  }

  const lane = lanes[currentLane];
  collectCoin(lane);
  if (lane.type === 'river' && !findLog(lane, chicken.position.x)) startDeath('sink');
}

function findLog(lane, x) {
  return lane.logs.find(log =>
    x > log.position.x - log.userData.len / 2 - 6 * zoom &&
    x < log.position.x + log.userData.len / 2 + 6 * zoom
  );
}

function collectCoin(lane) {
  if (!lane.coin || lane.coin.collected) return;
  if (lane.coin.column !== xToColumn(chicken.position.x)) return;
  lane.coin.collected = true;
  lane.mesh.remove(lane.coin.mesh);
  disposeObject(lane.coin.mesh);
  score += 5;
  coinsCollected += 1;
  playSound('coin');
  updateHUD();
}

// ------------------------------------------------------------
// Per-frame updates
// ------------------------------------------------------------
const laneEdgeMin = -boardWidth * zoom / 2 - positionWidth * 2 * zoom;
const laneEdgeMax = boardWidth * zoom / 2 + positionWidth * 2 * zoom;

function moveWrapping(objects, lane, delta) {
  const step = lane.speed / 16 * delta;
  objects.forEach(obj => {
    if (lane.direction) {
      obj.position.x = obj.position.x < laneEdgeMin ? laneEdgeMax : obj.position.x - step;
    } else {
      obj.position.x = obj.position.x > laneEdgeMax ? laneEdgeMin : obj.position.x + step;
    }
  });
}

function setSignal(lane, blinking) {
  const mats = lane.signal.lightMats;
  if (!blinking) {
    mats[0].color.setHex(0x330000);
    mats[1].color.setHex(0x330000);
    return;
  }
  const phase = Math.floor(gameTime / 200) % 2;
  mats[0].color.setHex(phase === 0 ? 0xff2222 : 0x330000);
  mats[1].color.setHex(phase === 1 ? 0xff2222 : 0x330000);
}

function updateRail(lane, delta) {
  const nearPlayer = Math.abs(lane.index - currentLane) < 9;
  if (lane.phase === null) {
    lane.phase = 'idle';
    lane.phaseUntil = gameTime + 2000 + Math.random() * 6000;
    lane.lastTick = 0;
  }
  if (lane.phase === 'idle') {
    setSignal(lane, false);
    if (gameTime > lane.phaseUntil) {
      lane.phase = 'warning';
      lane.phaseUntil = gameTime + 1000;
    }
  } else if (lane.phase === 'warning') {
    setSignal(lane, true);
    if (nearPlayer && gameState === 'playing' && gameTime - lane.lastTick > 350) {
      lane.lastTick = gameTime;
      playSound('warning');
    }
    if (gameTime > lane.phaseUntil) {
      lane.phase = 'crossing';
      lane.trainDir = Math.random() >= 0.5 ? 1 : -1;
      lane.train.visible = true;
      lane.train.rotation.z = lane.trainDir === 1 ? 0 : Math.PI;
      lane.train.position.x = -lane.trainDir * (boardWidth * zoom / 2 + TRAIN_HALF + 60);
      if (nearPlayer) playSound('train');
    }
  } else if (lane.phase === 'crossing') {
    setSignal(lane, true);
    lane.train.position.x += lane.trainDir * 2.2 * delta;
    if (Math.abs(lane.train.position.x) > boardWidth * zoom / 2 + TRAIN_HALF + 80) {
      lane.train.visible = false;
      lane.phase = 'idle';
      lane.phaseUntil = gameTime + (3000 + Math.random() * 7000) / difficultyFor(lane.index);
    }
  }
}

function updateLane(lane, delta) {
  if (lane.type === 'car' || lane.type === 'truck') moveWrapping(lane.vehicles, lane, delta);
  else if (lane.type === 'river') moveWrapping(lane.logs, lane, delta);
  else if (lane.type === 'rail') updateRail(lane, delta);
  if (lane.coin && !lane.coin.collected) {
    lane.coin.mesh.rotation.z += 0.004 * delta;
    lane.coin.mesh.position.z = (12 + Math.sin(gameTime * 0.005) * 1.5) * zoom;
  }
}

function hitTest() {
  const laneIndex = Math.round(chicken.position.y / (positionWidth * zoom));
  const lane = lanes[laneIndex];
  if (!lane || lane.removed) return;

  const chickenMinX = chicken.position.x - chickenSize * zoom / 2;
  const chickenMaxX = chicken.position.x + chickenSize * zoom / 2;

  if (lane.type === 'car' || lane.type === 'truck') {
    const vehicleLength = { car: 60, truck: 105 }[lane.type];
    for (const vehicle of lane.vehicles) {
      const minX = vehicle.position.x - vehicleLength * zoom / 2;
      const maxX = vehicle.position.x + vehicleLength * zoom / 2;
      if (chickenMaxX > minX && chickenMinX < maxX) {
        startDeath('squash');
        return;
      }
    }
  } else if (lane.type === 'rail' && lane.phase === 'crossing') {
    const minX = lane.train.position.x - TRAIN_HALF;
    const maxX = lane.train.position.x + TRAIN_HALF;
    if (chickenMaxX > minX && chickenMinX < maxX) startDeath('squash');
  }
}

function updateStanding(delta) {
  const lane = lanes[currentLane];
  if (lane.type === 'river') {
    const log = findLog(lane, chicken.position.x);
    if (!log) {
      startDeath('sink');
      return;
    }
    chicken.position.x += (lane.direction ? -1 : 1) * lane.speed / 16 * delta;
    chicken.position.z = LOG_TOP + Math.sin(gameTime * 0.008) * 0.8;
    if (Math.abs(chicken.position.x) > boardWidth * zoom / 2) startDeath('sink');
  } else {
    chicken.position.z = Math.abs(Math.sin(gameTime * 0.004)) * 1.5;
    collectCoin(lane);
  }
}

function updateDeath(delta) {
  const t = (gameTime - deathStart) / 700;
  if (deathType === 'squash') {
    chicken.scale.z = Math.max(1 - t * 2, 0.12);
    chicken.scale.x = chicken.scale.y = 1 + Math.min(t, 0.4);
    chicken.position.z = Math.max(0, chicken.position.z - 0.3 * delta);
  } else {
    chicken.position.z -= 0.08 * delta;
    chicken.rotation.z += 0.004 * delta;
  }
  if (t >= 1) endGame();
}

function animate(timestamp) {
  requestAnimationFrame(animate);

  if (previousTimestamp === null) previousTimestamp = timestamp;
  const delta = Math.min(timestamp - previousTimestamp, 50);
  previousTimestamp = timestamp;

  if (gameState === 'paused') {
    renderer.render(scene, camera);
    return;
  }
  gameTime += delta;

  const from = Math.max(0, currentLane - 10);
  const to = Math.min(lanes.length - 1, currentLane + 14);
  for (let i = from; i <= to; i++) {
    if (!lanes[i].removed) updateLane(lanes[i], delta);
  }

  if (gameState === 'playing') {
    if (!stepping && moves.length) beginStep();
    if (stepping) updateStep();
    else updateStanding(delta);
    if (gameState === 'playing') hitTest();
  } else if (gameState === 'dying') {
    updateDeath(delta);
  } else if (gameState === 'ready') {
    chicken.position.z = Math.abs(Math.sin(gameTime * 0.004)) * 2;
  }

  camera.position.y = initialCameraPositionY + chicken.position.y;
  camera.position.x = initialCameraPositionX + chicken.position.x;
  dirLight.position.x = initialDirLightPositionX + chicken.position.x;
  dirLight.position.y = initialDirLightPositionY + chicken.position.y;

  renderer.render(scene, camera);
}

// ------------------------------------------------------------
// Input
// ------------------------------------------------------------
function handleAction(direction) {
  ensureAudio();
  if (gameState === 'gameover' || gameState === 'paused') return;
  move(direction);
}

document.getElementById('forward').addEventListener('click', () => handleAction('forward'));
document.getElementById('backward').addEventListener('click', () => handleAction('backward'));
document.getElementById('left').addEventListener('click', () => handleAction('left'));
document.getElementById('right').addEventListener('click', () => handleAction('right'));
document.getElementById('retry').addEventListener('click', () => { ensureAudio(); retryGame(); });
document.getElementById('play').addEventListener('click', () => { ensureAudio(); startGame(); });
muteDOM.addEventListener('click', toggleMute);

window.addEventListener('keydown', event => {
  if (event.repeat) return;
  const key = event.key;
  if (key === 'ArrowUp' || key === 'w' || key === 'W' || key === ' ') {
    event.preventDefault();
    if (gameState === 'gameover') retryGame();
    else handleAction('forward');
  } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
    event.preventDefault();
    handleAction('backward');
  } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
    event.preventDefault();
    handleAction('left');
  } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
    event.preventDefault();
    handleAction('right');
  } else if (key === 'p' || key === 'P' || key === 'Escape') {
    togglePause();
  } else if (key === 'm' || key === 'M') {
    toggleMute();
  } else if (key === 'Enter') {
    if (gameState === 'gameover') retryGame();
    else if (gameState === 'ready') { ensureAudio(); startGame(); }
  }
});

let touchStart = null;
document.addEventListener('touchstart', event => {
  ensureAudio();
  touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });

document.addEventListener('touchend', event => {
  if (!touchStart) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (event.target.closest('button')) return;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    handleAction('forward'); // tap = hop forward
  } else if (Math.abs(dx) > Math.abs(dy)) {
    handleAction(dx > 0 ? 'right' : 'left');
  } else {
    handleAction(dy < 0 ? 'forward' : 'backward');
  }
}, { passive: true });

window.addEventListener('blur', () => {
  if (gameState === 'playing') togglePause();
});

// ------------------------------------------------------------
// Go
// ------------------------------------------------------------
resetGame();
requestAnimationFrame(animate);
