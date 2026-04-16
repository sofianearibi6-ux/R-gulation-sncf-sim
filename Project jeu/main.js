// GLOBAL UI Elements
const menuView = document.getElementById('main-menu');
const gameView = document.getElementById('game-view');
const btnModeBal = document.getElementById('btn-mode-bal');
const btnModePrs = document.getElementById('btn-mode-prs');
const btnBack = document.getElementById('btn-back');

const balControls = document.getElementById('bal-controls');
const prsControls = document.getElementById('prs-controls');
const statusPanel = document.getElementById('status-panel');
const codisPanel = document.getElementById('codis-panel'); // New Control Panel
const timetableBody = document.getElementById('timetable-body');
const btnTraceRoute = document.getElementById('btn-trace-route');
const selOrigin = document.getElementById('route-origin');
const selDest = document.getElementById('route-dest');

const SNCF_NAMES = {
    "QA": "Quai A", "QB": "Quai B", "QC": "Quai C", "QD": "Quai D", "QE": "Quai E", "QF": "Quai F",
    "N1": "Ligne Paris (Nord)", "N2": "Ligne LGV (Nord)", "S1": "Ligne Lyon (Sud)", "S2": "Ligne Dole (Sud)", "D1": "Dépôt A"
};

let statusTimeout = null;
function setSNCFStatus(msg, timeout = 6000) {
    statusPanel.textContent = msg;
    if (statusTimeout) clearTimeout(statusTimeout);
    if (timeout > 0) {
        statusTimeout = setTimeout(() => {
            statusPanel.textContent = "SNCF MATRICE ACTIVE - Régulation Prête. En attente d'ordres.";
        }, timeout);
    }
}

const svgLayers = {
    tracks: document.getElementById('tracks-layer'),
    cantons: document.getElementById('cantons-layer'),
    signals: document.getElementById('signals-layer'),
    routes: document.getElementById('itinerary-layer'),
    trains: document.getElementById('trains-layer'),
    overlay: document.getElementById('overlay-layer')
};

let currentSimulation = null;
let animFrame = null;
let lastTime = 0;


// ==========================================
// CORE CLASSES
// ==========================================

class Train {
    constructor(locoId, wagonId, numWagons, idString, spawnNode, spawnDisplay) {
        this.id = idString; 
        this.spawnNode = spawnNode;
        this.spawnDisplay = spawnDisplay;
        
        this.pathEdges = [];
        this.distanceOnEdge = 0;
        this.speed = 150;
        this.targetSpeed = 150; 
        this.maxSpeed = 150;
        this.acceleration = 60;
        this.braking = 80; 
        
        this.state = "approaching"; // approaching -> wait_entry -> entering -> wait_departure -> leaving
        this.currentLocation = spawnNode;
        this.facing = (spawnNode.startsWith("N")) ? "R" : "L";
        
        this.cars = []; 
        let currentOffset = 0;
        
        this.cars.push(this._createCar(locoId, currentOffset, true));
        currentOffset -= 110; 
        
        for (let i = 0; i < numWagons; i++) {
            this.cars.push(this._createCar(wagonId, currentOffset, false));
            currentOffset -= 130; 
        }
        this.totalLength = Math.abs(currentOffset);
    }

    _createCar(svgId, offset, isLoco) {
        let g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "train-group");
        let use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", svgId);
        g.appendChild(use);
        
        let labelBg = null;
        let label = null;
        if (isLoco) {
            labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            labelBg.setAttribute("x", "-50"); labelBg.setAttribute("y", "-45");
            labelBg.setAttribute("width", "100"); labelBg.setAttribute("height", "22");
            labelBg.setAttribute("fill", "rgba(0,0,0,0.8)"); labelBg.setAttribute("rx", "4");
            
            label = document.createElementNS("http://www.w3.org/2000/svg", "text");
            label.setAttribute("x", "0"); label.setAttribute("y", "-30");
            label.setAttribute("class", "train-id-text");
            label.textContent = this.id;
            
            g.appendChild(labelBg);
            g.appendChild(label);
        }
        svgLayers.trains.appendChild(g);
        g.setAttribute("transform", `translate(-1000, -1000)`);
        
