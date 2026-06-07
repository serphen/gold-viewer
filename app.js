import * as THREE from 'three';

const LEVELS = [
  'YXJjaGl2ZXM=', 'YXp0ZWM=', 'YnVua2VyMQ==', 'YnVua2VyMg==', 'Y2F2ZXJucw==',
  'Y29udHJvbA==', 'Y3JhZGxl', 'ZGFt', 'ZGVwbw==', 'ZWd5cHQ=', 'ZmFjaWxpdHk=',
  'ZnJpZ2F0ZQ==', 'anVuZ2xl', 'cnVud2F5', 'c2lsbw==', 'c3RhdHVl',
  'c3RyZWV0cw==', 'c3VyZmFjZTE=', 'c3VyZmFjZTI=', 'dHJhaW4='
].map((level) => atob(level));
const LEVEL_PACKS = new Map(LEVELS.map((level, index) => [level, `${index + 1}.gz`]));

const canvas = document.getElementById('scene');
const levelSelect = document.getElementById('levelSelect');
const startView = document.getElementById('startView');
const resetView = document.getElementById('resetView');
const topView = document.getElementById('topView');
const colorMode = document.getElementById('colorMode');
const labelMode = document.getElementById('labelMode');
const bgMode = document.getElementById('bgMode');
const roomFilter = document.getElementById('roomFilter');
const tileSearch = document.getElementById('tileSearch');
const coordSearch = document.getElementById('coordSearch');
const goTile = document.getElementById('goTile');
const goCoord = document.getElementById('goCoord');
const edgeToggle = document.getElementById('edgeToggle');
const boundaryToggle = document.getElementById('boundaryToggle');
const visualBgToggle = document.getElementById('visualBgToggle');
const barsToggle = document.getElementById('barsToggle');
const guardsToggle = document.getElementById('guardsToggle');
const doubleSideToggle = document.getElementById('doubleSideToggle');
const markerToggle = document.getElementById('markerToggle');
const stats = document.getElementById('stats');
const selectedTile = document.getElementById('selectedTile');
const cameraReadout = document.getElementById('cameraReadout');

for (const level of LEVELS) {
  const option = document.createElement('option');
  option.value = level;
  option.textContent = level;
  if (level === 'dam') option.selected = true;
  levelSelect.appendChild(option);
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.15));
renderer.setClearColor(0x07090b);

const scene = new THREE.Scene();
scene.fog = null;

const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 12000);
camera.rotation.order = 'YXZ';

const world = new THREE.Group();
scene.add(world);

const marker = makeMarker();
scene.add(marker);

const grid = new THREE.GridHelper(5000, 100, 0x000000, 0x000000);
grid.material.transparent = true;
grid.material.opacity = 0.24;
scene.add(grid);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const clock = new THREE.Clock();
const cameraInput = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraTargetVelocity = new THREE.Vector3();
const keys = new Set();
const keyDownAt = new Map();
const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
const LABEL_CULL_INTERVAL = 0.18;
const PROP_LABEL_DISTANCE = 5200;
const STAN_LABEL_SURFACE_OFFSET = 0.25;
const PROP_LABEL_SURFACE_OFFSET = 0.35;
const STAN_LABEL_PADDING = 0.16;
const PROP_LABEL_PADDING = 0.18;
const PROP_VISUAL_MIN_THICKNESS = 0.2;
const BAR_OPACITY = 0.82;
const PROP_OPACITY = 0.86;
const GUARD_OPACITY = 0.94;
const GUARD_RAW_LINE_THRESHOLD = 2;
const WHEEL_DOLLY_BASE = 0.42;
const WHEEL_DOLLY_MAX = 1800;
const CAMERA_STOP_SPEED = 0.35;
const CAMERA_MOVE_EPS_SQ = 0.0004;
const GAP_MIN_DISTANCE = 4;
const GAP_MAX_DISTANCE = 76;
const GAP_Y_TOLERANCE = 120;
const GAP_MARKER_LIMIT = 450;
const GAP_COLUMN_HEIGHT = 520;
const TILE_GAP_MIN_DISTANCE = 3;
const TILE_GAP_MAX_DISTANCE = 70;
const TILE_GAP_Y_TOLERANCE = 36;
const TILE_GAP_MIN_OVERLAP = 8;
const TILE_GAP_PARALLEL_DOT = 0.965;
const TILE_GAP_MARKER_LIMIT = 650;
const TILE_GAP_COLUMN_HEIGHT = 1400;
const ROOM_SEAM_OVERLAY_OFFSET = 2.4;
const STAN_LABEL_ATLAS_CELL_W = 96;
const STAN_LABEL_ATLAS_CELL_H = 48;
const STAN_LABEL_ATLAS_COLS = 42;
const PROPFLAG_RENDERPOSTBG = 0x00000001;
const PROPFLAG_IN_AIR = 0x00000008;

let levelData = null;
let tileMeshes = [];
let edgeLine = null;
let boundaryLine = null;
let seamLine = null;
let visualBgMeshes = [];
let barMeshes = [];
let propMeshes = [];
let guardMeshes = [];
let gapMarkers = [];
let roomSeamMeshes = [];
let labels = [];
let stanLabelBatch = null;
let pickTargets = [];
let selected = null;
let levelBounds = null;
let yaw = 0;
let pitch = -0.6;
let flySpeed = 180;
let cameraVelocity = new THREE.Vector3();
let loadSerial = 0;
let labelCullElapsed = 0;
let lineRoomKey = null;
let dragging = false;
let dragMoved = false;
let renderDirty = true;
let wasMoving = false;

const BACKGROUNDS = {
  grid: { clear: 0x20262d, edge: 0x05070a, grid: 0x9aa7b4, gridOpacity: 0.2 },
  dark: { clear: 0x05070a, edge: 0xd9e4ee, grid: 0x607080, gridOpacity: 0.26 },
  light: { clear: 0xd7dde3, edge: 0x05070a, grid: 0x5d6872, gridOpacity: 0.28 },
  magenta: { clear: 0x6f1d5e, edge: 0xffffff, grid: 0xffffff, gridOpacity: 0.22 }
};

const PACK_MAGIC = 'GEPACK1\n';

async function inflateGzipResponse(response) {
  if (!('DecompressionStream' in window)) {
    throw new Error('gzip data requires browser DecompressionStream support');
  }
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function fetchArrayBuffer(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) return null;
  if (path.endsWith('.gz')) return inflateGzipResponse(response);
  return response.arrayBuffer();
}

async function loadLevelPack(level) {
  const packName = LEVEL_PACKS.get(level);
  if (!packName) throw new Error(`unknown level ${level}`);
  const buffer = await fetchArrayBuffer(`./packs/${packName}`);
  if (!buffer) return null;
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, PACK_MAGIC.length));
  if (magic !== PACK_MAGIC) throw new Error(`bad pack magic for ${level}`);
  const jsonLength = view.getUint32(PACK_MAGIC.length, true);
  const jsonStart = PACK_MAGIC.length + 4;
  const jsonEnd = jsonStart + jsonLength;
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, jsonStart, jsonLength)));
  const vertexBytes = buffer.slice(jsonEnd);
  return {
    level: manifest.level,
    levelData: manifest.level_data,
    bars: manifest.bars,
    visual: manifest.visual,
    visualVertices: vertexBytes.byteLength ? new Float32Array(vertexBytes) : null
  };
}

function getWorldScale(data) {
  return data.inv_level_scale || (1 / data.level_scale);
}

function rawToWorld(point, scale) {
  return new THREE.Vector3(point[0] * scale, point[1] * scale, point[2] * scale);
}

function colorForTile(tile) {
  const hue = ((tile.idx * 137.508) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.72, 0.54);
}

function colorForRoom(tile) {
  const hue = ((tile.room * 47.0) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.62, 0.52);
}

function colorForRaw(tile) {
  return new THREE.Color(
    Math.max(0.08, tile.r / 15),
    Math.max(0.08, tile.g / 15),
    Math.max(0.08, tile.b / 15)
  );
}

function getTileColor(tile) {
  if (colorMode.value === 'room') return colorForRoom(tile);
  if (colorMode.value === 'raw') return colorForRaw(tile);
  return colorForTile(tile);
}

function tileTouchesOtherRoom(tile, tileByIdx) {
  return (tile.neighbors || []).some((neighborIdx) => {
    const neighbor = tileByIdx.get(neighborIdx);
    return neighbor && neighbor.room !== tile.room;
  });
}

