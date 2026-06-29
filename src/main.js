import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./styles.css";

const TAU = Math.PI * 2;
const GALACTIC_PERIOD_DAYS = 230_000_000 * 365.25;
const GALACTIC_ORBIT_RADIUS = 110;
const SOLAR_VELOCITY_KM_PER_SECOND = 220;
const PAYLOAD_SIZE_METERS = 10;
const PAYLOAD_MASS_TONS = 10;
const PAYLOAD_RENDER_SIZE = 0.42;
const PAYLOAD_TRAIL_POINTS = 980;
const PAYLOAD_ROUTE_POINTS = 320;
const PAYLOAD_ORBIT_POINTS = 160;
const MAX_GRAVITY_LABELS = 8;
const SWINGBY_TRAJECTORY_COLOR = "#ff4a45";
const SWINGBY_ORBIT_COLOR = "#ff7a66";
const SUN_AVOIDANCE_MARGIN = 1.18;
const BODY_AVOIDANCE_MARGIN = 0.28;
const LAUNCH_CLEARANCE_PROGRESS = 0.045;
const TARGET_INSERTION_CLEARANCE_PROGRESS = 0.012;
const TRANSFER_CLEARANCE_SAMPLES = 160;
const MAX_TRANSFER_TURN_SAMPLES = 96;

const canvas = document.querySelector("#scene");
const speedInput = document.querySelector("#speedInput");
const speedStepButton = document.querySelector("#speedStepButton");
const playButton = document.querySelector("#playButton");
const swingbyButton = document.querySelector("#swingbyButton");
const destinationSelect = document.querySelector("#destinationSelect");
const viewModeSelect = document.querySelector("#viewMode");
const gravityToggle = document.querySelector("#gravityToggle");
const advancedControls = document.querySelector("#advancedControls");
const elapsedTime = document.querySelector("#elapsedTime");
const galacticAngleReadout = document.querySelector("#galacticAngle");
const payloadStatus = document.querySelector("#payloadStatus");
const mobilePortraitQuery = window.matchMedia("(max-width: 720px) and (orientation: portrait)");
const mobileLandscapeQuery = window.matchMedia("(max-height: 520px) and (orientation: landscape)");
let viewportMode = getViewportMode();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(getRendererPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#050506");
scene.fog = new THREE.FogExp2("#050506", 0.0045);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 1300);
camera.position.set(96, 58, 132);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 18;
controls.maxDistance = 320;
controls.target.set(45, 0, 2);

scene.add(new THREE.AmbientLight("#93a7c8", 0.46));

const galaxyCoreLight = new THREE.PointLight("#ffd38a", 2.2, 240, 1.7);
galaxyCoreLight.position.set(0, 0, 0);
scene.add(galaxyCoreLight);

const sunLight = new THREE.PointLight("#fff0b8", 5.8, 95, 1.45);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);

const solarSystem = new THREE.Group();
scene.add(solarSystem);
solarSystem.add(sunLight);

const gravityFields = [];
const labelSprites = [];
const bodyHandles = [];
const payloadTrailPositions = new Float32Array(PAYLOAD_TRAIL_POINTS * 3);
const payloadRoutePositions = new Float32Array(PAYLOAD_ROUTE_POINTS * 3);
const payloadOrbitPositions = new Float32Array(PAYLOAD_ORBIT_POINTS * 3);
const galaxyObjects = new THREE.Group();
scene.add(galaxyObjects);

let simulationDays = 0;
let speedMultiplier = Number(speedInput.value);
let paused = false;
let viewMode = viewModeSelect.value;
let lastFrameSolarPosition = new THREE.Vector3();
let diagnosticsAccumulator = 0;

const payloadState = {
  active: false,
  elapsed: 0,
  phase: "idle",
  progress: 0,
  targetKey: "saturn",
  targetName: "토성",
  nearestBody: "-",
  missionStartDays: 0,
  missionArrivalDays: 0,
  missionClockDays: 0,
  transferDays: 0,
  orbitRadius: 5,
  orbitStartDays: 0,
  orbitPeriodDays: 1,
  arrivalSpeedPerDay: 0,
  orbitPhase: 0,
  arrivalOrbitPhase: 0,
  insertionTurnAngle: 0,
  maxRouteTurnAngle: 0,
  loadIndex: 0,
  useBodyAvoidanceArc: false,
  useSunAvoidanceArc: false,
  enforceBodyClearance: false,
  sunClearance: 0,
  sunAvoidanceRadius: 0,
  bodyClearance: 0,
  bodyClearanceMargin: 0,
  bodyAvoidanceRadius: 0,
  bodyClearanceKey: "-",
  bodyClearanceName: "-",
  gravityReadings: [],
  lastStepDistance: 0,
  transitionStepDistance: 0,
  trailCount: 0,
  trailDistanceGate: new THREE.Vector3(),
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  startPosition: new THREE.Vector3(),
  startTangent: new THREE.Vector3(),
  arrivalPosition: new THREE.Vector3(),
  arrivalBodyPosition: new THREE.Vector3(),
  arrivalOffset: new THREE.Vector3(),
  arrivalTangent: new THREE.Vector3(),
  sunAvoidancePoint: new THREE.Vector3(),
  sunAvoidanceTangent: new THREE.Vector3(),
  avoidanceSplitT: 0.5,
  controlA: new THREE.Vector3(),
  controlB: new THREE.Vector3(),
  controlC: new THREE.Vector3(),
  controlD: new THREE.Vector3(),
  payload: null,
  trail: null,
  route: null,
  targetOrbit: null,
  gravityLabelGroup: null,
  gravityLabels: [],
};

const toonGradient = createToonGradientTexture();

const bodies = [
  {
    key: "sun",
    name: "태양",
    radius: 4.8,
    distance: 0,
    orbitalPeriod: 1,
    rotationPeriod: 26,
    massEarth: 333000,
    color: "#ffb13b",
    textureKind: "sun",
    gridColor: "#ffbd57",
    emissive: "#ff9f1f",
  },
  {
    key: "mercury",
    name: "수성",
    radius: 0.46,
    distance: 8,
    orbitalPeriod: 87.969,
    rotationPeriod: 58.646,
    massEarth: 0.055,
    color: "#b9aa92",
    textureKind: "crater",
    gridColor: "#b9aa92",
  },
  {
    key: "venus",
    name: "금성",
    radius: 0.76,
    distance: 10.6,
    orbitalPeriod: 224.701,
    rotationPeriod: -243.025,
    massEarth: 0.815,
    color: "#d7b36b",
    textureKind: "cloudy",
    gridColor: "#d7b36b",
  },
  {
    key: "earth",
    name: "지구",
    radius: 0.84,
    distance: 13.5,
    orbitalPeriod: 365.256,
    rotationPeriod: 0.997,
    massEarth: 1,
    color: "#4b9ce6",
    textureKind: "earth",
    gridColor: "#73e0d1",
  },
  {
    key: "mars",
    name: "화성",
    radius: 0.62,
    distance: 16.8,
    orbitalPeriod: 686.98,
    rotationPeriod: 1.026,
    massEarth: 0.107,
    color: "#cf6845",
    textureKind: "rust",
    gridColor: "#ef8c58",
  },
  {
    key: "jupiter",
    name: "목성",
    radius: 2.34,
    distance: 22.8,
    orbitalPeriod: 4332.59,
    rotationPeriod: 0.414,
    massEarth: 317.8,
    color: "#d8a76d",
    textureKind: "gas",
    gridColor: "#f0c884",
  },
  {
    key: "saturn",
    name: "토성",
    radius: 2.04,
    distance: 29.3,
    orbitalPeriod: 10759.22,
    rotationPeriod: 0.444,
    massEarth: 95.2,
    color: "#e1c381",
    textureKind: "bands",
    gridColor: "#e9d9a3",
    ring: { inner: 2.52, outer: 4.36, color: "#e6d2a1", opacity: 0.58 },
  },
  {
    key: "uranus",
    name: "천왕성",
    radius: 1.28,
    distance: 35.2,
    orbitalPeriod: 30688.5,
    rotationPeriod: -0.718,
    massEarth: 14.5,
    color: "#8fd3cf",
    textureKind: "ice",
    gridColor: "#9be4de",
    ring: { inner: 1.62, outer: 2.05, color: "#b8eee9", opacity: 0.28 },
  },
  {
    key: "neptune",
    name: "해왕성",
    radius: 1.25,
    distance: 40.2,
    orbitalPeriod: 60182,
    rotationPeriod: 0.671,
    massEarth: 17.1,
    color: "#456de4",
    textureKind: "storm",
    gridColor: "#6f8cff",
  },
];

buildGalaxy();
buildSolarSystem();
buildSwingbyPayload();
setViewMode(viewMode);
applyViewportMode(true);

function setSpeedMultiplier(value) {
  const numericValue = Number(value);
  speedMultiplier = Number.isFinite(numericValue)
    ? THREE.MathUtils.clamp(numericValue, 0, 1_000_000_000)
    : 0;
  speedInput.value = String(speedMultiplier);
}

document.querySelectorAll(".preset-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (!button.dataset.speed) {
      return;
    }
    setSpeedMultiplier(button.dataset.speed);
  });
});

speedStepButton.addEventListener("click", () => {
  setSpeedMultiplier(speedMultiplier + 10);
});

speedInput.addEventListener("input", () => {
  const value = Number(speedInput.value);
  speedMultiplier = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1_000_000_000) : 0;
});

playButton.addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    clearSwingbyPayload();
  }
  playButton.textContent = paused ? "재생" : "정지";
  playButton.setAttribute("aria-label", paused ? "재생" : "일시정지");
});

swingbyButton.addEventListener("click", () => {
  launchSwingbyPayload();
});

destinationSelect.addEventListener("change", () => {
  payloadState.targetKey = destinationSelect.value;
  const target = getBodyHandle(payloadState.targetKey);
  payloadState.targetName = target?.body.name ?? "목적지";
  if (!payloadState.active) {
    updatePayloadReadout();
  }
});

viewModeSelect.addEventListener("change", () => {
  setViewMode(viewModeSelect.value);
});

gravityToggle.addEventListener("change", () => {
  gravityFields.forEach((field) => {
    field.visible = gravityToggle.checked;
  });
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = getCameraFov();
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getRendererPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyViewportMode(false);
});

[mobilePortraitQuery, mobileLandscapeQuery].forEach((query) => {
  const handleQueryChange = () => {
    applyViewportMode(true);
  };
  if (query.addEventListener) {
    query.addEventListener("change", handleQueryChange);
  } else {
    query.addListener(handleQueryChange);
  }
});

const clock = new THREE.Clock();
let lastRenderedAt = 0;

function renderFrame() {
  const delta = Math.min(clock.getDelta(), 0.18);

  if (!paused) {
    advanceSimulationClock(delta);
  }

  updateSolarSystem();
  updateSwingbyPayload(delta);
  updateCameraTarget();
  updateLabels();
  updateReadout();

  controls.update();
  renderer.render(scene, camera);

  diagnosticsAccumulator += delta;
  if (diagnosticsAccumulator > 0.25) {
    diagnosticsAccumulator = 0;
    updateCanvasDiagnostics();
  }
  lastRenderedAt = window.performance.now();
}

