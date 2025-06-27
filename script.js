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
    engineForce: 2400,
    brakingForce: 800,
    maxSteeringAngle: 0.3,
    steeringSpeed: 3.0, // Increased for touch sensitivity
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
const keys = {
    ArrowUp: false, ArrowDown: false, 
    ArrowLeft: false, ArrowRight: false,
    KeyW: false, KeyS: false, 
    KeyA: false, KeyD: false
};

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
    const groundSize = 200;
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = '#225522';
    context.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 3 + 1;
        const color = Math.random() > 0.5 ? '#1e4d1e' : '#316231';
        context.fillStyle = color;
        context.fillRect(x, y, size, size);
    }
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x88aa88,
        roughness: 2.0,
        metalness: 0.1,
        map: new THREE.CanvasTexture(canvas)
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    if (physicsWorld) {
        const groundShape = new Ammo.btBoxShape(new Ammo.btVector3(100, 0.5, 100));
        const groundTransform = new Ammo.btTransform();
        groundTransform.setIdentity();
        groundTransform.setOrigin(new Ammo.btVector3(0, -0.49, 0)); // Top at y = 0.01
        const mass = 0;
        const localInertia = new Ammo.btVector3(0, 0, 0);
        const motionState = new Ammo.btDefaultMotionState(groundTransform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, groundShape, localInertia);
        const groundBody = new Ammo.btRigidBody(rbInfo);
        groundBody.setFriction(2.0);
        physicsWorld.addRigidBody(groundBody);
        physicsBodyCount++;
        console.log("Ground body added, count:", physicsBodyCount);
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
        const brightness = Math.random() * 20 + 30;
        roadCtx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
        roadCtx.fillRect(x, y, size, size);
    }
    const roadTexture = new THREE.CanvasTexture(roadCanvas);
    roadTexture.wrapS = THREE.RepeatWrapping;
    roadTexture.wrapT = THREE.RepeatWrapping;
    roadTexture.repeat.set(4, 1);
    const roadRingGeometry = new THREE.RingGeometry(roadInnerRadius, roadOuterRadius, 96);
    const roadMaterial = new THREE.MeshStandardMaterial({
        map: roadTexture,
        roughness: 0.8,
        metalness: 0.1
    });
    const road = new THREE.Mesh(roadRingGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    scene.add(road);

    if (physicsWorld) {
        const roadShape = new Ammo.btBoxShape(new Ammo.btVector3(roadOuterRadius, 0.01, roadOuterRadius));
        const roadTransform = new Ammo.btTransform();
        roadTransform.setIdentity();
        roadTransform.setOrigin(new Ammo.btVector3(0, 0.01, 0));
        const mass = 0;
        const roadInertia = new Ammo.btVector3(0, 0, 0);
        const roadMotionState = new Ammo.btDefaultMotionState(roadTransform);
        const roadRbInfo = new Ammo.btRigidBodyConstructionInfo(mass, roadMotionState, roadShape, roadInertia);
        const roadBody = new Ammo.btRigidBody(roadRbInfo);
        roadBody.setFriction(2.0);
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
    centerLineCanvas.width = 512;
    centerLineCanvas.height = 64;
    const lineCtx = centerLineCanvas.getContext('2d');
    lineCtx.fillStyle = '#ffffff';
    for (let i = 0; i < 512; i += 64) {
        lineCtx.fillRect(i, 0, 32, 64);
    }
    const centerLineTexture = new THREE.CanvasTexture(centerLineCanvas);
    centerLineTexture.wrapS = THREE.RepeatWrapping;
    centerLineTexture.repeat.set(8, 1);
    const centerLineMaterial = new THREE.MeshBasicMaterial({
        map: centerLineTexture,
        transparent: true
    });
    const centerLine = new THREE.Mesh(centerLineGeometry, centerLineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.02;
    scene.add(centerLine);

    const edgeGeometry1 = new THREE.RingGeometry(roadOuterRadius - 0.4, roadOuterRadius, 96);
    const edgeGeometry2 = new THREE.RingGeometry(roadInnerRadius, roadInnerRadius + 0.4, 96);
    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const outerEdge = new THREE.Mesh(edgeGeometry1, edgeMaterial);
    outerEdge.rotation.x = -Math.PI / 2;
    outerEdge.position.y = 0.02;
    scene.add(outerEdge);
    const innerEdge = new THREE.Mesh(edgeGeometry2, edgeMaterial);
    innerEdge.rotation.x = -Math.PI / 2;
    innerEdge.position.y = 0.02;
    scene.add(innerEdge);

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

function setupVehicle(chassisMesh) {
    if (!physicsWorld) {
        console.error("Physics world not initialized");
        return;
    }

    const tuning = new Ammo.btVehicleTuning();
    tuning.m_suspensionStiffness = 20.0;
    tuning.m_suspensionCompression = 0.3;
    tuning.m_suspensionDamping = 1.0;
    tuning.m_maxSuspensionTravelCm = 20.0;
    tuning.m_frictionSlip = 12.0;
    tuning.m_maxSuspensionForce = 10000.0;

    // Adjust chassis shape to better match your car model
    const chassisShape = new Ammo.btBoxShape(new Ammo.btVector3(1.8, 0.6, 1.2));
    const mass = 600.0;
    const chassisInertia = new Ammo.btVector3(0, 0, 0);
    chassisShape.calculateLocalInertia(mass, chassisInertia);

    const chassisTransform = new Ammo.btTransform();
    chassisTransform.setIdentity();
    chassisTransform.setOrigin(new Ammo.btVector3(
        carState.position.x,
        carState.position.y,
        carState.position.z
    ));

    const motionState = new Ammo.btDefaultMotionState(chassisTransform);
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, chassisShape, chassisInertia);
    const chassisBody = new Ammo.btRigidBody(rbInfo);

    chassisBody.setDamping(0.2, 0.2);
    chassisBody.setActivationState(4);
    physicsWorld.addRigidBody(chassisBody);
    physicsBodyCount++;

    const raycaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld);
    vehicle = new Ammo.btRaycastVehicle(tuning, chassisBody, raycaster);
    vehicle.setCoordinateSystem(0, 1, 2);
    physicsWorld.addAction(vehicle);

    const wheelDirectionCS0 = new Ammo.btVector3(0, -1, 0);
    const wheelAxleCS = new Ammo.btVector3(-1, 0, 0);
    const suspensionRestLength = 0.3;
    const wheelRadius = carState.wheelRadius;

    const wheelPositions = [
        [-1.5, -0.25, 0.9],  // Front left
        [1.5, -0.25, 0.9],   // Front right
        [-1.5, -0.25, -0.9], // Back left
        [1.5, -0.25, -0.9]   // Back right
    ];

    wheelPositions.forEach((pos, i) => {
        const connectionPoint = new Ammo.btVector3(pos[0], pos[1], pos[2]);
        vehicle.addWheel(
            connectionPoint,
            wheelDirectionCS0,
            wheelAxleCS,
            suspensionRestLength,
            wheelRadius,
            tuning,
            i < 2
        );
        
        const wheel = vehicle.getWheelInfo(i);
        wheel.m_suspensionStiffness = tuning.m_suspensionStiffness;
        wheel.m_wheelsDampingRelaxation = tuning.m_suspensionDamping;
        wheel.m_wheelsDampingCompression = tuning.m_suspensionCompression;
        wheel.m_frictionSlip = tuning.m_frictionSlip;
        wheel.m_rollInfluence = 0.01;
    });

    carBody = {
        body: chassisBody,
        mesh: chassisMesh,
        vehicle: vehicle
    };
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

async function loadCar() {
    return new Promise((resolve) => {
        const loader = new THREE.GLTFLoader();
        loader.load(
            'models/car.glb',
            (gltf) => {
                carMesh = gltf.scene;
                carMesh.scale.set(0.17, 0.17, 0.17);
                carMesh.position.copy(carState.position);
                carMesh.rotation.y = carState.rotation + carState.modelRotationOffset;
                
                carMesh.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.name === "MODEL 1 v1.005") {
                            wheels.frontLeft = child;
                            console.log("Assigned frontLeft:", child.name, "Position:", child.position.toArray().map(v => v.toFixed(2)));
                        }
                        if (child.name === "MODEL 1 v1.004") {
                            wheels.frontRight = child;
                            console.log("Assigned frontRight:", child.name, "Position:", child.position.toArray().map(v => v.toFixed(2)));
                        }
                        if (child.name === "MODEL 1 v1.006") {
                            wheels.backLeft = child;
                            console.log("Assigned backLeft:", child.name, "Position:", child.position.toArray().map(v => v.toFixed(2)));
                        }
                        if (child.name === "MODEL 1 v1.003") {
                            wheels.backRight = child;
                            console.log("Assigned backRight:", child.name, "Position:", child.position.toArray().map(v => v.toFixed(2)));
                        }
                        console.log("GLTF child:", child.name, "Position:", child.position.toArray().map(v => v.toFixed(2)));
                    }
                });
                
                console.log("Wheels assigned:", Object.keys(wheels).filter(k => wheels[k]).map(k => `${k}: ${wheels[k].name}`));
                scene.add(carMesh);
                console.log("Car model loaded");
                resolve(carMesh);
            },
            undefined,
            (error) => {
                console.warn('Using simple car:', error);
                carMesh = createSimpleCar();
                carMesh.position.copy(carState.position);
                carMesh.rotation.y = carState.rotation + carState.modelRotationOffset;
                scene.add(carMesh);
                console.log("Simple car loaded");
                resolve(carMesh);
            }
        );
    });
}

