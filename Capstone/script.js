let scene, camera, renderer;
let physicsWorld = null;
let vehicle = null;
let carBody = null;
let carMesh = null;
const clock = new THREE.Clock();
const timeStep = 1/60;
const maxSubSteps = 10;

// Track physics bodies
let physicsBodyCount = 0;

// Car state
const carState = {
    position: new THREE.Vector3(25, 0.6, 0),
    rotation: Math.PI / 2,
    engineForce: 3800,
    brakingForce: 90,
    maxSteeringAngle: 0.35,
    steeringSpeed: 6.0, // Increased for touch sensitivity
    currentSteering: 0,
    wheelRadius: 0.3,
    wheelWidth: 0.2,
    groundOffset: 0.3,
    modelRotationOffset: Math.PI / 2,
    trackCenter: new THREE.Vector3(0, 0, 0),
    speed: 0,
    lapCount: 0,
    lastQuadrant: 0
};

// Controls
// --- BEGIN: input handlers (replace your current key listeners) ---
const keys = { ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false, KeyW:false, KeyA:false, KeyS:false, KeyD:false };

let lastTime = performance.now();

function onKeyDown(e){
  // Use code, not key; prevent arrow scrolling
  switch (e.code) {
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      e.preventDefault(); break;
  }
  if (keys.hasOwnProperty(e.code)) keys[e.code] = true;
}
function onKeyUp(e){
  if (keys.hasOwnProperty(e.code)) keys[e.code] = false;
}
window.removeEventListener('keydown', onKeyDown);
window.removeEventListener('keyup', onKeyUp);
window.addEventListener('keydown', onKeyDown, { passive:false });
window.addEventListener('keyup', onKeyUp, { passive:true });
// --- END: input handlers ---

// Wheel references
const wheels = {
    frontLeft: null,
    frontRight: null,
    backLeft: null,
    backRight: null
};

// Camera control state
const cameraState = {
    distance: 8,
    minDistance: 0.5,
    maxDistance: 20,
    theta: Math.PI / 4,  // horizontal angle
    phi: Math.PI / 6,    // vertical angle
    minPhi: 0.1,         // minimum vertical angle
    maxPhi: Math.PI / 2 - 0.1,  // maximum vertical angle
    isDragging: false,
    lastX: 0,
    lastY: 0,
    zoomSpeed: 2,
    rotateSpeed: 0.01
};

let debugElement = document.getElementById('debug');

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    camera.position.set(25, 10, 15);
    camera.lookAt(25, 0, 0);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);
    
    console.log("Scene initialized");
}

function createRealisticRoad() {
  // ---------- VISUAL GROUND ----------
  const groundSize = 200;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);

  // Procedural grass-ish texture
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#225522';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const size = Math.random() * 3 + 1;
    ctx.fillStyle = Math.random() > 0.5 ? '#1e4d1e' : '#316231';
    ctx.fillRect(x, y, size, size);
  }

  const groundTex = new THREE.CanvasTexture(canvas);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x88aa88,
    roughness: 1.0,      // (0..1)
    metalness: 0.0,
    map: groundTex
  });

  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.position.y = 0.0; // visual ground at y = 0
  scene.add(ground);

  // ---------- PHYSICS GROUND (INFINITE PLANE @ y = 0) ----------
  if (physicsWorld) {
    const planeShape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(0, 1, 0), 0); // y-up plane
    const planeTransform = new Ammo.btTransform();
    planeTransform.setIdentity();
    planeTransform.setOrigin(new Ammo.btVector3(0, 0, 0));
    const planeMotion = new Ammo.btDefaultMotionState(planeTransform);
    const planeInfo = new Ammo.btRigidBodyConstructionInfo(0, planeMotion, planeShape, new Ammo.btVector3(0, 0, 0));
    const groundBody = new Ammo.btRigidBody(planeInfo);

    // Asphalt-like contact
    groundBody.setFriction(1.6);
    groundBody.setRestitution(0.05);
    // Helps reduce sideways skating for rigid contacts (vehicle mainly uses wheel friction)
    if (groundBody.setRollingFriction) groundBody.setRollingFriction(0.002);

    physicsWorld.addRigidBody(groundBody);
    physicsBodyCount++;
    console.log("Ground plane added, count:", physicsBodyCount);
  }

  // ---------- VISUAL ROAD (RING) ----------
  const roadWidth = 8;
  const roadOuterRadius = 30;
  const roadInnerRadius = roadOuterRadius - roadWidth;

  const roadCanvas = document.createElement('canvas');
  roadCanvas.width = 512;
  roadCanvas.height = 512;
  const roadCtx = roadCanvas.getContext('2d');
  roadCtx.fillStyle = '#333333';
  roadCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 10000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 2 + 0.5;
    const b = Math.floor(Math.random() * 20 + 30);
    roadCtx.fillStyle = `rgb(${b},${b},${b})`;
    roadCtx.fillRect(x, y, size, size);
  }

  const roadTexture = new THREE.CanvasTexture(roadCanvas);
  roadTexture.wrapS = THREE.RepeatWrapping;
  roadTexture.wrapT = THREE.RepeatWrapping;
  roadTexture.repeat.set(4, 1);
  if (typeof renderer !== 'undefined') {
    roadTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;
  }

  const roadRingGeometry = new THREE.RingGeometry(roadInnerRadius, roadOuterRadius, 96);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    roughness: 0.85,
    metalness: 0.0
  });
  const road = new THREE.Mesh(roadRingGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.005; // sit just above ground to avoid z-fighting
  road.receiveShadow = true;
  scene.add(road);

  // ---------- PHYSICS ROAD (HIGHER-GRIP PATCH @ y = 0) ----------
  if (physicsWorld) {
    // Approximate the ring by a thin, wide box (simple & fast); center at y = 0
    // Thickness is small; top surface is ~0 which matches visuals.
    const roadShape = new Ammo.btBoxShape(new Ammo.btVector3(roadOuterRadius, 0.025, roadOuterRadius));
    const roadTransform = new Ammo.btTransform();
    roadTransform.setIdentity();
    roadTransform.setOrigin(new Ammo.btVector3(0, 0, 0));
    const roadMotionState = new Ammo.btDefaultMotionState(roadTransform);
    const roadInfo = new Ammo.btRigidBodyConstructionInfo(0, roadMotionState, roadShape, new Ammo.btVector3(0, 0, 0));
    const roadBody = new Ammo.btRigidBody(roadInfo);

    // Give the road more grip than the grass
    roadBody.setFriction(1.8);
    roadBody.setRestitution(0.05);
    if (roadBody.setRollingFriction) roadBody.setRollingFriction(0.004);

    physicsWorld.addRigidBody(roadBody);
    physicsBodyCount++;
    console.log("Road body added, count:", physicsBodyCount);
  }

  // ---------- LINES & EDGES (VISUAL ONLY) ----------
  const centerLineGeometry = new THREE.RingGeometry(
    roadInnerRadius + roadWidth * 0.48,
    roadInnerRadius + roadWidth * 0.52,
    96
  );

  const centerLineCanvas = document.createElement('canvas');
  centerLineCanvas.width = 512; centerLineCanvas.height = 64;
  const lineCtx = centerLineCanvas.getContext('2d');
  lineCtx.fillStyle = '#ffffff';
  for (let i = 0; i < 512; i += 64) lineCtx.fillRect(i, 0, 32, 64);

  const centerLineTexture = new THREE.CanvasTexture(centerLineCanvas);
  centerLineTexture.wrapS = THREE.RepeatWrapping;
  centerLineTexture.repeat.set(8, 1);

  const centerLineMaterial = new THREE.MeshBasicMaterial({ map: centerLineTexture, transparent: true });
  const centerLine = new THREE.Mesh(centerLineGeometry, centerLineMaterial);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.y = 0.006;
  scene.add(centerLine);

  const edgeGeometry1 = new THREE.RingGeometry(roadOuterRadius - 0.4, roadOuterRadius, 96);
  const edgeGeometry2 = new THREE.RingGeometry(roadInnerRadius, roadInnerRadius + 0.4, 96);
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const outerEdge = new THREE.Mesh(edgeGeometry1, edgeMaterial);
  outerEdge.rotation.x = -Math.PI / 2; outerEdge.position.y = 0.006; scene.add(outerEdge);
  const innerEdge = new THREE.Mesh(edgeGeometry2, edgeMaterial);
  innerEdge.rotation.x = -Math.PI / 2; innerEdge.position.y = 0.006; scene.add(innerEdge);

  // ---------- TRACK META ----------
  carState.trackCenter = new THREE.Vector3(0, 0, 0);
  carState.trackRadius = roadInnerRadius + roadWidth / 2;
  carState.trackWidth = roadWidth;

  return {
    ground,
    road,
    centerLine,
    outerEdge,
    innerEdge,
    trackRadius: roadInnerRadius + roadWidth / 2,
    trackWidth: roadWidth
  };
}