function requestNextFrame() {
  renderFrame();
  window.requestAnimationFrame(requestNextFrame);
}

renderFrame();
window.requestAnimationFrame(requestNextFrame);
window.setInterval(() => {
  if (window.performance.now() - lastRenderedAt > 140) {
    renderFrame();
  }
}, 140);

window.__solarSim = {
  getState() {
    return {
      simulationDays,
      speedMultiplier,
      paused,
      viewMode,
      viewportMode,
      solarPosition: solarSystem.position.toArray(),
      bodyPositions: Object.fromEntries(
        bodyHandles.map(({ body, holder }) => [body.key, holder.position.toArray()]),
      ),
      gravityFields: gravityFields.length,
      payload: {
        active: payloadState.active,
        elapsed: payloadState.elapsed,
        phase: payloadState.phase,
        progress: payloadState.progress,
        targetKey: payloadState.targetKey,
        targetName: payloadState.targetName,
        nearestBody: payloadState.nearestBody,
        position: payloadState.position.toArray(),
        velocity: payloadState.velocity.toArray(),
        trailCount: payloadState.trailCount,
        missionClockDays: payloadState.missionClockDays,
        transferDays: payloadState.transferDays,
        orbitPeriodDays: payloadState.orbitPeriodDays,
        arrivalSpeedPerDay: payloadState.arrivalSpeedPerDay,
        insertionTurnAngle: payloadState.insertionTurnAngle,
        maxRouteTurnAngle: payloadState.maxRouteTurnAngle,
        loadIndex: payloadState.loadIndex,
        useBodyAvoidanceArc: payloadState.useBodyAvoidanceArc,
        useSunAvoidanceArc: payloadState.useSunAvoidanceArc,
        enforceBodyClearance: payloadState.enforceBodyClearance,
        sunClearance: payloadState.sunClearance,
        sunAvoidanceRadius: payloadState.sunAvoidanceRadius,
        bodyClearance: payloadState.bodyClearance,
        bodyClearanceMargin: payloadState.bodyClearanceMargin,
        bodyAvoidanceRadius: payloadState.bodyAvoidanceRadius,
        bodyClearanceKey: payloadState.bodyClearanceKey,
        bodyClearanceName: payloadState.bodyClearanceName,
        gravityReadings: payloadState.gravityReadings,
        sizeMeters: PAYLOAD_SIZE_METERS,
        massTons: PAYLOAD_MASS_TONS,
      },
    };
  },
  setSpeed(value) {
    setSpeedMultiplier(value);
  },
  setPaused(value) {
    paused = Boolean(value);
    playButton.textContent = paused ? "재생" : "정지";
  },
  launchSwingbyPayload,
};

