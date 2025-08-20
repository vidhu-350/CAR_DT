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
    engineForce: 1500,
    brakingForce: 150,
    maxSteeringAngle: 0.35,
    steeringSpeed: 6.0,
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
const keys = { ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false, KeyW:false, KeyA:false, KeyS:false, KeyD:false };

let lastTime = performance.now();

function onKeyDown(e){
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
    theta: Math.PI / 4,
    phi: Math.PI / 6,
    minPhi: 0.1,
    maxPhi: Math.PI / 2 - 0.1,
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
  const groundSize = 200;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);

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
    roughness: 1.0,
    metalness: 0.0,
    map: groundTex
  });

  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.position.y = 0.0;
  scene.add(ground);

  if (physicsWorld) {
    const planeShape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(0, 1, 0), 0);
    const planeTransform = new Ammo.btTransform();
    planeTransform.setIdentity();
    planeTransform.setOrigin(new Ammo.btVector3(0, 0, 0));
    const planeMotion = new Ammo.btDefaultMotionState(planeTransform);
    const planeInfo = new Ammo.btRigidBodyConstructionInfo(0, planeMotion, planeShape, new Ammo.btVector3(0, 0, 0));
    const groundBody = new Ammo.btRigidBody(planeInfo);

    groundBody.setFriction(2.5);
    groundBody.setRestitution(0.1);
    if (groundBody.setRollingFriction) groundBody.setRollingFriction(0.005);

    physicsWorld.addRigidBody(groundBody);
    physicsBodyCount++;
    console.log("Ground plane added, count:", physicsBodyCount);
  }

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
  if (renderer) {
    roadTexture.anisotropy = renderer.capabilities.getMaxAnisotropy() || 1;
  }

  const roadRingGeometry = new THREE.RingGeometry(roadInnerRadius, roadOuterRadius, 96);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    roughness: 0.85,
    metalness: 0.0
  });
  const road = new THREE.Mesh(roadRingGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.005;
  road.receiveShadow = true;
  scene.add(road);

  if (physicsWorld) {
    const roadShape = new Ammo.btBoxShape(new Ammo.btVector3(roadOuterRadius, 0.025, roadOuterRadius));
    const roadTransform = new Ammo.btTransform();
    roadTransform.setIdentity();
    roadTransform.setOrigin(new Ammo.btVector3(0, 0, 0));
    const roadMotionState = new Ammo.btDefaultMotionState(roadTransform);
    const roadInfo = new Ammo.btRigidBodyConstructionInfo(0, roadMotionState, roadShape, new Ammo.btVector3(0, 0, 0));
    const roadBody = new Ammo.btRigidBody(roadInfo);

    roadBody.setFriction(2.5);
    roadBody.setRestitution(0.1);
    if (roadBody.setRollingFriction) roadBody.setRollingFriction(0.005);

    physicsWorld.addRigidBody(roadBody);
    physicsBodyCount++;
    console.log("Road body added, count:", physicsBodyCount);
  }

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

  carState.trackCenter = new THREE.Vector3(0, 0, 0);
  carState.trackRadius = roadInnerRadius + roadWidth / 2;
  carState.trackWidth = roadWidth;

  return { ground, road, centerLine, outerEdge, innerEdge, trackRadius: roadInnerRadius + roadWidth / 2, trackWidth: roadWidth };
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
        humpBody.setFriction(3.0);
        humpBody.setRestitution(0.1);
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
        treeBody.setFriction(3.0);
        treeBody.setRestitution(0.1);
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
        physicsWorld.setGravity(new Ammo.btVector3(0, -9.81, 0));
        
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
  const body = carBody.body;
  const tr = new Ammo.btTransform();

  body.getMotionState().getWorldTransform(tr);
  const o = tr.getOrigin();
  tr.setOrigin(new Ammo.btVector3(o.x(), carState.wheelRadius + carState.groundOffset, o.z()));
  tr.setRotation(new Ammo.btQuaternion(0, Math.sin(carState.rotation / 2), 0, Math.cos(carState.rotation / 2)));
  body.setWorldTransform(tr);
  body.getMotionState().setWorldTransform(tr);
  body.setLinearVelocity(new Ammo.btVector3(0, -0.2, 0));
  body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
  body.activate();

  for (let i = 0; i < 3; i++) {
    physicsWorld.stepSimulation(1/60, 1);
  }
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
  if (!inContact) {
    console.warn("Vehicle settling failed, forcing final position");
    body.getMotionState().getWorldTransform(tr);
    const pos = tr.getOrigin();
    tr.setOrigin(new Ammo.btVector3(pos.x(), carState.wheelRadius + carState.groundOffset, pos.z()));
    body.setWorldTransform(tr);
    body.getMotionState().setWorldTransform(tr);
    body.activate();
  } else {
    console.log("Vehicle settled on ground after initial steps");
  }
}

