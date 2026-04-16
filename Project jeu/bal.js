// ==========================================
// SIMULATION 4 : LIGNE REGIONALE BAL AUTO
// ==========================================

class SimBAL {
    constructor() {
        this.trains = [];
        this.edges = [];
        this.signals = {};
        
        this.activeRoutes = [];
        this.timeSinceLastSpawn = 0;
        this.spawnInterval = 5; 
        this.trainCounter = 5000;
        this.lastGridTick = 0;
        
        this.isAutoAiguillage = true;
        this.prsState = 'idle';
        this.prsOriginNode = null;
        this.prsOriginSignal = null;
        
        timetableBody.innerHTML = '';
        this.setup();
    }

    setup() {
        let balControls = document.getElementById('bal-controls');
        if (balControls) balControls.classList.remove('hidden');
        codisPanel.classList.remove('hidden');
        
        this.prsStatePanel = document.getElementById('prs-state-panel');
        this.prsOrigLabel = document.getElementById('prs-orig-label');
        this.prsDestLabel = document.getElementById('prs-dest-label');
        this.btnCancelRoute = document.getElementById('btn-cancel-route');
        
        if (this.btnCancelRoute) {
            this.btnCancelRoute.onclick = () => this.resetPRS();
        }

        let toggleAuto = document.getElementById('toggle-auto-bal');
        if(toggleAuto) {
            toggleAuto.onclick = () => {
                this.isAutoAiguillage = !this.isAutoAiguillage;
                toggleAuto.textContent = this.isAutoAiguillage ? "Aiguillage Auto: ON" : "Aiguillage Auto: OFF";
                toggleAuto.className = this.isAutoAiguillage ? "active" : "";
                if(!this.isAutoAiguillage) setSNCFStatus("MODE TCO MANUEL ENGAGÉ. Gestion des gares manuelle requise !");
                else setSNCFStatus("AIGUILLAGE AUTOMATIQUE ENGAGÉ.");
            };
        }
        
        // --- TOPOLOGY MASSIVE SCALE ---
        this.routeDB = {};
        
        const addEdge = (id, path) => {
            let edge = new TrackEdge(id, path);
            this.edges.push(edge); return edge;
        };
        const createRoute = (startNode, endNode, edges, signalId, len) => {
            if(!this.signals[signalId]) console.log("Missing signal", signalId);
            this.routeDB[`${startNode}->${endNode}`] = { edges: edges, signal: signalId, dist: len, start: startNode, end: endNode };
        };

        // LINE 1 : WEST TO EAST (Gargantuan Distances)
        let e1 = addEdge("e1", "M -1000 400 L 9000 400"); 
        let e1_2 = addEdge("e1_2", "M 9000 400 L 19000 400"); // 10k leaps
        let e2 = addEdge("e2", "M 19000 400 L 29000 400");  
        let e3 = addEdge("e3", "M 29000 400 L 39000 400");  
        
        // STATION A (x = 39500 to 42500)
        let ea_qa1_in = addEdge("ea_qa1_in", "M 39000 400 C 39200 400, 39200 300, 39500 300");
        let ea_qa2_in = addEdge("ea_qa2_in", "M 39000 400 C 39200 400, 39200 500, 39500 500");
        let qa1 = addEdge("qa1_lr", "M 39500 300 L 42500 300");
        let qa2 = addEdge("qa2_lr", "M 39500 500 L 42500 500");
        let ea_qa1_out = addEdge("ea_qa1_out", "M 42500 300 C 42800 300, 42800 400, 43000 400");
        let ea_qa2_out = addEdge("ea_qa2_out", "M 42500 500 C 42800 500, 42800 400, 43000 400");

        let e4 = addEdge("e4", "M 43000 400 L 53000 400"); 
        let e4_2 = addEdge("e4_2", "M 53000 400 L 63000 400"); 
        let e5 = addEdge("e5", "M 63000 400 L 73000 400"); 
        
        // STATION B & DEPOT (x = 73500 to 76500)
        let eb_qb1_in = addEdge("eb_qb1_in", "M 73000 400 C 73200 400, 73200 300, 73500 300");
        let eb_qb2_in = addEdge("eb_qb2_in", "M 73000 400 C 73200 400, 73200 500, 73500 500");
        let eb_dep_in = addEdge("eb_dep_in", "M 73000 400 C 73200 400, 73200 150, 73500 150"); 
        
        let qb1 = addEdge("qb1_lr", "M 73500 300 L 76500 300");
        let qb2 = addEdge("qb2_lr", "M 73500 500 L 76500 500");
        let dep = addEdge("dep_lr", "M 73500 150 L 76500 150");
        
        let eb_qb1_out = addEdge("eb_qb1_out", "M 76500 300 C 76800 300, 76800 400, 77000 400");
        let eb_qb2_out = addEdge("eb_qb2_out", "M 76500 500 C 76800 500, 76800 400, 77000 400");
        let eb_dep_out = addEdge("eb_dep_out", "M 76500 150 C 76800 150, 76800 400, 77000 400");

        let e6 = addEdge("e6", "M 77000 400 L 87000 400"); 
        let e7 = addEdge("e7", "M 87000 400 L 97000 400");        // Draw Platforms
        this.drawPlatform(39500, 300, "V. 1", 3000);
        this.drawPlatform(39500, 500, "V. 2", 3000);
        this.drawPlatform(73500, 300, "V. 1", 3000);
        this.drawPlatform(73500, 500, "V. 2", 3000);
        this.drawPlatform(73500, 150, "FAISCEAU DÉPÔT", 3000, "#ffb845");

        // Station background names
        const addStationLabel = (x, y, textStr) => {
            let tG = document.createElementNS("http://www.w3.org/2000/svg", "text");
            tG.setAttribute("x", x); tG.setAttribute("y", y); 
            tG.setAttribute("fill", "rgba(255, 255, 255, 0.4)"); 
            tG.setAttribute("font-size", "140px"); 
            tG.setAttribute("font-weight", "900");
            tG.setAttribute("text-anchor", "middle");
            tG.setAttribute("style", "pointer-events: none;");
            tG.textContent = textStr;
            svgLayers.cantons.appendChild(tG);
        };
        addStationLabel(41000, 100, "GARE DE BEAUNE");
        addStationLabel(75000, -50, "GARE DE CHALON-SUR-SAÔNE");
        
        // Define Signals FIRST
        this.signals["N_W"] = new Signal(100, 400, "N.W");
        this.signals["C1"] = new Signal(8900, 400, "Sém.");
        this.signals["C2"] = new Signal(18900, 400, "Sém.");
        this.signals["C2B"] = new Signal(28900, 400, "Entrée A");
        this.signals["Q_A1"] = new Signal(42450, 300, "Sortie A1");
        this.signals["Q_A2"] = new Signal(42450, 500, "Sortie A2");
        this.signals["C3"] = new Signal(52900, 400, "Sém.");
        this.signals["C3B"] = new Signal(62900, 400, "Entrée B");
        this.signals["Q_B1"] = new Signal(76450, 300, "Sortie B1");
        this.signals["Q_B2"] = new Signal(76450, 500, "Sortie B2");
        this.signals["DEPOT"] = new Signal(76450, 150, "Sortie Dépôt");
        this.signals["C4"] = new Signal(86900, 400, "Sém.");

        // Apply properties to signals
        Object.keys(this.signals).forEach(key => {
            this.signals[key].nodeId = key;
            this.signals[key].onClickCb = (s) => this.onSignalClick(s);
        });

        // Define route mappings W->E
        createRoute("N_W", "C1", [e1], "N_W", 0);
        createRoute("C1", "C2", [e1_2], "C1", 0);
        createRoute("C2", "C2B", [e2], "C2", 0);
        createRoute("C2B", "Q_A1", [e3, ea_qa1_in, qa1], "C2B", 0);
        createRoute("C2B", "Q_A2", [e3, ea_qa2_in, qa2], "C2B", 0);
        
        createRoute("Q_A1", "C3", [ea_qa1_out, e4], "Q_A1", 3000);
        createRoute("Q_A2", "C3", [ea_qa2_out, e4], "Q_A2", 3000);
        
        createRoute("C3", "C3B", [e4_2], "C3", 0);
        createRoute("C3B", "Q_B1", [e5, eb_qb1_in, qb1], "C3B", 0);
        createRoute("C3B", "Q_B2", [e5, eb_qb2_in, qb2], "C3B", 0);
        createRoute("C3B", "DEPOT", [e5, eb_dep_in, dep], "C3B", 0);
        
        createRoute("Q_B1", "C4", [eb_qb1_out, e6], "Q_B1", 3000);
        createRoute("Q_B2", "C4", [eb_qb2_out, e6], "Q_B2", 3000);
        createRoute("DEPOT", "C4", [eb_dep_out, e6], "DEPOT", 3000);
        
        createRoute("C4", "N_E", [e7], "C4", 0);

        setSNCFStatus("LIGNE RÉGIONALE BAL ACTIVE.", 0);
    }
    
