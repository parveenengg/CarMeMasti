'use strict';
// ═══════════════════════════════════════════════════════════════
//  CYBER DRIVE 3D — Open World Racer
//  Three.js  |  Proper Car Physics  |  Air Thruster  |  Mountains
// ═══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  ENGINE SOUND PROFILES
// ──────────────────────────────────────────────────────────────
const ENGINE_PROFILES = {
    v8:      { osc:'sawtooth', bPitch:55,  pRange:190, fType:'lowpass',  bCut:350,  cRange:1400 },
    electric:{ osc:'triangle', bPitch:105, pRange:370, fType:'bandpass', bCut:900,  cRange:900  },
    diesel:  { osc:'square',   bPitch:38,  pRange:100, fType:'lowpass',  bCut:180,  cRange:500  },
    rocket:  { osc:'sawtooth', bPitch:28,  pRange:260, fType:'highpass', bCut:80,   cRange:200  }
};

// ──────────────────────────────────────────────────────────────
//  AUDIO ENGINE
// ──────────────────────────────────────────────────────────────
class AudioEngine {
    constructor() {
        this.ctx = null; this.osc = null; this.filter = null; this.gain = null;
        this.profileKey = 'v8';
        this.engineVol  = 0.8;
        this.sfxVol     = 0.9;
        this.ready      = false;
    }

    init() {
        if (this.ready) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC();
            this._rebuild();
            this.ready = true;
        } catch(e) { console.warn('Audio unavailable', e); }
    }

    _rebuild() {
        if (this.osc) { try { this.osc.stop(); } catch(e){} }
        const p = ENGINE_PROFILES[this.profileKey];
        this.osc    = this.ctx.createOscillator();
        this.filter = this.ctx.createBiquadFilter();
        this.gain   = this.ctx.createGain();

        this.osc.type              = p.osc;
        this.osc.frequency.value   = p.bPitch;
        this.filter.type           = p.fType;
        this.filter.frequency.value= p.bCut;
        this.gain.gain.value       = 0;

        this.osc.connect(this.filter);
        this.filter.connect(this.gain);
        this.gain.connect(this.ctx.destination);
        this.osc.start();
    }

    setProfile(key) {
        if (!ENGINE_PROFILES[key] || key === this.profileKey) return;
        this.profileKey = key;
        if (this.ready) this._rebuild();
    }

    updateEngine(speedRatio, accel) {
        if (!this.ready) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const p   = ENGINE_PROFILES[this.profileKey];
        const t   = this.ctx.currentTime;
        const freq= p.bPitch  + speedRatio * p.pRange + (accel ? 18 : 0);
        const cut = p.bCut    + speedRatio * p.cRange;
        const vol = (0.03 + speedRatio * 0.12) * this.engineVol;
        this.osc.frequency.setTargetAtTime(freq, t, 0.07);
        this.filter.frequency.setTargetAtTime(cut, t, 0.07);
        this.gain.gain.setTargetAtTime(vol, t, 0.07);
    }

    _sfx(f, type, dur, vol) {
        if (!this.ready) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(vol * this.sfxVol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t + dur);
    }
    playPickup() { this._sfx(880,  'sine',     0.15, 0.22); }
    playNitro()  { this._sfx(130,  'triangle', 0.28, 0.22); }
    playCrash()  { this._sfx(70,   'square',   0.65, 0.35); }
    playLand()   { this._sfx(100,  'sawtooth', 0.12, 0.18); }
}

// ──────────────────────────────────────────────────────────────
//  GAME ENGINE
// ──────────────────────────────────────────────────────────────
class GameEngine {
    constructor() {
        this.canvas = document.getElementById('bg-canvas');
        this.state  = 'MENU';

        // ── CAR PHYSICS ──
        // heading = 0  →  car faces world +Z direction
        // forward vec  = (sin(heading), 0, cos(heading))
        // camera behind= carPos - forward * dist
        this.heading = 0;       // world angle of car's nose (+Z when 0)
        this.speed   = 0;       // m/s
        this.steer   = 0;       // current lerped steer value
        this.carX    = 0;
        this.carY    = 0;       // height off ground (for thruster)
        this.carZ    = 0;
        this.vy      = 0;       // vertical velocity

        // Tuning
        this.ACCEL    = 27;
        this.BRAKE    = 52;
        this.FRICTION = 17;
        this.MAX_SPD  = 62;
        this.NITRO_SP = 92;
        this.STEER_MX = 1.85;
        this.WHEELBASE= 2.5;
        this.GRAVITY  = -24;
        this.THRUST   = 36;
        this.BOUND    = 490;    // playable boundary

        // Nitro
        this.nitro    = 100;
        this.isNitro  = false;
        this.airborne = false;

        // Score
        this.score = 0; this.coins = 0; this.distance = 0;

        // Input
        this.input = { fwd:false, bwd:false, left:false, right:false,
                       drift:false, nitro:false, thrust:false };
        this.joystickActive = false;
        this.joystickNormX  = 0;
        this.joystickNormY  = 0;
        this._ctrl = 'both';  // 'both' | 'wasd' | 'arrows'

        // Camera
        // camAngle is a world-space angle for the camera position.
        // When not dragging it auto-follows to heading + PI (behind car).
        this.camAngle  = Math.PI;
        this.camPitch  = 0.33;
        this.camMode   = 0;      // 0=chase, 1=close, 2=top
        this.isDragging= false;

        // Sub-systems
        this.audio     = new AudioEngine();
        this.obstacles = [];
        this.gems      = [];
        this.bankLights= [];

        this._initThree();
        this._buildSky();
        this._buildTerrain();
        this._buildCar();
        this._spawnEntities();
        this._bindEvents();

        this.clock = new THREE.Clock();
        this._loop = this._loop.bind(this);
        requestAnimationFrame(this._loop);
    }