function makeGeometry(tile, scale) {
  const points = tile.points.map((point) => rawToWorld(point, scale));
  const vertices = [];
  for (let i = 1; i < points.length - 1; i++) {
    vertices.push(points[0].x, points[0].y, points[0].z);
    vertices.push(points[i].x, points[i].y, points[i].z);
    vertices.push(points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function makeRoomSeamOverlayGeometry(tile, scale) {
  const normal = tileNormal(tile, scale);
  const points = tile.points.map((point) => rawToWorld(point, scale).addScaledVector(normal, ROOM_SEAM_OVERLAY_OFFSET));
  const vertices = [];
  for (let i = 1; i < points.length - 1; i++) {
    vertices.push(points[0].x, points[0].y, points[0].z);
    vertices.push(points[i].x, points[i].y, points[i].z);
    vertices.push(points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function makeBoundaryGeometries(tile, scale, tileByIdx) {
  const boundary = [];
  const seam = [];
  for (let i = 0; i < tile.points.length; i++) {
    const neighborIdx = tile.neighbors?.[i] ?? -1;
    const neighbor = tileByIdx.get(neighborIdx);
    if (neighborIdx >= 0 && neighbor && neighbor.room === tile.room) continue;
    const target = neighbor && neighbor.room !== tile.room ? seam : boundary;
    const a = rawToWorld(tile.points[i], scale);
    const b = rawToWorld(tile.points[(i + 1) % tile.points.length], scale);
    target.push(a.x, a.y + 1.2, a.z, b.x, b.y + 1.2, b.z);
  }
  const boundaryGeometry = new THREE.BufferGeometry();
  boundaryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(boundary, 3));
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seam, 3));
  return { boundaryGeometry, seamGeometry };
}

function visibleTilesForRoom() {
  const roomText = roomFilter.value.trim();
  const wantedRoom = roomText === '' ? null : Number(roomText);
  return levelData.tiles.filter((tile) => (
    tile.pointCount >= 3
    && tile.points.length >= 3
    && (wantedRoom === null || tile.room === wantedRoom)
  ));
}

function makeEdgeGeometryForTiles(tiles, scale) {
  const vertices = [];
  const addSegment = (a, b) => {
    vertices.push(a.x, a.y + 1.1, a.z, b.x, b.y + 1.1, b.z);
  };
  for (const tile of tiles) {
    const points = tile.points.map((point) => rawToWorld(point, scale));
    for (let i = 1; i < points.length - 1; i++) {
      addSegment(points[0], points[i]);
      addSegment(points[i], points[i + 1]);
      addSegment(points[i + 1], points[0]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function makeBoundaryGeometryForTiles(tiles, scale, tileByIdx) {
  const boundary = [];
  const seam = [];
  const addSegment = (target, a, b) => {
    target.push(a.x, a.y + 1.2, a.z, b.x, b.y + 1.2, b.z);
  };
  for (const tile of tiles) {
    for (let i = 0; i < tile.points.length; i++) {
      const neighborIdx = tile.neighbors?.[i] ?? -1;
      const neighbor = tileByIdx.get(neighborIdx);
      if (neighborIdx >= 0 && neighbor && neighbor.room === tile.room) continue;
      const target = neighbor && neighbor.room !== tile.room ? seam : boundary;
      addSegment(
        target,
        rawToWorld(tile.points[i], scale),
        rawToWorld(tile.points[(i + 1) % tile.points.length], scale)
      );
    }
  }
  const boundaryGeometry = new THREE.BufferGeometry();
  boundaryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(boundary, 3));
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seam, 3));
  return { boundaryGeometry, seamGeometry };
}

function clearLineLayers() {
  for (const object of [edgeLine, boundaryLine, seamLine]) {
    if (!object) continue;
    world.remove(object);
    disposeObject(object);
  }
  edgeLine = null;
  boundaryLine = null;
  seamLine = null;
  lineRoomKey = null;
}

function rebuildLineLayers(force = false) {
  if (!levelData) return;
  const roomKey = roomFilter.value.trim();
  if (!force && roomKey === lineRoomKey && edgeLine && boundaryLine && seamLine) return;
  clearLineLayers();
  lineRoomKey = roomKey;
  const scale = getWorldScale(levelData);
  const tileByIdx = new Map(levelData.tiles.map((tile) => [tile.idx, tile]));
  const tiles = visibleTilesForRoom();
  const bg = BACKGROUNDS[bgMode.value] || BACKGROUNDS.magenta;

  edgeLine = new THREE.LineSegments(
    makeEdgeGeometryForTiles(tiles, scale),
    new THREE.LineBasicMaterial({ color: bg.edge, transparent: true, opacity: 0.92 })
  );
  edgeLine.visible = edgeToggle.checked;
  world.add(edgeLine);

  const boundaries = makeBoundaryGeometryForTiles(tiles, scale, tileByIdx);
  boundaryLine = new THREE.LineSegments(
    boundaries.boundaryGeometry,
    new THREE.LineBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.98 })
  );
  boundaryLine.visible = boundaryToggle.checked;
  world.add(boundaryLine);

  seamLine = new THREE.LineSegments(
    boundaries.seamGeometry,
    new THREE.LineBasicMaterial({ color: 0x58d8ff, transparent: true, opacity: 0.98 })
  );
  seamLine.visible = boundaryToggle.checked;
  world.add(seamLine);
}

function makeBarGeometry(bar) {
  const vertices = [];
  const n = bar.points.length;
  for (let i = 0; i < n; i++) {
    const a = bar.points[i];
    const b = bar.points[(i + 1) % n];
    vertices.push(a.x, bar.ymin, a.z);
    vertices.push(b.x, bar.ymin, b.z);
    vertices.push(b.x, bar.ymax, b.z);
    vertices.push(a.x, bar.ymin, a.z);
    vertices.push(b.x, bar.ymax, b.z);
    vertices.push(a.x, bar.ymax, a.z);
  }
  for (let i = 1; i < n - 1; i++) {
    const a = bar.points[0], b = bar.points[i], c = bar.points[i + 1];
    vertices.push(a.x, bar.ymax, a.z, b.x, bar.ymax, b.z, c.x, bar.ymax, c.z);
    vertices.push(a.x, bar.ymin, a.z, c.x, bar.ymin, c.z, b.x, bar.ymin, b.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function applyMergedPropBarColors(geometry) {
  const position = geometry.getAttribute('position');
  const color = new THREE.Color();
  const green = new THREE.Color(0x9aff8a);
  const gold = new THREE.Color(0xffb000);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const height = Math.max(1, maxY - minY);
  const colors = [];
  for (let i = 0; i < position.count; i++) {
    const yMix = (position.getY(i) - minY) / height;
    const wave = 0.18 * Math.sin((position.getX(i) + position.getZ(i)) * 0.015);
    const mix = Math.max(0, Math.min(1, 0.34 + yMix * 0.5 + wave));
    color.copy(green).lerp(gold, mix);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function mergedBarMaterial(hasSetupProp) {
  if (!hasSetupProp) {
    return new THREE.MeshBasicMaterial({
      color: 0xffb000,
      transparent: true,
      opacity: BAR_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: true
    });
  }
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: true
  });
}

function hidePropVisualMergedIntoBar(bar) {
  if (!bar.object) return;
  const propMesh = propMeshes.find((mesh) => mesh.userData.prop?.index === bar.index);
  if (!propMesh) return;
  propMesh.userData.mergedIntoBar = true;
  propMesh.visible = false;
}

function makeBarLabel(bar) {
  const title = bar.object ? 'prop' : 'bar';
  const name = bar.name && bar.name !== 'unknown' ? bar.name : `model ${bar.model}`;
  return `${title} ${bar.index}\n${name}`;
}

function modelName(level, model) {
  return level.models?.[String(model)]?.name || 'unknown';
}

function getPad(level, object) {
  if (!object || !Number.isInteger(object.pad)) return null;
  if (object.pad >= 10000) {
    const boundPads = level.pad3dlist || [];
    const idx = object.pad - 10000;
    return idx >= 0 && idx < boundPads.length ? boundPads[idx] : null;
  }
  const pads = level.padlist || [];
  return object.pad >= 0 && object.pad < pads.length ? pads[object.pad] : null;
}

function padAxes(pad) {
  const up = new THREE.Vector3(pad?.up?.[0] ?? 0, pad?.up?.[1] ?? 1, pad?.up?.[2] ?? 0);
  const look = new THREE.Vector3(pad?.look?.[0] ?? 0, pad?.look?.[1] ?? 0, pad?.look?.[2] ?? -1);
  if (up.lengthSq() < 0.001) up.set(0, 1, 0);
  if (look.lengthSq() < 0.001) look.set(0, 0, -1);
  up.normalize();
  look.normalize();
  let normal = new THREE.Vector3().crossVectors(up, look);
  if (normal.lengthSq() < 0.001) normal = new THREE.Vector3(1, 0, 0);
  normal.normalize();
  const matrix = new THREE.Matrix4().makeBasis(normal, up, look);
  return { normal, up, look, quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix) };
}

function propGeometryFromBox(size) {
  return new THREE.BoxGeometry(
    Math.max(PROP_VISUAL_MIN_THICKNESS, Math.abs(size.x)),
    Math.max(PROP_VISUAL_MIN_THICKNESS, Math.abs(size.y)),
    Math.max(PROP_VISUAL_MIN_THICKNESS, Math.abs(size.z))
  );
}

function makePropGeometry(prop, level, pad) {
  const model = level.models?.[String(prop.model)] || {};
  const bbox = pad?.bbox || model.bbox;
  const modelScale = model.scale ?? 0.1;
  const extraScale = (prop.extrascale ?? 256) / 256;
  if (!bbox) return new THREE.BoxGeometry(32, 32, 32);
  const scale = pad?.bbox ? 1 : modelScale * extraScale;
  const geometry = propGeometryFromBox(new THREE.Vector3(
    (bbox.xmax - bbox.xmin) * scale,
    (bbox.ymax - bbox.ymin) * scale,
    (bbox.zmax - bbox.zmin) * scale
  ));
  geometry.translate(
    ((bbox.xmin + bbox.xmax) * scale) / 2,
    ((bbox.ymin + bbox.ymax) * scale) / 2,
    ((bbox.zmin + bbox.zmax) * scale) / 2
  );
  return geometry;
}

function makeBoundPadGeometry(pad) {
  return propGeometryFromBox(new THREE.Vector3(
    pad.bbox.xmax - pad.bbox.xmin,
    pad.bbox.ymax - pad.bbox.ymin,
    pad.bbox.zmax - pad.bbox.zmin
  ));
}

function boundPadCenter(pad) {
  const axes = padAxes(pad);
  return new THREE.Vector3(pad.pos[0], pad.pos[1], pad.pos[2])
    .addScaledVector(axes.normal, (pad.bbox.xmin + pad.bbox.xmax) * 0.5)
    .addScaledVector(axes.up, (pad.bbox.ymin + pad.bbox.ymax) * 0.5)
    .addScaledVector(axes.look, (pad.bbox.zmin + pad.bbox.zmax) * 0.5);
}

function propHasFlag(prop, flag) {
  return ((prop.flags ?? 0) & flag) !== 0;
}

function propLabelText(prop, name) {
  const suffix = propHasFlag(prop, PROPFLAG_RENDERPOSTBG) ? '\nauto fall to ground' : '';
  return `prop ${prop.index}\n${name}${suffix}`;
}

function propPlacementMode(prop, level, pad) {
  const model = level.models?.[String(prop.model)] || {};
  if (pad?.bbox && propHasFlag(prop, PROPFLAG_IN_AIR)) return model.bbox ? 'pad-model' : 'pad-anchor';
  return pad?.bbox ? 'boundpad-center' : 'pad-model';
}

function setupPropGeometry(prop, level, pad, placementMode) {
  if (placementMode === 'boundpad-center') return makeBoundPadGeometry(pad);
  return makePropGeometry(prop, level, null);
}

function addSetupProps(level) {
  const props = level.objects || [];
  const bounds = new THREE.Box3();
  for (const prop of props) {
    const pad = getPad(level, prop);
    if (!pad?.pos) continue;
    const placementMode = propPlacementMode(prop, level, pad);
    const geometry = setupPropGeometry(prop, level, pad, placementMode);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: prop.doorType !== undefined ? 0x8ad8ff : 0x9aff8a,
        transparent: true,
        opacity: PROP_OPACITY,
        depthWrite: true
      })
    );
    const propEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 1),
      new THREE.LineBasicMaterial({
        color: prop.doorType !== undefined ? 0xc5efff : 0xd4ffd0,
        transparent: true,
        opacity: 0.82
      })
    );
    mesh.add(propEdge);
    const name = modelName(level, prop.model);
    if (placementMode === 'boundpad-center') {
      mesh.position.copy(boundPadCenter(pad));
      mesh.quaternion.copy(padAxes(pad).quaternion);
    } else {
      mesh.position.set(pad.pos[0], pad.pos[1], pad.pos[2]);
      mesh.quaternion.copy(padAxes(pad).quaternion);
    }
    mesh.userData.prop = {
      ...prop,
      padData: pad,
      name,
      placementMode,
      typename: prop.typename || (prop.doorType !== undefined ? 'Door' : 'SetupObject')
    };
    world.add(mesh);
    propMeshes.push(mesh);
    bounds.expandByObject(mesh);

    const propBox = new THREE.Box3().setFromObject(mesh);
    const label = makePropSurfaceLabel(propLabelText(prop, name), propBox);
    label.userData.kind = 'prop';
    label.userData.prop = mesh.userData.prop;
    world.add(label);
    labels.push(label);
  }
  return { count: props.length, bounds };
}