        return { g, offset, labelBg, label };
    }

    setPath(edges, startDist, nextState, targetLoc, signal = null, triggerDist = 0) {
        this.pathEdges = edges;
        this.distanceOnEdge = startDist;
        this.state = nextState;
        this.targetSpeed = this.maxSpeed;
        this.targetLocation = targetLoc; 
        this.targetDestId = targetLoc;
        this.activeSignal = signal;
        this.signalTriggerDist = triggerDist;
        this.hasTriggeredSignal = false;
    }

    getPointOnRoute(distance) {
        if (!this.pathEdges.length) return null;
        let firstEdge = this.pathEdges[0];
        let lastEdge = this.pathEdges[this.pathEdges.length - 1];
        
        if (distance < 0) {
            let p0 = firstEdge.getPointAtLength(0);
            let p1 = firstEdge.getPointAtLength(1);
            let dx = p1.x - p0.x;
            let dy = p1.y - p0.y;
            let len = Math.hypot(dx, dy) || 1;
            return {
                x: p0.x + (dx/len) * distance,
                y: p0.y + (dy/len) * distance,
                angle: Math.atan2(dy, dx) * (180/Math.PI)
            };
        }
        
        let currentLength = 0;
        for (let i = 0; i < this.pathEdges.length; i++) {
            let edge = this.pathEdges[i];
            if (distance >= currentLength && distance <= currentLength + edge.length) {
                return edge.getPointAtLength(distance - currentLength);
            }
            currentLength += edge.length;
        }
        
        let pEnd = lastEdge.getPointAtLength(lastEdge.length);
        let pPrev = lastEdge.getPointAtLength(lastEdge.length - 1);
        let dx = pEnd.x - pPrev.x;
        let dy = pEnd.y - pPrev.y;
        let len = Math.hypot(dx, dy) || 1;
        let overshoot = distance - currentLength;
        return {
            x: pEnd.x + (dx/len) * overshoot,
            y: pEnd.y + (dy/len) * overshoot,
            angle: Math.atan2(dy, dx) * (180/Math.PI)
        };
    }

    getCurrentEdge() {
        if (!this.pathEdges.length) return null;
        let currentLength = 0;
        for (let i = 0; i < this.pathEdges.length; i++) {
            let edge = this.pathEdges[i];
            if (this.distanceOnEdge >= currentLength && this.distanceOnEdge <= currentLength + edge.length) {
                return edge;
            }
            currentLength += edge.length;
        }
        return this.pathEdges[this.pathEdges.length - 1];
    }

    updatePosition() {
        if (!this.pathEdges.length) return;
        for (let car of this.cars) {
            let pos = this.getPointOnRoute(this.distanceOnEdge + car.offset);
            if (pos) {
                let displayAngle = pos.angle;
                let scaleStr = "";
                let isGoingLeft = Math.abs(displayAngle) > 90;
                if (isGoingLeft) {
                    displayAngle -= 180;
                    scaleStr = "scale(-1, 1)";
                }
                car.g.setAttribute("transform", `translate(${pos.x}, ${pos.y}) rotate(${displayAngle}) ${scaleStr}`);
                
                if (car.labelBg && car.label) {
                    let invScale = isGoingLeft ? "scale(-1, 1)" : "";
                    car.labelBg.setAttribute("transform", `${invScale} rotate(${-displayAngle})`);
                    car.label.setAttribute("transform", `${invScale} rotate(${-displayAngle})`);
                }
            }
        }
    }

    destroy() {
        for (let car of this.cars) {
            if (car.g && car.g.parentNode) {
                car.g.parentNode.removeChild(car.g);
            }
        }
        this.state = "destroyed";
    }

    update(dt) {
        if (this.state === "service_passenger") {
            this.serviceTimer -= dt;
            if (this.serviceTimer <= 0) {
                this.state = "wait_departure";
                
                // Génération de la NOUVELLE demande de sortie !
                let exits = [];
                if (this.spawnNode.startsWith("N")) {
                    exits = ["S1", "S2"]; 
                    if (Math.random() > 0.8) exits = ["D1"]; // Dépôt
                } else {
                    exits = ["N1", "N2"];
                }
                this.targetDestId = exits[Math.floor(Math.random() * exits.length)];
                
                let d = new Date();
                this.arrivalTimeStr = d.getHours().toString().padStart(2, '0') + ":" + d.getMinutes().toString().padStart(2, '0');
                
                if (currentSimulation) currentSimulation.updateGrid();
            }
            this.updatePosition();
            return;
        }

        if (this.state === "wait_entry" || this.state === "wait_departure" || this.state === "destroyed") {
            this.updatePosition();
            return;
        }

        if (this.speed < this.targetSpeed) {
            this.speed += this.acceleration * dt;
            if (this.speed > this.targetSpeed) this.speed = this.targetSpeed;
        } else if (this.speed > this.targetSpeed) {
            this.speed -= this.braking * dt;
            if (this.speed < this.targetSpeed) this.speed = this.targetSpeed;
            if (this.speed < 0) this.speed = 0;
        }

        if (this.speed > 0) {
            this.distanceOnEdge += this.speed * dt;
        }
            
        // DÉTECTION DE FRANCHISSEMENT DE SIGNAL
        if (this.speed > 0 && this.activeSignal && !this.hasTriggeredSignal) {
            if (this.distanceOnEdge >= this.signalTriggerDist) {
                this.hasTriggeredSignal = true;
                // Déclenchement de la fermeture au passage avec un délai de 2 sec !
                let sig = this.activeSignal;
                setTimeout(() => {
                    sig.state = 0; // Carré
                    sig.updateVisuals();
                }, 2000);
            }
        }
        
        let totalPathLength = this.pathEdges.reduce((sum, e) => sum + e.length, 0);
            
        // Logic depending on state
        if (this.state === "approaching") {
            let distToSignal = totalPathLength - this.distanceOnEdge;
            let brakingDist = (this.speed * this.speed) / (2 * this.braking) || 0;
            if (distToSignal < brakingDist + 50 && this.targetSpeed > 0) {
                this.targetSpeed = 0; 
            }
            if (this.speed === 0) {
                this.state = "wait_entry";
                if (currentSimulation) currentSimulation.updateGrid();
            }
        } 
        else if (this.state === "entering") {
            let distToPlatformEnd = totalPathLength - this.distanceOnEdge;
            let brakingDist = (this.speed * this.speed) / (2 * this.braking) || 0;
            if (distToPlatformEnd < brakingDist + 60 && this.targetSpeed > 0) {
                this.targetSpeed = 0;
                if (currentSimulation) setSNCFStatus(`${this.id} entre en gare et stationne ${SNCF_NAMES[this.targetLocation] || this.targetLocation}.`);
            }
            if (this.speed === 0) {
                this.state = "service_passenger";
                this.currentLocation = this.targetLocation;
                // Départ automatique planifié précisément après 30 secondes !
                this.serviceTimer = 30; 
                this.targetDestId = "---";
                if (currentSimulation) currentSimulation.updateGrid();
            }
        }
        else if (this.state === "leaving") {
            if (this.distanceOnEdge - this.totalLength > totalPathLength + 200) {
                this.destroy(); // Out of simulation
                if (currentSimulation) currentSimulation.updateGrid();
            }
        }
        
        this.updatePosition();
    }
}