    drawPlatform(x, y, label, width, outlineColor="rgba(88, 166, 255, 0.3)") {
        let plat = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        plat.setAttribute("x", x); plat.setAttribute("y", y - 24);
        plat.setAttribute("width", width.toString()); plat.setAttribute("height", "48");
        plat.setAttribute("fill", "rgba(88, 166, 255, 0.05)"); 
        plat.setAttribute("stroke", outlineColor);
        plat.setAttribute("stroke-width", "2");
        plat.setAttribute("rx", "16");
        svgLayers.cantons.appendChild(plat);

        let text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x + width/2); 
        text.setAttribute("y", y + 15); 
        text.setAttribute("fill", "rgba(88, 166, 255, 0.6)"); 
        text.setAttribute("font-size", "44px"); 
        text.setAttribute("font-weight", "900");
        text.setAttribute("font-family", "Inter, sans-serif");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("style", "pointer-events: none;");
        text.textContent = label.toUpperCase();
        svgLayers.cantons.appendChild(text);
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
            this.prsOrigLabel.textContent = this.prsOriginNode;
            this.prsDestLabel.textContent = "ATTENTE DEST.";
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
            this.prsDestLabel.textContent = destNode;
            this.traceRoute(this.prsOriginNode, destNode);
            setTimeout(() => this.resetPRS(), 1500);
        }
    }

    hasConflict(o1, d1, initiatorTrain = null) {
        for (let r of this.activeRoutes) {
            let usedByInitiator = initiatorTrain && initiatorTrain.pathEdges === r.edgesItem;
            if (usedByInitiator) continue;
            
            // In BAL line, blocks are exclusively locked. Any common segment is a conflict.
            let route1Obj = this.routeDB[`${o1}->${d1}`];
            if (!route1Obj) return true;
            
            for (let edge1 of route1Obj.edges) {
                if (r.edgesItem.includes(edge1)) return true;
            }
        }
        return false;
    }

    traceRoute(startId, endId) {
        let routeKey = `${startId}->${endId}`;
        let routeData = this.routeDB[routeKey];
        if (!routeData) {
            setSNCFStatus("ERREUR MANUTENTION : Itinéraire inconnu."); return;
        }

        let train = this.trains.find(t => 
            ((t.state === "wait_entry" || t.state === "block_wait") && t.spawnNode === startId) || 
            ((t.state === "wait_departure" || t.state === "service_passenger") && t.currentLocation === startId)
        );
        if (!train) return; // No train waiting to use this route
        
        if (train.state === "service_passenger") return;

        if (this.hasConflict(startId, endId, train)) {
            return; // Block locked.
        }

        let ar = {
            edgesItem: routeData.edges,
            o: startId, d: endId 
        };
        this.activeRoutes.push(ar);

        let hl = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let pathData = routeData.edges.map(e => e.pathStr).join(" ");
        hl.setAttribute("d", pathData);
        hl.setAttribute("class", "tco-track-locked");
        hl.routeRef = ar;
        svgLayers.overlay.appendChild(hl);

        let signal = this.signals[startId];
        if (signal) {
            signal.state = 2; // Voie Libre
            signal.updateVisuals();
        }

        let lastEdgeLen = train.pathEdges && train.pathEdges.length > 0 ? train.pathEdges[train.pathEdges.length - 1].length : 0;
        let pfxLen = train.pathEdges ? train.pathEdges.reduce((s, e)=>s+e.length,0) - lastEdgeLen : 0;
        let initialDist = Math.max(0, train.distanceOnEdge - pfxLen);
        if(!train.pathEdges) initialDist = routeData.dist;

        let triggerDist = routeData.edges[0].length;
        
        // Define next state based on destination type
        let nextState = endId.startsWith("Q") ? "entering" : "block_transit";
        if (endId === "N_E") nextState = "leaving";

        train.setPath(routeData.edges, initialDist, nextState, endId, signal, triggerDist);
        train.spawnNode = endId; // Progresses logic node
        
        this.updateGrid();
    }

    spawnTrainBAL() {
        let t = new Train(this.trainCounter++);
        t.maxSpeed = 150 + Math.random() * 50;
        t.braking = t.maxSpeed / 2;
        
        // Train pops at NW. Wait entry.
        t.state = "wait_entry";
        t.currentLocation = "---";
        t.targetDestId = "C1";
        t.spawnNode = "N_W";
        let d = new Date();
        t.arrivalTimeStr = d.getHours().toString().padStart(2, '0') + ":" + d.getMinutes().toString().padStart(2, '0');
        t.serviceTimer = 0;
        
        // Initial visual positioning on edge e1 (not moving)
        let edge1 = this.edges.find(e=>e.id==="e1");
        t.setPath([edge1], 0, "wait_entry", "C1", null, 0); 
        t.targetSpeed = 0;
        t.speed = 0;

        this.trains.push(t);
        this.updateGrid();
    }

    updateGrid() {
        timetableBody.innerHTML = '';
        this.trains.forEach(t => {
            if (t.state === "destroyed" || t.state === "block_transit" || t.state === "entering" || t.state === "leaving") return;

            let tr = document.createElement('tr');
            let stat = "En mouvement";
            if (t.state === "wait_entry") stat = "Demande Section";
            if (t.state === "block_wait") stat = "Canton Fermé";
            if (t.state === "wait_departure") stat = "Demande de Départ";
            if (t.state === "service_passenger") stat = `<span style="color:#d29f00;">À Quai (${Math.ceil(t.serviceTimer)}s)</span>`;
            
            tr.innerHTML = `
                <td>${t.arrivalTimeStr}</td>
                <td style="color:#ffee58;font-weight:bold;">BAL-${t.id}</td>
                <td>Pleine Ligne</td>
                <td>${stat}</td>
            `;
            timetableBody.appendChild(tr);
        });
    }

    autoRoutage() {
        if (!this.isAutoAiguillage) return;

        this.trains.forEach(t => {
            if (t.state === "wait_entry" || t.state === "block_wait" || t.state === "wait_departure") {
                let start = t.spawnNode;
                // AI routing decisions for BAL
                let target = "";
                if (start === "N_W") target = "C1";
                if (start === "C1") target = "C2";
                if (start === "C2") target = "C2B";
                if (start === "C2B") target = Math.random() > 0.5 ? "Q_A1" : "Q_A2"; // Distributes randomly
                if (start.startsWith("Q_A")) target = "C3";
                if (start === "C3") target = "C3B";
                if (start === "C3B") {
                    let r = Math.random();
                    if (r > 0.6) target = "DEPOT";
                    else target = r > 0.3 ? "Q_B1" : "Q_B2";
                }
                if (start.startsWith("Q_B") || start === "DEPOT") target = "C4";
                if (start === "C4") target = "N_E";

                if (target) {
                    this.traceRoute(start, target);
                }
            }
        });
    }

    update(dt) {
        this.timeSinceLastSpawn += dt;
        if (this.timeSinceLastSpawn > this.spawnInterval) {
            this.timeSinceLastSpawn = 0;
            if (this.trains.length < 15) {
                this.spawnTrainBAL();
            }
            this.spawnInterval = 20 + Math.random() * 20; // Sparse spawns
        }

        this.autoRoutage();

        this.lastGridTick += dt;
        if (this.lastGridTick > 1.0) {
            this.lastGridTick = 0;
            if (this.trains.some(t => t.state === "service_passenger")) {
                this.updateGrid();
            }
            // Update signals to Sémaphore if block occupied ahead visually ? 
            // In a real BAL we compute logic. Here we keep it simple.
        }

        document.querySelectorAll('.tco-track-occupied').forEach(el => el.remove());

        this.trains.forEach(t => {
            // Modify state logic for intermediate block transients
            if (t.state === "block_transit") {
                let totalPathLength = t.pathEdges.reduce((sum, e) => sum + e.length, 0);
                if (totalPathLength - t.distanceOnEdge < 200 && t.targetSpeed > 0) {
                    t.targetSpeed = 0;
                }
                if (t.speed === 0) {
                    t.state = "block_wait"; 
                    this.updateGrid();
                }
            }

            t.update(dt);
            
            // Occupied tracking
            let inTransitState = ["entering", "leaving", "block_transit", "wait_entry", "block_wait", "service_passenger", "wait_departure"].includes(t.state);
            if (inTransitState) {
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
            let stillUsed = this.trains.some(t => 
                t.pathEdges === ar.edgesItem && 
                ["block_transit", "entering", "leaving", "wait_entry", "block_wait"].includes(t.state)
            );
            if (!stillUsed) {
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
        let balControls = document.getElementById('bal-controls');
        if (balControls) balControls.classList.add('hidden');
        this.trains.forEach(t => t.destroy());
        this.trains = [];
        this.edges.forEach(e => e.destroy());
        Object.values(this.signals).forEach(s => s.destroy());
    }
}