function pointInTileXZ(point, tile) {
  let inside = false;
  const scale = getWorldScale(levelData);
  const points = tile.points.map((raw) => rawToWorld(raw, scale));
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = ((a.z > point.z) !== (b.z > point.z))
      && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function tileYAtXZ(tile, x, z) {
  const scale = getWorldScale(levelData);
  const points = tile.points.map((raw) => rawToWorld(raw, scale));
  if (points.length < 3) return null;
  const a = points[0];
  for (let i = 1; i + 1 < points.length; i++) {
    const b = points[i];
    const c = points[i + 1];
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a)
    );
    if (Math.abs(normal.y) < 0.0001) continue;
    return a.y - (normal.x * (x - a.x) + normal.z * (z - a.z)) / normal.y;
  }
  return null;
}

function projectGuardSpawn(guard) {
  const raw = new THREE.Vector3(...guard.pos);
  let best = null;
  for (const tile of levelData.tiles) {
    if (tile.pointCount < 3 || tile.points.length < 3) continue;
    if (!pointInTileXZ(raw, tile)) continue;
    const y = tileYAtXZ(tile, raw.x, raw.z);
    if (y === null) continue;
    const dy = Math.abs(raw.y - y);
    if (!best || dy < best.dy) {
      best = { pos: new THREE.Vector3(raw.x, y, raw.z), tile, dy };
    }
  }
  return best || { pos: raw, tile: null, dy: null };
}

function makeGuardLabel(guard) {
  return `guard ${guard.index}\npad ${guard.pad} ai ${guard.ailist}`;
}

function addGuards(level) {
  const guards = level.guards || [];
  const bounds = new THREE.Box3();
  for (const guard of guards) {
    if (!guard.pos) continue;
    const projected = projectGuardSpawn(guard);
    const group = new THREE.Group();
    const base = projected.pos.clone();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 34, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff4b5f,
        transparent: true,
        opacity: GUARD_OPACITY,
        depthWrite: true
      })
    );
    body.position.copy(base).add(new THREE.Vector3(0, 17, 0));
    const look = new THREE.Vector3(...(guard.look || [0, 0, 1]));
    if (look.lengthSq() < 0.001) look.set(0, 0, 1);
    look.y = 0;
    if (look.lengthSq() < 0.001) look.set(0, 0, 1);
    look.normalize();
    const arrow = new THREE.ArrowHelper(look, base.clone().add(new THREE.Vector3(0, 38, 0)), 46, 0xffd166, 16, 9);
    const label = makeLabel(makeGuardLabel(guard));
    label.position.copy(base).add(new THREE.Vector3(0, 66, 0));
    label.scale.set(74, 24, 1);
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(13, 18, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.86, side: THREE.DoubleSide })
    );
    marker.position.copy(base).add(new THREE.Vector3(0, 0.6, 0));
    marker.rotation.x = -Math.PI / 2;
    group.add(marker, body, arrow, label);
    if (projected.dy !== null && projected.dy > GUARD_RAW_LINE_THRESHOLD) {
      const raw = new THREE.Vector3(...guard.pos);
      const rawLineGeom = new THREE.BufferGeometry().setFromPoints([base, raw]);
      const rawLine = new THREE.Line(
        rawLineGeom,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42 })
      );
      group.add(rawLine);
    }
    group.userData.guard = {
      ...guard,
      projectedPos: [projected.pos.x, projected.pos.y, projected.pos.z],
      projectedTile: projected.tile?.idx ?? null,
      projectedRoom: projected.tile?.room ?? null,
      projectedDy: projected.dy
    };
    for (const child of group.children) child.userData.guard = group.userData.guard;
    world.add(group);
    guardMeshes.push(group);
    bounds.expandByObject(group);
  }
  return { count: guards.length, bounds };
}

function enrichBar(bar, level) {
  const setupObjects = [...(level.objects || []), ...(level.doors || [])];
  const object = setupObjects.find((item) => item.index === bar.index) || null;
  const modelInfo = level.models?.[String(bar.model)] || null;
  return {
    ...bar,
    object,
    pad: getPad(level, object),
    name: modelInfo?.name || 'unknown',
    modelScale: modelInfo?.scale ?? null,
    bbox: modelInfo?.bbox || null,
    typename: object?.typename || (object?.doorType !== undefined ? 'Door' : 'CollisionBar')
  };
}

function pointsFromFlatXZ(values) {
  const points = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    points.push({ x: values[i], z: values[i + 1] });
  }
  return points;
}

function hydrateLevelData(data) {
  if (data.format !== 'level-v2' || !Array.isArray(data.tile_schema)) return data;
  const schema = data.tile_schema;
  data.tiles = (data.tiles || []).map((row) => {
    if (!Array.isArray(row)) return row;
    const tile = {};
    for (let i = 0; i < schema.length; i++) tile[schema[i]] = row[i];
    return tile;
  });
  return data;
}

async function loadBars(levelDataForBars, data) {
  try {
    if (!data) return { count: 0, bounds: new THREE.Box3() };
    const bounds = new THREE.Box3();

    const bars = data.bars || [];
    for (const rawBar of bars) {
      const bar = Array.isArray(rawBar)
        ? {
            index: rawBar[0],
            model: rawBar[1],
            ymin: rawBar[2],
            ymax: rawBar[3],
            points: pointsFromFlatXZ(rawBar[4])
          }
        : rawBar;
      const enrichedBar = enrichBar(bar, levelDataForBars);
      const geometry = makeBarGeometry(enrichedBar);
      if (enrichedBar.object) applyMergedPropBarColors(geometry);
      const mesh = new THREE.Mesh(geometry, mergedBarMaterial(Boolean(enrichedBar.object)));
      mesh.userData.bar = enrichedBar;
      world.add(mesh);
      barMeshes.push(mesh);
      hidePropVisualMergedIntoBar(enrichedBar);
      bounds.expandByObject(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 1),
        new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.78 })
      );
      edge.userData.barEdge = true;
      mesh.add(edge);

      if (!enrichedBar.object || enrichedBar.object.doorType !== undefined) {
        const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        const label = makeLabel(makeBarLabel(enrichedBar));
        label.position.set(center.x, enrichedBar.ymax + 18, center.z);
        fitLabelToObject(label, mesh, 105);
        label.userData.kind = 'bar';
        label.userData.bar = enrichedBar;
        world.add(label);
        labels.push(label);
      }
    }
    return { count: bars.length, bounds };
  } catch {
    return { count: 0, bounds: new THREE.Box3() };
  }
}

function closestPointOnSegment2D(point, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 0.0001) return { x: a.x, z: a.z, t: 0 };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.z - a.z) * vz) / lenSq));
  return { x: a.x + vx * t, z: a.z + vz * t, t };
}

function pointInPolygonXZ(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = ((a.z > point.z) !== (b.z > point.z))
      && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentsIntersectXZ(a, b, c, d) {
  const orient = (p, q, r) => ((q.x - p.x) * (r.z - p.z)) - ((q.z - p.z) * (r.x - p.x));
  const onSegment = (p, q, r) => (
    Math.min(p.x, r.x) - 0.001 <= q.x && q.x <= Math.max(p.x, r.x) + 0.001
    && Math.min(p.z, r.z) - 0.001 <= q.z && q.z <= Math.max(p.z, r.z) + 0.001
  );
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (Math.abs(o1) < 0.001 && onSegment(a, c, b)) return true;
  if (Math.abs(o2) < 0.001 && onSegment(a, d, b)) return true;
  if (Math.abs(o3) < 0.001 && onSegment(c, a, d)) return true;
  if (Math.abs(o4) < 0.001 && onSegment(c, b, d)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polygonsIntersectXZ(a, b) {
  if (a.some((point) => pointInPolygonXZ(point, b))) return true;
  if (b.some((point) => pointInPolygonXZ(point, a))) return true;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersectXZ(a0, a1, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

function boundarySegmentsForGaps() {
  const scale = getWorldScale(levelData);
  const tileByIdx = new Map(levelData.tiles.map((tile) => [tile.idx, tile]));
  const segments = [];
  for (const tile of levelData.tiles) {
    if (tile.pointCount < 3 || tile.points.length < 3) continue;
    for (let i = 0; i < tile.points.length; i++) {
      const neighborIdx = tile.neighbors?.[i] ?? -1;
      const neighbor = tileByIdx.get(neighborIdx);
      if (neighborIdx >= 0 && neighbor && neighbor.room === tile.room) continue;
      const a = rawToWorld(tile.points[i], scale);
      const b = rawToWorld(tile.points[(i + 1) % tile.points.length], scale);
      segments.push({
        tile,
        neighborIdx,
        a: { x: a.x, y: a.y, z: a.z },
        b: { x: b.x, y: b.y, z: b.z },
        y: (a.y + b.y) * 0.5
      });
    }
  }
  return segments;
}

function makeGapMarker(gap) {
  const group = new THREE.Group();
  const y = gap.y + 7;
  const centerX = (gap.from.x + gap.to.x) * 0.5;
  const centerZ = (gap.from.z + gap.to.z) * 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    gap.from.x, y, gap.from.z,
    gap.to.x, y, gap.to.z
  ], 3));
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.96, depthTest: true })
  );
  const radius = Math.max(5, Math.min(18, gap.distance * 0.32));
  const height = gap.columnHeight || TILE_GAP_COLUMN_HEIGHT;
  const colors = [0xff3048, 0xff8a00, 0xfff04a, 0x30e86f, 0x27c7ff, 0x7a5cff, 0xff4df0];
  const segmentHeight = height / colors.length;
  for (let i = 0; i < colors.length; i++) {
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, segmentHeight * 0.92, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: 0.54,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    column.position.set(centerX, y + segmentHeight * (i + 0.5), centerZ);
    column.userData.gap = gap;
    group.add(column);
  }
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.28, 10, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94, depthTest: true, depthWrite: false })
  );
  cap.position.set(centerX, y + 1.5, centerZ);
  group.add(line, cap);
  group.userData.gap = gap;
  line.userData.gap = gap;
  cap.userData.gap = gap;
  return group;
}