function createObstacles() {
    if (!physicsWorld) return;

    const humpGeometry = new THREE.CylinderGeometry(3, 3, 0.5, 32);
    const humpMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    
    for (let i = 0; i < 5; i++) {
        const angle = Math.PI * 2 * (i / 5);
        const radius = carState.trackRadius + 5;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        const hump = new THREE.Mesh(humpGeometry, humpMaterial);
        hump.position.set(x, 0.25, z);
        hump.rotation.x = Math.PI / 2;
        hump.receiveShadow = true;
        hump.castShadow = true;
        scene.add(hump);
        
        const humpShape = new Ammo.btCylinderShape(new Ammo.btVector3(3, 0.25, 3));
        const humpTransform = new Ammo.btTransform();
        humpTransform.setIdentity();
        humpTransform.setOrigin(new Ammo.btVector3(x, 0.25, z));
        const mass = 0;
        const humpInertia = new Ammo.btVector3(0, 0, 0);
        const humpMotionState = new Ammo.btDefaultMotionState(humpTransform);
        const humpRbInfo = new Ammo.btRigidBodyConstructionInfo(mass, humpMotionState, humpShape, humpInertia);
        const humpBody = new Ammo.btRigidBody(humpRbInfo);
        humpBody.setFriction(1.0);
        physicsWorld.addRigidBody(humpBody);
        physicsBodyCount++;
        console.log("Hump body added, count:", physicsBodyCount);
    }

    const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.3, 2, 8);
    const leavesGeometry = new THREE.SphereGeometry(1.5, 16, 16);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
    
    for (let i = 0; i < 5; i++) {
        const angle = Math.PI * 2 * (i / 5);
        const radius = carState.trackRadius + 10;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.set(x, 1, z);
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        scene.add(trunk);
        
        const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
        leaves.position.set(x, 3, z);
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        scene.add(leaves);
        
        const treeShape = new Ammo.btCylinderShape(new Ammo.btVector3(0.3, 1, 0.3));
        const treeTransform = new Ammo.btTransform();
        treeTransform.setIdentity();
        treeTransform.setOrigin(new Ammo.btVector3(x, 1, z));
        const mass = 0;
        const treeInertia = new Ammo.btVector3(0, 0, 0);
        const treeMotionState = new Ammo.btDefaultMotionState(treeTransform);
        const treeRbInfo = new Ammo.btRigidBodyConstructionInfo(mass, treeMotionState, treeShape, treeInertia);
        const treeBody = new Ammo.btRigidBody(treeRbInfo);
        treeBody.setFriction(1.0);
        physicsWorld.addRigidBody(treeBody);
        physicsBodyCount++;
        console.log("Tree body added, count:", physicsBodyCount);
    }
}