class TrackEdge {
    constructor(id, pathString) {
        this.id = id;
        this.pathString = pathString;
        this.element = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.element.setAttribute("d", pathString);
        this.element.setAttribute("class", "track");
        svgLayers.tracks.appendChild(this.element);
        this.length = this.element.getTotalLength();
    }
    getPointAtLength(distance) {
        let d = Math.max(0, Math.min(distance, this.length));
        let pos = this.element.getPointAtLength(d);
        let posNext = this.element.getPointAtLength(Math.min(d + 1, this.length));
        let angle = 0;
        if (posNext.x !== pos.x || posNext.y !== pos.y) {
            angle = Math.atan2(posNext.y - pos.y, posNext.x - pos.x) * (180 / Math.PI);
        }
        return { x: pos.x, y: pos.y, angle: angle };
    }
    destroy() { if(this.element.parentNode) this.element.parentNode.removeChild(this.element); }
}

class Signal {
    constructor(x, y, label, isReversed=false, nodeId=null) {
        this.x = x; this.y = y; this.label = label;
        this.state = 0; // 0=Carré
        this.isReversed = isReversed;
        this.nodeId = nodeId;
        this.onClickCb = null;
        this.element = this.draw();
    }
    draw() {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        // On réduit la taille physique du bloc de 40% pour qu'il s'insère parfaitement entre les voies denses
        const scaleX = this.isReversed ? -0.6 : 0.6;
        g.setAttribute("transform", `translate(${this.x}, ${this.y}) scale(${scaleX}, 0.6)`);
        g.setAttribute("class", "clickable-signal");
        
        g.addEventListener('click', () => {
            if (this.onClickCb) this.onClickCb(this);
        });
        
        const pole = document.createElementNS("http://www.w3.org/2000/svg", "line");
        pole.setAttribute("x1", "0"); pole.setAttribute("y1", "0"); pole.setAttribute("x2", "0"); pole.setAttribute("y2", "-60");
        pole.setAttribute("class", "signal-pole");
        g.appendChild(pole);
        
        const plate = document.createElementNS("http://www.w3.org/2000/svg", "path");
        
        // Tracé précis de la plaque cible "CARRÉ" classique (4 cibles alignées verticalement)
        // D'après l'image, c'est un rectangle adouci contenant de haut en bas: ROUGE, VERT, ROUGE, JAUNE
        let d = "M -18,-260 " +
                "L 18,-260 A 18,18 0 0 1 36,-242 " +
                "L 36,-18 A 18,18 0 0 1 18,0 " +
                "L -18,0 A 18,18 0 0 1 -36,-18 " +
                "L -36,-242 A 18,18 0 0 1 -18,-260 Z";
                
        plate.setAttribute("d", d);
        plate.setAttribute("fill", "#1a1a1a");
        plate.setAttribute("stroke", "#ffffff");
        plate.setAttribute("stroke-width", "3");
        g.appendChild(plate);
        
        const createL = (cx, cy, c) => {
            const h = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            h.setAttribute("cx", cx); h.setAttribute("cy", cy); h.setAttribute("r", "12");
            h.setAttribute("class", `light ${c}`); return h;
        };
        
        // Placement exact des 4 feux verticaux (CARRÉ)
        this.carre1     = createL("0", "-230", "off"); // Rouge 1
        this.voieLibre  = createL("0", "-170", "off"); // Vert
        this.carre2     = createL("0", "-110", "off"); // Rouge 2
        this.avertiss   = createL("0", "-50", "off");  // Jaune
        
        // Oeilleton rattaché au pilonne (Blanc)
        this.oeilleton = createL("-42", "-110", "off"); 
        this.oeilleton.setAttribute("r", "5");
        
        g.appendChild(this.carre1);
        g.appendChild(this.voieLibre);
        g.appendChild(this.carre2);
        g.appendChild(this.avertiss);
        g.appendChild(this.oeilleton);
        
        const lb = document.createElementNS("http://www.w3.org/2000/svg", "text");
        lb.setAttribute("x", "0"); lb.setAttribute("y", "-245"); lb.setAttribute("class", "signal-label");
        if (this.isReversed) {
            lb.setAttribute("transform", "scale(-1, 1)");
        }
        lb.textContent = this.label; g.appendChild(lb);
        svgLayers.signals.appendChild(g);
        this.updateVisuals();
        return g;
    }
    updateVisuals() {
        // Reset all lights
        let lights = [this.carre1, this.carre2, this.voieLibre, this.avertiss, this.oeilleton];
        lights.forEach(l => l.setAttribute("class", "light off"));

        if (this.state === 0) { // Carré fermé (2 Feux Rouges)
            this.carre1.setAttribute("class", "light red");
            this.carre2.setAttribute("class", "light red");
        } else if (this.state === 1) { // Sémaphore (1 Feu Rouge + Oeilleton optionnel)
            this.carre1.setAttribute("class", "light red");
            this.oeilleton.setAttribute("class", "light white"); 
        } else if (this.state === 2) { // Voie Libre (Vert)
            this.voieLibre.setAttribute("class", "light green");
        } else if (this.state === 3) { // Avertissement (Jaune)
            this.avertiss.setAttribute("class", "light yellow");
        } else if (this.state === 4) { // Ralentissement (Jaune clignotant / simple)
            this.avertiss.setAttribute("class", "light yellow");
        }
    }
    destroy() { if(this.element.parentNode) this.element.parentNode.removeChild(this.element); }
}


// ==========================================
// SIMULATION 3 : TCO INTEGRAL & INTERLOCKING
// ==========================================

class SimDijon {
    constructor() {
        this.trains = [];
        this.edges = [];
        this.signals = {};
        
        this.activeRoutes = []; // Anti-collision locking array
        this.timeSinceLastSpawn = 0;
        this.spawnInterval = 3; 
        this.trainCounter = 1000;
        this.lastGridTick = 0;
        
        this.prsState = 'idle';
        this.prsOriginNode = null;
        this.prsOriginSignal = null;
        
        timetableBody.innerHTML = '';
        this.setup();
    }