function rebuildGapMarkers() {
  for (const markerObject of gapMarkers) {
    world.remove(markerObject);
    disposeObject(markerObject);
  }
  gapMarkers = [];
  if (!levelData || !barMeshes.length) return;

  const segments = boundarySegmentsForGaps();
  const candidates = [];
  const seen = new Set();
  for (const barMesh of barMeshes) {
    const bar = barMesh.userData.bar;
    const points = bar.points || [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      let best = null;
      for (const segment of segments) {
        if (Math.abs(segment.y - bar.ymin) > GAP_Y_TOLERANCE && Math.abs(segment.y - bar.ymax) > GAP_Y_TOLERANCE) continue;
        const close = closestPointOnSegment2D(point, segment.a, segment.b);
        const dx = point.x - close.x;
        const dz = point.z - close.z;
        const distance = Math.hypot(dx, dz);
        if (distance < GAP_MIN_DISTANCE || distance > GAP_MAX_DISTANCE) continue;
        if (!best || distance < best.distance) {
          best = { bar, point, segment, close, distance };
        }
      }
      if (!best) continue;
      const mx = Math.round((best.point.x + best.close.x) * 0.5);
      const mz = Math.round((best.point.z + best.close.z) * 0.5);
      const key = `${best.bar.index}:${best.segment.tile.idx}:${mx}:${mz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        distance: best.distance,
        from: { x: best.point.x, z: best.point.z },
        to: { x: best.close.x, z: best.close.z },
        y: best.segment.y,
        bar: {
          index: best.bar.index,
          model: best.bar.model,
          name: best.bar.name,
          isDoor: best.bar.object?.doorType !== undefined || best.bar.typename === 'Door'
        },
        stan: {
          idx: best.segment.tile.idx,
          room: best.segment.tile.room,
          neighborIdx: best.segment.neighborIdx
        }
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const gap of candidates.slice(0, GAP_MARKER_LIMIT)) {
    const markerObject = makeGapMarker(gap);
    markerObject.visible = false;
    world.add(markerObject);
    gapMarkers.push(markerObject);
  }
}

function tileEdgeSegmentsForGaps() {
  const scale = getWorldScale(levelData);
  const segments = [];
  for (const tile of levelData.tiles) {
    if (tile.pointCount < 3 || tile.points.length < 3) continue;
    for (let i = 0; i < tile.points.length; i++) {
      const neighborIdx = tile.neighbors?.[i] ?? -1;
      if (neighborIdx >= 0) continue;
      const a3 = rawToWorld(tile.points[i], scale);
      const b3 = rawToWorld(tile.points[(i + 1) % tile.points.length], scale);
      const dx = b3.x - a3.x;
      const dz = b3.z - a3.z;
      const length = Math.hypot(dx, dz);
      if (length < TILE_GAP_MIN_OVERLAP) continue;
      segments.push({
        tile,
        edge: i,
        a: { x: a3.x, y: a3.y, z: a3.z },
        b: { x: b3.x, y: b3.y, z: b3.z },
        y: (a3.y + b3.y) * 0.5,
        dx: dx / length,
        dz: dz / length,
        length
      });
    }
  }
  return segments;
}

function projectedOverlapAlongSegment(a, b) {
  const bx0 = b.a.x - a.a.x;
  const bz0 = b.a.z - a.a.z;
  const bx1 = b.b.x - a.a.x;
  const bz1 = b.b.z - a.a.z;
  const t0 = bx0 * a.dx + bz0 * a.dz;
  const t1 = bx1 * a.dx + bz1 * a.dz;
  const min = Math.max(0, Math.min(t0, t1));
  const max = Math.min(a.length, Math.max(t0, t1));
  return { min, max, amount: Math.max(0, max - min) };
}

function segmentPointAt(segment, along) {
  return {
    x: segment.a.x + segment.dx * along,
    y: segment.y,
    z: segment.a.z + segment.dz * along
  };
}

function rebuildTileGapMarkers() {
  for (const markerObject of gapMarkers) {
    world.remove(markerObject);
    disposeObject(markerObject);
  }
  gapMarkers = [];
  if (!levelData) return;

  const segments = tileEdgeSegmentsForGaps();
  const candidates = [];
  const seen = new Set();
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (a.tile.idx === b.tile.idx) continue;
      if (Math.abs(a.y - b.y) > TILE_GAP_Y_TOLERANCE) continue;
      const dot = Math.abs(a.dx * b.dx + a.dz * b.dz);
      if (dot < TILE_GAP_PARALLEL_DOT) continue;
      const overlap = projectedOverlapAlongSegment(a, b);
      if (overlap.amount < TILE_GAP_MIN_OVERLAP) continue;
      const middle = (overlap.min + overlap.max) * 0.5;
      const pa = segmentPointAt(a, middle);
      const close = closestPointOnSegment2D(pa, b.a, b.b);
      const distance = Math.hypot(pa.x - close.x, pa.z - close.z);
      if (distance < TILE_GAP_MIN_DISTANCE || distance > TILE_GAP_MAX_DISTANCE) continue;
      const key = [a.tile.idx, b.tile.idx].sort((x, y) => x - y).join(':');
      const rounded = `${key}:${Math.round((pa.x + close.x) * 0.5)}:${Math.round((pa.z + close.z) * 0.5)}`;
      if (seen.has(rounded)) continue;
      seen.add(rounded);
      candidates.push({
        distance,
        from: { x: pa.x, z: pa.z },
        to: { x: close.x, z: close.z },
        y: (a.y + b.y) * 0.5,
        columnHeight: TILE_GAP_COLUMN_HEIGHT,
        kind: 'tile-gap',
        stanA: { idx: a.tile.idx, room: a.tile.room, edge: a.edge },
        stanB: { idx: b.tile.idx, room: b.tile.room, edge: b.edge },
        overlap: overlap.amount
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const gap of candidates.slice(0, TILE_GAP_MARKER_LIMIT)) {
    const markerObject = makeGapMarker(gap);
    markerObject.visible = false;
    world.add(markerObject);
    gapMarkers.push(markerObject);
  }
}

async function loadVisualBg(pack, serial = loadSerial) {
  try {
    if (serial !== loadSerial) return { count: 0, bounds: new THREE.Box3() };
    const data = pack.visual;
    if (!data) return { count: 0, bounds: new THREE.Box3() };
    if (serial !== loadSerial) return { count: 0, bounds: new THREE.Box3() };
    const vertices = loadVisualBgVertices(pack);
    if (serial !== loadSerial) return { count: 0, bounds: new THREE.Box3() };
    if (!vertices?.length) return { count: 0, bounds: new THREE.Box3() };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const material = new THREE.MeshBasicMaterial({
      color: 0x9fb3c8,
      transparent: true,
      opacity: 0.115,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(getWorldScale(levelData));
    mesh.userData.visualBg = data.source || level;
    world.add(mesh);
    visualBgMeshes.push(mesh);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 1),
      new THREE.LineBasicMaterial({ color: 0xc7d7e8, transparent: true, opacity: 0.1 })
    );
    mesh.add(edge);
    const bounds = new THREE.Box3().setFromObject(mesh);
    return { count: vertices.length / 9, bounds };
  } catch {
    return { count: 0, bounds: new THREE.Box3() };
  }
}

function loadVisualBgVertices(pack) {
  if (pack.visualVertices?.length) return pack.visualVertices;
  if (pack.visual?.vertices?.length) return new Float32Array(pack.visual.vertices);
  return null;
}

function centroid(tile, scale) {
  const center = new THREE.Vector3();
  for (const point of tile.points) center.add(rawToWorld(point, scale));
  center.multiplyScalar(1 / tile.points.length);
  return center;
}

function tileNormal(tile, scale) {
  const points = tile.points.map((point) => rawToWorld(point, scale));
  const normal = new THREE.Vector3();
  for (let i = 1; i < points.length - 1; i++) {
    const a = new THREE.Vector3().subVectors(points[i], points[0]);
    const b = new THREE.Vector3().subVectors(points[i + 1], points[0]);
    normal.crossVectors(a, b);
    if (normal.lengthSq() > 0.0001) {
      normal.normalize();
      if (normal.y < 0) normal.multiplyScalar(-1);
      return normal;
    }
  }
  return new THREE.Vector3(0, 1, 0);
}

function spawnLookDirection() {
  const spawn = levelData?.intro_spawnpoints?.find((item) => item.look);
  const look = new THREE.Vector3(spawn?.look?.[0] ?? 0, spawn?.look?.[1] ?? 0, spawn?.look?.[2] ?? -1);
  return look.lengthSq() > 0.001 ? look.normalize() : new THREE.Vector3(0, 0, -1);
}

function spawnPosition() {
  const spawn = levelData?.intro_spawnpoints?.find((item) => item.pos);
  return spawn?.pos ? new THREE.Vector3(spawn.pos[0], spawn.pos[1], spawn.pos[2]) : null;
}

function labelQuaternionOnSurface(normal) {
  const zAxis = normal.clone().normalize();
  let yAxis = spawnLookDirection().projectOnPlane(zAxis);
  if (yAxis.lengthSq() < 0.001) yAxis = new THREE.Vector3(0, 0, -1).projectOnPlane(zAxis);
  if (yAxis.lengthSq() < 0.001) yAxis = new THREE.Vector3(1, 0, 0).projectOnPlane(zAxis);
  yAxis.normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function labelQuaternionForPropSurface(normal) {
  const zAxis = normal.clone().normalize();
  let yAxis = Math.abs(zAxis.y) > 0.82
    ? spawnLookDirection().projectOnPlane(zAxis)
    : new THREE.Vector3(0, 1, 0).projectOnPlane(zAxis);
  if (yAxis.lengthSq() < 0.001) yAxis = spawnLookDirection().projectOnPlane(zAxis);
  if (yAxis.lengthSq() < 0.001) yAxis = new THREE.Vector3(1, 0, 0).projectOnPlane(zAxis);
  yAxis.normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function fitLabelToBox(label, box, fallbackWidth = 90, minWidth = 26, minHeight = 12) {
  const size = box.getSize(new THREE.Vector3());
  const maxWidth = Math.max(minWidth, Math.min(fallbackWidth, Math.max(size.x, size.z) * 0.82));
  const maxHeight = Math.max(minHeight, Math.min(42, Math.max(size.y, Math.min(size.x, size.z)) * 0.45));
  const ratio = label.userData.labelRatio || (label.scale.y / label.scale.x);
  label.scale.x = maxWidth;
  label.scale.y = Math.min(maxHeight, maxWidth * ratio);
}

function fitLabelToObject(label, object, fallbackWidth = 90, minWidth = 26, minHeight = 12) {
  fitLabelToBox(label, new THREE.Box3().setFromObject(object), fallbackWidth, minWidth, minHeight);
}

function makeLabelTexture(text, style = 'default') {
  const lines = String(text).split('\n').slice(0, style === 'prop' ? 3 : 2);
  const canvas2d = document.createElement('canvas');
  const context = canvas2d.getContext('2d');
  const scale = 2;
  const width = 320;
  const height = lines.length > 2 ? 126 : (lines.length > 1 ? 104 : 72);
  canvas2d.width = width * scale;
  canvas2d.height = height * scale;
  context.scale(scale, scale);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (style === 'prop') {
    const fill = context.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, '#ffef99');
    fill.addColorStop(0.18, '#693f00');
    fill.addColorStop(0.45, '#f4b026');
    fill.addColorStop(0.68, '#3a2100');
    fill.addColorStop(1, '#ffe268');
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(255, 255, 255, 0.45)';
    context.fillRect(10, 8, width - 20, 5);
    context.fillStyle = 'rgba(255, 255, 255, 0.25)';
    context.fillRect(26, 18, width * 0.34, 4);
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#fff7b0');
    gradient.addColorStop(0.35, '#f6c544');
    gradient.addColorStop(0.7, '#fff4a3');
    gradient.addColorStop(1, '#b97400');
    context.strokeStyle = gradient;
    context.lineWidth = 7;
    context.strokeRect(3.5, 3.5, width - 7, height - 7);
    context.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    context.lineWidth = 2;
    context.strokeRect(10.5, 10.5, width - 21, height - 21);
  } else {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
    if (style === 'stan') {
      context.fillStyle = 'rgba(255, 255, 255, 0.16)';
      context.fillRect(10, 8, width - 20, 3);
      context.strokeStyle = 'rgba(255, 240, 106, 0.78)';
      context.lineWidth = 2;
      context.setLineDash([12, 8]);
      context.strokeRect(5.5, 5.5, width - 11, height - 11);
      context.setLineDash([]);
    } else {
      context.strokeStyle = '#fff06a';
      context.lineWidth = 3;
      context.strokeRect(1.5, 1.5, width - 3, height - 3);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const y = lines.length > 2 ? [31, 64, 96][i] : (lines.length > 1 ? 34 + i * 38 : height / 2);
    const propFinePrint = style === 'prop' && i === 2;
    context.font = i === 0
      ? 'bold 30px Menlo, Consolas, monospace'
      : `bold ${propFinePrint ? 18 : 24}px Menlo, Consolas, monospace`;
    context.lineWidth = propFinePrint ? 6 : (style === 'prop' ? 8 : 7);
    context.strokeStyle = style === 'prop' ? '#301800' : '#000000';
    context.strokeText(lines[i], width / 2, y);
    context.fillStyle = style === 'prop'
      ? (i === 0 ? '#fff3a6' : (propFinePrint ? '#fff0b8' : '#ffffff'))
      : (i === 0 ? '#fff9a8' : '#dcecff');
    context.fillText(lines[i], width / 2, y);
    if (style === 'prop') {
      context.fillStyle = 'rgba(255, 255, 255, 0.55)';
      context.fillText(lines[i], width / 2 - 1, y - 2);
    }
  }

  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, lines };
}

function makeLabel(text, style = 'default') {
  const { texture, lines } = makeLabelTexture(text, style);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(132, lines.length > 2 ? 52 : (lines.length > 1 ? 43 : 30), 1);
  sprite.userData.labelRatio = sprite.scale.y / sprite.scale.x;
  return sprite;
}

function makePlaneLabel(text, style = 'default') {
  const { texture, lines } = makeLabelTexture(text, style);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 30;
  mesh.scale.set(132, lines.length > 2 ? 52 : (lines.length > 1 ? 43 : 30), 1);
  mesh.userData.labelRatio = mesh.scale.y / mesh.scale.x;
  return mesh;
}

function makeStanLabel(text, tile, scale, tileMesh) {
  const { texture, lines } = makeLabelTexture(text, 'stan');
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 30;
  mesh.scale.set(132, lines.length > 1 ? 43 : 30, 1);
  mesh.userData.labelRatio = mesh.scale.y / mesh.scale.x;
  const normal = tileNormal(tile, scale);
  const center = centroid(tile, scale);
  mesh.position.copy(center).addScaledVector(normal, STAN_LABEL_SURFACE_OFFSET);
  mesh.quaternion.copy(labelQuaternionOnSurface(normal));
  return mesh;
}

function makeLazyStanLabel(tile, scale, tileMesh) {
  const label = new THREE.Object3D();
  const normal = tileNormal(tile, scale);
  const center = centroid(tile, scale);
  label.position.copy(center).addScaledVector(normal, STAN_LABEL_SURFACE_OFFSET);
  label.quaternion.copy(labelQuaternionOnSurface(normal));
  label.scale.set(132, 43, 1);
  label.userData = {
    kind: 'stan',
    tile,
    tileMesh,
    levelScale: scale,
    lazyStan: true,
    labelRatio: 43 / 132,
    stanBatchVisible: false,
    atlas: null,
    wantsVisible: false,
    mesh: null
  };
  fitStanLabelToTile(label, tile, scale);
  return label;
}

function drawStanAtlasCell(context, tile, x, y) {
  const width = STAN_LABEL_ATLAS_CELL_W;
  const height = STAN_LABEL_ATLAS_CELL_H;
  context.save();
  context.translate(x, y);
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(255, 255, 255, 0.18)';
  context.fillRect(4, 3, width - 8, 2);
  context.strokeStyle = 'rgba(255, 240, 106, 0.8)';
  context.lineWidth = 1.5;
  context.setLineDash([6, 4]);
  context.strokeRect(2.5, 2.5, width - 5, height - 5);
  context.setLineDash([]);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 17px Menlo, Consolas, monospace';
  context.lineWidth = 4;
  context.strokeStyle = '#000000';
  context.strokeText(`stan ${tile.idx}`, width / 2, 18);
  context.fillStyle = '#fff9a8';
  context.fillText(`stan ${tile.idx}`, width / 2, 18);
  context.font = 'bold 14px Menlo, Consolas, monospace';
  context.strokeText(`room ${tile.room}`, width / 2, 34);
  context.fillStyle = '#dcecff';
  context.fillText(`room ${tile.room}`, width / 2, 34);
  context.restore();
}

function createStanLabelBatch(stanLabels) {
  disposeStanLabelBatch();
  if (stanLabels.length === 0) return;
  const cols = Math.min(STAN_LABEL_ATLAS_COLS, stanLabels.length);
  const rows = Math.ceil(stanLabels.length / cols);
  const canvas2d = document.createElement('canvas');
  canvas2d.width = cols * STAN_LABEL_ATLAS_CELL_W;
  canvas2d.height = rows * STAN_LABEL_ATLAS_CELL_H;
  const context = canvas2d.getContext('2d');
  context.clearRect(0, 0, canvas2d.width, canvas2d.height);
  for (let i = 0; i < stanLabels.length; i++) {
    const label = stanLabels[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * STAN_LABEL_ATLAS_CELL_W;
    const y = row * STAN_LABEL_ATLAS_CELL_H;
    drawStanAtlasCell(context, label.userData.tile, x, y);
    label.userData.atlas = {
      u0: x / canvas2d.width,
      u1: (x + STAN_LABEL_ATLAS_CELL_W) / canvas2d.width,
      v0: 1 - ((y + STAN_LABEL_ATLAS_CELL_H) / canvas2d.height),
      v1: 1 - (y / canvas2d.height)
    };
  }

  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = 30;
  world.add(mesh);
  stanLabelBatch = { mesh, material, texture };
  rebuildStanLabelBatch(stanLabels);
}

function rebuildStanLabelBatch(stanLabels = labels.filter((label) => label.userData.kind === 'stan')) {
  if (!stanLabelBatch) return;
  const positions = [];
  const uvs = [];
  const indices = [];
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  let quad = 0;
  for (const label of stanLabels) {
    if (!label.userData.stanBatchVisible || !label.userData.atlas) continue;
    const halfWidth = label.scale.x / 2;
    const halfHeight = label.scale.y / 2;
    xAxis.set(1, 0, 0).applyQuaternion(label.quaternion).multiplyScalar(halfWidth);
    yAxis.set(0, 1, 0).applyQuaternion(label.quaternion).multiplyScalar(halfHeight);
    const p = label.position;
    positions.push(
      p.x - xAxis.x - yAxis.x, p.y - xAxis.y - yAxis.y, p.z - xAxis.z - yAxis.z,
      p.x + xAxis.x - yAxis.x, p.y + xAxis.y - yAxis.y, p.z + xAxis.z - yAxis.z,
      p.x + xAxis.x + yAxis.x, p.y + xAxis.y + yAxis.y, p.z + xAxis.z + yAxis.z,
      p.x - xAxis.x + yAxis.x, p.y - xAxis.y + yAxis.y, p.z - xAxis.z + yAxis.z
    );
    const { u0, u1, v0, v1 } = label.userData.atlas;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const base = quad * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    quad++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  stanLabelBatch.mesh.geometry.dispose();
  stanLabelBatch.mesh.geometry = geometry;
  stanLabelBatch.mesh.visible = quad > 0;
}

function disposeStanLabelBatch() {
  if (!stanLabelBatch) return;
  world.remove(stanLabelBatch.mesh);
  disposeObject(stanLabelBatch.mesh);
  stanLabelBatch = null;
}

function materializeLabel(label) {
  if (!label.userData.lazyStan || label.userData.mesh) return label.userData.mesh || label;
  const tile = label.userData.tile;
  const scale = label.userData.levelScale;
  const mesh = makeStanLabel(`stan ${tile.idx}\nroom ${tile.room}`, tile, scale, label.userData.tileMesh);
  mesh.position.copy(label.position);
  mesh.quaternion.copy(label.quaternion);
  mesh.scale.copy(label.scale);
  mesh.userData = label.userData;
  label.userData.mesh = mesh;
  world.add(mesh);
  return mesh;
}

function setLabelVisible(label, visible) {
  label.visible = visible;
  if (label.userData.mesh) label.userData.mesh.visible = visible;
}

function propLabelFace(box) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const flatProp = size.y < Math.min(size.x, size.z) * 0.35;
  if (flatProp) {
    return {
      normal: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(center.x, box.max.y, center.z),
      width: size.x,
      height: size.z
    };
  }

  const towardSpawn = spawnPosition()?.sub(center).normalize() || spawnLookDirection().multiplyScalar(-1);
  const faces = [
    {
      normal: new THREE.Vector3(1, 0, 0),
      center: new THREE.Vector3(box.max.x, center.y, center.z),
      width: size.z,
      height: size.y
    },
    {
      normal: new THREE.Vector3(-1, 0, 0),
      center: new THREE.Vector3(box.min.x, center.y, center.z),
      width: size.z,
      height: size.y
    },
    {
      normal: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(center.x, center.y, box.max.z),
      width: size.x,
      height: size.y
    },
    {
      normal: new THREE.Vector3(0, 0, -1),
      center: new THREE.Vector3(center.x, center.y, box.min.z),
      width: size.x,
      height: size.y
    },
    {
      normal: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(center.x, box.max.y, center.z),
      width: size.x,
      height: size.z,
      top: true
    }
  ];
  faces.sort((a, b) => {
    const scoreA = a.normal.dot(towardSpawn) + (a.top ? -0.35 : 0);
    const scoreB = b.normal.dot(towardSpawn) + (b.top ? -0.35 : 0);
    return scoreB - scoreA;
  });
  return faces[0];
}

function fitLabelToFace(label, face, maxWidth = 118, minWidth = 5) {
  const ratio = label.userData.labelRatio || (label.scale.y / label.scale.x);
  const padding = Math.max(2, Math.min(face.width, face.height) * PROP_LABEL_PADDING);
  const usableWidth = Math.max(0, face.width - padding * 2);
  const usableHeight = Math.max(0, face.height - padding * 2);
  const width = Math.max(minWidth, Math.min(maxWidth, usableWidth, usableHeight / ratio));
  label.scale.x = width;
  label.scale.y = width * ratio;
}

function makePropSurfaceLabel(text, box) {
  const face = propLabelFace(box);
  const label = makePlaneLabel(text, 'prop');
  label.position.copy(face.center).addScaledVector(face.normal, PROP_LABEL_SURFACE_OFFSET);
  label.quaternion.copy(labelQuaternionForPropSurface(face.normal));
  fitLabelToFace(label, face, 118, 5);
  return label;
}

function pointInProjectedTile(point, polygon, epsilon = 0.001) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const dx = xj - xi;
    const dy = yj - yi;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq > epsilon) {
      const t = Math.max(0, Math.min(1, ((point.x - xi) * dx + (point.y - yi) * dy) / lengthSq));
      const px = xi + t * dx;
      const py = yi + t * dy;
      const distSq = (point.x - px) ** 2 + (point.y - py) ** 2;
      if (distSq <= epsilon * epsilon) return true;
    }
    const crosses = ((yi > point.y) !== (yj > point.y))
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function rectInsideProjectedTile(width, height, polygon) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return [
    new THREE.Vector2(-halfWidth, -halfHeight),
    new THREE.Vector2(halfWidth, -halfHeight),
    new THREE.Vector2(halfWidth, halfHeight),
    new THREE.Vector2(-halfWidth, halfHeight)
  ].every((point) => pointInProjectedTile(point, polygon));
}

function fitStanLabelToTile(label, tile, scale) {
  const inverse = label.quaternion.clone().invert();
  const localPoints = tile.points.map((point) => (
    rawToWorld(point, scale).sub(label.position).applyQuaternion(inverse)
  ));
  const box = new THREE.Box3().setFromPoints(localPoints);
  const size = box.getSize(new THREE.Vector3());
  const ratio = label.userData.labelRatio || (label.scale.y / label.scale.x);
  const polygon = localPoints.map((point) => new THREE.Vector2(point.x, point.y));
  const padding = Math.max(3, Math.min(size.x, size.y) * STAN_LABEL_PADDING);
  const usableWidth = Math.max(0, size.x - padding * 2);
  const usableHeight = Math.max(0, size.y - padding * 2);
  const maxWidth = Math.min(88, usableWidth, usableHeight / ratio);
  let width = maxWidth;
  for (let i = 0; i < 20 && width > 0.5; i++) {
    if (rectInsideProjectedTile(width, width * ratio, polygon)) break;
    width *= 0.86;
  }
  width = Math.max(4, width);
  label.scale.x = width;
  label.scale.y = width * ratio;
}

function disposeObject(object) {
  for (const child of object.children || []) disposeObject(child);
  if (object.geometry) object.geometry.dispose();
  if (object.material) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.map) material.map.dispose();
      material.dispose();
    }
  }
}

function disposeLabels() {
  disposeStanLabelBatch();
  for (const label of labels) {
    if (label.userData?.mesh) {
      world.remove(label.userData.mesh);
      disposeObject(label.userData.mesh);
    }
    world.remove(label);
    disposeObject(label);
  }
}

function clearLevel() {
  clearLineLayers();
  disposeLabels();
  for (const object of [...tileMeshes, ...visualBgMeshes, ...barMeshes, ...propMeshes, ...guardMeshes, ...gapMarkers, ...roomSeamMeshes]) {
    world.remove(object);
    disposeObject(object);
  }
  tileMeshes = [];
  visualBgMeshes = [];
  barMeshes = [];
  propMeshes = [];
  guardMeshes = [];
  gapMarkers = [];
  roomSeamMeshes = [];
  labels = [];
  pickTargets = [];
  selected = null;
}

function populateRoomFilter() {
  const rooms = [...new Set(levelData.tiles.map((tile) => tile.room))].sort((a, b) => a - b);
  roomFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'all';
  roomFilter.appendChild(all);
  for (const room of rooms) {
    const option = document.createElement('option');
    option.value = String(room);
    option.textContent = String(room);
    roomFilter.appendChild(option);
  }
}

async function loadLevel(level) {
  const serial = ++loadSerial;
  clearLevel();
  roomFilter.value = '';
  tileSearch.value = '';
  stats.textContent = `Loading ${level}.pack.gz`;
  const pack = await loadLevelPack(level);
  if (serial !== loadSerial) return false;
  if (!pack?.levelData) throw new Error(`missing ${level}`);
  levelData = hydrateLevelData(pack.levelData);
  if (serial !== loadSerial) return false;
  populateRoomFilter();
  const scale = getWorldScale(levelData);
  const bounds = new THREE.Box3();
  const tileByIdx = new Map(levelData.tiles.map((tile) => [tile.idx, tile]));

  for (const tile of levelData.tiles) {
    if (tile.pointCount < 3 || tile.points.length < 3) continue;
    const geometry = makeGeometry(tile, scale);
    const material = new THREE.MeshBasicMaterial({
      color: getTileColor(tile),
      side: doubleSideToggle.checked ? THREE.DoubleSide : THREE.FrontSide,
      transparent: false,
      opacity: 1,
      depthWrite: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.tile = tile;
    world.add(mesh);
    tileMeshes.push(mesh);
    bounds.expandByObject(mesh);

    if (tileTouchesOtherRoom(tile, tileByIdx)) {
      const seamMesh = new THREE.Mesh(
        makeRoomSeamOverlayGeometry(tile, scale),
        new THREE.MeshBasicMaterial({
          color: 0xff1e2f,
          transparent: true,
          opacity: 0.68,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4
        })
      );
      seamMesh.userData.roomSeamTile = tile;
      world.add(seamMesh);
      roomSeamMeshes.push(seamMesh);
    }

    labels.push(makeLazyStanLabel(tile, scale, mesh));
  }
  createStanLabelBatch(labels.filter((label) => label.userData.kind === 'stan'));

  const stanBounds = bounds.clone();

  const props = addSetupProps(levelData);
  if (!props.bounds.isEmpty()) bounds.union(props.bounds);

  const guards = addGuards(levelData);
  if (!guards.bounds.isEmpty()) bounds.union(guards.bounds);

  const bars = await loadBars(levelData, pack.bars);
  if (serial !== loadSerial) return false;
  if (!bars.bounds.isEmpty()) bounds.union(bars.bounds);

  levelBounds = stanBounds.clone();
  const startedAtSpawn = focusStartView();
  if (!startedAtSpawn) focusBounds(levelBounds);
  applyBackground();
  applyVisibility();
  updateStats(bounds);
  if (!startedAtSpawn) selectedTile.textContent = 'No tile selected';
  loadVisualBg(pack, serial).then((visual) => {
    if (serial !== loadSerial) return;
    if (!visual.bounds.isEmpty()) bounds.union(visual.bounds);
    applyVisibility();
    updateStats(bounds);
  });
  return startedAtSpawn;
}

function focusBounds(bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const radius = Math.max(1, size.length() * 0.5);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 0.72;
  const viewDir = new THREE.Vector3(0.26, 0.5, 0.86).normalize();
  camera.near = Math.max(0.5, maxSize / 200000);
  camera.far = Math.max(12000, maxSize * 12);
  camera.updateProjectionMatrix();
  camera.position.copy(center).addScaledVector(viewDir, distance);
  lookAt(center);
  flySpeed = Math.max(42, maxSize * 0.17);
  cameraVelocity.set(0, 0, 0);
  marker.position.copy(center);
  grid.position.set(center.x, bounds.min.y - maxSize * 0.04, center.z);
  grid.scale.setScalar(Math.max(1, maxSize / 5000));
  requestDraw();
}

function focusStartView() {
  const spawn = levelData?.intro_spawnpoints?.find((item) => item.pos);
  if (!spawn) return false;
  const pos = new THREE.Vector3(spawn.pos[0], spawn.pos[1] + 76, spawn.pos[2]);
  const look = new THREE.Vector3(spawn.look?.[0] ?? 0, spawn.look?.[1] ?? 0, spawn.look?.[2] ?? -1);
  if (look.lengthSq() < 0.001) look.set(0, 0, -1);
  look.normalize();
  camera.position.copy(pos);
  camera.near = 0.5;
  camera.far = Math.max(12000, (levelBounds?.getSize(new THREE.Vector3()).length() || 12000) * 8);
  camera.updateProjectionMatrix();
  lookAt(pos.clone().add(look));
  flySpeed = Math.max(260, (levelBounds?.getSize(new THREE.Vector3()).length() || 30000) * 0.035);
  cameraVelocity.set(0, 0, 0);
  marker.position.set(spawn.pos[0], spawn.pos[1], spawn.pos[2]);
  selected = { kind: 'spawn', index: spawn.index };
  selectedTile.textContent = [
    `spawn ${spawn.index}  pad ${spawn.pad}  set ${spawn.set}`,
    `pos ${spawn.pos.map((value) => value.toFixed(2)).join(', ')}`,
    `look ${spawn.look.map((value) => value.toFixed(4)).join(', ')}`
  ].join('\n');
  requestDraw();
  return true;
}

function visibleBounds() {
  const bounds = new THREE.Box3();
  for (const object of tileMeshes) {
    if (object.visible) bounds.expandByObject(object);
  }
  if (!bounds.isEmpty()) return bounds;
  for (const object of [...barMeshes, ...propMeshes]) {
    if (object.visible) bounds.expandByObject(object);
  }
  return bounds;
}

function focusVisibleBounds() {
  const bounds = visibleBounds();
  if (!bounds.isEmpty()) focusBounds(bounds);
}

function updateStats(bounds) {
  const rooms = new Set(levelData.tiles.map((tile) => tile.room));
  const size = bounds.getSize(new THREE.Vector3());
  const visibleTiles = tileMeshes.filter((mesh) => mesh.visible).length;
  stats.textContent = [
    `tiles ${levelData.tiles.length}`,
    `visible ${visibleTiles}`,
    `bars ${barMeshes.length}`,
    `props ${propMeshes.length}`,
    `guards ${guardMeshes.length}`,
    `room seams ${roomSeamMeshes.length}`,
    `rooms ${rooms.size}`,
    `world scale ${getWorldScale(levelData).toFixed(6)}`,
    `size ${size.x.toFixed(1)} / ${size.y.toFixed(1)} / ${size.z.toFixed(1)}`,
    `camera far ${camera.far.toFixed(0)}`,
    'Drag mouse to look',
    'WASD move, QE vertical, Shift fast'
  ].join('\n');
}

function updateColors() {
  for (const mesh of tileMeshes) mesh.material.color.copy(getTileColor(mesh.userData.tile));
  requestDraw();
}

function applyVisibility() {
  const roomText = roomFilter.value.trim();
  const wantedRoom = roomText === '' ? null : Number(roomText);
  const selectedOnly = labelMode.value === 'selected';
  const showAllLabels = labelMode.value === 'all';

  for (let i = 0; i < tileMeshes.length; i++) {
    const tile = tileMeshes[i].userData.tile;
    const visible = wantedRoom === null || tile.room === wantedRoom;
    tileMeshes[i].visible = visible;
    tileMeshes[i].material.side = doubleSideToggle.checked ? THREE.DoubleSide : THREE.FrontSide;
  }
  for (const mesh of roomSeamMeshes) {
    mesh.visible = false;
  }
  rebuildLineLayers();
  if (edgeLine) edgeLine.visible = edgeToggle.checked;
  if (boundaryLine) boundaryLine.visible = boundaryToggle.checked;
  if (seamLine) seamLine.visible = boundaryToggle.checked;
  for (const label of labels) {
    if (label.userData.kind === 'stan') {
      const tile = label.userData.tile;
      const visible = wantedRoom === null || tile.room === wantedRoom;
      label.userData.wantsVisible = visible && (showAllLabels || (selectedOnly && selected?.kind === 'stan' && selected.idx === tile.idx));
    } else if (label.userData.kind === 'bar') {
      const bar = label.userData.bar;
      label.userData.wantsVisible = barsToggle.checked && (showAllLabels || (selectedOnly && selected?.kind === 'bar' && selected.index === bar.index));
    } else if (label.userData.kind === 'prop') {
      const prop = label.userData.prop;
      label.userData.wantsVisible = barsToggle.checked && labelMode.value !== 'none'
        && (showAllLabels || selectedOnly || (selected?.kind === 'prop' && selected.index === prop.index));
    }
  }
  updateLabelCull(true);
  for (const mesh of barMeshes) mesh.visible = barsToggle.checked;
  for (const mesh of propMeshes) mesh.visible = barsToggle.checked && !mesh.userData.mergedIntoBar;
  for (const mesh of guardMeshes) mesh.visible = guardsToggle.checked;
  for (const mesh of gapMarkers) mesh.visible = false;
  for (const mesh of visualBgMeshes) mesh.visible = visualBgToggle.checked;
  pickTargets = [
    ...tileMeshes.filter((mesh) => mesh.visible),
    ...barMeshes.filter((mesh) => mesh.visible),
    ...propMeshes.filter((mesh) => mesh.visible),
    ...guardMeshes.filter((mesh) => mesh.visible)
  ];
  marker.visible = markerToggle.checked;
  if (levelData && levelBounds) updateStats(levelBounds);
  requestDraw();
}

function updateLabelCull(force = false, allowMaterialize = true) {
  if (!force && labelCullElapsed < LABEL_CULL_INTERVAL) return;
  labelCullElapsed = 0;
  const cam = camera.position;
  let stanBatchDirty = false;
  for (const label of labels) {
    if (!label.userData.wantsVisible) {
      if (label.userData.kind === 'stan' && label.userData.stanBatchVisible) {
        label.userData.stanBatchVisible = false;
        stanBatchDirty = true;
      }
      setLabelVisible(label, false);
      continue;
    }
    const selectedLabel = selected
      && ((label.userData.kind === 'stan' && selected.kind === 'stan' && selected.idx === label.userData.tile.idx)
        || (label.userData.kind === 'prop' && selected.kind === 'prop' && selected.index === label.userData.prop.index)
        || (label.userData.kind === 'bar' && selected.kind === 'bar' && selected.index === label.userData.bar.index));
    if (label.userData.kind === 'stan') {
      if (!label.userData.stanBatchVisible) {
        label.userData.stanBatchVisible = true;
        stanBatchDirty = true;
      }
      label.visible = true;
      continue;
    }
    if (selectedLabel) {
      materializeLabel(label).visible = true;
      label.visible = true;
      continue;
    }
    const visible = cam.distanceToSquared(label.position) <= PROP_LABEL_DISTANCE * PROP_LABEL_DISTANCE;
    if (visible && (allowMaterialize || label.userData.mesh || !label.userData.lazyStan)) {
      materializeLabel(label).visible = true;
      setLabelVisible(label, true);
    } else {
      setLabelVisible(label, false);
    }
  }
  if (stanBatchDirty) rebuildStanLabelBatch();
}

function applyBackground() {
  const bg = BACKGROUNDS[bgMode.value] || BACKGROUNDS.magenta;
  renderer.setClearColor(bg.clear);
  if (edgeLine) edgeLine.material.color.setHex(bg.edge);
  grid.material.color.setHex(bg.grid);
  grid.material.opacity = bg.gridOpacity;
  requestDraw();
}

function topDownView() {
  if (!levelBounds) return;
  const center = levelBounds.getCenter(new THREE.Vector3());
  const size = levelBounds.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  camera.near = Math.max(0.5, maxSize / 200000);
  camera.far = Math.max(12000, maxSize * 12);
  camera.updateProjectionMatrix();
  camera.position.set(center.x, levelBounds.max.y + maxSize * 1.25, center.z);
  yaw = 0;
  pitch = -Math.PI / 2 + 0.02;
  applyCameraRotation();
  requestDraw();
}

function selectTile(tile) {
  selected = { kind: 'stan', idx: tile.idx };
  for (const mesh of tileMeshes) mesh.material.opacity = 1;
  for (const mesh of barMeshes) mesh.material.opacity = BAR_OPACITY;
  selectedTile.textContent = [
    `stan ${tile.idx}  room ${tile.room}  id ${tile.id}`,
    `points ${tile.pointCount}  special ${tile.special}  rgb ${tile.r},${tile.g},${tile.b}`,
    `neighbors ${tile.neighbors.join(', ')}`
  ].join('\n');
  labelMode.value = labelMode.value === 'none' ? 'selected' : labelMode.value;
  applyVisibility();
}

function selectBar(bar) {
  selected = { kind: 'bar', index: bar.index };
  resetSelectionOpacity();
  for (const mesh of barMeshes) {
    mesh.material.opacity = mesh.userData.bar.index === bar.index ? 0.96 : 0.58;
  }
  const pad = bar.pad?.pos ? bar.pad.pos.map((value) => value.toFixed(2)).join(', ') : 'none';
  selectedTile.textContent = [
    `${bar.object ? 'prop' : 'bar'} ${bar.index}  model ${bar.model}  ${bar.name}`,
    `type ${bar.typename}  pad ${bar.object?.pad ?? 'none'}  pos ${pad}`,
    `y ${bar.ymin.toFixed(2)}..${bar.ymax.toFixed(2)}  points ${bar.points.length}`
  ].join('\n');
  labelMode.value = labelMode.value === 'none' ? 'selected' : labelMode.value;
  applyVisibility();
}

function selectProp(prop) {
  selected = { kind: 'prop', index: prop.index };
  resetSelectionOpacity();
  for (const mesh of propMeshes) {
    mesh.material.opacity = mesh.userData.prop.index === prop.index ? 0.96 : 0.62;
  }
  const pad = prop.padData?.pos ? prop.padData.pos.map((value) => value.toFixed(2)).join(', ') : 'none';
  const flagNotes = propHasFlag(prop, PROPFLAG_RENDERPOSTBG) ? '  auto fall to ground' : '';
  selectedTile.textContent = [
    `prop ${prop.index}  model ${prop.model}  ${prop.name}`,
    `type ${prop.typename}  pad ${prop.pad ?? 'none'}  pos ${pad}`,
    `flags ${prop.flags ?? 0}  flags2 ${prop.flags2 ?? 0}${flagNotes}`,
    `placement ${prop.placementMode ?? 'unknown'}`
  ].join('\n');
  labelMode.value = labelMode.value === 'none' ? 'selected' : labelMode.value;
  applyVisibility();
}

function selectGuard(guard) {
  selected = { kind: 'guard', index: guard.index };
  resetSelectionOpacity();
  for (const group of guardMeshes) {
    const selectedGuard = group.userData.guard.index === guard.index;
    for (const child of group.children) {
      if (child.material?.opacity !== undefined) child.material.opacity = selectedGuard ? 1 : 0.44;
    }
  }
  const pos = guard.pos ? guard.pos.map((value) => value.toFixed(2)).join(', ') : 'none';
  const projected = guard.projectedPos ? guard.projectedPos.map((value) => value.toFixed(2)).join(', ') : 'none';
  const tile = guard.projectedTile === null ? 'none' : `${guard.projectedTile} room ${guard.projectedRoom}`;
  const dy = guard.projectedDy === null || guard.projectedDy === undefined ? 'none' : guard.projectedDy.toFixed(2);
  selectedTile.textContent = [
    `guard ${guard.index}  chr ${guard.chrnum}  pad ${guard.pad}`,
    `pos ${pos}`,
    `projected ${projected}  tile ${tile}  raw-floor ${dy}`,
    `body ${guard.body}  head ${guard.head}  ai ${guard.ailist}`,
    `health ${guard.health}  reaction ${guard.reaction}  flags ${guard.bitflags}`
  ].join('\n');
  applyVisibility();
}

function selectGap(gap) {
  selected = gap.kind === 'tile-gap'
    ? { kind: 'gap', stanA: gap.stanA.idx, stanB: gap.stanB.idx }
    : { kind: 'gap', bar: gap.bar.index, stan: gap.stan.idx };
  resetSelectionOpacity();
  marker.position.set((gap.from.x + gap.to.x) * 0.5, gap.y, (gap.from.z + gap.to.z) * 0.5);
  if (gap.kind === 'tile-gap') {
    selectedTile.textContent = [
      `tile gap ${gap.distance.toFixed(2)}  overlap ${gap.overlap.toFixed(2)}`,
      `stan ${gap.stanA.idx} room ${gap.stanA.room} edge ${gap.stanA.edge}`,
      `stan ${gap.stanB.idx} room ${gap.stanB.room} edge ${gap.stanB.edge}`,
      `from ${gap.from.x.toFixed(2)}, ${gap.from.z.toFixed(2)}  to ${gap.to.x.toFixed(2)}, ${gap.to.z.toFixed(2)}`
    ].join('\n');
    applyVisibility();
    return;
  }
  selectedTile.textContent = [
    `gap ${gap.distance.toFixed(2)}`,
    `${gap.bar.isDoor ? 'door' : 'prop'} ${gap.bar.index}  model ${gap.bar.model}  ${gap.bar.name}`,
    `stan ${gap.stan.idx}  room ${gap.stan.room}  neighbor ${gap.stan.neighborIdx}`,
    `from ${gap.from.x.toFixed(2)}, ${gap.from.z.toFixed(2)}  to ${gap.to.x.toFixed(2)}, ${gap.to.z.toFixed(2)}`
  ].join('\n');
  applyVisibility();
}

function resetSelectionOpacity() {
  for (const mesh of tileMeshes) mesh.material.opacity = 1;
  for (const mesh of barMeshes) mesh.material.opacity = BAR_OPACITY;
  for (const mesh of propMeshes) mesh.material.opacity = PROP_OPACITY;
  for (const group of guardMeshes) {
    for (const child of group.children) {
      if (child.material?.opacity !== undefined) child.material.opacity = GUARD_OPACITY;
    }
  }
  requestDraw();
}

function focusTile(idx) {
  const mesh = tileMeshes.find((item) => item.userData.tile.idx === idx);
  if (!mesh) return;
  const center = centroid(mesh.userData.tile, getWorldScale(levelData));
  const size = levelBounds?.getSize(new THREE.Vector3()) || new THREE.Vector3(1000, 1000, 1000);
  const maxSize = Math.max(size.x, size.y, size.z);
  marker.position.copy(center);
  camera.near = Math.max(0.5, maxSize / 200000);
  camera.far = Math.max(12000, maxSize * 8);
  camera.updateProjectionMatrix();
  camera.position.set(center.x, center.y + 350, center.z + 550);
  lookAt(center);
  selectTile(mesh.userData.tile);
}

function makeMarker() {
  const group = new THREE.Group();
  const materialX = new THREE.LineBasicMaterial({ color: 0xff4056 });
  const materialY = new THREE.LineBasicMaterial({ color: 0x58d55f });
  const materialZ = new THREE.LineBasicMaterial({ color: 0x52a7ff });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-18, 0, 0), new THREE.Vector3(18, 0, 0)
  ]), materialX));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -18, 0), new THREE.Vector3(0, 18, 0)
  ]), materialY));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, -18), new THREE.Vector3(0, 0, 18)
  ]), materialZ));
  return group;
}

function markCoordinate(text) {
  const nums = text.split(/[,\s/]+/).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return;
  const [x, yOrZ, maybeZ] = nums;
  const y = nums.length >= 3 ? yOrZ : marker.position.y;
  const z = nums.length >= 3 ? maybeZ : yOrZ;
  marker.position.set(x, y, z);
  camera.position.set(x, y + 80, z + 120);
  lookAt(marker.position);
  requestDraw();
}

function applyCameraRotation() {
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  requestDraw();
}

function lookAt(target) {
  const dir = new THREE.Vector3().subVectors(target, camera.position).normalize();
  yaw = Math.atan2(-dir.x, -dir.z);
  pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  applyCameraRotation();
}

function smoothStep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function requestDraw() {
  renderDirty = true;
}

function hasMovementInput() {
  return movementKeys.some((key) => keys.has(key));
}

function updateCamera(delta) {
  const input = cameraInput.set(0, 0, 0);
  if (keys.has('KeyW')) input.z -= 1;
  if (keys.has('KeyS')) input.z += 1;
  if (keys.has('KeyA')) input.x -= 1;
  if (keys.has('KeyD')) input.x += 1;
  if (keys.has('KeyQ')) input.y -= 1;
  if (keys.has('KeyE')) input.y += 1;
  const hasInput = input.lengthSq() > 0;
  if (hasInput) {
    const now = performance.now() / 1000;
    let heldFor = 0;
    for (const key of movementKeys) {
      if (keys.has(key)) heldFor = Math.max(heldFor, now - (keyDownAt.get(key) ?? now));
    }
    const ramp = smoothStep(heldFor / 1.25);
    const fineToFull = 0.22 + ramp * 0.78;
    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1;
    input.normalize().multiplyScalar(flySpeed * fineToFull * shift);
  }

  camera.getWorldDirection(cameraForward).normalize();
  cameraRight.crossVectors(cameraForward, camera.up).normalize();
  const targetVelocity = cameraTargetVelocity
    .set(0, 0, 0)
    .addScaledVector(cameraRight, input.x)
    .addScaledVector(cameraForward, -input.z);
  targetVelocity.y += input.y;
  const blend = 1 - Math.exp(-delta * (hasInput ? 2.8 : 5.2));
  cameraVelocity.lerp(targetVelocity, blend);
  if (!hasInput && cameraVelocity.length() < CAMERA_STOP_SPEED) {
    cameraVelocity.set(0, 0, 0);
  }
  const beforeX = camera.position.x;
  const beforeY = camera.position.y;
  const beforeZ = camera.position.z;
  camera.position.addScaledVector(cameraVelocity, delta);
  const dx = camera.position.x - beforeX;
  const dy = camera.position.y - beforeY;
  const dz = camera.position.z - beforeZ;
  return hasInput || (dx * dx + dy * dy + dz * dz) > CAMERA_MOVE_EPS_SQ;
}

function dataObjectForHit(object) {
  let current = object;
  while (current) {
    if (current.userData.gap || current.userData.tile || current.userData.bar || current.userData.prop || current.userData.guard) return current;
    current = current.parent;
  }
  return object;
}

function inspectAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(pickTargets, true);
  if (hits.length > 0) {
    marker.position.copy(hits[0].point);
    const dataObject = dataObjectForHit(hits[0].object);
    if (dataObject.userData.gap) {
      selectGap(dataObject.userData.gap);
    } else if (dataObject.userData.tile) {
      selectTile(dataObject.userData.tile);
    } else if (dataObject.userData.bar) {
      selectBar(dataObject.userData.bar);
    } else if (dataObject.userData.prop) {
      selectProp(dataObject.userData.prop);
    } else if (dataObject.userData.guard) {
      selectGuard(dataObject.userData.guard);
    }
  } else {
    resetSelectionOpacity();
    selected = null;
    selectedTile.textContent = 'No tile selected';
    applyVisibility();
  }
}

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const moved = updateCamera(delta);
  if (moved) {
    labelCullElapsed += delta;
    updateLabelCull(false, false);
    requestDraw();
    wasMoving = true;
  } else if (wasMoving) {
    updateLabelCull(true, true);
    requestDraw();
    wasMoving = false;
  }
  if (renderDirty) {
    const p = camera.position;
    cameraReadout.textContent = `cam ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
    renderer.render(scene, camera);
    renderDirty = false;
  }
  requestAnimationFrame(render);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  requestDraw();
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (!event.repeat && movementKeys.includes(event.code)) {
    keyDownAt.set(event.code, performance.now() / 1000);
  }
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
  keyDownAt.delete(event.code);
  if (movementKeys.includes(event.code) && !hasMovementInput()) {
    cameraVelocity.set(0, 0, 0);
    updateLabelCull(true, true);
    requestDraw();
    wasMoving = false;
  }
});