function setupControls() {
    document.addEventListener('keydown', (e) => {
        if (e.code in keys) {
            keys[e.code] = true;
            console.log("Key down:", e.code);
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.code in keys) {
            keys[e.code] = false;
        }
    });

    const domElement = renderer.domElement;
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
        console.log("Touch start:", e.touches.length, "vehicle:", !!vehicle);
        if (e.touches.length === 1 && vehicle) {
            isDragging = true;
            lastX = e.touches[0].clientX;
            console.log("Touch coord:", e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
            isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            initialTheta = cameraState.theta;
            initialPhi = cameraState.phi;
        }
    });

    domElement.addEventListener('touchmove', (e) => {
        console.log("Touch move:", e.touches.length, "vehicle:", !!vehicle);
        if (e.touches.length === 1 && isDragging && vehicle) {
            const dx = e.touches[0].clientX - lastX;
            if (Math.abs(dx) > 1) {
                keys.ArrowLeft = dx > 0;
                keys.ArrowRight = dx < 0;
                console.log("Touch steering dx:", dx);
            }
            lastX = e.touches[0].clientX;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
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
        console.log("Touch end");
    });

    console.log("Controls initialized");
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    // Add mouse move for look-around when right-clicking
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
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
    if (!physicsWorld || !carBody || !vehicle) {
        console.warn("Physics not ready:", { physicsWorld: !!physicsWorld, carBody: !!carBody, vehicle: !!vehicle });
        return;
    }

    const transform = new Ammo.btTransform();
    carBody.body.getMotionState().getWorldTransform(transform);
    const pos = transform.getOrigin();
    if (pos.y() < -1) {
        console.log("Car falling detected, resetting at y:", pos.y());
        resetCar();
    }

    let engineForce = 0;
    if (keys.ArrowUp || keys.KeyW) {
        engineForce = carState.engineForce;
    } else if (keys.ArrowDown || keys.KeyS) {
        engineForce = -carState.engineForce * 0.6;
    }
    
    // Apply engine force to rear wheels only (for more realistic behavior)
    vehicle.applyEngineForce(engineForce, 2); // Rear left
    vehicle.applyEngineForce(engineForce, 3); // Rear right
    
    let targetSteering = 0;
    if (keys.ArrowLeft || keys.KeyA) {
        targetSteering = carState.maxSteeringAngle;
    }
    if (keys.ArrowRight || keys.KeyD) {
        targetSteering = -carState.maxSteeringAngle;
    }
    
    carState.currentSteering = THREE.MathUtils.lerp(
        carState.currentSteering,
        targetSteering,
        carState.steeringSpeed * deltaTime
    );
    
    // Apply steering only to front wheels
    vehicle.setSteeringValue(carState.currentSteering, 0); // Front left
    vehicle.setSteeringValue(carState.currentSteering, 1); // Front right
    
    const brakeForce = (!keys.ArrowUp && !keys.KeyW && !keys.ArrowDown && !keys.KeyS) ? 
        carState.brakingForce : 0;
    
    for (let i = 0; i < 4; i++) {
        vehicle.setBrake(brakeForce, i);
    }
    
    physicsWorld.stepSimulation(deltaTime, maxSubSteps, timeStep);
    updateCarVisuals();
    updateCarStateFromPhysics();
}