    setup() {
        prsControls.classList.add('hidden');
        codisPanel.classList.remove('hidden');
        
        this.prsStatePanel = document.getElementById('prs-state-panel');
        this.prsOrigLabel = document.getElementById('prs-orig-label');
        this.prsDestLabel = document.getElementById('prs-dest-label');
        this.btnCancelRoute = document.getElementById('btn-cancel-route');
        
        if (this.btnCancelRoute) {
            this.btnCancelRoute.onclick = () => this.resetPRS();
        }
        
        // TOPOLOGY CONFIG (Retour à l'original compact)
        const NodeY = { N1: 250, N2: 400, S1: 650, S2: 800, D1: 100, QA: 200, QB: 320, QC: 440, QD: 560, QE: 680, QF: 800 };
        this.NodeY = NodeY;
        
        const platConfig = [
            { id: "QA", lbl: "Voie A" }, { id: "QB", lbl: "Voie B" }, { id: "QC", lbl: "Voie C" },
            { id: "QD", lbl: "Voie D" }, { id: "QE", lbl: "Voie E" }, { id: "QF", lbl: "Voie F" }
        ];

        // 1. IN/OUT EDGES
        let edgesMap = {};
        edgesMap["N1"] = { in: new TrackEdge("N1_in", "M -1000 250 L 500 250"), out: new TrackEdge("N1_out", "M 500 250 L -1000 250") };
        edgesMap["N2"] = { in: new TrackEdge("N2_in", "M -1000 400 L 500 400"), out: new TrackEdge("N2_out", "M 500 400 L -1000 400") };
        edgesMap["S1"] = { in: new TrackEdge("S1_in", "M 7000 650 L 3500 650"), out: new TrackEdge("S1_out", "M 3500 650 L 7000 650") };
        edgesMap["S2"] = { in: new TrackEdge("S2_in", "M 7000 800 L 3500 800"), out: new TrackEdge("S2_out", "M 3500 800 L 7000 800") };
        edgesMap["D1"] = { in: new TrackEdge("D1_in", "M 7000 100 L 3500 100"), out: new TrackEdge("D1_out", "M 3500 100 L 7000 100") };

        // 2. REGIONAL DECORATION (Gevrey on S1 & Depot D1)
        this.createScenery();

        // 3. QUAYS AND CONNECTIONS
        let qMap = {}; // Forward (LR) and Backward (RL)
        this.routeDB = {}; // Database of all combinations

        platConfig.forEach(q => {
            let y = NodeY[q.id];
            
            // Physical platforms (Original layout)
            qMap[q.id + "_LR"] = new TrackEdge(`${q.id}_LR`, `M 1100 ${y} L 2100 ${y}`);
            qMap[q.id + "_RL"] = new TrackEdge(`${q.id}_RL`, `M 2100 ${y} L 1100 ${y}`);
            
            this.signals[`Q_${q.id}_R`] = new Signal(2050, y, "Sortie Côté Lyon", false, `${q.id}`);
            this.signals[`Q_${q.id}_L`] = new Signal(1150, y, "Sortie Côté Paris", true, `${q.id}`);
            
            this.drawPlatform(1100, y, q.lbl, 1000);
            
            // Connect Left Nodes (N1, N2) to Quays
            ['N1', 'N2'].forEach(node => {
                let ny = NodeY[node];
                let inC = new TrackEdge(`${node}_${q.id}`, `M 500 ${ny} C 800 ${ny}, 800 ${y}, 1100 ${y}`);
                let outC = new TrackEdge(`${q.id}_${node}`, `M 1100 ${y} C 800 ${y}, 800 ${ny}, 500 ${ny}`);
                this.routeDB[`${node}->${q.id}`] = { edges: [edgesMap[node].in, inC, qMap[q.id+"_LR"]], signal: node, dist: 0 };
                this.routeDB[`${q.id}->${node}`] = { edges: [qMap[q.id+"_RL"], outC, edgesMap[node].out], signal: `Q_${q.id}_L`, dist: 1000 };
            });

            // Connect Right Nodes (S1, S2, D1) to Quays
            ['S1', 'S2', 'D1'].forEach(node => {
                let ny = NodeY[node];
                let inC = new TrackEdge(`${node}_${q.id}`, `M 3500 ${ny} C 3200 ${ny}, 3200 ${y}, 2100 ${y}`);
                let outC = new TrackEdge(`${q.id}_${node}`, `M 2100 ${y} C 3200 ${y}, 3200 ${ny}, 3500 ${ny}`);
                this.routeDB[`${node}->${q.id}`] = { edges: [edgesMap[node].in, inC, qMap[q.id+"_RL"]], signal: node, dist: 0 };
                this.routeDB[`${q.id}->${node}`] = { edges: [qMap[q.id+"_LR"], outC, edgesMap[node].out], signal: `Q_${q.id}_R`, dist: 1000 };
            });
        });

        // 4. SIGNALS BOUNDARIES
        this.signals["N1"] = new Signal(350, NodeY.N1, "C.Paris", false, "N1");
        this.signals["N2"] = new Signal(350, NodeY.N2, "C.LGV", false, "N2");
        this.signals["S1"] = new Signal(4650, NodeY.S1, "C.Lyon", true, "S1");
        this.signals["S2"] = new Signal(4650, NodeY.S2, "C.Dole", true, "S2");
        this.signals["D1"] = new Signal(4650, NodeY.D1, "C.Dépôt", true, "D1");

        Object.values(this.signals).forEach(sig => {
            sig.onClickCb = (s) => this.onSignalClick(s);
        });

        setSNCFStatus("SNCF MATRICE ACTIVE - Mode TCO Complet Prêt.", 0);
    }