canvas.addEventListener('mousedown', () => {
  dragging = true;
  dragMoved = false;
});

window.addEventListener('mousemove', (event) => {
  if (!dragging) return;
  dragMoved = dragMoved || Math.abs(event.movementX) + Math.abs(event.movementY) > 2;
  yaw -= event.movementX * 0.00335;
  pitch -= event.movementY * 0.00335;
  pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
  applyCameraRotation();
});

window.addEventListener('mouseup', (event) => {
  if (!dragging) return;
  dragging = false;
  if (!dragMoved) inspectAt(event.clientX, event.clientY);
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  camera.getWorldDirection(cameraForward);
  const rawDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
  const distance = Math.max(-WHEEL_DOLLY_MAX, Math.min(WHEEL_DOLLY_MAX, rawDelta * WHEEL_DOLLY_BASE));
  camera.position.addScaledVector(cameraForward, distance);
  cameraVelocity.multiplyScalar(0.35);
  updateLabelCull(true);
  requestDraw();
}, { passive: false });

levelSelect.addEventListener('change', async () => {
  await loadLevel(levelSelect.value);
});
startView.addEventListener('click', () => focusStartView());
resetView.addEventListener('click', () => {
  if (levelBounds) focusBounds(levelBounds);
});
topView.addEventListener('click', topDownView);
colorMode.addEventListener('change', updateColors);
labelMode.addEventListener('change', applyVisibility);
bgMode.addEventListener('change', applyBackground);
roomFilter.addEventListener('change', () => {
  applyVisibility();
  focusVisibleBounds();
});
edgeToggle.addEventListener('change', applyVisibility);
boundaryToggle.addEventListener('change', applyVisibility);
visualBgToggle.addEventListener('change', applyVisibility);
barsToggle.addEventListener('change', applyVisibility);
guardsToggle.addEventListener('change', applyVisibility);
doubleSideToggle.addEventListener('change', applyVisibility);
markerToggle.addEventListener('change', applyVisibility);
goTile.addEventListener('click', () => focusTile(Number(tileSearch.value)));
goCoord.addEventListener('click', () => markCoordinate(coordSearch.value));
tileSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') focusTile(Number(tileSearch.value));
});
coordSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') markCoordinate(coordSearch.value);
});

resize();
applyBackground();
await loadLevel(levelSelect.value);
render();