async function initPhysics() {
    try {
        if (typeof Ammo === 'undefined') {
            throw new Error("Ammo.js not loaded");
        }
        const AmmoLib = await Ammo();
        if (!AmmoLib) {
            throw new Error("AmmoLib failed to initialize");
        }
        const collisionConfiguration = new AmmoLib.btDefaultCollisionConfiguration();
        const dispatcher = new AmmoLib.btCollisionDispatcher(collisionConfiguration);
        const broadphase = new AmmoLib.btDbvtBroadphase();
        const solver = new AmmoLib.btSequentialImpulseConstraintSolver();
        physicsWorld = new AmmoLib.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfiguration);
        if (!physicsWorld) {
            throw new Error("Physics world creation failed");
        }
        physicsWorld.setGravity(new AmmoLib.btVector3(0, -9.81, 0));
        
        console.log("Physics initialized successfully");
        return true;
    } catch (error) {
        console.error("Ammo.js initialization failed:", error);
        document.getElementById('loading').textContent = "Failed to load physics engine: " + error.message;
        return false;
    }
}

function settleVehicle() {
  if (!physicsWorld || !vehicle || !carBody) return;
  const body = vehicle.getRigidBody ? vehicle.getRigidBody() : carBody.body;
  const tr = new Ammo.btTransform();

  // Try up to ~0.5s of micro steps to find contact
  for (let iter = 0; iter < 60; iter++) {
    physicsWorld.stepSimulation(1/240, 0);

    let inContact = false;
    const n = vehicle.getNumWheels ? vehicle.getNumWheels() : 0;
    for (let i = 0; i < n; i++) {
      vehicle.updateWheelTransform(i, true);
      const wi = vehicle.getWheelInfo(i);
      const ri = wi.get_m_raycastInfo?.();
      if (ri && ri.get_m_isInContact && ri.get_m_isInContact()) {
        inContact = true; break;
      }
    }
    if (inContact) return; // done, we’re on the ground

    // Lower chassis a hair and try again
    body.getMotionState().getWorldTransform(tr);
    const o = tr.getOrigin();
    tr.setOrigin(new Ammo.btVector3(o.x(), o.y() - 0.02, o.z()));
    body.setWorldTransform(tr);
    body.getMotionState().setWorldTransform(tr);
    body.activate();
  }
}

function setupVehicle(chassisMesh) {
  if (!physicsWorld) { console.error("Physics world not initialized"); return; }

  const tuning = new Ammo.btVehicleTuning();
  tuning.m_suspensionStiffness = 28.0;
  tuning.m_suspensionCompression = 4.0;
  tuning.m_suspensionDamping = 6.0;
  tuning.m_maxSuspensionTravelCm = 8.0;
  tuning.m_frictionSlip = 60.0;
  tuning.m_maxSuspensionForce = 20000.0;

  const chassisShape = new Ammo.btBoxShape(new Ammo.btVector3(1.8, 0.6, 1.2));
  const mass = 700.0;
  const inertia = new Ammo.btVector3(0,0,0);
  chassisShape.calculateLocalInertia(mass, inertia);

  const start = new Ammo.btTransform(); start.setIdentity();
  const startY = 0.95; // comfy ride height to ensure wheel rays hit ground
  const startPos = carState.position || new THREE.Vector3(25, startY, 0);
  start.setOrigin(new Ammo.btVector3(startPos.x, startY, startPos.z));

  const motion = new Ammo.btDefaultMotionState(start);
  const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motion, chassisShape, inertia);
  const body = new Ammo.btRigidBody(rbInfo);
  body.setDamping(0.15, 0.25);
  body.setRestitution(0.05);
  body.setFriction(1.2);
  body.setActivationState(4);        // DISABLE_DEACTIVATION
  body.setSleepingThresholds(0, 0);  // never auto-sleep
  physicsWorld.addRigidBody(body);

  const ray = new Ammo.btDefaultVehicleRaycaster(physicsWorld);
  const veh = new Ammo.btRaycastVehicle(tuning, body, ray);
  veh.setCoordinateSystem(0, 1, 2); // right=X, up=Y, forward=Z
  physicsWorld.addAction(veh);

  const dir = new Ammo.btVector3(0,-1,0);
  const axle = new Ammo.btVector3(-1,0,0);
  const restLen = 0.32;
  const radius  = chassisMesh.userData.wheelRadius || carState.wheelRadius || 0.35;

  // CPs are [FL, FR, RL, RR]. If missing, synthesize.
  let cps = chassisMesh.userData.connectionPoints;
  if (!Array.isArray(cps) || cps.length !== 4) {
    chassisMesh.updateWorldMatrix(true,true);
    const bboxW = new THREE.Box3().setFromObject(chassisMesh);
    const inv = new THREE.Matrix4().copy(chassisMesh.matrixWorld).invert();
    const minL = bboxW.min.clone().applyMatrix4(inv);
    const maxL = bboxW.max.clone().applyMatrix4(inv);
    const hx = (maxL.x - minL.x) * 0.5;
    const hy = (maxL.y - minL.y) * 0.5;
    const hz = (maxL.z - minL.z) * 0.5;
    const x = hx*0.85, zf = hz*0.65, zr = -hz*0.65, y = -hy*0.55;
    cps = [[-x,y,zf],[x,y,zf],[-x,y,zr],[x,y,zr]];
  }

  for (let i = 0; i < 4; i++) {
    const p = cps[i];
    const cp = new Ammo.btVector3(p[0], p[1] + 0.05, p[2]);  // tiny Y nudge
    const isFront = (i < 2);
    veh.addWheel(cp, dir, axle, restLen, radius, tuning, isFront);
    const wi = veh.getWheelInfo(i);
    wi.m_suspensionStiffness = tuning.m_suspensionStiffness;
    wi.m_wheelsDampingRelaxation = tuning.m_suspensionDamping;
    wi.m_wheelsDampingCompression = tuning.m_suspensionCompression;
    wi.m_frictionSlip = tuning.m_frictionSlip;
    wi.m_rollInfluence = 0.1;
  }

  // Fixed indices: fronts = 0,1 ; rears = 2,3
  veh.__frontIndices = [0, 1];
  veh.__rearIndices  = [2, 3];

  carBody = { body, mesh: chassisMesh, vehicle: veh };
  vehicle = veh;

  // 👇 force-drive window (~2s) to bust static rest
  carState._bootDriveUntil = performance.now() + 2000;

  console.log(`setupVehicle(): wheels added = ${vehicle.getNumWheels?.()} | front=${vehicle.__frontIndices} rear=${vehicle.__rearIndices}`);
}