    resetPRS() {
        this.prsState = 'idle';
        if (this.prsOriginSignal && this.prsOriginSignal.element) {
            this.prsOriginSignal.element.classList.remove('origin-active');
        }
        this.prsOriginNode = null;
        this.prsOriginSignal = null;
        this.updatePRSUIVisuals();
    }
    
    updatePRSUIVisuals() {
        if (!this.prsStatePanel) return;
        this.prsStatePanel.className = this.prsState === 'idle' ? 'prs-idle' : 'prs-origin-selected';
        this.btnCancelRoute.classList.toggle('hidden', this.prsState === 'idle');
        
        if (this.prsState === 'idle') {
            this.prsOrigLabel.textContent = "--";
            this.prsDestLabel.textContent = "--";
            document.getElementById('prs-instruction').textContent = "CLIQUEZ SUR UN FEU D'ORIGINE POUR COMMENCER";
        } else {
            this.prsOrigLabel.textContent = SNCF_NAMES[this.prsOriginNode] || this.prsOriginNode;
            this.prsDestLabel.textContent = "ATTENTE DESTINATION";
            document.getElementById('prs-instruction').textContent = "CLIQUEZ LE SIGNAL DE DESTINATION";
        }
    }

    onSignalClick(signal) {
        if (!signal.nodeId) return;

        if (this.prsState === 'idle') {
            this.prsState = 'origin-selected';
            this.prsOriginNode = signal.nodeId;
            this.prsOriginSignal = signal;
            signal.element.classList.add('origin-active');
            this.updatePRSUIVisuals();
        } else if (this.prsState === 'origin-selected') {
            let destNode = signal.nodeId;
            if (destNode === this.prsOriginNode) {
                this.resetPRS(); return;
            }
            this.prsDestLabel.textContent = SNCF_NAMES[destNode] || destNode;
            this.traceRoute(this.prsOriginNode, destNode);
            setTimeout(() => this.resetPRS(), 1500); // Wait 1.5s to show destination visually before reset
        }
    }

    createScenery() {
        const addText = (x, y, txt, align="end") => {
            let t = document.createElementNS("http://www.w3.org/2000/svg", "text");
            t.setAttribute("x", x); t.setAttribute("y", y); 
            t.setAttribute("fill", "#607d8b"); 
            t.setAttribute("font-size", "14px"); 
            t.setAttribute("font-weight", "bold");
            t.setAttribute("text-anchor", align);
            t.textContent = txt;
            svgLayers.cantons.appendChild(t);
        };
        // Loin sous le rail !
        addText("400", "290", "ENTRÉE PARIS (N1)");
        addText("400", "440", "ENTRÉE LGV (N2)");
        addText("3600", "690", "ENTRÉE LYON (S1)", "start");
        addText("3600", "840", "ENTRÉE DOLE (S2)", "start");
        addText("3600", "140", "ENTRÉE DÉPÔT (D1)", "start");

        // Gevrey
        let pG = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        pG.setAttribute("x", "3500"); pG.setAttribute("y", "626"); pG.setAttribute("width", "1000"); pG.setAttribute("height", "48");
        pG.setAttribute("fill", "#2d2121"); pG.setAttribute("rx", "6");
        svgLayers.cantons.appendChild(pG);
        let tG = document.createElementNS("http://www.w3.org/2000/svg", "text");
        tG.setAttribute("x", "5000"); tG.setAttribute("y", "656"); tG.setAttribute("class", "signal-label"); tG.textContent = "Gare de Gevrey";
        svgLayers.cantons.appendChild(tG);

        // Dummy Semaphores
        svgLayers.signals.appendChild(new Signal(5600, 650, "Sém.", true).element);
        svgLayers.signals.appendChild(new Signal(4400, 650, "Sém.", true).element);

        // Depot Shed
        let fac = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        fac.setAttribute("x", "4500"); fac.setAttribute("y", "1550");
        fac.setAttribute("width", "500"); fac.setAttribute("height", "400");
        fac.setAttribute("fill", "#1c3245"); fac.setAttribute("rx", "10");
        svgLayers.cantons.appendChild(fac);
    }