function setupVehicle(chassisMesh) {
  if (!physicsWorld) { console.error("Physics world not initialized"); return; }

  const halfWidth = 0.85;
  const halfHeight = 0.35;
  const halfLength = 1.8;
  const chassisShape = new Ammo.btBoxShape(new Ammo.btVector3(halfWidth, halfHeight, halfLength));
  const mass = 900.0;
  const inertia = new Ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(mass, inertia);

  const start = new Ammo.btTransform();
  start.setIdentity();
  const startY = carState.wheelRadius + carState.groundOffset;
  const startPos = carState.position.clone();
  startPos.y = startY;
  start.setOrigin(new Ammo.btVector3(startPos.x, startY, startPos.z));
  start.setRotation(new Ammo.btQuaternion(0, Math.sin(carState.rotation / 2), 0, Math.cos(carState.rotation / 2)));

  const motion = new Ammo.btDefaultMotionState(start);
  const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motion, chassisShape, inertia);
  const body = new Ammo.btRigidBody(rbInfo);
  // Improved damping to prevent flipping
  body.setDamping(0.15, 0.85);
  body.setRestitution(0.02);
  body.setFriction(3.0);
  body.setActivationState(4);
  body.setSleepingThresholds(0, 0);
  physicsWorld.addRigidBody(body);

  const tuning = new Ammo.btVehicleTuning();
  tuning.m_suspensionStiffness = 35.0;  // Reduced stiffness
  tuning.m_suspensionCompression = 2.5;  // Reduced compression
  tuning.m_suspensionDamping = 3.5;     // Increased damping
  tuning.m_maxSuspensionTravelCm = 30.0;  // Increased travel
  tuning.m_frictionSlip = 1000.0;       // Much higher friction
  tuning.m_maxSuspensionForce = 15000.0;

  const ray = new Ammo.btDefaultVehicleRaycaster(physicsWorld);
  const veh = new Ammo.btRaycastVehicle(tuning, body, ray);
  veh.setCoordinateSystem(0, 1, 2);

  physicsWorld.addAction(veh);

  const dir = new Ammo.btVector3(0, -1, 0);
  const axle = new Ammo.btVector3(-1, 0, 0);  // Fixed axle direction
  const restLen = 0.3;  // Increased rest length
  const radius = carState.wheelRadius;

  const cps = [
    [-0.8, -0.3, 1.3],  // FL
    [0.8, -0.3, 1.3],   // FR
    [-0.8, -0.3, -1.3], // RL
    [0.8, -0.3, -1.3]   // RR
  ];

  for (let i = 0; i < 4; i++) {
    const p = cps[i];
    const cp = new Ammo.btVector3(p[0], p[1], p[2]);
    const isFront = (i < 2);
    veh.addWheel(cp, dir, axle, restLen, radius, tuning, isFront);
    const wi = veh.getWheelInfo(i);
    wi.m_suspensionStiffness = tuning.m_suspensionStiffness;
    wi.m_wheelsDampingRelaxation = tuning.m_suspensionDamping;
    wi.m_wheelsDampingCompression = tuning.m_suspensionCompression;
    wi.m_frictionSlip = tuning.m_frictionSlip;
    wi.m_rollInfluence = 0.05;  // Reduced roll influence
  }

  veh.__frontIndices = [0, 1];
  veh.__rearIndices = [2, 3];

  carBody = { body, mesh: chassisMesh, vehicle: veh };
  vehicle = veh;

  console.log(`setupVehicle(): wheels added = ${vehicle.getNumWheels?.()} | front=${veh.__frontIndices} rear=${veh.__rearIndices}`);
}

function createSimpleCar() {
    const carGroup = new THREE.Group();
    
    const bodyGeometry = new THREE.BoxGeometry(3.6, 0.7, 1.7);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.35;
    body.castShadow = true;
    body.receiveShadow = true;
    carGroup.add(body);
    
    carGroup.traverse((child) => {
        if (child.isMesh && (child.geometry.type === 'PlaneGeometry' || child.geometry.attributes.position.count < 4)) {
            child.visible = false;
        }
    });
    
    console.log("Simple car created with no plane artifacts");
    return carGroup;
}

function ensureProxyWheels(radius = 0.3, width = 0.2) {
    return {
        frontLeft: { mesh: null },
        frontRight: { mesh: null },
        backLeft: { mesh: null },
        backRight: { mesh: null }
    };
}