function createSimpleCar() {
    const carGroup = new THREE.Group();
    
    const bodyGeometry = new THREE.BoxGeometry(4, 1, 2.5);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.75;
    body.castShadow = true;
    body.receiveShadow = true;
    carGroup.add(body);
    
    const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    
    const wheelPositions = [
        { pos: [-1.5, -0.25, 0.9], name: "wheel_FL" },
        { pos: [1.5, -0.25, 0.9], name: "wheel_FR" },
        { pos: [-1.5, -0.25, -0.9], name: "wheel_RL" },
        { pos: [1.5, -0.25, -0.9], name: "wheel_RR" }
    ];
    
    wheelPositions.forEach((wheel) => {
        const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheelMesh.position.set(wheel.pos[0], wheel.pos[1], wheel.pos[2]);
        wheelMesh.rotation.z = Math.PI / 2;
        wheelMesh.castShadow = true;
        wheelMesh.receiveShadow = true;
        wheelMesh.name = wheel.name;
        carGroup.add(wheelMesh);
        wheels[wheel.name.replace("wheel_", "").toLowerCase()] = wheelMesh;
    });
    
    console.log("Simple car created:", Object.keys(wheels));
    return carGroup;
}
function _clearExistingCar() {
  if (vehicle) {
    physicsWorld.removeAction(vehicle);
    vehicle = null;
  }
  if (carBody?.body) {
    physicsWorld.removeRigidBody(carBody.body);
  }
  carBody = null;

  if (carMesh?.parent) scene.remove(carMesh);

  // keep the object, but clear wheel refs
  if (wheels.frontLeft?.parent)  scene.remove(wheels.frontLeft);
  if (wheels.frontRight?.parent) scene.remove(wheels.frontRight);
  if (wheels.backLeft?.parent)   scene.remove(wheels.backLeft);
  if (wheels.backRight?.parent)  scene.remove(wheels.backRight);

  wheels.frontLeft = wheels.frontRight = wheels.backLeft = wheels.backRight = null;
}
_clearExistingCar();

function _meshWorldDims(mesh) {
  mesh.geometry.computeBoundingBox?.();
  const bb = mesh.geometry.boundingBox;
  const s = mesh.getWorldScale(new THREE.Vector3());
  const sx = (bb.max.x - bb.min.x) * s.x;
  const sy = (bb.max.y - bb.min.y) * s.y;
  const sz = (bb.max.z - bb.min.z) * s.z;
  return new THREE.Vector3(sx, sy, sz);
}

function _isWheelish(mesh) {
  if (!mesh.isMesh || !mesh.geometry || mesh.geometry.isInstancedBufferGeometry) return false;
  // name hints help, but don't rely on them
  const n = (mesh.name || '').toLowerCase();
  const nameHint = /wheel|tyre|tire|rim|alloy/.test(n);

  const dims = _meshWorldDims(mesh);
  const arr = [dims.x, dims.y, dims.z].sort((a,b)=>a-b);
  const thickness = arr[0];
  const d1 = arr[1], d2 = arr[2];

  // round-ish (two large dims similar), one thin (axle)
  const roundish = (d1 > 0.15 && d2 > 0.15) && (Math.abs(d1 - d2) / Math.max(d1, d2) < 0.25);
  const thin = (thickness / ((d1 + d2) * 0.5)) < 0.35;

  // reasonable wheel diameter range in your scaled world
  const diameter = Math.max(d1, d2);
  const sizeOk = diameter > 0.25 && diameter < 1.5;

  return (roundish && thin && sizeOk) || nameHint;
}

function autoDetectWheels(root) {
  const candidates = [];
  root.traverse((child) => {
    if (child.isMesh && _isWheelish(child)) {
      const wp = child.getWorldPosition(new THREE.Vector3());
      const dims = _meshWorldDims(child);
      const diameter = Math.max(dims.x, dims.y, dims.z);
      candidates.push({ mesh: child, wp, diameter });
    }
  });

  if (candidates.length < 4) return null;

  // Sort by diameter, keep top 8 to avoid tiny bolts, then assign by quadrant
  candidates.sort((a,b)=>b.diameter - a.diameter);
  const top = candidates.slice(0, 8);

  // Assign FL/FR/RL/RR by world X (left -ve) and Z (front +ve) since vehicle uses +Z forward
  function pick(qx, qz) {
    // qx: -1 left, +1 right | qz: +1 front, -1 rear
    let best = null, bestScore = Infinity;
    for (const c of top) {
      const s = (Math.sign(c.wp.x) === qx ? 0 : 1) + (Math.sign(c.wp.z) === qz ? 0 : 1) * 1.1
              + 0.002 * Math.abs(c.wp.x) + 0.002 * Math.abs(c.wp.z);
      if (s < bestScore && !c.taken) { best = c; bestScore = s; }
    }
    if (best) best.taken = true;
    return best?.mesh || null;
  }

  return {
    frontLeft:  pick(-1, +1),
    frontRight: pick(+1, +1),
    backLeft:   pick(-1, -1),
    backRight:  pick(+1, -1),
  };
}

// If no wheels found, create visual proxies so steering/spin are visible anyway
function ensureProxyWheels(radius = 0.35, width = 0.22) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 20, 1, false);
  // cylinder axis = Y; rotate so axle aligns to X (Bullet axle)
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.2, roughness: 0.6 });

  function make() {
    const m = new THREE.Mesh(geo, mat.clone());
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  return {
    frontLeft:  make(),
    frontRight: make(),
    backLeft:   make(),
    backRight:  make(),
  };
}