    drawPlatform(x, y, label) {
        let plat = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        plat.setAttribute("x", x); plat.setAttribute("y", y - 24);
        plat.setAttribute("width", "1000"); plat.setAttribute("height", "48");
        plat.setAttribute("fill", "rgba(88, 166, 255, 0.05)"); 
        plat.setAttribute("stroke", "rgba(88, 166, 255, 0.3)");
        plat.setAttribute("stroke-width", "2");
        plat.setAttribute("rx", "16");
        svgLayers.cantons.appendChild(plat);

        let text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x + 500); 
        text.setAttribute("y", y + 10); 
        text.setAttribute("fill", "rgba(88, 166, 255, 0.6)"); 
        text.setAttribute("font-size", "28px"); 
        text.setAttribute("font-weight", "900");
        text.setAttribute("font-family", "Inter, sans-serif");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("style", "pointer-events: none;");
        text.textContent = label.toUpperCase(); // e.g. "VOIE A" -> "QUAI A" or "VOIE A"
        svgLayers.cantons.appendChild(text);
    }

    hasConflict(o1, d1, initiatorTrain = null) {
        let isLeft1 = o1.startsWith("N") || d1.startsWith("N");
        let y_b = this.NodeY[o1]; let y_q = this.NodeY[d1];
        if (o1.startsWith("Q")) { y_b = this.NodeY[d1]; y_q = this.NodeY[o1]; } // normalize y_b = boundary, y_q = quay

        for (let r of this.activeRoutes) {
            // Un train ne rentre pas en conflit avec l'itinéraire sur lequel il est lui-même déjà stationné !
            let usedByInitiator = initiatorTrain && initiatorTrain.pathEdges === r.edgesItem;
            if (usedByInitiator) continue;

            let isLeft2 = r.o.startsWith("N") || r.d.startsWith("N");
            let ry_b = this.NodeY[r.o]; let ry_q = this.NodeY[r.d];
            if (r.o.startsWith("Q")) { ry_b = this.NodeY[r.d]; ry_q = this.NodeY[r.o]; }

            if (isLeft1 === isLeft2) {
                // Same side, mathematically check crossings
                if ((y_b - ry_b) * (y_q - ry_q) <= 0) return true;
            } else {
                // Different sides, conflict only if same Quay
                if (y_q === ry_q) return true;
            }
        }
        return false;
    }

    traceRoute(startId, endId) {
        let routeKey = `${startId}->${endId}`;
        let routeData = this.routeDB[routeKey];
        if (!routeData) {
            setSNCFStatus("ERREUR MANUTENTION : Itinéraire géographiquement ou techniquement impossible."); return;
        }

        // On identifie d'abord le train (nécessaire pour autoriser un train à effacer sa PREPRE trace d'arrivée)
        let train = this.trains.find(t => 
            ((t.state === "approaching" || t.state === "wait_entry") && t.spawnNode === startId) || 
            ((t.state === "wait_departure" || t.state === "service_passenger") && t.currentLocation === startId)
        );
        if (!train) {
             setSNCFStatus(`ERREUR : Aucun train stationné ou en approche sur ${SNCF_NAMES[startId] || startId}.`); return;
        }

        // Vérification de sécurité voyageurs !
        if (train.state === "service_passenger") {
             return; // on ignore l'ordre silencieusement
        }

        // Validation stricte d'occupation des quais si on entrait manuellement
        if (endId.startsWith("Q")) {
            let isOccupied = this.trains.some(t => 
                t !== train && 
                (t.currentLocation === endId || t.targetLocation === endId) && 
                t.state !== "destroyed" && t.state !== "leaving"
            );
            if (isOccupied) {
                setSNCFStatus(`SÉCURITÉ REFUSÉE : Le quai ${SNCF_NAMES[endId] || endId} est bloqué par un autre trafic !`, 4000);
                return;
            }
        }

        // Contrôle matriciel anti-collision !
        if (this.hasConflict(startId, endId, train)) {
            setSNCFStatus("ALERTE SÉCURITÉ CONFLIT : Risque de croisement ou segment occupé ! Ordre refusé."); return;
        }
        // Vérification stricte de la destination réclamée par le train (Gameplay !)
        if (train.targetDestId !== endId && train.targetDestId !== "---") {
             setSNCFStatus(`⚠️ DÉVIATION AUTORISÉE : Le train ${train.id} est contraint de changer sa cible originelle de ${SNCF_NAMES[train.targetDestId] || train.targetDestId} vers ${SNCF_NAMES[endId] || endId}.`, 4000);
        }

        // Validation de l'occupation physique : on ne route jamais un train vers un quai occupé !!
        if (endId.startsWith("Q")) {
            let isOccupied = this.trains.some(t => 
                t !== train && 
                (t.currentLocation === endId || t.targetLocation === endId) && 
                t.state !== "destroyed" && t.state !== "leaving"
            );
            if (isOccupied) {
                setSNCFStatus(`SÉCURITÉ : La voie ${SNCF_NAMES[endId] || endId} est déjà occupée ou réservée !`, 4000);
                return;
            }
        }

        // Lock route visually
        setSNCFStatus(`Itinéraire Sécurisé. Transit ouvert vers ${SNCF_NAMES[endId] || endId}.`);
        
        // Push Route Lock
        let routeObj = { o: startId, d: endId, edgesItem: routeData.edges };
        this.activeRoutes.push(routeObj);
        
        let signal = this.signals[routeData.signal];
        if (signal) {
            signal.state = 3; // Ralentissement 30 (Feux Jaunes purs)
            signal.updateVisuals();
        }

        // GUI lines
        routeData.edges.forEach(e => {
            let hl = document.createElementNS("http://www.w3.org/2000/svg", "path");
            hl.setAttribute("d", e.pathString);
            hl.setAttribute("class", "tco-track-locked");
            hl.routeRef = routeObj; // Meta tag to clear it later
            svgLayers.overlay.appendChild(hl);
        });

        setTimeout(() => {
            let nextState = endId.startsWith("Q") ? "entering" : "leaving";
            
            let isEntryRoute = !startId.startsWith("Q");
            let initialDist = 0;
            if (isEntryRoute) {
                initialDist = train.distanceOnEdge;
            } else {
                // Calcul exact de la portion locale parcourue sur le quai pour une transition parfaite
                let currentLocalDist = routeData.dist;
                if (train.pathEdges && train.pathEdges.length > 0) {
                    let lastEdgeLen = train.pathEdges[train.pathEdges.length - 1].length;
                    let prefixLen = train.pathEdges.reduce((s, e) => s + e.length, 0) - lastEdgeLen;
                    currentLocalDist = train.distanceOnEdge - prefixLen;
                    if(currentLocalDist < 0) currentLocalDist = 0;
                    if(currentLocalDist > 1000) currentLocalDist = 1000;
                }
                initialDist = currentLocalDist;
            }
            
            // Le train déclenche le signal Carré uniquement quand il passe devant !
            // (À l'entrée c'est à la fin du inC, à la sortie c'est à la fin du quai)
            let triggerDist = isEntryRoute ? routeData.edges[0].length - 50 : routeData.edges[0].length;
            
            train.setPath(routeData.edges, initialDist, nextState, endId, signal, triggerDist);
            
            if (currentSimulation) currentSimulation.updateGrid();
        }, 1500);
    }

    spawnAutomaticTrain() {
        let origins = [
            { id:"N1", name:"Ligne Paris"}, { id:"N2", name:"Ligne LGV"},
            { id:"S1", name:"Ligne Lyon (Gevrey)"}, { id:"S2", name:"Ligne Dole"},
            { id:"D1", name:"Dépôt A"}
        ];
        
        let spawnParams = origins[Math.floor(Math.random() * origins.length)];
        let spawnNode = spawnParams.id;
        
        let occupied = this.trains.some(t => t.spawnNode === spawnNode && (t.state === "approaching" || t.state === "wait_entry"));
        if (occupied) return; 
        
        let quays = ["QA","QB","QC","QD","QE","QF"];
        let destId = quays[Math.floor(Math.random() * quays.length)];
        
        let r = Math.random();
        let trainIdStr = r > 0.5 ? "INT " + this.trainCounter++ : "TER " + this.trainCounter++;
        let locoId = r > 0.5 ? "#train-loco-red" : "#train-loco-blue";
        let wagonId = "#train-wagon-grey";
        
        // Train très long (6 à 7 wagons passagers) pour maximiser la voie
        let train = new Train(locoId, wagonId, Math.floor(Math.random() * 2) + 6, trainIdStr, spawnNode, spawnParams.name);
        
        let d = new Date();
        d.setMinutes(d.getMinutes() + Math.floor(Math.random() * 5));
        train.arrivalTimeStr = d.getHours().toString().padStart(2, '0') + ":" + d.getMinutes().toString().padStart(2, '0');
        
        let initialEdge = this.routeDB[`${spawnNode}->QA`].edges[0]; // the 'in' edge
        train.setPath([initialEdge], 0, "approaching", destId);
        
        this.trains.push(train);
        this.updateGrid();
    }

    updateGrid() {
        timetableBody.innerHTML = '';
        
        this.trains.forEach(t => {
            // Nettoyage de l'interface : On cache les trains en mouvement (entrant/sortant) ou détruits
            if (t.state === "destroyed" || t.state === "entering" || t.state === "leaving") return;

            let tr = document.createElement('tr');
            let stat = "En approche";
            if (t.state === "wait_entry") stat = "Demande d'Entrée";
            if (t.state === "wait_departure") stat = "Demande de Départ";
            if (t.state === "service_passenger") stat = `<span style="color:#d29f00;">À Quai (${Math.ceil(t.serviceTimer)}s)</span>`;
            
            let destDisp = SNCF_NAMES[t.targetDestId] || t.targetDestId || "Gare de Dijon";
            if (t.state === "wait_departure") destDisp = `Direction ${destDisp}`;
            if (t.state === "service_passenger") destDisp = "Portes Ouvertes";
            
            let origDisp = SNCF_NAMES[t.spawnNode] || t.spawnNode;
            if (t.state === "wait_departure" || t.state === "service_passenger") origDisp = SNCF_NAMES[t.currentLocation] || t.currentLocation; 
            
            let timeStr = t.arrivalTimeStr || "--:--";
            
            tr.innerHTML = `
                <td style="color:#aaa">${timeStr}</td>
                <td><strong>${t.id}</strong><br><small style="color:#aaa">${stat}</small></td>
                <td>${origDisp}</td>
                <td style="color:var(--accent); font-weight:bold;">${destDisp}</td>
            `;
            timetableBody.appendChild(tr);
        });
    }

    update(dt) {
        this.timeSinceLastSpawn += dt;
        if (this.timeSinceLastSpawn > this.spawnInterval) {
            this.spawnAutomaticTrain();
            this.timeSinceLastSpawn = 0;
            this.spawnInterval = 12 + Math.random() * 8;
        }
        
        this.lastGridTick += dt;
        if (this.lastGridTick > 1.0) {
            this.lastGridTick = 0;
            if (this.trains.some(t => t.state === "service_passenger")) {
                this.updateGrid(); // Dynamic countdown visually
            }
        }
        
        // Clear old occupied markers
        document.querySelectorAll('.tco-track-occupied').forEach(el => el.remove());

        this.trains.forEach(t => {
            t.update(dt);
            // On a retiré le départ automatique : le joueur doit retracer l'itinéraire manuellement.
            
            // TCO red transit painting
            if (t.state === "entering" || t.state === "leaving" || t.state === "approaching" || t.state === "wait_entry" || t.state === "service_passenger" || t.state === "wait_departure") {
                let e = t.getCurrentEdge();
                if (e) {
                    let hl = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    hl.setAttribute("d", e.pathString);
                    hl.setAttribute("class", "tco-track-occupied");
                    svgLayers.overlay.appendChild(hl);
                }
            }
        });
        
        // Clean unlocked routes
        this.activeRoutes = this.activeRoutes.filter(ar => {
            // Un lock matriciel n'est conservé QUE si le train est activement en cours de mouvement sur cet itinéraire !
            // Dès qu'il est à l'arrêt passagers ("service_passenger" ou "wait_departure"), l'itinéraire est libéré.
            let stillUsed = this.trains.some(t => 
                t.pathEdges === ar.edgesItem && 
                (t.state === "approaching" || t.state === "entering" || t.state === "leaving" || t.state === "wait_entry")
            );
            if (!stillUsed) {
                // Clear SVG paths (efface le ruban jaune)
                Array.from(svgLayers.overlay.children).forEach(hl => {
                    if (hl.routeRef === ar) hl.remove();
                });
                return false;
            }
            return true;
        });
    }

    teardown() {
        codisPanel.classList.add('hidden');
        if (this.onTraceBtnClick) btnTraceRoute.removeEventListener('click', this.onTraceBtnClick);
        this.trains.forEach(t => t.destroy());
        this.trains = [];
        this.edges.forEach(e => e.destroy());
        Object.values(this.signals).forEach(s => s.destroy());
    }

    autoDepartTrain(train) {
        let startId = train.currentLocation;
        let endId = train.targetDestId;
        
        let routeKey = `${startId}->${endId}`;
        let routeData = this.routeDB[routeKey];
        if (!routeData) return;

        // On attend que la voie devant soit libre (pas de conflit direct avec un nouveau train)
        if (this.hasConflict(startId, endId, train)) { setSNCFStatus('BLOCAGE AUTO DEPART CONFLIT MATRICE !', 2000); return; } 
        
        // Push Route Lock silencieux !
        let routeObj = { o: startId, d: endId, edgesItem: routeData.edges };
        this.activeRoutes.push(routeObj);

        // Highlight SVG (on le trace pour l'immersion visuelle)
        let highlight = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let pathData = routeData.edges.map(e => e.pathStr).join(" ");
        highlight.setAttribute("d", pathData);
        highlight.setAttribute("class", "route-highlight");
        highlight.routeRef = routeObj;
        svgLayers.overlay.appendChild(highlight);

        let signal = this.signals[startId] || (startId.startsWith("Q") && routeData.signal ? this.signals[routeData.signal] : null);
        if (signal) {
            signal.state = 3; // Carré au Vert/Jaune (30)
            signal.updateVisuals();
        }

        let nextState = "leaving";
        let initialDist = 0;
        let currentLocalDist = routeData.dist;
        if (train.pathEdges && train.pathEdges.length > 0) {
            let lastEdgeLen = train.pathEdges[train.pathEdges.length - 1].length;
            let prefixLen = train.pathEdges.reduce((s, e) => s + e.length, 0) - lastEdgeLen;
            currentLocalDist = train.distanceOnEdge - prefixLen;
            if(currentLocalDist < 0) currentLocalDist = 0;
            if(currentLocalDist > 1000) currentLocalDist = 1000;
        }
        initialDist = currentLocalDist;
        
        let triggerDist = routeData.edges[0].length;
        
        // Le départ est immédiat, et la grille est mise à jour !
        train.setPath(routeData.edges, initialDist, nextState, endId, signal, triggerDist);
        this.updateGrid();
    }
}