function loadCar() {
  return new Promise((resolve) => {
    const loader = new THREE.GLTFLoader();
    loader.load(
      'models/car.glb',
      (gltf) => {
        const root = gltf.scene;
        root.scale.set(0.17, 0.17, 0.17);
        root.position.copy(carState.position);
        root.rotation.y = carState.rotation + carState.modelRotationOffset;
        root.rotation.x = -Math.PI / 2;

        root.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.geometry.type === 'PlaneGeometry' || child.geometry.attributes.position.count < 6) {
              child.visible = false;
            } else {
              switch(child.name) {
                case 'MODEL_1_v1005': wheels.frontLeft = child; break;
                case 'MODEL_1_v1004': wheels.frontRight = child; break;
                case 'MODEL_1_v1006': wheels.backLeft = child; break;
                case 'MODEL_1_v1003': wheels.backRight = child; break;
              }
            }
          }
        });

        scene.add(root);
        root.updateWorldMatrix(true, true);

        if (!wheels.frontLeft || !wheels.frontRight || !wheels.backLeft || !wheels.backRight) {
          console.warn('Some wheel meshes not found, using proxy wheels');
          const proxies = ensureProxyWheels(carState.wheelRadius || 0.3, 0.2);
          wheels.frontLeft = proxies.frontLeft;
          wheels.frontRight = proxies.frontRight;
          wheels.backLeft = proxies.backLeft;
          wheels.backRight = proxies.backRight;
        }

        carState.wheelRadius = 0.3;
        root.userData.wheelRadius = carState.wheelRadius;

        window.carMesh = root;
        resolve(root);
      },
      undefined,
      (err) => {
        console.error('GLB load failed:', err);
        const fallback = createSimpleCar();
        scene.add(fallback);
        fallback.userData.connectionPoints = [
          [-0.8, -0.3, 1.3],
          [0.8, -0.3, 1.3],
          [-0.8, -0.3, -1.3],
          [0.8, -0.3, -1.3]
        ];
        fallback.userData.wheelRadius = 0.3;
        window.carMesh = fallback;
        resolve(fallback);
      }
    );
  });
}

function setupControls() {
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
  el.addEventListener('keydown', setTrue, { passive: false });
  el.addEventListener('keyup', setFalse, { passive: true });
  window.addEventListener('keydown', setTrue, { passive: false });
  window.addEventListener('keyup', setFalse, { passive: true });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  document.addEventListener('keydown', (e) => {
    if (e.code.startsWith('Arrow')) e.preventDefault();
  }, { passive: false });

  const domElement = el;
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  domElement.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  domElement.addEventListener('mousemove', (e) => {
    if (!isDragging || !vehicle) return;
    
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    
    cameraState.theta += dx * cameraState.rotateSpeed;
    cameraState.phi = THREE.MathUtils.clamp(cameraState.phi - dy * cameraState.rotateSpeed, cameraState.minPhi, cameraState.maxPhi);
    
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraState.distance += e.deltaY * -cameraState.zoomSpeed;
    cameraState.distance = Math.max(cameraState.minDistance, Math.min(cameraState.maxDistance, cameraState.distance));
  }, { passive: false });

  console.log("Controls initialized");
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
        console.log("Car reset to:", carState.position);
    }
}

function updatePhysics(deltaTime) {
  if (!physicsWorld || !carBody || !vehicle) return;

  carBody.body.activate();
  vehicle.getRigidBody?.().activate();

  const tr = new Ammo.btTransform();
  carBody.body.getMotionState().getWorldTransform(tr);
  if (tr.getOrigin().y() < -1) { resetCar(); return; }

  const accel = (keys.ArrowUp || keys.KeyW) ? 1 : 0;
  const reverse = (keys.ArrowDown || keys.KeyS) ? 1 : 0;
  const left = (keys.ArrowLeft || keys.KeyA) ? 1 : 0;
  const right = (keys.ArrowRight || keys.KeyD) ? 1 : 0;

  let force = 0;
  if (accel) force = carState.engineForce;
  if (reverse) force = -carState.engineForce * 0.5;  // Increased reverse power

  const rears = vehicle.__rearIndices || [2, 3];
  for (const idx of rears) {
    vehicle.applyEngineForce(force, idx);
  }

  // Improved braking system
  let brakingForce = 0;
  if (!accel && !reverse) {
    // Apply gradual braking when no input
    brakingForce = carState.brakingForce * 2;
  }
  
  for (let i = 0; i < 4; i++) {
    vehicle.setBrake(brakingForce, i);
  }

  let steerTarget = 0;
  if (left) steerTarget = carState.maxSteeringAngle;
  if (right) steerTarget = -carState.maxSteeringAngle;
  
  carState.currentSteering = THREE.MathUtils.lerp(
    carState.currentSteering,
    steerTarget,
    Math.min(1, carState.steeringSpeed * deltaTime * 60)
  );

  const fronts = vehicle.__frontIndices || [0, 1];
  for (const idx of fronts) {
    vehicle.setSteeringValue(carState.currentSteering, idx);
  }

  physicsWorld.stepSimulation(deltaTime, maxSubSteps, timeStep);

  updateCarVisuals(deltaTime);
  updateCarStateFromPhysics();
}