function updateCarVisuals() {
    if (!carBody || !vehicle) return;

    // Update car body position and rotation
    const transform = new Ammo.btTransform();
    carBody.body.getMotionState().getWorldTransform(transform);
    const pos = transform.getOrigin();
    const quat = transform.getRotation();

    carBody.mesh.position.set(pos.x(), pos.y(), pos.z());
    carBody.mesh.quaternion.set(quat.x(), quat.y(), quat.z(), quat.w());

    // Loop over wheels
    for (let i = 0; i < vehicle.getNumWheels(); i++) {
        vehicle.updateWheelTransform(i, true);
        const wheelTransform = vehicle.getWheelTransformWS(i);
        const wheelPos = wheelTransform.getOrigin();

        const wheelInfo = vehicle.getWheelInfo(i);
        const spin = -wheelInfo.get_m_rotation();
        const steering = (i < 2) ? carState.currentSteering : 0;

        let wheelMesh = null;
        if (i === 0) wheelMesh = wheels.frontLeft;
        else if (i === 1) wheelMesh = wheels.frontRight;
        else if (i === 2) wheelMesh = wheels.backLeft;
        else if (i === 3) wheelMesh = wheels.backRight;

        if (!wheelMesh) continue;

        // Set position from physics
        wheelMesh.position.set(wheelPos.x(), wheelPos.y(), wheelPos.z());

        // --- Apply proper orientation ---

        // Reset base orientation to match model's (Z-facing), rotate to X-facing
        const base = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, 0, Math.PI / 2) // Converts Z-wheel to X-wheel
        );

        // Add steering (Y-axis)
        const steeringQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            steering
        );

        // Add spin (X-axis, since wheel now faces X)
        const spinQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            spin
        );

        // Combine in order: base → steering → spin
        const finalQuat = base.clone().multiply(steeringQuat).multiply(spinQuat);
        wheelMesh.quaternion.copy(finalQuat);
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

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = Math.min(clock.getDelta(), 0.1);
    
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
        if (!await initPhysics()) {
            throw new Error("Physics initialization failed");
        }
        
        document.getElementById('loading').textContent = "Creating road...";
        physicsBodyCount = 0;
        createRealisticRoad();
        
        document.getElementById('loading').textContent = "Setting up controls...";
        setupControls();
        
        document.getElementById('loading').textContent = "Loading car model...";
        const chassisMesh = await loadCar();
        setupVehicle(chassisMesh);
        
        document.getElementById('loading').textContent = "Creating obstacles...";
        createObstacles();
        
        document.getElementById('loading').style.display = 'none';
        console.log("Initialization complete, physics bodies:", physicsBodyCount);
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