async function loadCar() {
  if (typeof _clearExistingCar === 'function') _clearExistingCar();

  // --- helpers ---
  function _meshWorldDims(mesh) {
    mesh.geometry.computeBoundingBox?.();
    const bb = mesh.geometry.boundingBox;
    const s = mesh.getWorldScale(new THREE.Vector3());
    const sx = (bb.max.x - bb.min.x) * s.x;
    const sy = (bb.max.y - bb.min.y) * s.y;
    const sz = (bb.max.z - bb.min.z) * s.z;
    return new THREE.Vector3(sx, sy, sz);
  }
  function _isWheelish(mesh) {
    if (!mesh?.isMesh || !mesh.geometry || mesh.geometry.isInstancedBufferGeometry) return false;
    const n = (mesh.name || '').toLowerCase();
    const nameHint = /wheel|tyre|tire|rim|alloy/.test(n);
    const dims = _meshWorldDims(mesh);
    const arr = [dims.x, dims.y, dims.z].sort((a,b)=>a-b);
    const thickness = arr[0], d1 = arr[1], d2 = arr[2];
    const roundish = (d1 > 0.15 && d2 > 0.15) && (Math.abs(d1 - d2) / Math.max(d1, d2) < 0.25);
    const thin = (thickness / ((d1 + d2) * 0.5)) < 0.35;
    const diameter = Math.max(d1, d2);
    const sizeOk = diameter > 0.25 && diameter < 1.5;
    return (roundish && thin && sizeOk) || nameHint;
  }
  function autoDetectWheels(root) {
    const candidates = [];
    root.traverse((child) => {
      if (child.isMesh && _isWheelish(child)) {
        const wp = child.getWorldPosition(new THREE.Vector3());
        const dims = _meshWorldDims(child);
        const diameter = Math.max(dims.x, dims.y, dims.z);
        candidates.push({ mesh: child, wp, diameter });
      }
    });
    if (candidates.length < 4) return null;
    candidates.sort((a,b)=>b.diameter - a.diameter);
    const top = candidates.slice(0, 8);
    function pick(qx, qz) {
      let best=null, bestScore=Infinity;
      for (const c of top) {
        const s = (Math.sign(c.wp.x)===qx?0:1) + (Math.sign(c.wp.z)===qz?0:1)*1.1
                + 0.002*Math.abs(c.wp.x) + 0.002*Math.abs(c.wp.z);
        if (!c.taken && s < bestScore) { best=c; bestScore=s; }
      }
      if (best) best.taken = true;
      return best?.mesh || null;
    }
    return {
      frontLeft:  pick(-1,+1),
      frontRight: pick(+1,+1),
      backLeft:   pick(-1,-1),
      backRight:  pick(+1,-1),
    };
  }
  function ensureProxyWheels(radius = 0.35, width = 0.22) {
    const geo = new THREE.CylinderGeometry(radius, radius, width, 20, 1, false);
    geo.rotateZ(Math.PI / 2); // axle → X
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.2, roughness: 0.6 });
    function make() {
      const m = new THREE.Mesh(geo, mat.clone());
      m.castShadow = true; m.receiveShadow = true;
      m.userData.isProxy = true; // <-- tag proxy
      scene.add(m);
      return m;
    }
    return { frontLeft:make(), frontRight:make(), backLeft:make(), backRight:make() };
  }
  // --- end helpers ---

  return new Promise((resolve) => {
    const loader = new THREE.GLTFLoader();
    loader.load(
      'models/car.glb',
      (gltf) => {
        const root = gltf.scene;
        const s = 0.17;
        root.scale.set(s, s, s);
        root.position.copy(carState.position || new THREE.Vector3(25, 1, 0));
        root.rotation.y = (carState.rotation || 0) + (carState.modelRotationOffset || 0);

        root.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = true; child.receiveShadow = true;
          const name = (child.name || '').toLowerCase();
          if (child.geometry?.type === 'PlaneGeometry' || /plane|floor|ground|grid|circle/.test(name)) child.visible = false;
        });

        scene.add(root);
        root.updateWorldMatrix(true, true);

        if (!window.wheels) window.wheels = {};
        let detected = autoDetectWheels(root);

        // We'll fill this with 4 local CPs
        const cps = [];

        if (detected && detected.frontLeft && detected.frontRight && detected.backLeft && detected.backRight) {
          console.log('Wheel meshes auto-detected.');
          for (const key of ['frontLeft','frontRight','backLeft','backRight']) {
            const m = detected[key];
            m.updateWorldMatrix(true, false);
            const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
            m.matrixWorld.decompose(wp, wq, ws);
            scene.attach(m);
            m.position.copy(wp); m.quaternion.copy(wq); m.scale.copy(ws);
            m.userData.isProxy = false;
            wheels[key] = m;

            const lp = root.worldToLocal(wp.clone());
            cps.push([lp.x, lp.y, lp.z]);
          }
        } else {
          console.warn('Wheel meshes not found; creating proxy wheels for visuals.');
          // Derive CPs from chassis bbox in LOCAL space
          const bboxW = new THREE.Box3().setFromObject(root);
          const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
          const minL = bboxW.min.clone().applyMatrix4(inv);
          const maxL = bboxW.max.clone().applyMatrix4(inv);
          const hx = (maxL.x - minL.x) * 0.5;
          const hy = (maxL.y - minL.y) * 0.5;
          const hz = (maxL.z - minL.z) * 0.5;

          const x = hx * 0.85, zf =  hz * 0.65, zr = -hz * 0.65, y = -hy * 0.55;
          cps.push([-x, y,  zf]); // FL
          cps.push([ x, y,  zf]); // FR
          cps.push([-x, y,  zr]); // RL
          cps.push([ x, y,  zr]); // RR
          console.warn('Using bbox-derived connection points:', cps.map(v=>v.map(n=>+n.toFixed(3))));

          // Create proxies at those CP world positions
          const proxies = ensureProxyWheels(carState.wheelRadius || 0.35, 0.22);
          const order = ['frontLeft','frontRight','backLeft','backRight'];
          for (let i = 0; i < 4; i++) {
            const key = order[i];
            const lp = new THREE.Vector3(cps[i][0], cps[i][1], cps[i][2]);
            const wp = root.localToWorld(lp.clone());
            const m = proxies[key];
            m.position.copy(wp);
            m.quaternion.copy(root.quaternion); // physics will override
            wheels[key] = m;
          }
        }

        // Wheel radius
        let wheelRadius = carState.wheelRadius;
        if (!wheelRadius) {
          const pick = wheels.frontLeft || wheels.frontRight || wheels.backLeft || wheels.backRight;
          if (pick?.geometry) {
            pick.geometry.computeBoundingBox?.();
            const bb = pick.geometry.boundingBox;
            const sx = Math.abs(bb.max.x - bb.min.x);
            const sy = Math.abs(bb.max.y - bb.min.y);
            const sz = Math.abs(bb.max.z - bb.min.z);
            const dims = [sx, sy, sz].sort((a,b)=>a-b);
            const diameter = dims[2];
            wheelRadius = Math.max(0.15, Math.min(0.6, diameter * 0.5));
          } else {
            wheelRadius = 0.35;
          }
          carState.wheelRadius = wheelRadius;
        }

        root.userData.connectionPoints = cps;
        root.userData.wheelRadius = wheelRadius;

        console.log('Detected wheels:', ['frontLeft','frontRight','backLeft','backRight'].map(k => `${k}:${wheels?.[k]?.userData?.isProxy ? 'proxy' : (wheels?.[k]?.name || 'none')}`));
        console.log('Connection points (local):', cps.map(v => v.map(n => +n.toFixed(3))));
        console.log('Using wheelRadius:', +wheelRadius.toFixed(3));

        window.carMesh = root;
        resolve(root);
      },
      undefined,
      (err) => {
        console.error('GLB load failed:', err);
        const fallback = createSimpleCar();
        scene.add(fallback);
        fallback.userData.connectionPoints = [
          [-1.5, -0.25,  0.9],
          [ 1.5, -0.25,  0.9],
          [-1.5, -0.25, -0.9],
          [ 1.5, -0.25, -0.9],
        ];
        fallback.userData.wheelRadius = carState.wheelRadius || 0.35;
        window.carMesh = fallback;
        resolve(fallback);
      }
    );
  });
}