    // ── THREE.JS SETUP ─────────────────────────────────────
    _initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xd8f0ff, 0.0018);

        this.camera = new THREE.PerspectiveCamera(65, innerWidth/innerHeight, 0.1, 1600);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(innerWidth, innerHeight);
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

        // Bright natural ambient lighting
        this.scene.add(new THREE.AmbientLight(0xd0f4ff, 0.75));

        // Warm golden sunlight
        const sun = new THREE.DirectionalLight(0xfffaee, 1.35);
        sun.position.set(120, 160, 100);
        sun.castShadow = true;
        sun.shadow.camera.near   = 1;
        sun.shadow.camera.far    = 950;
        const sc = 340;
        sun.shadow.camera.left   = -sc; sun.shadow.camera.right = sc;
        sun.shadow.camera.top    =  sc; sun.shadow.camera.bottom= -sc;
        sun.shadow.mapSize.set(2048, 2048);
        this.scene.add(sun);

        // Sky bounce light
        this.scene.add(new THREE.DirectionalLight(0x70c0ff, 0.45).position.set(-100, 50, -100));

        // Headlights (follow car)
        this.hlL = new THREE.SpotLight(0xffffff, 3.5, 95, Math.PI/10, 0.5);
        this.hlR = new THREE.SpotLight(0xffffff, 3.5, 95, Math.PI/10, 0.5);
        this.scene.add(this.hlL, this.hlR, this.hlL.target, this.hlR.target);

        window.addEventListener('resize', () => {
            this.camera.aspect = innerWidth / innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(innerWidth, innerHeight);
        });
    }

    // ── SKY DOME (sunset gradient) ─────────────────────────
    _buildSky() {
        const skyGeo = new THREE.SphereGeometry(900, 32, 20);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            vertexShader:`
                varying float vH;
                void main(){
                    vH = normalize(position).y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                }`,
            fragmentShader:`
                varying float vH;
                void main(){
                    float t = clamp(vH, 0.0, 1.0);
                    vec3 horizon = vec3(0.72, 0.88, 0.98);
                    vec3 mid     = vec3(0.38, 0.68, 0.98);
                    vec3 zenith  = vec3(0.15, 0.45, 0.85);
                    vec3 c = mix(horizon, mid, smoothstep(0.0, 0.35, t));
                    c      = mix(c, zenith, smoothstep(0.25, 1.0, t));
                    gl_FragColor = vec4(c, 1.0);
                }`
        });
        this.scene.add(new THREE.Mesh(skyGeo, skyMat));

        // Radiant Golden Sun
        const sunGeo = new THREE.CircleGeometry(65, 48);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xfffa66, fog: false, side: THREE.DoubleSide });
        const sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.set(120, 150, -750);
        this.scene.add(sunMesh);

        // Fluffy procedural clouds
        const cloudGeo = new THREE.DodecahedronGeometry(18);
        const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.88, fog: false });
        for (let i = 0; i < 35; i++) {
            const cg = new THREE.Group();
            for (let j = 0; j < 5; j++) {
                const cm = new THREE.Mesh(cloudGeo, cloudMat);
                cm.position.set((j-2)*12 + Math.random()*4, Math.random()*6, Math.random()*6);
                cm.scale.setScalar(0.8 + Math.random()*0.6);
                cg.add(cm);
            }
            cg.position.set((Math.random()-0.5)*1400, 140 + Math.random()*60, (Math.random()-0.5)*1400);
            this.scene.add(cg);
        }
    }

    // ── TERRAIN (ground + procedural mountains + rivers) ───
    _buildTerrain() {
        // Use more segments for a bigger, richer terrain
        const SIZE = 2200, SEG = 220;
        const geo  = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
        geo.rotateX(-Math.PI / 2);

        const pos  = geo.attributes.position;
        const cols = [];

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            // Use the shared height sampler so terrain & physics always match
            const y = this._terrainH(x, z);
            pos.setY(i, y);

            // ── Vertex colour by zone ──
            if (y < 0.8) {
                // Lush meadow green
                const gv = (Math.sin(x * 0.02) + Math.cos(z * 0.02)) * 0.02;
                cols.push(0.20 + gv, 0.62 + gv*2, 0.28 + gv);
            } else if (y < 12) {
                // Offroad entry — emerald grass
                const t2 = y / 12;
                cols.push(0.18 + t2*0.04, 0.54 + t2*0.08, 0.22 + t2*0.04);
            } else if (y < 32) {
                // Offroad hills — deep forest green & moss
                const t2 = (y - 12) / 20;
                cols.push(0.14 + t2*0.10, 0.44 + t2*0.06, 0.18 + t2*0.04);
            } else if (y < 80) {
                // Mountain rock
                const t2 = (y - 32) / 48;
                cols.push(0.35 + t2*0.10, 0.38 + t2*0.08, 0.38 + t2*0.08);
            } else if (y < 130) {
                // Mountain upper cool stone
                const t2 = (y - 80) / 50;
                cols.push(0.45 + t2*0.18, 0.48 + t2*0.15, 0.50 + t2*0.12);
            } else {
                // Snow caps
                const t2 = Math.min((y - 130) / 40, 1.0);
                cols.push(0.92 + t2*0.08, 0.95 + t2*0.05, 0.98 + t2*0.02);
            }
        }

        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
        geo.computeVertexNormals();

        const terrain = new THREE.Mesh(geo,
            new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.85, metalness:0.02 }));
        terrain.receiveShadow = true;
        this.scene.add(terrain);

        // Boundary stone markers
        const bMat = new THREE.MeshStandardMaterial({ color: 0x557766, roughness: 0.9 });
        const fH = 5, fB = this.BOUND + 2;
        [
            [new THREE.BoxGeometry(fB*2+4, fH, 1.5), [0, fH/2, -fB]],
            [new THREE.BoxGeometry(fB*2+4, fH, 1.5), [0, fH/2,  fB]],
            [new THREE.BoxGeometry(1.5, fH, fB*2+4), [-fB, fH/2, 0 ]],
            [new THREE.BoxGeometry(1.5, fH, fB*2+4), [ fB, fH/2, 0 ]],
        ].forEach(([g, p]) => {
            const m = new THREE.Mesh(g, bMat);
            m.position.set(...p);
            this.scene.add(m);
        });

        // Plant lush trees across the landscape!
        this._spawnTrees();
        this._buildRivers();
    }

    _spawnTrees() {
        const trunkGeo   = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 8);
        const trunkMat   = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 });
        const foliageGeo = new THREE.ConeGeometry(2.4, 6.0, 8);
        const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6, metalness: 0.1 });

        for (let i = 0; i < 150; i++) {
            const [x, z] = this._rndPos(30);
            if (Math.hypot(x, z) < 25) continue; // Keep spawn area open

            const y = this._terrainH(x, z);
            if (y > 90) continue; // Don't spawn high in snow mountain peaks

            const treeGroup = new THREE.Group();
            
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 1.6;
            trunk.castShadow = true;
            treeGroup.add(trunk);

            const f1 = new THREE.Mesh(foliageGeo, foliageMat);
            f1.position.y = 4.2;
            f1.castShadow = true;
            treeGroup.add(f1);

            const f2 = new THREE.Mesh(foliageGeo, foliageMat);
            f2.position.y = 6.2;
            f2.scale.set(0.72, 0.72, 0.72);
            f2.castShadow = true;
            treeGroup.add(f2);

            const scale = 0.8 + Math.random() * 0.65;
            treeGroup.scale.set(scale, scale, scale);
            treeGroup.position.set(x, y, z);
            treeGroup.rotation.y = Math.random() * Math.PI * 2;
            this.scene.add(treeGroup);
        }
    }

    _buildRivers() {
        const rMat = new THREE.MeshStandardMaterial({
            color: 0x0099ff, transparent: true, opacity: 0.80,
            roughness: 0.1, metalness: 0.20,
            emissive: 0x0033aa, emissiveIntensity: 0.25
        });

        // River A — long N/S through flat & offroad zones
        const rA = new THREE.Mesh(new THREE.PlaneGeometry(20, 900, 1, 1), rMat);
        rA.rotation.x = -Math.PI / 2;
        rA.position.set(-180, 0.07, 0);
        this.scene.add(rA);

        // River B — wide E/W crossing
        const rB = new THREE.Mesh(new THREE.PlaneGeometry(900, 18, 1, 1), rMat);
        rB.rotation.x = -Math.PI / 2;
        rB.position.set(0, 0.07, 145);
        this.scene.add(rB);

        // River C — diagonal offroad creek
        const rC = new THREE.Mesh(new THREE.PlaneGeometry(16, 680, 1, 1), rMat);
        rC.rotation.x = -Math.PI / 2;
        rC.rotation.z = Math.PI / 6;
        rC.position.set(240, 0.07, -100);
        this.scene.add(rC);

        // River D — short curved creek in offroad zone
        const rD = new THREE.Mesh(new THREE.PlaneGeometry(14, 500, 1, 1), rMat);
        rD.rotation.x = -Math.PI / 2;
        rD.rotation.z = -Math.PI / 4;
        rD.position.set(-300, 0.07, 200);
        this.scene.add(rD);

        // Ambient glow lights
        [[-180,0,3], [0,145,3], [240,-100,3], [-300,200,3]].forEach(([x,z,y]) => {
            const l = new THREE.PointLight(0x0099ff, 2.2, 55);
            l.position.set(x, y, z);
            this.scene.add(l);
            this.bankLights.push(l);
        });
    }

    // ── PLAYER CAR ─────────────────────────────────────────
    _buildCar() {
        this.carGroup = new THREE.Group();

        // Metallic Emerald Body
        this.carGroup.add(this._mesh(
            new THREE.BoxGeometry(2.2, 0.78, 4.4),
            { color:0x0f2b1d, metalness:0.85, roughness:0.15 },
            [0, 0.62, 0], true
        ));

        // Crystal Sky Cabin glass
        this.carGroup.add(this._mesh(
            new THREE.BoxGeometry(1.72, 0.55, 2.1),
            { color:0x80deea, transparent:true, opacity:0.45, roughness:0 },
            [0, 1.12, -0.1]
        ));

        // Rear spoiler with emerald accent
        this.carGroup.add(this._mesh(
            new THREE.BoxGeometry(2.05, 0.46, 0.22),
            { color:0x00e676, emissive:0x00c853, emissiveIntensity:0.6 },
            [0, 1.18, -2.05]
        ));

        // Hood accent stripe
        this.carGroup.add(this._mesh(
            new THREE.BoxGeometry(2.2, 0.10, 1.6),
            { color:0x00e676, emissive:0x00c853, emissiveIntensity:0.28 },
            [0, 1.02, 1.6]
        ));

        // Side skirt glow strips
        [-1.12, 1.12].forEach(xp => {
            this.carGroup.add(this._mesh(
                new THREE.BoxGeometry(0.1, 0.14, 3.8),
                { color:0x00e676, emissive:0x00e676, emissiveIntensity:0.8 },
                [xp, 0.26, 0]
            ));
        });

        // Headlights
        const hlGeo = new THREE.BoxGeometry(0.55, 0.18, 0.12);
        const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        [-0.72, 0.72].forEach(xp => {
            const hl = new THREE.Mesh(hlGeo, hlMat);
            hl.position.set(xp, 0.68, 2.22);
            this.carGroup.add(hl);
        });

        // Tail lights
        const tlMat = new THREE.MeshBasicMaterial({ color: 0xff3344 });
        [-0.72, 0.72].forEach(xp => {
            const tl = new THREE.Mesh(hlGeo, tlMat);
            tl.position.set(xp, 0.68, -2.22);
            this.carGroup.add(tl);
        });

        // Emerald Underglow
        this.underGlow = new THREE.PointLight(0x00e676, 2.2, 9);
        this.underGlow.position.set(0, 0.1, 0);
        this.carGroup.add(this.underGlow);

        // Wheels (4x)
        this.wheels = [];
        const wGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 20);
        const wMat = new THREE.MeshStandardMaterial({ color: 0x1a2420, roughness: 0.8 });
        const rGeo = new THREE.BoxGeometry(0.09, 0.36, 0.65);
        const rMat = new THREE.MeshBasicMaterial({ color: 0x00e676 });

        [{x:-1.16, z: 1.45, front:true },
         {x: 1.16, z: 1.45, front:true },
         {x:-1.16, z:-1.45, front:false},
         {x: 1.16, z:-1.45, front:false}
        ].forEach(wp => {
            const wh = new THREE.Group();
            const w  = new THREE.Mesh(wGeo, wMat); w.rotation.z = Math.PI / 2;
            const r  = new THREE.Mesh(rGeo, rMat); r.rotation.z = Math.PI / 2;
            wh.add(w, r);
            wh.position.set(wp.x, 0.42, wp.z);
            this.carGroup.add(wh);
            this.wheels.push({ wh, front: wp.front, spinRef: w });
        });

        // Nitro exhaust flame
        const nGeo = new THREE.ConeGeometry(0.38, 2.2, 12);
        const nMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.88 });
        this.nitroFlame = new THREE.Mesh(nGeo, nMat);
        this.nitroFlame.rotation.x = Math.PI / 2;
        this.nitroFlame.position.set(0, 0.5, -3.0);
        this.nitroFlame.visible = false;
        this.carGroup.add(this.nitroFlame);

        // Thruster flames (under car — 4 corner jets)
        this.thrusterFlames = [];
        [[-.7,-.7],[.7,-.7],[-.7,.7],[.7,.7]].forEach(([tx, tz]) => {
            const tGeo = new THREE.ConeGeometry(0.18, 1.4, 8);
            const tMat = new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.9 });
            const tf = new THREE.Mesh(tGeo, tMat);
            tf.rotation.x = -Math.PI;
            tf.position.set(tx, 0.0, tz);
            tf.visible = false;
            this.carGroup.add(tf);
            this.thrusterFlames.push(tf);
        });

        this.scene.add(this.carGroup);
    }

    _mesh(geo, matOpts, pos, shadow=false) {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(matOpts));
        m.position.set(...pos);
        if (shadow) m.castShadow = true;
        return m;
    }

    // ── ENTITY SPAWNING ────────────────────────────────────
    _spawnEntities() {
        for (let i = 0; i < 14; i++) this._spawnObstacle();
        for (let i = 0; i < 36; i++) this._spawnCoin();
    }

    _rndPos(margin = 20) {
        const B = this.BOUND - margin;
        return [(Math.random()-0.5)*B*2, (Math.random()-0.5)*B*2];
    }

    _spawnObstacle() {
        const isCrate = Math.random() > 0.5;
        let m;
        if (isCrate) {
            m = new THREE.Mesh(
                new THREE.BoxGeometry(2.2, 2.2, 2.2),
                new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8, metalness: 0.1 })
            );
        } else {
            m = new THREE.Mesh(
                new THREE.DodecahedronGeometry(1.8),
                new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.95, metalness: 0.1 })
            );
        }
        const [x, z] = this._rndPos();
        const y = this._terrainH(x, z);
        m.position.set(x, y + 1.1, z);
        m.rotation.set(Math.random(), Math.random(), Math.random());
        m.castShadow = true;
        this.scene.add(m);
        this.obstacles.push(m);
    }

    _spawnCoin() {
        const cGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 24);
        cGeo.rotateX(Math.PI / 2);
        const cMat = new THREE.MeshStandardMaterial({
            color: 0xffd700, roughness: 0.2, metalness: 0.9,
            emissive: 0xffa000, emissiveIntensity: 0.35
        });
        const m = new THREE.Mesh(cGeo, cMat);
        const [x, z] = this._rndPos(30);
        const y = this._terrainH(x, z);
        m.position.set(x, y + 1.0, z);
        m.castShadow = true;
        this.scene.add(m);
        this.gems.push(m);
    }

    // ── EVENTS ─────────────────────────────────────────────
    _bindEvents() {
        const _set = (key, val) => {
            const ctrl = this._ctrl || 'both';
            const isWASD   = ['KeyW','KeyS','KeyA','KeyD'].includes(key);
            const isArrows = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key);
            if (ctrl === 'wasd'   && isArrows) return;
            if (ctrl === 'arrows' && isWASD)   return;

            switch(key) {
                case 'KeyW':case 'ArrowUp':    this.input.fwd    = val; break;
                case 'KeyS':case 'ArrowDown':  this.input.bwd    = val; break;
                case 'KeyA':case 'ArrowLeft':  this.input.left   = val; break;
                case 'KeyD':case 'ArrowRight': this.input.right  = val; break;
                case 'Space':
                    if (val && !this.input.thrust) this._doJump();
                    this.input.thrust = val;
                    break;
                case 'KeyQ':
                case 'ControlLeft':
                case 'ControlRight':           this.input.drift  = val; break;
                case 'ShiftLeft':
                case 'ShiftRight':             this.input.nitro  = val; break;
                case 'KeyE':case 'KeyF':case 'KeyJ':
                    if (val && key === 'KeyJ') this._doJump();
                    this.input.thrust = val;
                    break;
            }
        };

        window.addEventListener('keydown', e => {
            this.audio.init();
            if (e.code === 'Space') e.preventDefault();
            if (e.code === 'KeyC') { this.camMode = (this.camMode+1)%3; return; }
            _set(e.code, true);
        });
        window.addEventListener('keyup', e => _set(e.code, false));

        // ── Mouse / Touch camera orbit ──
        let lTX = 0, lTY = 0;

        this.canvas.addEventListener('mousedown', e => {
            this.isDragging = true;
            this.audio.init();
        });
        window.addEventListener('mouseup',   () => this.isDragging = false);
        window.addEventListener('mousemove', e => {
            if (!this.isDragging) return;
            this.camAngle += e.movementX * 0.007;
            this.camPitch  = THREE.MathUtils.clamp(
                this.camPitch - e.movementY * 0.006, 0.06, 1.25
            );
        });
        window.addEventListener('contextmenu', e => e.preventDefault());

        this.canvas.addEventListener('touchstart', e => {
            this.isDragging = true;
            lTX = e.touches[0].clientX;
            lTY = e.touches[0].clientY;
            this.audio.init();
        }, { passive: true });
        window.addEventListener('touchend', () => this.isDragging = false);
        window.addEventListener('touchmove', e => {
            if (!this.isDragging || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - lTX;
            const dy = e.touches[0].clientY - lTY;
            this.camAngle += dx * 0.007;
            this.camPitch  = THREE.MathUtils.clamp(this.camPitch - dy * 0.006, 0.06, 1.25);
            lTX = e.touches[0].clientX;
            lTY = e.touches[0].clientY;
        }, { passive: true });

        // ── UI Buttons & Menu ──
        const startFn = (e) => {
            if (e) e.preventDefault();
            this._requestFullscreen();
            this._startGame();
        };

        const btnStart   = document.getElementById('btn-start');
        const btnRestart = document.getElementById('btn-restart');
        const btnFs      = document.getElementById('fullscreen-btn');
        const btnMenu    = document.getElementById('menu-btn');

        if (btnStart) {
            btnStart.addEventListener('touchstart', startFn, { passive: false });
            btnStart.addEventListener('click', startFn);
        }
        if (btnRestart) {
            btnRestart.addEventListener('touchstart', startFn, { passive: false });
            btnRestart.addEventListener('click', startFn);
        }
        if (btnFs) {
            const toggleFn = (e) => {
                if (e) e.preventDefault();
                this.toggleFullscreen();
            };
            btnFs.addEventListener('touchstart', toggleFn, { passive: false });
            btnFs.addEventListener('click', toggleFn);
        }
        if (btnMenu) {
            const menuFn = (e) => {
                if (e) e.preventDefault();
                this._toggleMenu();
            };
            btnMenu.addEventListener('touchstart', menuFn, { passive: false });
            btnMenu.addEventListener('click', menuFn);
        }

        // Settings panel
        const tog = document.getElementById('settings-toggle');
        const drw = document.getElementById('settings-drawer');
        if (tog && drw) {
            tog.addEventListener('click', e => {
                e.stopPropagation();
                drw.classList.toggle('hidden');
            });
            document.addEventListener('click', e => {
                if (!document.getElementById('settings-panel').contains(e.target))
                    drw.classList.add('hidden');
            });
        }

        document.getElementById('engine-type').addEventListener('change', e => {
            this.audio.setProfile(e.target.value);
        });
        document.getElementById('sl-engine').addEventListener('input', e => {
            this.audio.engineVol = e.target.value / 100;
            document.getElementById('eng-vol-lbl').innerText = e.target.value + '%';
        });
        document.getElementById('sl-sfx').addEventListener('input', e => {
            this.audio.sfxVol = e.target.value / 100;
            document.getElementById('sfx-vol-lbl').innerText = e.target.value + '%';
        });
        document.getElementById('cam-select').addEventListener('change', e => {
            this.camMode = parseInt(e.target.value);
        });
        document.getElementById('ctrl-method').addEventListener('change', e => {
            this._ctrl = e.target.value;
        });

        this._bindMobileControls();
    }

    // ── MOBILE / TABLET ON-SCREEN CONTROLS ─────────────────
    _bindMobileControls() {
        // NITRO button
        const mNitro = document.getElementById('m-nitro');
        if (mNitro) {
            const downN = e => { e.preventDefault(); this.audio.init(); this.input.nitro = true; mNitro.classList.add('active'); };
            const upN   = e => { e.preventDefault(); this.input.nitro = false; mNitro.classList.remove('active'); };
            mNitro.addEventListener('touchstart', downN, { passive: false });
            mNitro.addEventListener('touchend',   upN,   { passive: false });
            mNitro.addEventListener('touchcancel',upN,   { passive: false });
            mNitro.addEventListener('mousedown',  downN);
            mNitro.addEventListener('mouseup',    upN);
            mNitro.addEventListener('mouseleave', upN);
        }

        // JUMP button
        const mJump = document.getElementById('m-jump');
        if (mJump) {
            const downJ = e => { e.preventDefault(); this._doJump(); mJump.classList.add('active'); };
            const upJ   = e => { e.preventDefault(); mJump.classList.remove('active'); };
            mJump.addEventListener('touchstart', downJ, { passive: false });
            mJump.addEventListener('touchend',   upJ,   { passive: false });
            mJump.addEventListener('touchcancel',upJ,   { passive: false });
            mJump.addEventListener('mousedown',  downJ);
            mJump.addEventListener('mouseup',    upJ);
        }

        // FLY button
        const mFly = document.getElementById('m-fly');
        if (mFly) {
            const downF = e => { e.preventDefault(); this.audio.init(); this.input.thrust = true; mFly.classList.add('active'); };
            const upF   = e => { e.preventDefault(); this.input.thrust = false; mFly.classList.remove('active'); };
            mFly.addEventListener('touchstart', downF, { passive: false });
            mFly.addEventListener('touchend',   upF,   { passive: false });
            mFly.addEventListener('touchcancel',upF,   { passive: false });
            mFly.addEventListener('mousedown',  downF);
            mFly.addEventListener('mouseup',    upF);
            mFly.addEventListener('mouseleave', upF);
        }

        // ── VIRTUAL JOYSTICK BINDING ──
        const joyBase  = document.getElementById('joystick-base');
        const joyThumb = document.getElementById('joystick-thumb');

        if (joyBase && joyThumb) {
            let joyTouchId = null;
            let baseRect   = null;
            let isMouseDown= false;

            const updateJoystick = (clientX, clientY) => {
                if (!baseRect) baseRect = joyBase.getBoundingClientRect();
                const centerX = baseRect.left + baseRect.width / 2;
                const centerY = baseRect.top + baseRect.height / 2;

                const deltaX = clientX - centerX;
                const deltaY = clientY - centerY;
                const dist   = Math.hypot(deltaX, deltaY);
                const maxR   = (baseRect.width / 2) - 10;
                const angle  = Math.atan2(deltaY, deltaX);
                const clampedR = Math.min(dist, maxR);

                const knobX = Math.cos(angle) * clampedR;
                const knobY = Math.sin(angle) * clampedR;

                joyThumb.style.transform = `translate(${knobX}px, ${knobY}px)`;

                this.joystickActive = true;
                this.joystickNormX  = knobX / maxR; // -1 (left) to +1 (right)
                this.joystickNormY  = knobY / maxR; // -1 (up/fwd) to +1 (down/bwd)

                // Forward / Backward throttle
                if (this.joystickNormY < -0.18) {
                    this.input.fwd = true;  this.input.bwd = false;
                } else if (this.joystickNormY > 0.18) {
                    this.input.fwd = false; this.input.bwd = true;
                } else {
                    this.input.fwd = false; this.input.bwd = false;
                }

                // Left / Right steering fallback
                if (this.joystickNormX < -0.18) {
                    this.input.left = true;  this.input.right = false;
                } else if (this.joystickNormX > 0.18) {
                    this.input.left = false; this.input.right = true;
                } else {
                    this.input.left = false; this.input.right = false;
                }
            };

            const resetJoystick = () => {
                joyTouchId = null;
                baseRect   = null;
                isMouseDown= false;
                joyThumb.style.transform = 'translate(0px, 0px)';
                this.joystickActive = false;
                this.joystickNormX  = 0;
                this.joystickNormY  = 0;
                this.input.fwd = false;
                this.input.bwd = false;
                this.input.left = false;
                this.input.right = false;
            };

            const handleStart = e => {
                e.preventDefault();
                this.audio.init();
                const touch = e.changedTouches ? e.changedTouches[0] : e;
                if (e.changedTouches) joyTouchId = touch.identifier;
                baseRect = joyBase.getBoundingClientRect();
                updateJoystick(touch.clientX, touch.clientY);
            };

            const handleMove = e => {
                if (!this.joystickActive && joyTouchId === null && !isMouseDown) return;
                let touch = null;
                if (e.changedTouches) {
                    for (let i = 0; i < e.changedTouches.length; i++) {
                        if (e.changedTouches[i].identifier === joyTouchId) {
                            touch = e.changedTouches[i];
                            break;
                        }
                    }
                } else if (isMouseDown) {
                    touch = e;
                }
                if (touch) {
                    e.preventDefault();
                    updateJoystick(touch.clientX, touch.clientY);
                }
            };

            const handleEnd = e => {
                if (e.changedTouches && joyTouchId !== null) {
                    let matches = false;
                    for (let i = 0; i < e.changedTouches.length; i++) {
                        if (e.changedTouches[i].identifier === joyTouchId) {
                            matches = true; break;
                        }
                    }
                    if (!matches) return;
                }
                e.preventDefault();
                resetJoystick();
            };

            joyBase.addEventListener('touchstart', handleStart, { passive: false });
            window.addEventListener('touchmove', handleMove, { passive: false });
            window.addEventListener('touchend', handleEnd, { passive: false });
            window.addEventListener('touchcancel', handleEnd, { passive: false });

            joyBase.addEventListener('mousedown', e => {
                isMouseDown = true;
                handleStart(e);
            });
            window.addEventListener('mousemove', e => {
                if (isMouseDown) handleMove(e);
            });
            window.addEventListener('mouseup', e => {
                if (isMouseDown) resetJoystick();
            });
        }
    }

    _requestFullscreen() {
        const elem = document.documentElement;
        try {
            window.scrollTo(0, 1);
        } catch(e) {}

        if (elem.requestFullscreen) {
            elem.requestFullscreen().catch(() => {});
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }

        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
        }
    }

    toggleFullscreen() {
        const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
        if (!isFs) {
            this._requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            }
        }
    }

    _doJump() {
        this.audio.init();
        const groundY = this._terrainH(this.carX, this.carZ);
        if (this.carY <= groundY + 1.2) {
            this.vy = 26; // Vertical jump impulse
            this.airborne = true;
            this.audio.playLand();
        }
    }

    _toggleMenu() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen.classList.contains('hidden')) {
            startScreen.classList.remove('hidden');
            document.getElementById('hud').classList.add('hidden');
            document.getElementById('mobile-controls').classList.add('hidden');
            this.state = 'MENU';
        } else {
            this._startGame();
        }
    }

    // ── GAME STATE ─────────────────────────────────────────
    _startGame() {
        this.audio.init();
        this._requestFullscreen();
        this.state    = 'PLAYING';
        this.coins    = 0;
        this.speed    = 0; this.steer = 0;
        this.heading  = 0;
        this.carX     = 0; this.carY = 0; this.carZ = 0;
        this.vy       = 0;
        this.nitro    = 100;
        this.camAngle = Math.PI;
        this.airborne = false;

        this.carGroup.position.set(0, 0, 0);
        this.carGroup.rotation.set(0, 0, 0);

        // Respawn entities
        this.obstacles.forEach(o => this.scene.remove(o));
        this.gems.forEach(g => this.scene.remove(g));
        this.obstacles = []; this.gems = [];
        this._spawnEntities();

        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('game-over-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        document.getElementById('mobile-controls').classList.remove('hidden');
    }

    _gameOver() {
        this.state = 'GAMEOVER';
        this.audio.playCrash();
        this.speed = 0; this.vy = 0;

        document.getElementById('final-coins').innerText = this.coins;
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('mobile-controls').classList.add('hidden');

        // Shake effect
        if (window.gsap) {
            gsap.to(this.camera.position, { y:'+=3', duration:0.07, yoyo:true, repeat:5 });
        }
    }

    // ── PHYSICS UPDATE ─────────────────────────────────────
    _updatePhysics(dt) {
        if (this.state !== 'PLAYING') return;

        // ── NITRO ──
        let topSpd = this.MAX_SPD;
        if (this.input.nitro && this.nitro > 0) {
            this.isNitro = true;
            topSpd = this.NITRO_SP;
            this.nitro = Math.max(0, this.nitro - dt * 25);
            this.nitroFlame.visible = true;
            const s = 0.8 + Math.random() * 0.5;
            this.nitroFlame.scale.set(s, 0.7 + Math.random() * 0.8, s);
            this.audio.playNitro();
        } else {
            this.isNitro = false;
            this.nitroFlame.visible = false;
            this.nitro = Math.min(100, this.nitro + dt * 11);
        }

        // ── AIR THRUSTER ──
        if (this.input.thrust) {
            // Continuous upward thrust — the longer you hold E the higher you go
            this.vy += this.THRUST * dt;
            this.thrusterFlames.forEach(f => {
                f.visible = true;
                const s = 0.7 + Math.random() * 0.6;
                f.scale.set(s, 0.8 + Math.random() * 0.7, s);
            });
        } else {
            this.thrusterFlames.forEach(f => f.visible = false);
            this.vy += this.GRAVITY * dt;   // gravity
        }
        this.vy    = THREE.MathUtils.clamp(this.vy, -55, 32);
        this.carY += this.vy * dt;

        // ── TERRAIN HEIGHT at current position ──
        const groundY = this._terrainH(this.carX, this.carZ);

        if (this.carY <= groundY) {
            if (this.vy < -6) this.audio.playLand();
            this.carY = groundY; this.vy = 0; this.airborne = false;
        } else {
            this.airborne = true;
        }

        // ── DRIVE — Acceleration / Braking ──
        if (!this.airborne) {
            // Slope gravity: sample height ahead and behind the car
            const fX0 = Math.sin(this.heading), fZ0 = Math.cos(this.heading);
            const hAhead  = this._terrainH(this.carX + fX0 * 2.5, this.carZ + fZ0 * 2.5);
            const hBehind = this._terrainH(this.carX - fX0 * 2.5, this.carZ - fZ0 * 2.5);
            const slopeGrav = (hAhead - hBehind) * 1.8; // positive = uphill ahead

            if (this.input.fwd) {
                this.speed += this.ACCEL * (this.isNitro ? 2.0 : 1.0) * dt;
            } else if (this.input.bwd) {
                if (this.speed > 0.5) this.speed -= this.BRAKE * dt;
                else                  this.speed -= this.ACCEL * 0.45 * dt;
            } else {
                const fr = this.FRICTION * (this.input.drift ? 1.7 : 1.0);
                if (Math.abs(this.speed) < fr * dt) this.speed = 0;
                else this.speed -= Math.sign(this.speed) * fr * dt;
            }

            // Apply slope drag/assist (uphill slows, downhill speeds naturally)
            this.speed -= slopeGrav * dt * Math.sign(this.speed || 1);
            this.speed = THREE.MathUtils.clamp(this.speed, -22, topSpd);
        }

        // ── STEERING ──
        let si = 0;
        if (this.joystickActive && Math.abs(this.joystickNormX) > 0.05) {
            si = -this.joystickNormX; // Smooth analog steering from virtual joystick
        } else {
            if (this.input.left)  si =  1;   // heading increases = turn left (A)
            if (this.input.right) si = -1;   // heading decreases = turn right (D)
        }

        const sRatio = Math.abs(this.speed) / this.MAX_SPD;
        const sAngle = this.STEER_MX * (1.0 - sRatio * 0.52);
        const dBoost = this.input.drift ? 1.75 : 1.0;
        this.steer   = THREE.MathUtils.lerp(this.steer, si * sAngle * dBoost, dt * 7);

        if (Math.abs(this.speed) > 0.5) {
            const turnRate = (this.speed * Math.tan(this.steer * 0.40)) / this.WHEELBASE;
            this.heading  += turnRate * dt;
        }

        // ── MOVE CAR along heading direction ──
        // Forward vector = (sin H, 0, cos H)  — car's nose faces this direction
        const fX = Math.sin(this.heading);
        const fZ = Math.cos(this.heading);
        this.carX += fX * this.speed * dt;
        this.carZ += fZ * this.speed * dt;

        // Boundary bounce
        const B = this.BOUND;
        if (Math.abs(this.carX) > B) { this.carX = Math.sign(this.carX)*B; this.speed *= -0.2; }
        if (Math.abs(this.carZ) > B) { this.carZ = Math.sign(this.carZ)*B; this.speed *= -0.2; }

        // ── APPLY TO MESH ──
        this.carGroup.position.set(this.carX, this.carY, this.carZ);
        this.carGroup.rotation.y = this.heading;

        // Terrain slope for body tilt
        const norm    = this._terrainNormal(this.carX, this.carZ);
        const fwdV    = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
        const rightV  = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
        // Project normal onto car's local axes
        const terrainPitch = -norm.dot(fwdV)  * 0.85;  // nose up on downhill, down on uphill
        const terrainRoll  =  norm.dot(rightV) * 0.85;  // lean into cross-slope

        // Body lean into corner + terrain cross-slope
        const rollTgt = (-this.steer * sRatio * 0.09) + (this.airborne ? 0 : terrainRoll);
        this.carGroup.rotation.z = THREE.MathUtils.lerp(
            this.carGroup.rotation.z, rollTgt, dt * 6);

        // Suspension pitch + terrain forward slope
        const accelPitch = this.input.fwd ? -0.038 : (this.input.bwd ? 0.062 : 0);
        const ptgt = accelPitch + (this.airborne ? 0 : terrainPitch);
        this.carGroup.rotation.x = THREE.MathUtils.lerp(
            this.carGroup.rotation.x, ptgt, dt * 6);

        // Wheel spin + front wheel steering visual
        const spinDt = (this.speed / 12) * dt;
        this.wheels.forEach(w => {
            w.spinRef.rotation.x += spinDt;
            if (w.front)
                w.wh.rotation.y = THREE.MathUtils.lerp(w.wh.rotation.y, this.steer * 0.5, dt * 10);
        });

        // ── HEADLIGHTS ──
        const rX  = fZ, rZ = -fX; // right vector (perpendicular in XZ)
        const base = new THREE.Vector3(this.carX, this.carY + 0.7, this.carZ);
        const tgt  = base.clone().addScaledVector(new THREE.Vector3(fX, 0, fZ), 32);
        this.hlL.position.copy(base.clone().addScaledVector(new THREE.Vector3(rX,0,rZ), -0.8));
        this.hlR.position.copy(base.clone().addScaledVector(new THREE.Vector3(rX,0,rZ),  0.8));
        this.hlL.target.position.copy(tgt.clone().addScaledVector(new THREE.Vector3(rX,0,rZ), -0.5));
        this.hlR.target.position.copy(tgt.clone().addScaledVector(new THREE.Vector3(rX,0,rZ),  0.5));

        // Underglow pulse
        this.underGlow.intensity = this.isNitro
            ? 4.5 + Math.random()*2
            : 2.2 + Math.sin(Date.now()*0.003)*0.9;

        // ── COLLISION ──
        for (const o of this.obstacles) {
            const dx = this.carX - o.position.x, dz = this.carZ - o.position.z;
            if (Math.sqrt(dx*dx + dz*dz) < 2.85) { this._gameOver(); return; }
        }

        // ── GOLDEN COINS COLLECTION ──
        for (const g of this.gems) {
            g.rotation.y += dt * 3.2;
            g.position.y  = this._terrainH(g.position.x, g.position.z) + 1.0 + Math.sin(Date.now()*0.003 + g.position.x)*0.22;
            const dx = this.carX - g.position.x;
            const dy = this.carY - g.position.y;
            const dz = this.carZ - g.position.z;
            if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 2.5) {
                this.coins++;
                this.audio.playPickup();
                const [nx, nz] = this._rndPos(30);
                const ny = this._terrainH(nx, nz);
                g.position.set(nx, ny + 1.0, nz);
            }
        }

        // River shimmer
        const t = Date.now() * 0.001;
        this.bankLights.forEach((l, i) => {
            l.intensity = 1.4 + Math.sin(t * 1.6 + i * 2.2) * 0.9;
        });

        // ── AUDIO ──
        this.audio.updateEngine(Math.abs(this.speed) / this.MAX_SPD, this.input.fwd);

        // ── HUD UPDATES (Clean & Unobtrusive) ──
        const kmh = Math.abs(this.speed) * 3.6;
        document.getElementById('speed-val').innerText = Math.floor(kmh);
        document.getElementById('coin-val').innerText  = this.coins;
    }

    // ── CAMERA UPDATE ───────────────────────────────────────
    _updateCamera(dt) {
        if (this.camMode === 2) {
            // Top-down
            this.camera.position.lerp(
                new THREE.Vector3(this.carX, this.carY+42, this.carZ+5), dt*6);
            this.camera.lookAt(this.carX, this.carY, this.carZ);
            this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 65, dt*4);
            this.camera.updateProjectionMatrix();
            return;
        }

        const close = this.camMode === 1;
        const dist  = close ? 7.5 : (13.5 + Math.abs(this.speed)*0.045 + (this.isNitro ? 3 : 0));
        const hgt   = close ? 2.8  : (4.8  + this.carY * 0.18);

        // Auto-follow when not dragging:
        // Target camAngle = heading + PI (directly behind car)
        if (!this.isDragging) {
            let behind = this.heading + Math.PI;
            let diff   = behind - this.camAngle;
            // Normalise to [-PI, PI]
            while (diff >  Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            this.camAngle += diff * dt * (close ? 3.5 : 2.0);
            const pDef = close ? 0.22 : 0.33;
            this.camPitch = THREE.MathUtils.lerp(this.camPitch, pDef, dt * 2.2);
        }

        const cp = this.camPitch;
        const ca = this.camAngle;
        const tx = this.carX + Math.sin(ca) * Math.cos(cp) * dist;
        const ty = this.carY + hgt + Math.sin(cp) * dist * 0.5;
        const tz = this.carZ + Math.cos(ca) * Math.cos(cp) * dist;

        this.camera.position.lerp(new THREE.Vector3(tx, ty, tz), dt * (close ? 6 : 4.5));
        this.camera.lookAt(this.carX, this.carY + 1.5, this.carZ);

        const fovTgt = this.isNitro ? 84 : (close ? 80 : 65);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fovTgt, dt*5);
        this.camera.updateProjectionMatrix();
    }

    // ── TERRAIN HEIGHT SAMPLER ─────────────────────────────
    // Single source of truth used by BOTH _buildTerrain() and the
    // real-time physics so the mesh and collision always match exactly.
    //
    // ZONES (by radius from centre):
    //   0  – 160  → perfectly flat paved area (racing)
    //   160 – 420 → offroad rolling hills (8–30 m tall)
    //   420+      → tall mountain ring (up to 180 m)
    _terrainH(x, z) {
        const r  = Math.sqrt(x * x + z * z);
        let   y  = 0;

        // ── Offroad hills zone (r: 160 – 440) ──
        if (r > 160) {
            const t  = Math.min((r - 160) / 260, 1.0);
            // smoothstep so the flat zone blends in gently
            const st = t * t * (3.0 - 2.0 * t);

            // 4-octave hills — ample amplitude for real bumps
            const hills =
                  Math.sin(x * 0.032 + 1.1) * Math.cos(z * 0.028 - 0.9) * 22
                + Math.sin(x * 0.065 - 0.4) * Math.cos(z * 0.060 + 1.6) * 13
                + Math.sin(x * 0.130 + 2.2) * Math.cos(z * 0.120 - 0.2) * 7
                + Math.sin(x * 0.260 - 1.3) * Math.cos(z * 0.250 + 0.8) * 3.5;

            // Bias positive so hills are almost always above flat ground
            y = st * Math.max(0, hills + 14);
        }

        // ── Mountain ring (r > 400) layered on top ──
        if (r > 400) {
            const mt  = Math.min((r - 400) / 220, 1.0);
            const mst = mt * mt * (3.0 - 2.0 * mt);
            const n   = Math.sin(x * 0.030) * Math.cos(z * 0.026)
                      + Math.sin(x * 0.062 + 1.7) * Math.cos(z * 0.055 - 0.8) * 0.55
                      + Math.sin(x * 0.125 - 2.5) * Math.cos(z * 0.118 + 1.4) * 0.28
                      + Math.sin(x * 0.250 + 0.4) * Math.cos(z * 0.238 - 0.6) * 0.12;
            const mH  = Math.max(0, mst * 180 * (0.38 + n * 0.62));
            y = Math.max(y, mH);
        }

        return Math.max(0, y);
    }

    // Returns the up-normal of the terrain at (x,z) using finite differences
    _terrainNormal(x, z) {
        const e  = 1.5;
        const hL = this._terrainH(x - e, z);
        const hR = this._terrainH(x + e, z);
        const hF = this._terrainH(x, z - e);
        const hB = this._terrainH(x, z + e);
        // dh/dx and dh/dz give the slope; normal = cross of tangent vectors
        return new THREE.Vector3(hL - hR, 2 * e, hF - hB).normalize();
    }

    // ── MAIN LOOP ──────────────────────────────────────────
    _loop() {
        requestAnimationFrame(this._loop);
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this._updatePhysics(dt);
        this._updateCamera(dt);
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new GameEngine(); });