function buildGalaxy() {
  const coreGeometry = new THREE.SphereGeometry(4.8, 48, 24);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: "#ffd07a",
    transparent: true,
    opacity: 0.92,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  galaxyObjects.add(core);

  const haloGeometry = new THREE.SphereGeometry(12, 48, 24);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: "#d2775c",
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  galaxyObjects.add(new THREE.Mesh(haloGeometry, haloMaterial));

  const orbitPoints = [];
  for (let i = 0; i <= 360; i += 1) {
    const angle = (i / 360) * TAU;
    orbitPoints.push(
      new THREE.Vector3(
        Math.cos(angle) * GALACTIC_ORBIT_RADIUS,
        0,
        Math.sin(angle) * GALACTIC_ORBIT_RADIUS,
      ),
    );
  }
  const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
  const orbitMaterial = new THREE.LineBasicMaterial({
    color: "#73e0d1",
    transparent: true,
    opacity: 0.34,
  });
  galaxyObjects.add(new THREE.Line(orbitGeometry, orbitMaterial));

  const starCount =
    viewportMode === "mobile-portrait" ? 900 : viewportMode === "mobile-landscape" ? 1300 : 1900;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const random = mulberry32(2424);
  const color = new THREE.Color();

  for (let i = 0; i < starCount; i += 1) {
    const arm = (i % 4) * (TAU / 4);
    const radius = 18 + random() * 170;
    const angle = arm + radius * 0.025 + (random() - 0.5) * 0.78;
    const y = (random() - 0.5) * (5 + radius * 0.035);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * radius;

    const hueColor = random() > 0.68 ? "#f4ad6a" : random() > 0.44 ? "#86ddcf" : "#f7ecd7";
    color.set(hueColor);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.42,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  galaxyObjects.add(new THREE.Points(geometry, material));

  const farStars = createFarStarfield();
  scene.add(farStars);
}

function buildSolarSystem() {
  bodies.forEach((body, index) => {
    if (body.key === "sun") {
      const sunTexture = createPlanetTexture(body);
      const material = new THREE.MeshBasicMaterial({
        map: sunTexture,
        color: "#ffd78b",
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(body.radius, 72, 36), material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      solarSystem.add(mesh);

      const glow = createSunGlow(body.radius);
      solarSystem.add(glow);

      const grid = createGravityGrid(body);
      solarSystem.add(grid);
      gravityFields.push(grid);

      const label = createLabelSprite(body.name, body.color);
      label.userData.labelKind = "body";
      label.userData.bodyKey = body.key;
      label.position.set(0, body.radius + 1.2, 0);
      solarSystem.add(label);
      labelSprites.push(label);

      bodyHandles.push({ body, holder: solarSystem, mesh });
      return;
    }

    const orbitRing = createOrbitRing(body.distance, index);
    solarSystem.add(orbitRing);

    const holder = new THREE.Group();
    solarSystem.add(holder);

    const texture = createPlanetTexture(body);
    const material = new THREE.MeshToonMaterial({
      map: texture,
      gradientMap: toonGradient,
      color: new THREE.Color(body.color),
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(body.radius, 64, 32), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    holder.add(mesh);

    const grid = createGravityGrid(body);
    holder.add(grid);
    gravityFields.push(grid);

    if (body.ring) {
      const ring = createPlanetRing(body);
      holder.add(ring);
    }

    const label = createLabelSprite(body.name, body.color);
    label.userData.labelKind = "body";
    label.userData.bodyKey = body.key;
    label.position.set(0, body.radius + 0.84, 0);
    holder.add(label);
    labelSprites.push(label);

    bodyHandles.push({ body, holder, mesh });
  });
}

function buildSwingbyPayload() {
  const payload = new THREE.Group();
  payload.visible = false;

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(PAYLOAD_RENDER_SIZE, PAYLOAD_RENDER_SIZE, PAYLOAD_RENDER_SIZE),
    new THREE.MeshStandardMaterial({
      color: "#f8f1df",
      emissive: "#73e0d1",
      emissiveIntensity: 0.26,
      metalness: 0.42,
      roughness: 0.34,
    }),
  );
  box.castShadow = true;
  box.receiveShadow = true;
  payload.add(box);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(box.geometry),
    new THREE.LineBasicMaterial({
      color: "#73e0d1",
      transparent: true,
      opacity: 0.9,
    }),
  );
  payload.add(edges);

  const label = createLabelSprite(`${PAYLOAD_SIZE_METERS}m ${PAYLOAD_MASS_TONS}t`, "#73e0d1");
  label.userData.labelKind = "payload";
  label.position.set(0, PAYLOAD_RENDER_SIZE + 0.38, 0);
  label.scale.set(3.5, 1.3, 1);
  payload.add(label);
  labelSprites.push(label);

  const gravityLabelGroup = new THREE.Group();
  gravityLabelGroup.visible = false;
  gravityLabelGroup.position.set(0, PAYLOAD_RENDER_SIZE + 1.12, 0);
  const gravityLabels = [];
  for (let i = 0; i < MAX_GRAVITY_LABELS; i += 1) {
    const gravityLabel = createGravityReadingSprite();
    gravityLabel.userData.labelKind = "payload-gravity";
    gravityLabel.position.set(0, i * 0.38, 0);
    gravityLabel.visible = false;
    gravityLabelGroup.add(gravityLabel);
    gravityLabels.push(gravityLabel);
    labelSprites.push(gravityLabel);
  }
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(payloadTrailPositions, 3));
  trailGeometry.setDrawRange(0, 0);

  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({
      color: SWINGBY_TRAJECTORY_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  trail.frustumCulled = false;
  trail.visible = false;

  const routeGeometry = new THREE.BufferGeometry();
  routeGeometry.setAttribute("position", new THREE.BufferAttribute(payloadRoutePositions, 3));
  routeGeometry.setDrawRange(0, 0);

  const route = new THREE.Line(
    routeGeometry,
    new THREE.LineBasicMaterial({
      color: SWINGBY_TRAJECTORY_COLOR,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  route.frustumCulled = false;
  route.visible = false;

  const orbitGeometry = new THREE.BufferGeometry();
  orbitGeometry.setAttribute("position", new THREE.BufferAttribute(payloadOrbitPositions, 3));
  orbitGeometry.setDrawRange(0, 0);

  const targetOrbit = new THREE.LineLoop(
    orbitGeometry,
    new THREE.LineBasicMaterial({
      color: SWINGBY_ORBIT_COLOR,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  targetOrbit.frustumCulled = false;
  targetOrbit.visible = false;

  payload.userData = {
    sizeMeters: PAYLOAD_SIZE_METERS,
    massTons: PAYLOAD_MASS_TONS,
  };

  solarSystem.add(route);
  solarSystem.add(targetOrbit);
  solarSystem.add(trail);
  solarSystem.add(gravityLabelGroup);
  solarSystem.add(payload);
  payloadState.payload = payload;
  payloadState.trail = trail;
  payloadState.route = route;
  payloadState.targetOrbit = targetOrbit;
  payloadState.gravityLabelGroup = gravityLabelGroup;
  payloadState.gravityLabels = gravityLabels;
}

function launchSwingbyPayload() {
  const earthHandle = getBodyHandle("earth");
  const targetHandle = getBodyHandle(destinationSelect.value);
  if (!earthHandle || !targetHandle || !payloadState.payload) {
    return;
  }

  if (paused) {
    paused = false;
    playButton.textContent = "정지";
    playButton.setAttribute("aria-label", "일시정지");
  }

  payloadState.targetKey = targetHandle.body.key;
  payloadState.targetName = targetHandle.body.name;
  payloadState.phase = "transfer";
  payloadState.progress = 0;
  payloadState.active = true;
  payloadState.elapsed = 0;
  payloadState.nearestBody = earthHandle.body.name;
  payloadState.missionStartDays = simulationDays;
  payloadState.missionClockDays = simulationDays;
  payloadState.lastStepDistance = 0;
  payloadState.transitionStepDistance = 0;
  payloadState.transferDays = estimateTransferDays(targetHandle.body);
  payloadState.missionArrivalDays = payloadState.missionStartDays + payloadState.transferDays;
  payloadState.orbitRadius = targetHandle.body.radius * 2.25 + PAYLOAD_RENDER_SIZE * 1.5;

  const earthPosition = getBodyPositionAt(earthHandle.body, payloadState.missionStartDays);
  const arrivalBodyPosition = getBodyPositionAt(targetHandle.body, payloadState.missionArrivalDays);
  const departureTangent = getDepartureTangent(earthHandle.body, targetHandle.body, payloadState.missionStartDays);
  const targetTangent = getBodyOrbitalTangentAt(targetHandle.body, payloadState.missionArrivalDays);
  const launchPole = new THREE.Vector3(0, earthHandle.body.radius + PAYLOAD_RENDER_SIZE * 0.72, 0);
  payloadState.arrivalOrbitPhase = getOrbitPhaseForTangent(targetHandle.body, targetTangent);
  payloadState.arrivalOffset.copy(
    getOrbitOffset(targetHandle.body, payloadState.arrivalOrbitPhase, payloadState.orbitRadius),
  );

  payloadState.startPosition.copy(earthPosition).add(launchPole);
  payloadState.startTangent.copy(departureTangent);
  payloadState.arrivalBodyPosition.copy(arrivalBodyPosition);
  payloadState.arrivalTangent.copy(getOrbitTangent(targetHandle.body, payloadState.arrivalOrbitPhase));
  payloadState.arrivalPosition.copy(payloadState.arrivalBodyPosition).add(payloadState.arrivalOffset);
  calculateTransferControls(
    payloadState.startPosition,
    payloadState.arrivalPosition,
    payloadState.startTangent,
    payloadState.arrivalTangent,
  );
  payloadState.insertionTurnAngle = getInsertionTurnAngle(targetHandle.body);
  payloadState.maxRouteTurnAngle = getMaxRouteTurnAngle();
  payloadState.loadIndex = getLoadIndex(payloadState.insertionTurnAngle, targetHandle.body);
  payloadState.arrivalSpeedPerDay =
    payloadState.transferDays > 0 ? getTransferDerivative(1).length() / payloadState.transferDays : 0;
  payloadState.orbitStartDays = payloadState.missionArrivalDays;
  payloadState.orbitPeriodDays = estimatePayloadOrbitPeriodDays(
    targetHandle.body,
    payloadState.arrivalSpeedPerDay,
  );
  payloadState.position.copy(payloadState.startPosition);
  payloadState.velocity.copy(getTransferDerivative(0)).normalize().multiplyScalar(1.4);
  payloadState.orbitPhase = payloadState.arrivalOrbitPhase;

  payloadState.payload.visible = true;
  payloadState.payload.position.copy(payloadState.position);
  payloadState.trail.visible = true;
  payloadState.route.visible = true;
  payloadState.targetOrbit.visible = true;
  if (payloadState.gravityLabelGroup) {
    payloadState.gravityLabelGroup.visible = true;
  }
  updatePlannedRoute();
  updateTargetOrbitLine(payloadState.arrivalBodyPosition);
  resetPayloadTrail(payloadState.position);
  updatePayloadGravityLabels();
  updatePayloadReadout();
}

function clearSwingbyPayload() {
  payloadState.active = false;
  payloadState.phase = "idle";
  payloadState.progress = 0;
  payloadState.elapsed = 0;
  payloadState.nearestBody = "-";
  payloadState.trailCount = 0;
  payloadState.lastStepDistance = 0;
  payloadState.transitionStepDistance = 0;
  payloadState.insertionTurnAngle = 0;
  payloadState.maxRouteTurnAngle = 0;
  payloadState.loadIndex = 0;
  payloadState.useBodyAvoidanceArc = false;
  payloadState.useSunAvoidanceArc = false;
  payloadState.enforceBodyClearance = false;
  payloadState.sunClearance = 0;
  payloadState.sunAvoidanceRadius = 0;
  payloadState.bodyClearance = 0;
  payloadState.bodyClearanceMargin = 0;
  payloadState.bodyAvoidanceRadius = 0;
  payloadState.bodyClearanceKey = "-";
  payloadState.bodyClearanceName = "-";
  payloadState.arrivalSpeedPerDay = 0;
  payloadState.gravityReadings = [];
  payloadState.velocity.set(0, 0, 0);

  payloadTrailPositions.fill(0);
  payloadRoutePositions.fill(0);
  payloadOrbitPositions.fill(0);

  if (payloadState.payload) {
    payloadState.payload.visible = false;
  }
  if (payloadState.trail) {
    payloadState.trail.visible = false;
    payloadState.trail.geometry.setDrawRange(0, 0);
    payloadState.trail.geometry.attributes.position.needsUpdate = true;
  }
  if (payloadState.route) {
    payloadState.route.visible = false;
    payloadState.route.geometry.setDrawRange(0, 0);
    payloadState.route.geometry.attributes.position.needsUpdate = true;
  }
  if (payloadState.targetOrbit) {
    payloadState.targetOrbit.visible = false;
    payloadState.targetOrbit.geometry.setDrawRange(0, 0);
    payloadState.targetOrbit.geometry.attributes.position.needsUpdate = true;
  }
  if (payloadState.gravityLabelGroup) {
    payloadState.gravityLabelGroup.visible = false;
  }
  payloadState.gravityLabels.forEach((label) => {
    label.visible = false;
  });

  updatePayloadReadout();
}

function updateSwingbyPayload(delta) {
  if (!payloadState.active || paused) {
    return;
  }

  const previousPosition = payloadState.position.clone();
  if (payloadState.phase === "transfer") {
    updatePayloadTransfer();
  } else if (payloadState.phase === "orbit") {
    updatePayloadOrbit();
  }

  payloadState.lastStepDistance = payloadState.position.distanceTo(previousPosition);
  payloadState.payload.position.copy(payloadState.position);
  updatePayloadGravityLabels();
  orientPayloadToVelocity();

  if (payloadState.position.distanceTo(payloadState.trailDistanceGate) > 0.1) {
    addPayloadTrailPoint(payloadState.position);
    payloadState.trailDistanceGate.copy(payloadState.position);
  }
}

function advanceSimulationClock(delta) {
  const daysDelta = delta * speedMultiplier;

  if (payloadState.active && payloadState.phase === "transfer" && daysDelta > 0) {
    simulationDays = Math.min(simulationDays + daysDelta, payloadState.missionArrivalDays);
    return;
  }

  simulationDays += daysDelta;
}

function updatePayloadTransfer() {
  const targetHandle = getBodyHandle(payloadState.targetKey);
  if (!targetHandle) {
    return;
  }

  payloadState.missionClockDays = simulationDays;
  payloadState.elapsed = THREE.MathUtils.clamp(
    payloadState.missionClockDays - payloadState.missionStartDays,
    0,
    payloadState.transferDays,
  );
  payloadState.progress =
    payloadState.transferDays > 0
      ? THREE.MathUtils.clamp(payloadState.elapsed / payloadState.transferDays, 0, 1)
      : 1;

  const t = payloadState.progress;
  updateTargetOrbitLine(getBodyPosition(targetHandle));

  const previousPosition = payloadState.position.clone();
  payloadState.position.copy(getTransferPoint(t));
  payloadState.velocity.copy(payloadState.position).sub(previousPosition);
  payloadState.nearestBody = getNearestBodyName(payloadState.position);

  if (t >= 1) {
    payloadState.phase = "orbit";
    payloadState.elapsed = payloadState.transferDays;
    payloadState.progress = 1;
    payloadState.orbitStartDays = payloadState.missionArrivalDays;
    payloadState.orbitPhase = payloadState.arrivalOrbitPhase;
    payloadState.insertionTurnAngle = getInsertionTurnAngle(targetHandle.body);
    payloadState.loadIndex = getLoadIndex(payloadState.insertionTurnAngle, targetHandle.body);
    const beforeOrbitInsert = payloadState.position.clone();
    updatePayloadOrbit();
    payloadState.transitionStepDistance = payloadState.position.distanceTo(beforeOrbitInsert);
  }
}

function updatePayloadOrbit() {
  const targetHandle = getBodyHandle(payloadState.targetKey);
  if (!targetHandle) {
    return;
  }

  const previousPosition = payloadState.position.clone();
  const targetPosition = getBodyPosition(targetHandle);
  const orbitElapsedDays = Math.max(0, simulationDays - payloadState.orbitStartDays);
  const angularSpeedPerDay = TAU / Math.max(payloadState.orbitPeriodDays, 0.001);
  payloadState.orbitPhase = payloadState.arrivalOrbitPhase + orbitElapsedDays * angularSpeedPerDay;
  payloadState.position.copy(targetPosition).add(getOrbitOffset(targetHandle.body, payloadState.orbitPhase, payloadState.orbitRadius));
  payloadState.velocity.copy(payloadState.position).sub(previousPosition);
  if (payloadState.velocity.lengthSq() < 0.000001) {
    payloadState.velocity
      .copy(getOrbitTangent(targetHandle.body, payloadState.orbitPhase))
      .multiplyScalar(angularSpeedPerDay * payloadState.orbitRadius * 0.016);
  }
  payloadState.nearestBody = targetHandle.body.name;
  updateTargetOrbitLine(targetPosition);
}

function calculateTransferControls(start, arrival, startTangent, arrivalTangent) {
  payloadState.useBodyAvoidanceArc = false;
  payloadState.useSunAvoidanceArc = false;
  payloadState.enforceBodyClearance = false;
  payloadState.sunAvoidancePoint.set(0, 0, 0);
  payloadState.sunAvoidanceTangent.set(0, 0, 0);
  payloadState.avoidanceSplitT = 0.5;

  const chord = Math.max(start.distanceTo(arrival), 1);
  const startHandle = THREE.MathUtils.clamp(chord * 0.38, 2.2, 18);
  const arrivalHandle = THREE.MathUtils.clamp(chord * 0.34, payloadState.orbitRadius * 1.15, 16);

  payloadState.controlA.copy(start).addScaledVector(startTangent, startHandle);
  payloadState.controlB.copy(arrival).addScaledVector(arrivalTangent, -arrivalHandle);
  payloadState.controlC.copy(payloadState.controlA);
  payloadState.controlD.copy(payloadState.controlB);
  updateTransferClearanceDiagnostics();

  if (payloadState.bodyClearanceMargin >= 0) {
    return;
  }

  const safeRoute = buildBodyAvoidanceTransfer(start, arrival, startTangent, arrivalTangent);
  if (!safeRoute) {
    payloadState.enforceBodyClearance = true;
    updateTransferClearanceDiagnostics();
    return;
  }

  payloadState.useBodyAvoidanceArc = true;
  payloadState.useSunAvoidanceArc = Boolean(safeRoute.avoidsSun);
  payloadState.avoidanceSplitT = safeRoute.splitT;
  payloadState.sunAvoidancePoint.copy(safeRoute.via);
  payloadState.sunAvoidanceTangent.copy(safeRoute.viaTangent);
  payloadState.controlA.copy(safeRoute.controlA);
  payloadState.controlB.copy(safeRoute.controlB);
  payloadState.controlC.copy(safeRoute.controlC);
  payloadState.controlD.copy(safeRoute.controlD);
  updateTransferClearanceDiagnostics();
  if (payloadState.bodyClearanceMargin < 0) {
    payloadState.enforceBodyClearance = true;
    updateTransferClearanceDiagnostics();
  }
}

function buildBodyAvoidanceTransfer(start, arrival, startTangent, arrivalTangent) {
  const hazards = getRouteBodyClearances()
    .filter((clearance) => clearance.margin < 0)
    .slice(0, 4);
  const startRadius = getFlatRadius(start);
  const arrivalRadius = getFlatRadius(arrival);
  const nearEndpointRadius = Math.min(startRadius, arrivalRadius);
  const farEndpointRadius = Math.max(startRadius, arrivalRadius);
  const startDir = getFlatUnit(start, new THREE.Vector3(1, 0, 0));
  const arrivalDir = getFlatUnit(arrival, startDir.clone().negate());
  const primaryDirection = getPrimarySunAvoidanceDirection(startDir, arrivalDir, startTangent);
  let bestCandidate = null;

  hazards.forEach((hazard) => {
    const hazardDirections = getAvoidanceDirections(hazard, primaryDirection, start, arrival);
    const splitValues = getAvoidanceSplitValues(hazard.t);
    const yValues = getAvoidanceYValues(hazard);
    const radiusValues = getAvoidanceRadiusValues(
      hazard,
      nearEndpointRadius,
      farEndpointRadius,
    );

    splitValues.forEach((splitT) => {
      hazardDirections.forEach((direction) => {
        [-1, 1].forEach((tangentSign) => {
          radiusValues.forEach((radius) => {
            yValues.forEach((y) => {
              getAvoidanceHandleScales(hazard).forEach((handleScale) => {
                const via =
                  hazard.body?.key === "sun"
                    ? new THREE.Vector3(direction.x * radius, y, direction.z * radius)
                    : hazard.bodyPosition.clone().addScaledVector(direction, radius).setY(y);
                const viaTangent = new THREE.Vector3(
                  -direction.z * tangentSign,
                  0,
                  direction.x * tangentSign,
                ).normalize();
                const candidate = buildAvoidanceCandidate(
                  start,
                  arrival,
                  startTangent,
                  arrivalTangent,
                  via,
                  viaTangent,
                  splitT,
                  hazard.radius,
                  handleScale,
                );

                candidate.avoidsSun = hazard.body?.key === "sun";
                candidate.clearance = getRouteBodyClearance(candidate);
                candidate.maxTurn = getRouteMaxTurnAngle(candidate);
                candidate.detour =
                  start.distanceTo(via) + via.distanceTo(arrival) - start.distanceTo(arrival);
                candidate.score =
                  (candidate.clearance.margin >= 0 ? 100000 : 0) +
                  candidate.clearance.margin * 420 +
                  candidate.clearance.distance * 12 -
                  Math.max(0, candidate.maxTurn - 14) * 0.8 -
                  candidate.detour * 0.42 -
                  (1 - handleScale) * 1.8;

                if (!bestCandidate || candidate.score > bestCandidate.score) {
                  bestCandidate = candidate;
                }
              });
            });
          });
        });
      });
    });
  });

  return bestCandidate;
}

function buildAvoidanceCandidate(
  start,
  arrival,
  startTangent,
  arrivalTangent,
  via,
  viaTangent,
  splitT,
  avoidanceRadius,
  handleScale = 1,
) {
  const firstChord = Math.max(start.distanceTo(via), 1);
  const secondChord = Math.max(via.distanceTo(arrival), 1);
  const startHandle = THREE.MathUtils.clamp(firstChord * 0.42, 2.2, 18) * handleScale;
  const arrivalHandle =
    THREE.MathUtils.clamp(secondChord * 0.36, payloadState.orbitRadius * 1.15, 18) * handleScale;
  const viaHandle = THREE.MathUtils.clamp(
    Math.min(firstChord, secondChord) * 0.34,
    avoidanceRadius * 0.42,
    16,
  ) * Math.max(handleScale, 0.52);
  const splitInScale = Math.max(splitT * 2, 0.36);
  const splitOutScale = Math.max((1 - splitT) * 2, 0.36);

  return {
    start: start.clone(),
    arrival: arrival.clone(),
    splitT,
    via,
    viaTangent,
    controlA: start.clone().addScaledVector(startTangent, startHandle),
    controlB: via.clone().addScaledVector(viaTangent, -viaHandle * splitInScale),
    controlC: via.clone().addScaledVector(viaTangent, viaHandle * splitOutScale),
    controlD: arrival.clone().addScaledVector(arrivalTangent, -arrivalHandle),
  };
}

function getAvoidanceDirections(hazard, primaryDirection, start, arrival) {
  const awayFromHazard = getFlatUnit(
    hazard.point.clone().sub(hazard.bodyPosition),
    primaryDirection,
  );
  const hazardRadial = getFlatUnit(hazard.bodyPosition, primaryDirection);
  const chord = arrival.clone().sub(start);
  const chordSide = getFlatUnit(new THREE.Vector3(-chord.z, 0, chord.x), primaryDirection);
  const directions = [
    awayFromHazard,
    awayFromHazard.clone().negate(),
    hazardRadial,
    hazardRadial.clone().negate(),
    chordSide,
    chordSide.clone().negate(),
    primaryDirection,
    primaryDirection.clone().negate(),
  ];

  return getUniqueDirections(directions);
}

function getAvoidanceSplitValues(t) {
  return [...new Set([t, 0.5, t < 0.5 ? t + 0.12 : t - 0.12]
    .map((value) => Number(THREE.MathUtils.clamp(value, 0.18, 0.82).toFixed(3))))];
}

function getAvoidanceYValues(hazard) {
  const baseY = THREE.MathUtils.clamp(hazard.bodyPosition.y, -1.2, 1.2);
  if (hazard.body?.key === "sun") {
    return [baseY];
  }

  const lift = Math.max(hazard.radius + 0.8, 3.2);
  return [...new Set([
    baseY,
    THREE.MathUtils.clamp(hazard.bodyPosition.y + lift, -8.5, 8.5),
    THREE.MathUtils.clamp(hazard.bodyPosition.y - lift, -8.5, 8.5),
    5.8,
    -5.8,
  ].map((value) => Number(value.toFixed(3))))];
}

function getAvoidanceRadiusValues(hazard, nearEndpointRadius, farEndpointRadius) {
  if (hazard.body?.key === "sun") {
    const baseRadius = Math.max(
      hazard.radius + 2.1,
      Math.min(farEndpointRadius * 0.78, nearEndpointRadius * 0.96),
    );
    return [...new Set([
      baseRadius,
      Math.max(baseRadius + 2.2, nearEndpointRadius * 1.08),
      Math.max(baseRadius + 4.8, nearEndpointRadius * 1.26),
      Math.max(baseRadius + 8, farEndpointRadius * 0.62),
      Math.max(baseRadius + 12, nearEndpointRadius * 1.48),
      Math.max(baseRadius + 18, farEndpointRadius * 0.94),
    ].map((radius) => Number(radius.toFixed(3))))];
  }

  return [...new Set([
    hazard.radius + 0.9,
    hazard.radius + 2.2,
    hazard.radius + 4.4,
    hazard.radius + 7.5,
  ].map((radius) => Number(radius.toFixed(3))))];
}

function getAvoidanceHandleScales(hazard) {
  return hazard.body?.key === "sun" ? [1, 0.68, 0.42] : [1, 0.72];
}

function getSunAvoidanceRadius() {
  const sunBody = bodies.find((body) => body.key === "sun");
  return (sunBody?.radius ?? 4.8) + PAYLOAD_RENDER_SIZE + SUN_AVOIDANCE_MARGIN;
}

function getBodyAvoidanceRadius(body) {
  if (body.key === "sun") {
    return getSunAvoidanceRadius();
  }

  return body.radius + PAYLOAD_RENDER_SIZE * 0.68 + BODY_AVOIDANCE_MARGIN;
}

function updateTransferClearanceDiagnostics() {
  const bodyClearance = getRouteBodyClearance();
  const sunClearance = getRouteSpecificBodyClearance("sun");
  payloadState.bodyClearance = bodyClearance.distance;
  payloadState.bodyClearanceMargin = bodyClearance.margin;
  payloadState.bodyAvoidanceRadius = bodyClearance.radius;
  payloadState.bodyClearanceKey = bodyClearance.body?.key ?? "-";
  payloadState.bodyClearanceName = bodyClearance.body?.name ?? "-";
  payloadState.sunClearance = sunClearance.distance;
  payloadState.sunAvoidanceRadius = sunClearance.radius;
}

function getPrimarySunAvoidanceDirection(startDir, arrivalDir, startTangent) {
  const combined = startDir.clone().add(arrivalDir);
  if (combined.lengthSq() > 0.0001) {
    return combined.normalize();
  }

  const positivePerpendicular = new THREE.Vector3(-startDir.z, 0, startDir.x).normalize();
  const tangentDirection = getFlatUnit(startTangent, positivePerpendicular);
  const sign = tangentDirection.dot(positivePerpendicular) >= 0 ? 1 : -1;
  return positivePerpendicular.multiplyScalar(sign).normalize();
}

function getFlatUnit(vector, fallback) {
  const direction = new THREE.Vector3(vector.x, 0, vector.z);
  if (direction.lengthSq() > 0.0001) {
    return direction.normalize();
  }

  const fallbackDirection = fallback.clone().setY(0);
  if (fallbackDirection.lengthSq() > 0.0001) {
    return fallbackDirection.normalize();
  }

  return new THREE.Vector3(1, 0, 0);
}

function getFlatRadius(point) {
  return Math.hypot(point.x, point.z);
}

function getUniqueDirections(directions) {
  const seen = new Set();
  return directions
    .filter((direction) => direction.lengthSq() > 0.0001)
    .map((direction) => direction.clone().setY(0).normalize())
    .filter((direction) => {
      const key = `${direction.x.toFixed(3)},${direction.z.toFixed(3)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function getTransferSunClearance() {
  return getRouteSpecificBodyClearance("sun").distance;
}

function getRouteSunClearance(route = null) {
  return getRouteSpecificBodyClearance("sun", route).distance;
}

function getRouteBodyClearance(route = null) {
  const [clearance] = getRouteBodyClearances(route);
  return clearance ?? createEmptyBodyClearance();
}

function getRouteSpecificBodyClearance(bodyKey, route = null) {
  return (
    getRouteBodyClearances(route).find((clearance) => clearance.body?.key === bodyKey) ??
    createEmptyBodyClearance(bodies.find((body) => body.key === bodyKey))
  );
}

function getRouteBodyClearances(route = null) {
  const clearances = new Map();

  for (let i = 0; i < TRANSFER_CLEARANCE_SAMPLES; i += 1) {
    const t = i / (TRANSFER_CLEARANCE_SAMPLES - 1);
    const days = payloadState.missionStartDays + payloadState.transferDays * t;
    const point = route ? getCandidateTransferPoint(route, t) : getTransferPoint(t);

    bodies.forEach((body) => {
      if (shouldIgnoreBodyClearance(body, t)) {
        return;
      }

      const bodyPosition = getBodyPositionAt(body, days);
      const distance = getRouteBodyDistance(body, point, bodyPosition);
      const radius = getBodyAvoidanceRadius(body);
      const margin = distance - radius;
      const previous = clearances.get(body.key);

      if (!previous || margin < previous.margin) {
        clearances.set(body.key, {
          body,
          point: point.clone(),
          bodyPosition,
          t,
          distance,
          radius,
          margin,
        });
      }
    });
  }

  return [...clearances.values()].sort((a, b) => a.margin - b.margin);
}

function createEmptyBodyClearance(body = null) {
  return {
    body,
    point: new THREE.Vector3(),
    bodyPosition: new THREE.Vector3(),
    t: 0,
    distance: 0,
    radius: body ? getBodyAvoidanceRadius(body) : 0,
    margin: Infinity,
  };
}

function shouldIgnoreBodyClearance(body, t) {
  if (body.key === "earth" && t <= LAUNCH_CLEARANCE_PROGRESS) {
    return true;
  }

  return body.key === payloadState.targetKey && t >= 1 - TARGET_INSERTION_CLEARANCE_PROGRESS;
}

function getRouteBodyDistance(body, point, bodyPosition) {
  if (body.key === "sun") {
    return Math.hypot(point.x - bodyPosition.x, point.z - bodyPosition.z);
  }

  return point.distanceTo(bodyPosition);
}

function resolveBodyIntersections(point, t) {
  const resolvedPoint = point.clone();

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    const days = payloadState.missionStartDays + payloadState.transferDays * t;

    bodies.forEach((body) => {
      if (shouldIgnoreBodyClearance(body, t)) {
        return;
      }

      const bodyPosition = getBodyPositionAt(body, days);
      const radius = getBodyAvoidanceRadius(body);

      if (body.key === "sun") {
        const deltaX = resolvedPoint.x - bodyPosition.x;
        const deltaZ = resolvedPoint.z - bodyPosition.z;
        const distance = Math.hypot(deltaX, deltaZ);
        if (distance >= radius) {
          return;
        }

        const direction =
          distance > 0.0001
            ? new THREE.Vector3(deltaX / distance, 0, deltaZ / distance)
            : getFlatUnit(resolvedPoint, new THREE.Vector3(1, 0, 0));
        resolvedPoint.x = bodyPosition.x + direction.x * radius;
        resolvedPoint.z = bodyPosition.z + direction.z * radius;
        changed = true;
        return;
      }

      const direction = resolvedPoint.clone().sub(bodyPosition);
      const distance = direction.length();
      if (distance >= radius) {
        return;
      }

      if (distance > 0.0001) {
        direction.normalize();
      } else {
        const flatFallback = getFlatUnit(resolvedPoint, new THREE.Vector3(1, 0, 0));
        direction.set(flatFallback.x, 0.28, flatFallback.z).normalize();
      }
      resolvedPoint.copy(bodyPosition).addScaledVector(direction, radius);
      changed = true;
    });

    if (!changed) {
      break;
    }
  }

  return resolvedPoint;
}

function getRouteMaxTurnAngle(route) {
  let maxAngle = 0;
  let previousDirection = null;

  for (let i = 1; i < MAX_TRANSFER_TURN_SAMPLES; i += 1) {
    const previous = getCandidateTransferPoint(route, (i - 1) / (MAX_TRANSFER_TURN_SAMPLES - 1));
    const current = getCandidateTransferPoint(route, i / (MAX_TRANSFER_TURN_SAMPLES - 1));
    const direction = current.sub(previous);

    if (direction.lengthSq() < 0.000001) {
      continue;
    }

    direction.normalize();
    if (previousDirection) {
      maxAngle = Math.max(maxAngle, THREE.MathUtils.radToDeg(previousDirection.angleTo(direction)));
    }
    previousDirection = direction;
  }

  return maxAngle;
}

function getDepartureTangent(startBody, targetBody, days) {
  const orbitalTangent = getBodyOrbitalTangentAt(startBody, days);
  const startPosition = getBodyPositionAt(startBody, days);
  const radialDirection = startPosition.setY(0).normalize();
  const radialSign = targetBody.distance >= startBody.distance ? 1 : -1;
  return orbitalTangent.addScaledVector(radialDirection, radialSign * 0.26).normalize();
}

function getBodyOrbitalTangentAt(body, days) {
  if (body.key === "sun") {
    return new THREE.Vector3(0, 0, 1);
  }

  const orbitAngle = (days / body.orbitalPeriod) * TAU + body.distance * 0.18;
  return new THREE.Vector3(
    -Math.sin(orbitAngle) * body.distance,
    Math.cos(orbitAngle * 1.7) * 0.204,
    Math.cos(orbitAngle) * body.distance,
  ).normalize();
}

function getOrbitPhaseForTangent(body, desiredTangent) {
  const tilt = getOrbitTilt(body);
  const planeSide = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const xComponent = desiredTangent.x;
  const sideComponent = desiredTangent.dot(planeSide);

  if (Math.hypot(xComponent, sideComponent) < 0.0001) {
    return 0;
  }

  return Math.atan2(-xComponent, sideComponent);
}

function getOrbitTangent(body, angle) {
  const tilt = getOrbitTilt(body);
  return new THREE.Vector3(
    -Math.sin(angle),
    Math.cos(angle) * Math.sin(tilt),
    Math.cos(angle) * Math.cos(tilt),
  ).normalize();
}

function getInsertionTurnAngle(body) {
  const transferDirection = getTransferDerivative(1);
  if (transferDirection.lengthSq() < 0.000001) {
    return 0;
  }

  return THREE.MathUtils.radToDeg(
    transferDirection.normalize().angleTo(getOrbitTangent(body, payloadState.arrivalOrbitPhase)),
  );
}

function getMaxRouteTurnAngle() {
  let maxAngle = 0;
  let previousDirection = null;

  for (let i = 1; i < MAX_TRANSFER_TURN_SAMPLES; i += 1) {
    const previous = getTransferPoint((i - 1) / (MAX_TRANSFER_TURN_SAMPLES - 1));
    const current = getTransferPoint(i / (MAX_TRANSFER_TURN_SAMPLES - 1));
    const direction = current.sub(previous);

    if (direction.lengthSq() < 0.000001) {
      continue;
    }

    direction.normalize();
    if (previousDirection) {
      maxAngle = Math.max(maxAngle, THREE.MathUtils.radToDeg(previousDirection.angleTo(direction)));
    }
    previousDirection = direction;
  }

  return maxAngle;
}

function getLoadIndex(turnAngle, body) {
  const gravityValue = getBodyGravityValue(body);
  return 1 + (turnAngle / 22) ** 2 + gravityValue * 0.08;
}

function updatePlannedRoute() {
  for (let i = 0; i < PAYLOAD_ROUTE_POINTS; i += 1) {
    const t = i / (PAYLOAD_ROUTE_POINTS - 1);
    const point = getTransferPoint(t);
    const index = i * 3;
    payloadRoutePositions[index] = point.x;
    payloadRoutePositions[index + 1] = point.y;
    payloadRoutePositions[index + 2] = point.z;
  }
  payloadState.route.geometry.setDrawRange(0, PAYLOAD_ROUTE_POINTS);
  payloadState.route.geometry.attributes.position.needsUpdate = true;
}

function updateTargetOrbitLine(center) {
  const targetHandle = getBodyHandle(payloadState.targetKey);
  if (!targetHandle || !payloadState.targetOrbit) {
    return;
  }

  for (let i = 0; i < PAYLOAD_ORBIT_POINTS; i += 1) {
    const angle = (i / PAYLOAD_ORBIT_POINTS) * TAU;
    const point = center.clone().add(getOrbitOffset(targetHandle.body, angle, payloadState.orbitRadius));
    const index = i * 3;
    payloadOrbitPositions[index] = point.x;
    payloadOrbitPositions[index + 1] = point.y;
    payloadOrbitPositions[index + 2] = point.z;
  }
  payloadState.targetOrbit.geometry.setDrawRange(0, PAYLOAD_ORBIT_POINTS);
  payloadState.targetOrbit.geometry.attributes.position.needsUpdate = true;
}

function getCandidateTransferPoint(route, t) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  const splitT = route.splitT ?? 0.5;
  if (clampedT < splitT) {
    return getCubicBezierPoint(
      route.start,
      route.controlA,
      route.controlB,
      route.via,
      splitT > 0 ? clampedT / splitT : 0,
    );
  }

  return getCubicBezierPoint(
    route.via,
    route.controlC,
    route.controlD,
    route.arrival,
    splitT < 1 ? (clampedT - splitT) / (1 - splitT) : 1,
  );
}

function getCubicBezierPoint(start, controlA, controlB, arrival, t) {
  const inv = 1 - t;
  return start
    .clone()
    .multiplyScalar(inv * inv * inv)
    .add(controlA.clone().multiplyScalar(3 * inv * inv * t))
    .add(controlB.clone().multiplyScalar(3 * inv * t * t))
    .add(arrival.clone().multiplyScalar(t * t * t));
}

function getCubicBezierDerivative(start, controlA, controlB, arrival, t) {
  const inv = 1 - t;
  return controlA
    .clone()
    .sub(start)
    .multiplyScalar(3 * inv * inv)
    .add(controlB.clone().sub(controlA).multiplyScalar(6 * inv * t))
    .add(arrival.clone().sub(controlB).multiplyScalar(3 * t * t));
}

function getTransferPoint(t) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  let point;
  if (payloadState.useBodyAvoidanceArc || payloadState.useSunAvoidanceArc) {
    const splitT = payloadState.avoidanceSplitT;
    if (clampedT < splitT) {
      point = getCubicBezierPoint(
        payloadState.startPosition,
        payloadState.controlA,
        payloadState.controlB,
        payloadState.sunAvoidancePoint,
        splitT > 0 ? clampedT / splitT : 0,
      );
      return payloadState.enforceBodyClearance ? resolveBodyIntersections(point, clampedT) : point;
    }

    point = getCubicBezierPoint(
      payloadState.sunAvoidancePoint,
      payloadState.controlC,
      payloadState.controlD,
      payloadState.arrivalPosition,
      splitT < 1 ? (clampedT - splitT) / (1 - splitT) : 1,
    );
    return payloadState.enforceBodyClearance ? resolveBodyIntersections(point, clampedT) : point;
  }

  point = getCubicBezierPoint(
    payloadState.startPosition,
    payloadState.controlA,
    payloadState.controlB,
    payloadState.arrivalPosition,
    clampedT,
  );
  return payloadState.enforceBodyClearance ? resolveBodyIntersections(point, clampedT) : point;
}

function getTransferDerivative(t) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);
  if (payloadState.enforceBodyClearance) {
    return getProjectedTransferDerivative(clampedT);
  }

  if (payloadState.useBodyAvoidanceArc || payloadState.useSunAvoidanceArc) {
    const splitT = payloadState.avoidanceSplitT;
    if (clampedT < splitT) {
      return getCubicBezierDerivative(
        payloadState.startPosition,
        payloadState.controlA,
        payloadState.controlB,
        payloadState.sunAvoidancePoint,
        splitT > 0 ? clampedT / splitT : 0,
      ).multiplyScalar(splitT > 0 ? 1 / splitT : 1);
    }

    return getCubicBezierDerivative(
      payloadState.sunAvoidancePoint,
      payloadState.controlC,
      payloadState.controlD,
      payloadState.arrivalPosition,
      splitT < 1 ? (clampedT - splitT) / (1 - splitT) : 1,
    ).multiplyScalar(splitT < 1 ? 1 / (1 - splitT) : 1);
  }

  return getCubicBezierDerivative(
    payloadState.startPosition,
    payloadState.controlA,
    payloadState.controlB,
    payloadState.arrivalPosition,
    clampedT,
  );
}

function getProjectedTransferDerivative(t) {
  const beforeT = Math.max(0, t - 0.0015);
  const afterT = Math.min(1, t + 0.0015);
  if (afterT <= beforeT) {
    return new THREE.Vector3();
  }

  return getTransferPoint(afterT)
    .sub(getTransferPoint(beforeT))
    .multiplyScalar(1 / (afterT - beforeT));
}

function getArrivalOrbitPhase() {
  const targetHandle = getBodyHandle(payloadState.targetKey);
  if (!targetHandle) {
    return 0;
  }
  const relative = payloadState.arrivalPosition.clone().sub(getBodyPosition(targetHandle));
  const tilt = getOrbitTilt(targetHandle.body);
  const planeSide = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  return Math.atan2(relative.dot(planeSide), relative.x);
}

function getOrbitOffset(body, angle, radius) {
  const tilt = getOrbitTilt(body);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * Math.sin(tilt),
    Math.sin(angle) * radius * Math.cos(tilt),
  );
}

function getOrbitTilt(body) {
  return body.key === "uranus" ? 0.72 : body.key === "saturn" ? 0.34 : 0.22;
}

function getNearestBodyName(position) {
  let nearestDistance = Infinity;
  let nearestBodyName = "-";
  bodyHandles.forEach((handle) => {
    const distance = position.distanceTo(getBodyPosition(handle));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestBodyName = handle.body.name;
    }
  });
  return nearestBodyName;
}

function estimateTransferDays(targetBody) {
  const earth = getBodyHandle("earth")?.body;
  if (!earth || targetBody.key === "sun") {
    return 0;
  }

  const semiMajorRatio = (earth.distance + targetBody.distance) / (2 * earth.distance);
  const hohmannDays = (earth.orbitalPeriod * semiMajorRatio ** 1.5) / 2;
  return Math.max(18, hohmannDays);
}

function estimatePayloadOrbitPeriodDays(targetBody, arrivalSpeedPerDay) {
  const radiusRatio = payloadState.orbitRadius / Math.max(targetBody.radius, 0.32);
  const gravityValue = Math.max(getBodyGravityValue(targetBody), 0.2);
  const gravityPeriod = radiusRatio ** 1.5 / (gravityValue * 1.25);
  const speedMatchedPeriod =
    arrivalSpeedPerDay > 0.0001 ? (TAU * payloadState.orbitRadius) / arrivalSpeedPerDay : 0;
  const transferMatchedFloor = Math.max(payloadState.transferDays * 0.72, 18);
  const targetOrbitFloor = targetBody.orbitalPeriod * 0.028;
  const period = Math.max(gravityPeriod, speedMatchedPeriod, transferMatchedFloor, targetOrbitFloor);
  return THREE.MathUtils.clamp(period, 18, Math.max(targetBody.orbitalPeriod * 0.32, 36));
}

function getBodyPositionAt(body, days) {
  if (body.key === "sun") {
    return new THREE.Vector3(0, 0, 0);
  }

  const orbitAngle = (days / body.orbitalPeriod) * TAU + body.distance * 0.18;
  return new THREE.Vector3(
    Math.cos(orbitAngle) * body.distance,
    Math.sin(orbitAngle * 1.7) * 0.12,
    Math.sin(orbitAngle) * body.distance,
  );
}

function orientPayloadToVelocity() {
  const speed = payloadState.velocity.length();
  if (speed < 0.001) {
    return;
  }

  const direction = payloadState.velocity.clone().normalize();
  const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  payloadState.payload.quaternion.slerp(targetQuaternion, 0.28);
}

function resetPayloadTrail(position) {
  payloadTrailPositions.fill(0);
  payloadState.trailCount = 0;
  addPayloadTrailPoint(position);
  payloadState.trailDistanceGate.copy(position);
}

function addPayloadTrailPoint(position) {
  if (payloadState.trailCount < PAYLOAD_TRAIL_POINTS) {
    const index = payloadState.trailCount * 3;
    payloadTrailPositions[index] = position.x;
    payloadTrailPositions[index + 1] = position.y;
    payloadTrailPositions[index + 2] = position.z;
    payloadState.trailCount += 1;
  } else {
    payloadTrailPositions.copyWithin(0, 3);
    const index = (PAYLOAD_TRAIL_POINTS - 1) * 3;
    payloadTrailPositions[index] = position.x;
    payloadTrailPositions[index + 1] = position.y;
    payloadTrailPositions[index + 2] = position.z;
  }

  payloadState.trail.geometry.setDrawRange(0, payloadState.trailCount);
  payloadState.trail.geometry.attributes.position.needsUpdate = true;
}

function updatePayloadGravityLabels() {
  if (!payloadState.gravityLabelGroup || payloadState.gravityLabels.length === 0) {
    return;
  }

  if (!payloadState.active) {
    payloadState.gravityReadings = [];
    payloadState.gravityLabelGroup.visible = false;
    payloadState.gravityLabels.forEach((label) => {
      label.visible = false;
    });
    return;
  }

  const readings = getPayloadGravityReadings(payloadState.position);
  payloadState.gravityLabelGroup.position.copy(payloadState.position).add(new THREE.Vector3(0, PAYLOAD_RENDER_SIZE + 1.12, 0));
  payloadState.gravityReadings = readings.map((reading) => ({
    key: reading.key,
    name: reading.name,
    value: Number(reading.value.toFixed(5)),
  }));
  payloadState.gravityLabelGroup.visible = true;

  payloadState.gravityLabels.forEach((label, index) => {
    const reading = readings[index];
    if (!reading) {
      label.visible = false;
      return;
    }

    label.visible = true;
    updateGravityReadingSprite(
      label,
      `${reading.name} ${formatGravityReading(reading.value)}G`,
      reading.color,
    );
  });
}

function getPayloadGravityReadings(position) {
  return bodyHandles
    .filter(({ body }) => body.key !== "sun")
    .map((handle) => {
      const bodyPosition = getBodyPosition(handle);
      const distance = Math.max(position.distanceTo(bodyPosition), handle.body.radius * 0.3);
      const radius = getGravityGridRadius(handle.body);
      const influence = Math.max(handle.body.radius * 2.2, radius * 0.42);
      const value = getBodyGravityValue(handle.body) / (1 + (distance / influence) ** 2.3);
      return {
        key: handle.body.key,
        name: handle.body.name,
        color: handle.body.gridColor,
        value,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_GRAVITY_LABELS);
}

function formatGravityReading(value) {
  if (value >= 10) {
    return value.toFixed(1);
  }
  if (value >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(3);
}

function sampleSolarGravityGridHeight(position) {
  let height = 0;
  bodyHandles.forEach((handle) => {
    const bodyPosition = getBodyPosition(handle);
    const distance = Math.hypot(position.x - bodyPosition.x, position.z - bodyPosition.z);
    const radius = getGravityGridRadius(handle.body);
    const influence = Math.max(handle.body.radius * 2.2, radius * 0.42);
    const depth = getGravityGridDepth(handle.body);
    height += -depth / (1 + (distance / influence) ** 2.3);
  });
  return height * 0.34;
}

function getBodyPosition(handle) {
  if (handle.body.key === "sun") {
    return new THREE.Vector3(0, 0, 0);
  }
  return handle.holder.position.clone();
}

function getBodyHandle(key) {
  return bodyHandles.find(({ body }) => body.key === key);
}

function getBodyGravityValue(body) {
  const solarDamping = body.key === "sun" ? 0.66 : 1;
  return (Math.log10(body.massEarth + 1.35) + body.radius * 0.22) * solarDamping;
}

function getGravityGridRadius(body) {
  return THREE.MathUtils.clamp(body.radius * 4.6 + Math.log10(body.massEarth + 2) * 2.0, 4.4, 19);
}

function getGravityGridDepth(body) {
  const massCurve = Math.log10(body.massEarth + 1.35);
  return Math.min(body.radius * 1.8, body.radius * (0.26 + massCurve * 0.42));
}

function updateSolarSystem() {
  const galacticAngle = (simulationDays / GALACTIC_PERIOD_DAYS) * TAU;
  solarSystem.position.set(
    Math.cos(galacticAngle) * GALACTIC_ORBIT_RADIUS,
    Math.sin(galacticAngle * 2.0) * 3.2,
    Math.sin(galacticAngle) * GALACTIC_ORBIT_RADIUS,
  );
  solarSystem.rotation.y = -galacticAngle + 0.28;
  sunLight.position.set(0, 0, 0);

  bodyHandles.forEach(({ body, holder, mesh }) => {
    if (body.key !== "sun") {
      const orbitAngle = (simulationDays / body.orbitalPeriod) * TAU + body.distance * 0.18;
      holder.position.set(
        Math.cos(orbitAngle) * body.distance,
        Math.sin(orbitAngle * 1.7) * 0.12,
        Math.sin(orbitAngle) * body.distance,
      );
    }

    const rotationDays = body.rotationPeriod || 1;
    mesh.rotation.y = (simulationDays / rotationDays) * TAU;
    mesh.rotation.z = body.key === "uranus" ? THREE.MathUtils.degToRad(82) : 0;
  });
}

function updateCameraTarget() {
  const solarPosition = new THREE.Vector3();
  solarSystem.getWorldPosition(solarPosition);

  if (viewMode === "solar") {
    const delta = solarPosition.clone().sub(lastFrameSolarPosition);
    camera.position.add(delta);
    controls.target.copy(solarPosition);
  } else if (viewMode === "galaxy") {
    controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.035);
  } else {
    const blendedTarget = getOverviewTarget(solarPosition);
    controls.target.lerp(blendedTarget, 0.032);
  }

  lastFrameSolarPosition.copy(solarPosition);
}

function updateLabels() {
  labelSprites.forEach((label) => {
    label.quaternion.copy(camera.quaternion);
    if (label.userData.labelKind === "body") {
      label.visible =
        viewportMode !== "mobile-portrait" ||
        label.userData.bodyKey === "sun" ||
        label.userData.bodyKey === "earth" ||
        label.userData.bodyKey === payloadState.targetKey;
    }
  });
}

function updateReadout() {
  const absDays = Math.max(0, simulationDays);
  const years = Math.floor(absDays / 365.25);
  const days = Math.floor(absDays % 365.25);
  const galacticAngle = (((simulationDays / GALACTIC_PERIOD_DAYS) * 360) % 360 + 360) % 360;

  elapsedTime.textContent = years > 0 ? `${years.toLocaleString("ko-KR")}년 ${days}일` : `${days}일`;
  galacticAngleReadout.textContent = `은하 ${galacticAngle.toFixed(2)}°`;
  updatePayloadReadout();
  document.documentElement.dataset.simDays = simulationDays.toFixed(2);
  document.documentElement.dataset.viewportMode = viewportMode;
  document.documentElement.dataset.galacticAngle = galacticAngle.toFixed(4);
  document.documentElement.dataset.solarPosition = solarSystem.position
    .toArray()
    .map((value) => value.toFixed(3))
    .join(",");
  document.documentElement.dataset.gravityFields = String(gravityFields.length);
  document.documentElement.dataset.bodyCount = String(bodies.length);
  document.documentElement.dataset.payloadActive = String(payloadState.active);
  document.documentElement.dataset.payloadPhase = payloadState.phase;
  document.documentElement.dataset.payloadProgress = payloadState.progress.toFixed(4);
  document.documentElement.dataset.payloadElapsedDays = payloadState.elapsed.toFixed(2);
  document.documentElement.dataset.payloadTransferDays = payloadState.transferDays.toFixed(2);
  document.documentElement.dataset.payloadOrbitPeriodDays = payloadState.orbitPeriodDays.toFixed(3);
  document.documentElement.dataset.payloadArrivalSpeedPerDay = payloadState.arrivalSpeedPerDay.toFixed(4);
  document.documentElement.dataset.payloadDestination = payloadState.targetKey;
  document.documentElement.dataset.payloadDestinationName = payloadState.targetName;
  document.documentElement.dataset.payloadNearest = payloadState.nearestBody;
  document.documentElement.dataset.payloadTrailPoints = String(payloadState.trailCount);
  document.documentElement.dataset.payloadSpeed = payloadState.velocity.length().toFixed(4);
  document.documentElement.dataset.payloadTargetDistance = getPayloadTargetDistance().toFixed(4);
  document.documentElement.dataset.payloadOrbitRadius = payloadState.orbitRadius.toFixed(4);
  document.documentElement.dataset.payloadLastStepDistance = payloadState.lastStepDistance.toFixed(4);
  document.documentElement.dataset.payloadTransitionStepDistance =
    payloadState.transitionStepDistance.toFixed(4);
  document.documentElement.dataset.payloadInsertionTurnDegrees =
    payloadState.insertionTurnAngle.toFixed(3);
  document.documentElement.dataset.payloadMaxRouteTurnDegrees = payloadState.maxRouteTurnAngle.toFixed(3);
  document.documentElement.dataset.payloadLoadIndex = payloadState.loadIndex.toFixed(3);
  document.documentElement.dataset.payloadBodyAvoidanceActive = String(payloadState.useBodyAvoidanceArc);
  document.documentElement.dataset.payloadBodyClearanceProjected = String(payloadState.enforceBodyClearance);
  document.documentElement.dataset.payloadBodyClearance = payloadState.bodyClearance.toFixed(4);
  document.documentElement.dataset.payloadBodyClearanceMargin = payloadState.bodyClearanceMargin.toFixed(4);
  document.documentElement.dataset.payloadBodyAvoidanceRadius = payloadState.bodyAvoidanceRadius.toFixed(4);
  document.documentElement.dataset.payloadBodyClearanceKey = payloadState.bodyClearanceKey;
  document.documentElement.dataset.payloadBodyClearanceName = payloadState.bodyClearanceName;
  document.documentElement.dataset.payloadSunAvoidanceActive = String(payloadState.useSunAvoidanceArc);
  document.documentElement.dataset.payloadSunClearance = payloadState.sunClearance.toFixed(4);
  document.documentElement.dataset.payloadSunAvoidanceRadius = payloadState.sunAvoidanceRadius.toFixed(4);
  document.documentElement.dataset.payloadGravityReadings = payloadState.gravityReadings
    .map((reading) => `${reading.name}:${reading.value.toFixed(5)}`)
    .join("|");
  document.documentElement.dataset.payloadPosition = payloadState.position
    .toArray()
    .map((value) => value.toFixed(3))
    .join(",");
}

function getPayloadTargetDistance() {
  const targetHandle = getBodyHandle(payloadState.targetKey);
  if (!payloadState.active || !targetHandle) {
    return 0;
  }
  return payloadState.position.distanceTo(getBodyPosition(targetHandle));
}

function updatePayloadReadout() {
  if (!payloadState.active) {
    const target = getBodyHandle(destinationSelect.value);
    payloadStatus.textContent = `${PAYLOAD_SIZE_METERS}m·${PAYLOAD_MASS_TONS}t → ${target?.body.name ?? "목적지"}`;
    swingbyButton.textContent = "스타트";
    return;
  }

  if (payloadState.phase === "transfer") {
    payloadStatus.textContent = `${payloadState.targetName} 전이 ${(payloadState.progress * 100).toFixed(0)}%`;
  } else if (payloadState.phase === "orbit") {
    payloadStatus.textContent = `${payloadState.targetName} 공전 ${payloadState.velocity.length().toFixed(2)}u/s`;
  } else {
    payloadStatus.textContent = `${payloadState.targetName} ${payloadState.velocity.length().toFixed(2)}u/s`;
  }
  swingbyButton.textContent = "재시작";
}

function updateCanvasDiagnostics() {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const sampleRatios = [0.16, 0.32, 0.5, 0.68, 0.84];
  const pixel = new Uint8Array(4);
  const buckets = new Set();
  let nonBlack = 0;
  let bright = 0;
  let total = 0;
  let samples = 0;

  const readPixel = (x, y) => {
    const px = THREE.MathUtils.clamp(Math.floor(x), 0, width - 1);
    const py = THREE.MathUtils.clamp(Math.floor(y), 0, height - 1);
    gl.readPixels(px, height - py - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const sum = pixel[0] + pixel[1] + pixel[2];
    if (sum > 18) {
      nonBlack += 1;
    }
    if (sum > 170) {
      bright += 1;
    }
    total += sum;
    samples += 1;
    buckets.add(`${pixel[0] >> 4},${pixel[1] >> 4},${pixel[2] >> 4}`);
  };

  sampleRatios.forEach((yRatio) => {
    sampleRatios.forEach((xRatio) => {
      readPixel(width * xRatio, height * yRatio);
    });
  });

  const targetPositions = [new THREE.Vector3(0, 0, 0)];
  bodyHandles.forEach(({ mesh }) => {
    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    targetPositions.push(position);
  });

  targetPositions.forEach((position) => {
    const projected = position.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) {
      return;
    }
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    if (x < -18 || x > width + 18 || y < -18 || y > height + 18) {
      return;
    }
    [-3, 0, 3].forEach((offsetX) => {
      [-3, 0, 3].forEach((offsetY) => {
        readPixel(x + offsetX, y + offsetY);
      });
    });
  });

  document.documentElement.dataset.canvasSamples = String(samples);
  document.documentElement.dataset.canvasNonBlack = String(nonBlack);
  document.documentElement.dataset.canvasBright = String(bright);
  document.documentElement.dataset.canvasColorBuckets = String(buckets.size);
  document.documentElement.dataset.canvasAvgRgbSum = String(Math.round(total / Math.max(samples, 1)));
  document.documentElement.dataset.canvasBuffer = `${width},${height}`;
}

function setViewMode(mode) {
  viewMode = mode;
  viewModeSelect.value = mode;

  const solarPosition = new THREE.Vector3();
  solarSystem.getWorldPosition(solarPosition);
  lastFrameSolarPosition.copy(solarPosition);

  if (mode === "solar") {
    controls.target.copy(solarPosition);
    camera.position.copy(solarPosition).add(getSolarCameraOffset());
  } else if (mode === "galaxy") {
    controls.target.set(0, 0, 0);
    camera.position.copy(getGalaxyCameraPosition());
  } else {
    controls.target.copy(getOverviewTarget(solarPosition));
    camera.position.copy(getOverviewCameraPosition());
  }
  controls.update();
}

function getOverviewTarget(solarPosition) {
  if (viewportMode === "mobile-portrait") {
    return solarPosition.clone().multiplyScalar(0.82);
  }

  if (viewportMode === "mobile-landscape") {
    return solarPosition.clone().multiplyScalar(0.58);
  }

  return solarPosition.clone().multiplyScalar(0.54);
}

function getViewportMode() {
  if (mobilePortraitQuery.matches) {
    return "mobile-portrait";
  }

  if (mobileLandscapeQuery.matches) {
    return "mobile-landscape";
  }

  return "desktop";
}

function getRendererPixelRatio() {
  const devicePixelRatio = window.devicePixelRatio || 1;
  if (viewportMode === "mobile-portrait") {
    return Math.min(devicePixelRatio, 1.35);
  }

  if (viewportMode === "mobile-landscape") {
    return Math.min(devicePixelRatio, 1.55);
  }

  return Math.min(devicePixelRatio, 2);
}

function getCameraFov() {
  return viewportMode === "mobile-portrait" ? 54 : 48;
}

function applyViewportMode(forceCamera = false) {
  const nextViewportMode = getViewportMode();
  const changed = nextViewportMode !== viewportMode;
  viewportMode = nextViewportMode;
  document.documentElement.dataset.viewportMode = viewportMode;

  if (advancedControls && (forceCamera || changed)) {
    advancedControls.open = viewportMode !== "mobile-portrait";
  }

  camera.fov = getCameraFov();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getRendererPixelRatio());
  controls.enablePan = viewportMode !== "mobile-portrait";
  controls.rotateSpeed = viewportMode === "desktop" ? 1 : 0.72;
  controls.zoomSpeed = viewportMode === "desktop" ? 1 : 0.82;

  if (forceCamera || changed) {
    setViewMode(viewMode);
  }
}

function getSolarCameraOffset() {
  if (viewportMode === "mobile-portrait") {
    return new THREE.Vector3(0, 46, 92);
  }

  if (viewportMode === "mobile-landscape") {
    return new THREE.Vector3(0, 30, 58);
  }

  return new THREE.Vector3(0, 28, 54);
}

function getGalaxyCameraPosition() {
  if (viewportMode === "mobile-portrait") {
    return new THREE.Vector3(0, 210, 0.1);
  }

  return new THREE.Vector3(0, 165, 0.1);
}

function getOverviewCameraPosition() {
  if (viewportMode === "mobile-portrait") {
    return new THREE.Vector3(118, 108, 242);
  }

  if (viewportMode === "mobile-landscape") {
    return new THREE.Vector3(102, 58, 142);
  }

  return new THREE.Vector3(96, 58, 132);
}

function createOrbitRing(radius, index) {
  const points = [];
  const segments = 240;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * TAU;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: index % 2 === 0 ? "#7ac9be" : "#e4bc72",
    transparent: true,
    opacity: 0.24,
  });
  return new THREE.Line(geometry, material);
}

function createGravityGrid(body) {
  const radius = THREE.MathUtils.clamp(body.radius * 4.6 + Math.log10(body.massEarth + 2) * 2.0, 4.4, 19);
  const divisions = body.key === "sun" ? 44 : body.massEarth > 20 ? 34 : 28;
  const step = (radius * 2) / divisions;
  const positions = [];
  const edgeKeys = new Set();
  const massCurve = Math.log10(body.massEarth + 1.35);
  const depth = Math.min(body.radius * 1.8, body.radius * (0.26 + massCurve * 0.42));
  const influence = Math.max(body.radius * 2.2, radius * 0.42);
  let cellCount = 0;

  const warp = (x, z) => {
    const distance = Math.sqrt(x * x + z * z);
    const well = -depth / (1 + (distance / influence) ** 2.3);
    const rim = Math.sin(distance * 1.7) * 0.018 * body.radius;
    return well + rim - body.radius * 0.12;
  };

  const coordinate = (index) => -radius + index * step;
  const addEdge = (key, x1, z1, x2, z2) => {
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    positions.push(x1, warp(x1, z1), z1, x2, warp(x2, z2), z2);
  };

  for (let zIndex = 0; zIndex < divisions; zIndex += 1) {
    for (let xIndex = 0; xIndex < divisions; xIndex += 1) {
      const centerX = coordinate(xIndex) + step * 0.5;
      const centerZ = coordinate(zIndex) + step * 0.5;
      if (Math.hypot(centerX, centerZ) > radius) {
        continue;
      }

      const x1 = coordinate(xIndex);
      const x2 = coordinate(xIndex + 1);
      const z1 = coordinate(zIndex);
      const z2 = coordinate(zIndex + 1);
      addEdge(`h:${zIndex}:${xIndex}`, x1, z1, x2, z1);
      addEdge(`h:${zIndex + 1}:${xIndex}`, x1, z2, x2, z2);
      addEdge(`v:${zIndex}:${xIndex}`, x1, z1, x1, z2);
      addEdge(`v:${zIndex}:${xIndex + 1}`, x2, z1, x2, z2);
      cellCount += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: body.gridColor,
    transparent: true,
    opacity: body.key === "sun" ? 0.18 : 0.34,
    depthWrite: false,
  });

  const grid = new THREE.Group();
  const lattice = new THREE.LineSegments(geometry, material);
  lattice.renderOrder = -1;
  grid.add(lattice);

  const boundaryPoints = [];
  const boundaryRadius = radius + step * 0.38;
  for (let i = 0; i < 192; i += 1) {
    const angle = (i / 192) * TAU;
    const x = Math.cos(angle) * boundaryRadius;
    const z = Math.sin(angle) * boundaryRadius;
    boundaryPoints.push(new THREE.Vector3(x, warp(x, z) + 0.012, z));
  }
  const boundary = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(boundaryPoints),
    new THREE.LineBasicMaterial({
      color: body.gridColor,
      transparent: true,
      opacity: body.key === "sun" ? 0.28 : 0.48,
      depthWrite: false,
    }),
  );
  boundary.renderOrder = -1;
  grid.add(boundary);

  grid.userData.body = body.key;
  grid.userData.cellShape = "square";
  grid.userData.outlineShape = "circular";
  grid.userData.cellCount = cellCount;
  return grid;
}

function createPlanetRing(body) {
  const geometry = new THREE.RingGeometry(body.ring.inner, body.ring.outer, 160, 2);
  const material = new THREE.MeshBasicMaterial({
    color: body.ring.color,
    transparent: true,
    opacity: body.ring.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = Math.PI / 2;
  ring.rotation.z = body.key === "uranus" ? THREE.MathUtils.degToRad(82) : THREE.MathUtils.degToRad(-18);
  return ring;
}

function createSunGlow(radius) {
  const geometry = new THREE.SphereGeometry(radius * 1.42, 48, 24);
  const material = new THREE.MeshBasicMaterial({
    color: "#ff8d2f",
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geometry, material);
}

function createFarStarfield() {
  const starCount =
    viewportMode === "mobile-portrait" ? 700 : viewportMode === "mobile-landscape" ? 1000 : 1400;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const random = mulberry32(9001);
  const color = new THREE.Color();

  for (let i = 0; i < starCount; i += 1) {
    const radius = 260 + random() * 520;
    const theta = random() * TAU;
    const phi = Math.acos(2 * random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    color.set(random() > 0.72 ? "#f3c178" : "#fff7ec");
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
  );
}

function createPlanetTexture(body) {
  const size = 512;
  const canvasTexture = document.createElement("canvas");
  canvasTexture.width = size;
  canvasTexture.height = size / 2;
  const ctx = canvasTexture.getContext("2d");
  const random = mulberry32(hashString(body.key));

  paintBase(ctx, body, size, size / 2);

  if (body.textureKind === "earth") {
    paintEarth(ctx, size, size / 2, random);
  } else if (body.textureKind === "gas" || body.textureKind === "bands") {
    paintGasGiant(ctx, body, size, size / 2, random);
  } else if (body.textureKind === "sun") {
    paintSun(ctx, size, size / 2, random);
  } else if (body.textureKind === "ice" || body.textureKind === "storm") {
    paintIceWorld(ctx, body, size, size / 2, random);
  } else if (body.textureKind === "cloudy") {
    paintVenus(ctx, size, size / 2, random);
  } else {
    paintRock(ctx, body, size, size / 2, random);
  }

  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = "rgba(255, 255, 255, 0.13)";
  ctx.fillRect(0, 0, size, size / 2);
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function paintBase(ctx, body, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  const base = new THREE.Color(body.color);
  const light = base.clone().offsetHSL(0, -0.04, 0.2);
  const dark = base.clone().offsetHSL(0, 0.08, -0.22);
  gradient.addColorStop(0, `#${light.getHexString()}`);
  gradient.addColorStop(0.52, body.color);
  gradient.addColorStop(1, `#${dark.getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function paintEarth(ctx, width, height, random) {
  const landColors = ["#4f9c57", "#6fb46a", "#c0a76a", "#316f56"];
  for (let i = 0; i < 34; i += 1) {
    ctx.fillStyle = landColors[Math.floor(random() * landColors.length)];
    const x = random() * width;
    const y = random() * height;
    const rx = 22 + random() * 62;
    const ry = 10 + random() * 28;
    drawBlob(ctx, x, y, rx, ry, random, 8);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath();
    const y = random() * height;
    ctx.moveTo(0, y);
    for (let x = 0; x <= width; x += 24) {
      ctx.lineTo(x, y + Math.sin(x * 0.03 + random() * 6) * 8);
    }
    ctx.stroke();
  }
}

function paintGasGiant(ctx, body, width, height, random) {
  const palette =
    body.key === "jupiter"
      ? ["#fff0cc", "#d89a62", "#b56f4b", "#f4c987", "#784832"]
      : ["#f2dfaa", "#d0a85f", "#ead099", "#b88f51"];

  for (let y = 0; y < height; y += 8 + random() * 14) {
    ctx.fillStyle = palette[Math.floor(random() * palette.length)];
    ctx.globalAlpha = 0.34 + random() * 0.36;
    ctx.fillRect(0, y, width, 6 + random() * 18);
  }
  ctx.globalAlpha = 1;

  if (body.key === "jupiter") {
    ctx.fillStyle = "rgba(151, 70, 42, 0.72)";
    ctx.beginPath();
    ctx.ellipse(width * 0.67, height * 0.58, 42, 18, -0.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 226, 174, 0.62)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function paintSun(ctx, width, height, random) {
  for (let i = 0; i < 220; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 6 + random() * 26;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(255, 244, 132, 0.74)");
    gradient.addColorStop(1, "rgba(239, 74, 34, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
}

function paintIceWorld(ctx, body, width, height, random) {
  const stormColor = body.key === "neptune" ? "rgba(22, 35, 122, 0.32)" : "rgba(255,255,255,0.25)";
  for (let y = 0; y < height; y += 14) {
    ctx.fillStyle = y % 28 === 0 ? "rgba(255,255,255,0.22)" : "rgba(37, 111, 155, 0.14)";
    ctx.fillRect(0, y + Math.sin(y) * 4, width, 7);
  }
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = stormColor;
    ctx.beginPath();
    ctx.ellipse(random() * width, random() * height, 18 + random() * 38, 6 + random() * 18, 0, 0, TAU);
    ctx.fill();
  }
}

function paintVenus(ctx, width, height, random) {
  for (let i = 0; i < 44; i += 1) {
    ctx.strokeStyle = `rgba(255, ${205 + random() * 32}, ${112 + random() * 28}, ${0.18 + random() * 0.22})`;
    ctx.lineWidth = 8 + random() * 18;
    ctx.beginPath();
    const y = random() * height;
    ctx.moveTo(0, y);
    for (let x = 0; x <= width; x += 32) {
      ctx.lineTo(x, y + Math.sin(x * 0.025 + i) * (6 + random() * 7));
    }
    ctx.stroke();
  }
}

function paintRock(ctx, body, width, height, random) {
  const palette =
    body.key === "mars"
      ? ["rgba(102, 45, 31, 0.35)", "rgba(232, 141, 83, 0.42)", "rgba(87, 45, 35, 0.28)"]
      : ["rgba(255, 255, 255, 0.20)", "rgba(65, 58, 47, 0.22)", "rgba(0, 0, 0, 0.15)"];

  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = palette[Math.floor(random() * palette.length)];
    ctx.beginPath();
    ctx.ellipse(
      random() * width,
      random() * height,
      3 + random() * 18,
      2 + random() * 11,
      random() * TAU,
      0,
      TAU,
    );
    ctx.fill();
  }
}

function drawBlob(ctx, x, y, rx, ry, random, points) {
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * TAU;
    const radiusX = rx * (0.66 + random() * 0.52);
    const radiusY = ry * (0.66 + random() * 0.52);
    const px = x + Math.cos(angle) * radiusX;
    const py = y + Math.sin(angle) * radiusY;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
}

function createLabelSprite(text, color) {
  const canvasLabel = document.createElement("canvas");
  canvasLabel.width = 256;
  canvasLabel.height = 96;
  const ctx = canvasLabel.getContext("2d");
  ctx.fillStyle = "rgba(8, 8, 9, 0.62)";
  roundedRect(ctx, 40, 24, 176, 44, 8);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(62, 46, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff4df";
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 135, 46);

  const texture = new THREE.CanvasTexture(canvasLabel);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4.4, 1.65, 1);
  return sprite;
}

function createGravityReadingSprite() {
  const canvasLabel = document.createElement("canvas");
  canvasLabel.width = 384;
  canvasLabel.height = 72;
  const texture = new THREE.CanvasTexture(canvasLabel);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4.8, 0.9, 1);
  sprite.userData = {
    canvas: canvasLabel,
    context: canvasLabel.getContext("2d"),
    lastText: "",
    lastColor: "",
  };
  updateGravityReadingSprite(sprite, "-", "#ffffff");
  return sprite;
}

function updateGravityReadingSprite(sprite, text, color) {
  if (sprite.userData.lastText === text && sprite.userData.lastColor === color) {
    return;
  }

  const { canvas, context } = sprite.userData;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8, 8, 9, 0.66)";
  roundedRect(context, 22, 10, 340, 48, 8);
  context.fillStyle = color;
  context.beginPath();
  context.arc(48, 34, 5, 0, TAU);
  context.fill();
  context.font = "800 24px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, 66, 35, 280);

  sprite.material.map.needsUpdate = true;
  sprite.userData.lastText = text;
  sprite.userData.lastColor = color;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

function createToonGradientTexture() {
  const data = new Uint8Array([
    42, 42, 46, 105, 105, 112, 186, 178, 158, 255, 246, 219,
  ]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