function setupControls() {
  // ----- Keyboard -----
  const el = renderer.domElement;
  el.tabIndex = 0;
  el.style.outline = 'none';
  el.addEventListener('pointerdown', () => el.focus(), { passive: true });

  const setTrue = (e) => {
    if (e.code in keys) {
      keys[e.code] = true;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  };
  const setFalse = (e) => {
    if (e.code in keys) keys[e.code] = false;
  };
  // attach on both element and window for safety
  el.addEventListener('keydown', setTrue, { passive: false });
  el.addEventListener('keyup', setFalse, { passive: true });
  window.addEventListener('keydown', setTrue, { passive: false });
  window.addEventListener('keyup', setFalse, { passive: true });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // ----- Prevent page scroll on arrows -----
  document.addEventListener('keydown', (e) => {
    if (e.code.startsWith('Arrow')) e.preventDefault();
  }, { passive: false });

  // ----- Mouse/touch steering (kept from your version) -----
  const domElement = el;
  let isDragging = false;
  let lastX = 0;
  let initialPinchDistance = 0;
  let initialTheta = cameraState.theta;
  let initialPhi = cameraState.phi;

  domElement.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    e.preventDefault();
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    keys.ArrowLeft = keys.ArrowRight = false;
  });

  domElement.addEventListener('mousemove', (e) => {
    if (!isDragging || !vehicle) return;
    const dx = e.clientX - lastX;
    if (Math.abs(dx) > 1) {
      keys.ArrowLeft = dx > 0;
      keys.ArrowRight = dx < 0;
    }
    lastX = e.clientX;
    e.preventDefault();
  });

  domElement.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && vehicle) {
      isDragging = true;
      lastX = e.touches[0].clientX;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDistance = Math.hypot(dx, dy);
      initialTheta = cameraState.theta;
      initialPhi = cameraState.phi;
    }
  });

  domElement.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isDragging && vehicle) {
      const dx = e.touches[0].clientX - lastX;
      if (Math.abs(dx) > 1) {
        keys.ArrowLeft = dx > 0;
        keys.ArrowRight = dx < 0;
      }
      lastX = e.touches[0].clientX;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.hypot(dx, dy);
      const scale = distance / initialPinchDistance;
      cameraState.distance = THREE.MathUtils.clamp(
        cameraState.distance * scale,
        cameraState.minDistance,
        cameraState.maxDistance
      );
      const avgX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      cameraState.theta = initialTheta - avgX * 0.005;
      cameraState.phi = THREE.MathUtils.clamp(
        initialPhi - avgY * 0.001,
        0.1,
        Math.PI / 2 - 0.1
      );
    }
  });

  domElement.addEventListener('touchend', () => {
    isDragging = false;
    keys.ArrowLeft = keys.ArrowRight = false;
    initialPinchDistance = 0;
  });

  // Zoom + right-click look-around (unchanged)
  renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
  renderer.domElement.addEventListener('mousemove', handleMouseMove);
  renderer.domElement.addEventListener('mousedown', handleMouseDown);
  renderer.domElement.addEventListener('mouseup', handleMouseUp);
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  console.log("Controls initialized");
}


function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY * -0.01 * cameraState.zoomSpeed;
    cameraState.distance = THREE.MathUtils.clamp(
        cameraState.distance + delta,
        cameraState.minDistance,
        cameraState.maxDistance
    );
}

function handleMouseDown(e) {
    if (e.button === 2) { // Right mouse button
        cameraState.isDragging = true;
        cameraState.lastX = e.clientX;
        cameraState.lastY = e.clientY;
    }
}

function handleMouseUp() {
    cameraState.isDragging = false;
}