// ==========================================
// PAN & ZOOM LOGIC 
// ==========================================
function setupPanZoom() {
    let svg = document.getElementById('railway-svg');
    let isPanning = false;
    let startPoint = {x: 0, y: 0};
    let viewPort = {x: -1000, y: -200, width: 9000, height: 1600}; // Massively larger view

    // Init
    svg.setAttribute('viewBox', `${viewPort.x} ${viewPort.y} ${viewPort.width} ${viewPort.height}`);

    svg.addEventListener('mousedown', e => {
        isPanning = true;
        startPoint = {x: e.clientX, y: e.clientY};
        svg.style.cursor = 'grabbing';
    });
    
    window.addEventListener('mousemove', e => {
        if (!isPanning) return;
        let dx = e.clientX - startPoint.x;
        let dy = e.clientY - startPoint.y;
        let pRatio = viewPort.width / svg.clientWidth; 
        
        viewPort.x -= dx * pRatio;
        viewPort.y -= dy * pRatio;
        
        svg.setAttribute('viewBox', `${viewPort.x} ${viewPort.y} ${viewPort.width} ${viewPort.height}`);
        startPoint = {x: e.clientX, y: e.clientY};
    });
    
    window.addEventListener('mouseup', () => {
        isPanning = false;
        svg.style.cursor = 'grab';
    });
    
    svg.addEventListener('wheel', e => {
        e.preventDefault();
        let scale = e.deltaY > 0 ? 1.2 : 0.8;
        let cx = viewPort.x + viewPort.width/2;
        let cy = viewPort.y + viewPort.height/2;
        
        viewPort.width *= scale;
        viewPort.height *= scale;
        
        viewPort.x = cx - viewPort.width/2;
        viewPort.y = cy - viewPort.height/2;
        svg.setAttribute('viewBox', `${viewPort.x} ${viewPort.y} ${viewPort.width} ${viewPort.height}`);
    }, {passive: false});
    
    svg.style.cursor = 'grab';
}