function updateCarVisuals(deltaTime) {
  if (!carBody || !vehicle || !carBody.body) return;

  const tr = new Ammo.btTransform();
  carBody.body.getMotionState().getWorldTransform(tr);
  const p = tr.getOrigin();
  const q = tr.getRotation();
  carBody.mesh.position.set(p.x(), p.y(), p.z());
  carBody.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());

  // Update wheel rotations based on movement (ORIGINAL METHOD)
  const velocity = carBody.body.getLinearVelocity();
  const moveDistance = Math.sqrt(velocity.x() ** 2 + velocity.z() ** 2) * deltaTime;
  const wheelRotationAmount = moveDistance / (2 * Math.PI * carState.wheelRadius);

  if (wheels.frontLeft) wheels.frontLeft.rotation.z += wheelRotationAmount * 5;
  if (wheels.frontRight) wheels.frontRight.rotation.z += wheelRotationAmount * 5;
  if (wheels.backLeft) wheels.backLeft.rotation.z += wheelRotationAmount * 5;
  if (wheels.backRight) wheels.backRight.rotation.z += wheelRotationAmount * 5;

  // Apply steering to front wheels (ORIGINAL METHOD)
  if (wheels.frontLeft) wheels.frontLeft.rotation.y = carState.currentSteering;
  if (wheels.frontRight) wheels.frontRight.rotation.y = carState.currentSteering;

  // Stability check to prevent flipping
  const angularVel = carBody.body.getAngularVelocity();
  
  // If car is moving too fast or rotating too much, apply stabilization
  if (Math.abs(angularVel.x()) > 2 || Math.abs(angularVel.z()) > 2) {
    carBody.body.setAngularVelocity(new Ammo.btVector3(
      angularVel.x() * 0.8,
      angularVel.y(),
      angularVel.z() * 0.8
    ));
  }

  if (p.y() < carState.wheelRadius + carState.groundOffset - 0.1 || 
      Math.abs(carBody.mesh.rotation.x) > Math.PI / 2 || 
      Math.abs(carBody.mesh.rotation.z) > Math.PI / 2) {
    tr.setOrigin(new Ammo.btVector3(p.x(), carState.wheelRadius + carState.groundOffset, p.z()));
    tr.setRotation(new Ammo.btQuaternion(0, Math.sin(carState.rotation / 2), 0, Math.cos(carState.rotation / 2)));
    carBody.body.setWorldTransform(tr);
    carBody.body.getMotionState().setWorldTransform(tr);
    carBody.body.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
    carBody.body.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
    carBody.body.activate();
    console.log("Car stabilized due to sinking or flipping");
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
    
    const offset = new THREE.Vector3(
        cameraState.distance * Math.sin(cameraState.theta) * Math.cos(cameraState.phi),
        cameraState.distance * Math.sin(cameraState.phi),
        cameraState.distance * Math.cos(cameraState.theta) * Math.cos(cameraState.phi)
    );
    
    const targetPos = carPos.clone().add(offset);
    camera.position.lerp(targetPos, 0.1);
    
    const lookAtPos = carPos.clone();
    lookAtPos.y += 1;
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

  const deltaTime = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (physicsWorld && vehicle) {
    updatePhysics(deltaTime);
    updateCamera();
  }

  renderer.render(scene, camera);
}

async function init() {
  try {
    console.log("Starting initialization...");
    document.getElementById('loading').textContent = "Initializing scene...";
    initScene();

    document.getElementById('loading').textContent = "Loading physics...";
    const ok = await initPhysics();
    if (!ok) throw new Error("Physics initialization failed");

    document.getElementById('loading').textContent = "Creating road...";
    physicsBodyCount = 0;
    createRealisticRoad();

    document.getElementById('loading').textContent = "Setting up controls...";
    setupControls();

    document.getElementById('loading').textContent = "Loading car model...";
    const chassisMesh = await loadCar();
    setupVehicle(chassisMesh);
    settleVehicle();

    document.getElementById('loading').textContent = "Creating obstacles...";
    createObstacles();

    document.getElementById('loading').style.display = 'none';
    console.log("Initialization complete, physics bodies:", physicsBodyCount);

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