function handleMouseMove(e) {
    if (!cameraState.isDragging) return;
    
    const dx = e.clientX - cameraState.lastX;
    const dy = e.clientY - cameraState.lastY;
    
    cameraState.theta -= dx * cameraState.rotateSpeed;
    cameraState.phi = THREE.MathUtils.clamp(
        cameraState.phi - dy * cameraState.rotateSpeed,
        cameraState.minPhi,
        cameraState.maxPhi
    );
    
    cameraState.lastX = e.clientX;
    cameraState.lastY = e.clientY;
}

function resetCar() {
    if (carBody) {
        carState.position.set(25, 0.6, 0);
        carState.rotation = Math.PI / 2;
        carState.speed = 0;
        carState.currentSteering = 0;
        carState.lapCount = 0;
        carState.lastQuadrant = 0;
        carBody.mesh.position.copy(carState.position);
        carBody.mesh.rotation.set(0, carState.rotation + carState.modelRotationOffset, 0);
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(carState.position.x, carState.position.y, carState.position.z));
        carBody.body.setWorldTransform(transform);
        carBody.body.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
        carBody.body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
        if (wheels.frontLeft) wheels.frontLeft.rotation.y = 0;
        if (wheels.frontRight) wheels.frontRight.rotation.y = 0;
        console.log("Car reset to:", carState.position);
    }
}

function updatePhysics(deltaTime) {
  if (!physicsWorld || !carBody || !vehicle) return;

  // Keep body awake
  carBody.body.activate();
  vehicle.getRigidBody?.().activate();

  // Safety reset
  const tr = new Ammo.btTransform();
  carBody.body.getMotionState().getWorldTransform(tr);
  if (tr.getOrigin().y() < -1) { resetCar(); return; }

  // Inputs
  const accel   = (keys.ArrowUp || keys.KeyW) ? 1 : 0;
  const reverse = (keys.ArrowDown || keys.KeyS) ? 1 : 0;
  const left    = (keys.ArrowLeft || keys.KeyA) ? 1 : 0;
  const right   = (keys.ArrowRight || keys.KeyD) ? 1 : 0;

  // Defaults
  const baseForce = (carState.engineForce || 2600) * 0.85;
  const coastBrake = (carState.brakingForce != null ? carState.brakingForce : 90) * 0.18;

  // --- auto-calibrate forward force sign ---
  if (carState._forceSign !== 1 && carState._forceSign !== -1) carState._forceSign = +1;
  const speedKmh = vehicle.getCurrentSpeedKmHour ? vehicle.getCurrentSpeedKmHour() : 0;

  if (accel) {
    // if we’ve been pressing accel for >0.7s and still ~0 speed, flip the sign once
    carState._accelHold = (carState._accelHold || 0) + deltaTime;
    if (!carState._signLocked && carState._accelHold > 0.7 && Math.abs(speedKmh) < 0.3) {
      carState._forceSign *= -1;     // flip forward direction
      carState._signLocked = true;   // don’t bounce back and forth
      console.log('Auto-calibrated engine force sign ->', carState._forceSign);
    }
  } else {
    carState._accelHold = 0;
  }

  // Engine force
  let engineForce = 0;
  if (accel)   engineForce =  carState._forceSign * baseForce;
  if (reverse) engineForce = -carState._forceSign * baseForce * 0.6;

  // Brakes: NO brake while applying engine force; light drag only when coasting
  const braking = (engineForce === 0) ? coastBrake : 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(braking, i);

  // Drive rears
  const rears = vehicle.__rearIndices || [2,3];
  for (const idx of rears) vehicle.applyEngineForce(engineForce, idx);

  // If nearly stuck, briefly help with all 4 wheels + a tiny impulse forward
  if ((accel || reverse) && Math.abs(speedKmh) < 0.2) {
    for (let i = 0; i < 4; i++) vehicle.applyEngineForce(engineForce * 0.5, i);
    const q = tr.getRotation();
    const tq = new THREE.Quaternion(q.x(), q.y(), q.z(), q.w());
    const fwd = new THREE.Vector3(0,0,1).applyQuaternion(tq).normalize().multiplyScalar(0.6);
    carBody.body.applyCentralImpulse(new Ammo.btVector3(fwd.x, 0, fwd.z));
  }

  // Steering (fronts)
  let steerTarget = 0;
  if (left)  steerTarget =  (carState.maxSteeringAngle ?? 0.35);
  if (right) steerTarget = -(carState.maxSteeringAngle ?? 0.35);
  carState.currentSteering = THREE.MathUtils.lerp(
    carState.currentSteering || 0,
    steerTarget,
    Math.min(1, (carState.steeringSpeed ?? 7) * deltaTime)
  );
  const fronts = vehicle.__frontIndices || [0,1];
  for (const idx of fronts) vehicle.setSteeringValue(carState.currentSteering, idx);

  // Step simulation
  physicsWorld.stepSimulation(deltaTime, maxSubSteps, timeStep);

  // (Visuals later)
  updateCarVisuals?.();
  updateCarStateFromPhysics?.();
}