// ==========================================
// BOOT
// ==========================================

function switchSimulation(ModeClass) {
    if (currentSimulation) currentSimulation.teardown();
    Object.values(svgLayers).forEach(layer => layer.innerHTML = '');
    menuView.classList.remove('active');
    gameView.classList.add('active');
    currentSimulation = new ModeClass();
}

let isPaused = false;

function init() {
    btnModeBal.addEventListener('click', () => switchSimulation(SimBAL));
    btnModePrs.addEventListener('click', () => switchSimulation(SimDijon));
    btnBack.addEventListener('click', () => {
        if (currentSimulation) { currentSimulation.teardown(); currentSimulation = null; }
        gameView.classList.remove('active'); menuView.classList.add('active');
        isPaused = false;
        let pO = document.getElementById('pause-overlay');
        if (pO) pO.style.display = 'none';
    });
    
    setupPanZoom();

    // MASQUER L'INTERFACE AVEC LA TOUCHE C
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'c') {
            codisPanel.classList.toggle('hidden');
            let cs = document.getElementById('controls');
            if (cs) cs.classList.toggle('hidden');
        }
        if (e.code === 'Space') {
            e.preventDefault();
            if (menuView.classList.contains('active')) return;
            isPaused = !isPaused;
            let pauseEl = document.getElementById('pause-overlay');
            if (pauseEl) pauseEl.style.display = isPaused ? 'flex' : 'none';
        }
    });

    requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (currentSimulation && !isPaused) currentSimulation.update(dt);
    animFrame = requestAnimationFrame(gameLoop);
}

window.addEventListener('DOMContentLoaded', init);