function updateCarVisuals() {
  if (!carBody || !vehicle) return;

  // --- Chassis pose from Bullet ---
  const tr = new Ammo.btTransform();
  carBody.body.getMotionState().getWorldTransform(tr);
  const p = tr.getOrigin(), q = tr.getRotation();
  carBody.mesh.position.set(p.x(), p.y(), p.z());
  carBody.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());

  // Prepare correction quats per wheel (computed once from geometry)
  if (!carState._wheelCorrections) carState._wheelCorrections = [null, null, null, null];

  // Helper: compute a quaternion that rotates the wheel's local axle to +X (Bullet axle)
  function computeCorrection(mesh) {
    // Ensure we use the mesh's *local* geometry extents
    const geo = mesh.geometry;
    if (!geo.boundingBox) { geo.computeBoundingBox(); }
    const bb = geo.boundingBox;            // local-space
    const sx = Math.abs(bb.max.x - bb.min.x);
    const sy = Math.abs(bb.max.y - bb.min.y);
    const sz = Math.abs(bb.max.z - bb.min.z);

    // The smallest dimension is the axle direction (the "thickness" of the tire)
    let fromAxis = new THREE.Vector3(1,0,0); // default assume already X
    if (sx <= sy && sx <= sz) fromAxis.set(1,0,0);        // axle ≈ +X
    else if (sy <= sx && sy <= sz) fromAxis.set(0,1,0);   // axle ≈ +Y
    else fromAxis.set(0,0,1);                             // axle ≈ +Z

    // Build quaternion rotating from 'fromAxis' to +X
    const toAxis = new THREE.Vector3(1,0,0);
    const q = new THREE.Quaternion().setFromUnitVectors(fromAxis.normalize(), toAxis);
    return q;
  }

  // --- Update each wheel from Bullet's world transform ---
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    vehicle.updateWheelTransform(i, true);
    const wt = vehicle.getWheelTransformWS(i);
    const wp = wt.getOrigin();
    const wq = wt.getRotation();

    // Pick corresponding mesh
    let mesh = null;
    if (i === 0) mesh = wheels.frontLeft;
    if (i === 1) mesh = wheels.frontRight;
    if (i === 2) mesh = wheels.backLeft;
    if (i === 3) mesh = wheels.backRight;
    if (!mesh) continue;

    // Make sure it is NOT parented to chassis (parenting kills visual steer/spin)
    if (mesh.parent !== scene) {
      mesh.updateWorldMatrix(true, false);
      scene.attach(mesh);
    }

    // Compute & cache the correction once
    if (!carState._wheelCorrections[i]) {
      carState._wheelCorrections[i] = computeCorrection(mesh);
    }

    const bulletQuat = new THREE.Quaternion(wq.x(), wq.y(), wq.z(), wq.w());
const isProxy = !!(mesh.userData && mesh.userData.isProxy);
if (isProxy) {
  mesh.quaternion.copy(bulletQuat); // proxies already X-axle aligned
} else {
  // keep your existing correction if you had one:
  const corr = carState._wheelCorrection || new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,Math.PI/2));
  mesh.quaternion.copy(bulletQuat.multiply(corr));
}

  }
}


function updateCarStateFromPhysics() {
    if (!carBody) return;
    
    const transform = new Ammo.btTransform();
    carBody.body.getMotionState().getWorldTransform(transform);
    const pos = transform.getOrigin();
    
    carState.position.set(pos.x(), pos.y(), pos.z());
    
    const quat = transform.getRotation();
    const tempQuat = new THREE.Quaternion(quat.x(), quat.y(), quat.z(), quat.w());
    const euler = new THREE.Euler().setFromQuaternion(tempQuat);
    carState.rotation = euler.y;
    
    const velocity = carBody.body.getLinearVelocity();
    carState.speed = Math.sqrt(velocity.x() ** 2 + velocity.z() ** 2);
    
    updateDebugInfo();
}

function updateCamera() {
    if (!carBody) return;
    
    const carPos = carBody.mesh.position.clone();
    
    // Calculate camera position based on spherical coordinates
    const offset = new THREE.Vector3(
        cameraState.distance * Math.sin(cameraState.theta) * Math.cos(cameraState.phi),
        cameraState.distance * Math.sin(cameraState.phi),
        cameraState.distance * Math.cos(cameraState.theta) * Math.cos(cameraState.phi)
    );
    
    const targetPos = carPos.clone().add(offset);
    camera.position.lerp(targetPos, 0.1);
    
    const lookAtPos = carPos.clone();
    lookAtPos.y += 1; // Look slightly above the car's center
    camera.lookAt(lookAtPos);
}

function updateDebugInfo() {
    if (!debugElement) debugElement = document.getElementById('debug');
    if (!debugElement || !carBody) return;
    
    const velocity = carBody.body.getLinearVelocity();
    const speed = Math.sqrt(velocity.x() ** 2 + velocity.z() ** 2);
    
    debugElement.innerHTML = `
        <strong>Car Physics Debug:</strong><br>
        Position: X:${carState.position.x.toFixed(1)} Y:${carState.position.y.toFixed(1)} Z:${carState.position.z.toFixed(1)}<br>
        Speed: ${(speed * 3.6).toFixed(1)} km/h<br>
        Steering: ${(carState.currentSteering * 180/Math.PI).toFixed(1)}°<br>
        Rotation: ${(carState.rotation * 180/Math.PI).toFixed(1)}°<br>
        Laps: ${carState.lapCount}
    `;
}

function animate(now = performance.now()) {
  requestAnimationFrame(animate);

  // stable dt (clamped) for Ammo
  const deltaTime = Math.min(0.033, (now - lastTime) / 1000); // ~30ms max
  lastTime = now;

  if (physicsWorld && vehicle) {
    updatePhysics(deltaTime);   // physics FIRST
    if (typeof updateCamera === 'function') updateCamera();
  }

  renderer.render(scene, camera);
}


async function init() {
  try {
    console.log("Starting initialization...");
    document.getElementById('loading').textContent = "Initializing scene...";
    initScene();                      // (renderer is created inside this)

    // ⬅️ ensure inputs are wired to the canvas/renderer
    if (typeof setupInput === 'function') {
      setupInput(renderer);
    }

    document.getElementById('loading').textContent = "Loading physics...";
    const ok = await initPhysics();
    if (!ok) throw new Error("Physics initialization failed");

    document.getElementById('loading').textContent = "Creating road...";
    physicsBodyCount = 0;
    createRealisticRoad();

    document.getElementById('loading').textContent = "Setting up controls...";
    if (typeof setupControls === 'function') setupControls();

    document.getElementById('loading').textContent = "Loading car model...";
    const chassisMesh = await loadCar();
    setupVehicle(chassisMesh);
    settleVehicle(); 

    document.getElementById('loading').textContent = "Creating obstacles...";
    createObstacles();

    document.getElementById('loading').style.display = 'none';
    console.log("Initialization complete, physics bodies:", physicsBodyCount);

    // reset frame timer and start loop
    lastTime = performance.now();
    animate();
  } catch (error) {
    console.error("Initialization failed:", error);
    document.getElementById('loading').textContent = "Error: " + error.message;
  }
}


window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('load', init);