/**
 * MISC-04 Local Disaster Warning & Response Coordination Platform
 * Single-Page Architecture & View State Controller
 * Views: 'home' | 'processing' | 'dashboard' | 'validation' | 'report'
 */

// Top-Level State
let appState = null;
let currentView = 'home';
let currentTimestepIndex = 0;
let map = null;
let frozenReportMap = null;
let markerLayerGroup = null;
let roadLayerGroup = null;
let reportLayerGroup = null;
let safeRouteLayer = null;
let dispatchRouteLayer = null;
let depotMarkerLayer = null;
let autoPlayInterval = null;
let selectedSettlementId = null;
let availableUnits = 8;
let dispatchRoutesVisible = true;
let currentDispatchData = null;
const DEPOT_COORDS = [11.6103, 76.0827]; // Kalpetta District HQ

const PALETTE = {
  riskLow: '#15803d',
  riskMed: '#b45309',
  riskHigh: '#b91c1c',
  accentNavy: '#1e3a8a',
  accentBlue: '#2563eb',
  roadOpen: '#15803d',
  roadClosed: '#b91c1c'
};

// ============================================================================
// Initialization & State Contract Binding
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadStateData();
  bindGlobalNav();
  bindHomeControls();
  bindDashboardControls();
  bindDrawerControls();
  bindDispatchControls();
  bindReportControls();
  bindPredictSandbox();

  // Initial View
  switchView('home');
});

/**
 * Loads shared state data from FastAPI backend with fallback to state.json & state_data.js
 */
async function loadStateData() {
  try {
    const apiRes = await fetch('http://localhost:8000/state');
    if (!apiRes.ok) throw new Error(`API returned status ${apiRes.status}`);
    appState = await apiRes.json();
    console.log('[OK] Loaded live appState from FastAPI backend (/state):', appState);
  } catch (apiErr) {
    console.warn('Live API unavailable, attempting local state.json fallback:', apiErr);
    try {
      const response = await fetch('state.json');
      if (!response.ok) throw new Error('Local fetch failed');
      appState = await response.json();
      console.log('Loaded appState via local state.json fallback:', appState);
    } catch (err) {
      console.warn('Local state.json failed, falling back to window.DEFAULT_STATE:', err);
      if (window.DEFAULT_STATE) {
        appState = window.DEFAULT_STATE;
      } else {
        console.error('Fatal: No state data available!');
        return;
      }
    }
  }

  // Populate metadata into homepage & nav
  populateHomeStats();
  populateNavMeta();
  populateValidationScreen();
}

// ============================================================================
// View State Switching Controller
// ============================================================================
function switchView(viewName) {
  currentView = viewName;
  console.log(`[View] Switching to ${viewName}`);

  const topNav = document.getElementById('top-navbar');
  const viewHome = document.getElementById('view-home');
  const viewProc = document.getElementById('view-processing');
  const viewDash = document.getElementById('view-dashboard');
  const viewVal = document.getElementById('view-validation');
  const viewRep = document.getElementById('view-report');

  // Hide all screens
  [viewHome, viewProc, viewDash, viewVal, viewRep].forEach(el => {
    if (el) el.style.display = 'none';
  });

  // Top Nav Visibility
  if (viewName === 'home' || viewName === 'processing') {
    if (topNav) topNav.style.display = 'none';
  } else {
    if (topNav) topNav.style.display = 'flex';
    // Update active nav tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
      if (tab.dataset.view === viewName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  // Show target view
  if (viewName === 'home') {
    if (viewHome) viewHome.style.display = 'flex';
    initHero3DCanvas();
  } else if (viewName === 'processing') {
    if (viewProc) viewProc.style.display = 'flex';
    startProcessingSequence();
  } else if (viewName === 'dashboard') {
    if (viewDash) viewDash.style.display = 'block';
    if (!map) {
      initLeafletMap();
    } else {
      setTimeout(() => { map.invalidateSize(); }, 60);
    }
    renderCurrentTimestep();
  } else if (viewName === 'dispatch') {
    if (viewDash) viewDash.style.display = 'block';
    if (!map) {
      initLeafletMap();
    } else {
      setTimeout(() => { map.invalidateSize(); }, 60);
    }
    renderCurrentTimestep();
    openDispatchDrawer();
  } else if (viewName === 'validation') {
    if (viewVal) viewVal.style.display = 'flex';
    populateValidationScreen();
  } else if (viewName === 'report') {
    if (viewRep) viewRep.style.display = 'flex';
    renderOutputReport();
  }
}

// ============================================================================
// 1. Homepage Bindings & Telemetry
// ============================================================================
function populateHomeStats() {
  if (!appState) return;

  const statSettlements = document.getElementById('home-stat-settlements');
  const statRoads = document.getElementById('home-stat-roads');
  const statEvent = document.getElementById('home-stat-event');
  const homeDataLabel = document.getElementById('home-data-label');

  if (statSettlements) statSettlements.textContent = `${appState.settlements.length} settlements`;
  if (statRoads) statRoads.textContent = `${appState.roads.length} roads mapped`;
  if (statEvent) statEvent.textContent = `Aug 2018 event, replayed`;
  if (homeDataLabel && appState.data_label) homeDataLabel.textContent = appState.data_label;
}

function bindHomeControls() {
  // Launch buttons trigger processing sequence
  document.getElementById('btn-launch-model')?.addEventListener('click', () => {
    switchView('processing');
  });
  document.getElementById('btn-bottom-launch')?.addEventListener('click', () => {
    switchView('processing');
  });

  // Direct jumps from homepage
  document.getElementById('btn-hero-predict')?.addEventListener('click', () => {
    switchView('validation');
    setTimeout(() => {
      document.getElementById('predict-input-rain')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  });

  document.getElementById('btn-hero-sitrep')?.addEventListener('click', () => {
    switchView('report');
  });

  document.getElementById('btn-quick-val-link')?.addEventListener('click', () => {
    switchView('validation');
  });

  document.getElementById('btn-quick-report-link')?.addEventListener('click', () => {
    switchView('report');
  });

  // Start 3D Hero Canvas Animation
  initHero3DCanvas();
}

// 3D Topographic Canvas Simulation (Ensures instant 3D visuals & offline responsiveness)
let heroAnimId = null;
function initHero3DCanvas() {
  const canvas = document.getElementById('home-hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width = canvas.offsetWidth || 540;
  const height = canvas.height = canvas.offsetHeight || 420;

  let mouseX = width / 2;
  let mouseY = height / 2;
  let angleX = 0;
  let angleY = 0;

  canvas.parentElement?.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });

  const cols = 20;
  const rows = 16;
  let time = 0;

  function render3D() {
    ctx.clearRect(0, 0, width, height);

    // Smooth tilt interpolation based on mouse position
    const targetAngleX = (mouseX / width - 0.5) * 0.45;
    const targetAngleY = (mouseY / height - 0.5) * 0.35;
    angleX += (targetAngleX - angleX) * 0.05;
    angleY += (targetAngleY - angleY) * 0.05;

    time += 0.025;

    const grid = [];
    const cellW = width * 0.9 / cols;
    const cellH = height * 0.75 / rows;
    const originX = width * 0.05;
    const originY = height * 0.15;

    // Calculate 3D points with elevation wave & river valley depression
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const v = r / (rows - 1);

        // Valley along center (Kabini river basin)
        const riverDist = Math.abs(u - 0.5);
        const ridgeElev = Math.sin(u * Math.PI) * 45;
        const wave = Math.sin(u * 5 + time) * Math.cos(v * 4 + time * 0.8) * 16;
        const z = ridgeElev + wave - (1.0 - riverDist) * 20;

        // 3D Isometric Projection with interactive tilt
        const projX = originX + c * cellW + (v - 0.5) * 60 * angleX;
        const projY = originY + r * cellH - z + (u - 0.5) * 50 * angleY;

        grid[r][c] = { x: projX, y: projY, z: z };
      }
    }

    // Draw Topographic Grid Lines
    ctx.lineWidth = 1.2;
    for (let r = 0; r < rows; r++) {
      ctx.beginPath();
      for (let c = 0; c < cols; c++) {
        const p = grid[r][c];
        if (c === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      const alpha = 0.15 + (r / rows) * 0.35;
      ctx.strokeStyle = `rgba(37, 99, 235, ${alpha})`;
      ctx.stroke();
    }

    for (let c = 0; c < cols; c += 2) {
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const p = grid[r][c];
        if (r === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.18)';
      ctx.stroke();
    }

    // Draw Glowing Settlement Nodes on Terrain
    const nodes = [
      { r: 4, c: 5, name: "Mananthavady", risk: "#dc2626" },
      { r: 8, c: 10, name: "Kalpetta HQ", risk: "#2563eb" },
      { r: 12, c: 14, name: "Meppadi", risk: "#d97706" },
      { r: 6, c: 12, name: "Panamaram", risk: "#dc2626" },
      { r: 10, c: 6, name: "Vythiri", risk: "#16a34a" },
      { r: 3, c: 15, name: "Sulthan Bathery", risk: "#16a34a" }
    ];

    nodes.forEach(n => {
      if (grid[n.r] && grid[n.r][n.c]) {
        const p = grid[n.r][n.c];
        
        // Pulse ring
        const pulse = (Math.sin(time * 3) + 1) * 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = `${n.risk}22`;
        ctx.fill();

        // Node dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = n.risk;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = '#1e3a8a';
        ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(n.name, p.x + 8, p.y - 2);
      }
    });

    heroAnimId = requestAnimationFrame(render3D);
  }

  if (heroAnimId) cancelAnimationFrame(heroAnimId);
  render3D();
}

function populateNavMeta() {
  if (!appState) return;
  const navDistrict = document.getElementById('nav-district-text');
  if (navDistrict && appState.district) {
    navDistrict.textContent = `${appState.district.toUpperCase()}, KERALA`;
  }
}

function bindGlobalNav() {
  // Nav logo returns home
  document.getElementById('nav-btn-home')?.addEventListener('click', () => {
    switchView('home');
  });

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetView = btn.dataset.view;
      if (targetView) switchView(targetView);
    });
  });

  // Quick Generate Report button
  document.getElementById('btn-quick-report')?.addEventListener('click', () => {
    switchView('report');
  });

  // Replay model build pipeline button
  document.getElementById('nav-btn-replay')?.addEventListener('click', () => {
    switchView('processing');
  });
}

// ============================================================================
// 2. Processing / Model-Build Sequence (~8-10s)
// ============================================================================
function startProcessingSequence() {
  const terminalLogs = document.getElementById('proc-terminal-logs');
  const scoringCounter = document.getElementById('proc-scoring-counter');
  const scoringTbody = document.getElementById('proc-scoring-tbody');
  const progressFill = document.getElementById('proc-progress-fill');
  const progressPercent = document.getElementById('proc-percentage');
  const progressStatus = document.getElementById('proc-status-text');
  const canvas = document.getElementById('proc-graph-canvas');
  const procGraphView = document.getElementById('proc-graph-view');
  const procScoringView = document.getElementById('proc-scoring-view');

  if (!appState || !terminalLogs) return;

  // Clear previous runs
  terminalLogs.innerHTML = '';
  scoringTbody.innerHTML = '';
  procGraphView.style.display = 'none';
  procScoringView.style.display = 'block';

  const totalSettlements = appState.settlements.length;
  const totalRoads = appState.roads.length;
  const totalTimesteps = appState.timesteps.length;

  scoringCounter.textContent = `0 / ${totalSettlements} scored`;

  function addLog(text, isSuccess = false) {
    const time = new Date().toISOString().substring(11, 19);
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="timestamp">[${time}]</span> <span class="${isSuccess ? 'success' : ''}">${text}</span>`;
    terminalLogs.appendChild(line);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  // Canvas setup
  const ctx = canvas.getContext('2d');
  const canvasNodes = {};
  const latMin = 11.50, latMax = 11.95;
  const lngMin = 75.90, lngMax = 76.40;

  appState.settlements.forEach(s => {
    const x = 30 + ((s.lng - lngMin) / (lngMax - lngMin)) * (canvas.width - 60);
    const y = (canvas.height - 30) - ((s.lat - latMin) / (latMax - latMin)) * (canvas.height - 60);
    canvasNodes[s.id] = { x, y, name: s.name, risk: s.risk_level['T5'] };
  });

  // Stage A — Loading Event Data (~2s)
  addLog(`Connecting to IMD weather telemetry stream for ${appState.district}...`);
  setTimeout(() => {
    addLog(`8 rainfall timesteps parsed (Aug 2018 event, replayed)`, true);
    progressFill.style.width = '20%';
    progressPercent.textContent = '20%';
  }, 400);

  setTimeout(() => {
    addLog(`${totalSettlements} settlements loaded across 3 taluks`, true);
    addLog(`${totalRoads} physical road segments parsed from OpenStreetMap`, true);
    progressFill.style.width = '40%';
    progressPercent.textContent = '40%';
    progressStatus.textContent = 'Stage B: Evaluating flood susceptibility feature vectors...';
  }, 1200);

  // Stage B — Scoring Risk (~3s)
  setTimeout(() => {
    let sIdx = 0;
    const sInt = setInterval(() => {
      if (sIdx >= totalSettlements) {
        clearInterval(sInt);
        startStageC();
        return;
      }

      const s = appState.settlements[sIdx];
      const peakRain = s.rainfall_mm['T5'];
      const peakRisk = s.risk_score['T5'];
      const peakLevel = s.risk_level['T5'];

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${s.name}</strong></td>
        <td>${s.taluk}</td>
        <td class="tab-num">${s.elevation_m}m</td>
        <td class="tab-num">${s.distance_to_river_km}km</td>
        <td class="tab-num">${peakRain}mm</td>
        <td class="tab-num highlight" id="p-score-${s.id}">0.00</td>
      `;
      scoringTbody.prepend(tr);

      // Fast count-up
      const scoreEl = document.getElementById(`p-score-${s.id}`);
      let currentVal = 0.0;
      const stepVal = peakRisk / 4;
      const countInterval = setInterval(() => {
        currentVal += stepVal;
        if (currentVal >= peakRisk) {
          currentVal = peakRisk;
          clearInterval(countInterval);
        }
        if (scoreEl) scoreEl.textContent = currentVal.toFixed(2);
      }, 40);

      sIdx++;
      scoringCounter.textContent = `${sIdx} / ${totalSettlements} scored`;
      const pct = 40 + Math.round((sIdx / totalSettlements) * 25);
      progressFill.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;
    }, 170);
  }, 2000);

  // Stage C — Building Road Graph (~2s)
  function startStageC() {
    procScoringView.style.display = 'none';
    procGraphView.style.display = 'block';
    progressStatus.textContent = 'Stage C: Constructing NetworkX road graph & closure triggers...';
    addLog(`Synthesizing NetworkX road topology (${totalRoads} segments)...`, true);

    // Draw initial node dots
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.keys(canvasNodes).forEach(sid => {
      const node = canvasNodes[sid];
      ctx.beginPath();
      ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = node.risk === 'high' ? PALETTE.riskHigh : (node.risk === 'medium' ? PALETTE.riskMed : PALETTE.riskLow);
      ctx.fill();
    });

    let rIdx = 0;
    const rInt = setInterval(() => {
      if (rIdx >= totalRoads) {
        clearInterval(rInt);
        startStageD();
        return;
      }

      const r = appState.roads[rIdx];
      const fromNode = canvasNodes[r.from];
      const toNode = canvasNodes[r.to];
      const status = r.status['T5'];

      if (fromNode && toNode) {
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.strokeStyle = status === 'closed' ? PALETTE.roadClosed : 'rgba(21, 128, 61, 0.85)';
        ctx.lineWidth = status === 'closed' ? 2.5 : 1.5;
        if (status === 'closed') ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
        ctx.stroke();
      }

      document.getElementById('proc-graph-counter').textContent = `${rIdx + 1} / ${totalRoads} roads`;
      const fromName = appState.settlements.find(s => s.id === r.from)?.name || r.from;
      const toName = appState.settlements.find(s => s.id === r.to)?.name || r.to;
      document.getElementById('proc-graph-status').textContent = `Road ${r.id}: ${fromName} ↔ ${toName} [${status.toUpperCase()}]`;

      rIdx++;
    }, 75);
  }

  // Stage D — Ranking Alerts (~2s)
  function startStageD() {
    progressStatus.textContent = 'Stage D: Computing multi-factor priority ranking & safe routes...';
    const highRiskCount = appState.settlements.filter(s => s.risk_level['T5'] === 'high').length;
    addLog(`${highRiskCount} settlements flagged high-risk at peak surge (T5)`, true);
    addLog(`Priority ranking computed: 0.5*Risk + 0.3*Population + 0.2*Isolation`, true);
    addLog(`Safe-route heuristic graph primed for dynamic evacuation`, true);

    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';
    progressStatus.textContent = 'Model execution complete. Launching dashboard...';

    setTimeout(() => {
      switchView('dashboard');
    }, 1400);
  }

  // Skip button
  document.getElementById('btn-skip-processing')?.addEventListener('click', () => {
    switchView('dashboard');
  });
}

// ============================================================================
// 3. Main Dashboard Implementation
// ============================================================================
function initLeafletMap() {
  map = L.map('map', {
    center: [11.695, 76.140],
    zoom: 11,
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri &mdash; National Geographic, DeLorme, NAVTEQ, USGS'
  }).addTo(map);

  roadLayerGroup = L.layerGroup().addTo(map);
  markerLayerGroup = L.layerGroup().addTo(map);
  reportLayerGroup = L.layerGroup().addTo(map);
  safeRouteLayer = L.layerGroup().addTo(map);
  dispatchRouteLayer = L.layerGroup().addTo(map);
  depotMarkerLayer = L.layerGroup().addTo(map);
}

function renderCurrentTimestep() {
  if (!appState || !map) return;

  const tKey = appState.timesteps[currentTimestepIndex];
  const tLabel = appState.timestep_labels ? appState.timestep_labels[tKey] : tKey;

  // 1. Update slider & badges
  const slider = document.getElementById('timestep-slider');
  if (slider) slider.value = currentTimestepIndex;

  const stepBadge = document.getElementById('step-badge-current');
  if (stepBadge) stepBadge.textContent = tKey;

  document.querySelectorAll('.tick-btn').forEach((btn, idx) => {
    if (idx === currentTimestepIndex) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // 2. Count live statistics
  const settlements = appState.settlements;
  const roads = appState.roads;
  const reports = appState.ground_reports || [];

  const highRiskSettlements = settlements.filter(s => s.risk_level[tKey] === 'high');
  const closedRoads = roads.filter(r => r.status[tKey] === 'closed');
  const activeReports = reports.filter(g => g.timestep === tKey);

  // 3. Update Readout above slider
  const readout = document.getElementById('timestep-readout');
  if (readout) {
    readout.textContent = `${tKey} — ${tLabel} · ${highRiskSettlements.length} high-risk · ${closedRoads.length} roads closed`;
  }

  // 4. Update Live Summary Panel (Section 7)
  const statHigh = document.getElementById('stat-high-risk');
  const statTotalSettlements = document.getElementById('stat-total-settlements');
  const statRoads = document.getElementById('stat-roads-closed');
  const statTotalRoads = document.getElementById('stat-total-roads');
  const statReports = document.getElementById('stat-active-reports');

  if (statHigh) statHigh.textContent = highRiskSettlements.length;
  if (statTotalSettlements) statTotalSettlements.textContent = settlements.length;
  if (statRoads) statRoads.textContent = closedRoads.length;
  if (statTotalRoads) statTotalRoads.textContent = roads.length;
  if (statReports) statReports.textContent = activeReports.length;

  // 5. Render Map Elements
  renderRoads(tKey);
  renderSettlements(tKey);
  renderGroundReports(tKey);
  renderDepotMarker();

  // 6. Render Alert Sidebar
  renderAlertsSidebar(tKey);

  // 7. Update Dynamic Dispatch Schedule
  executeGreedyDispatch(false);

  // 8. Re-calculate Safe Route if a settlement is selected
  if (selectedSettlementId) {
    calculateAndRenderSafeRoute(selectedSettlementId, tKey);
    // Also update drawer if currently open
    const drawer = document.getElementById('settlement-detail-drawer');
    if (drawer && drawer.style.display !== 'none') {
      openSettlementDrawer(selectedSettlementId);
    }
  }
}

function renderRoads(tKey) {
  roadLayerGroup.clearLayers();

  appState.roads.forEach(road => {
    const isClosed = (road.status[tKey] === 'closed');
    const color = isClosed ? PALETTE.roadClosed : PALETTE.roadOpen;
    const weight = isClosed ? 4.5 : 3.0;
    const opacity = isClosed ? 0.95 : 0.75;
    const className = isClosed ? 'road-closed-animated' : '';

    const polyline = L.polyline(road.coordinates, {
      color: color,
      weight: weight,
      opacity: opacity,
      className: className,
      lineCap: 'round',
      lineJoin: 'round'
    });

    const fromName = appState.settlements.find(s => s.id === road.from)?.name || road.from;
    const toName = appState.settlements.find(s => s.id === road.to)?.name || road.to;

    polyline.bindTooltip(`
      <div style="font-size:11px;">
        <strong>Road ${road.id}</strong>: ${fromName} ↔ ${toName}<br>
        Status at ${tKey}: <span style="color:${color};font-weight:700;">${road.status[tKey].toUpperCase()}</span>
      </div>
    `, { className: 'custom-map-tooltip', sticky: true });

    roadLayerGroup.addLayer(polyline);
  });
}

function renderSettlements(tKey) {
  markerLayerGroup.clearLayers();

  const pops = appState.settlements.map(s => s.population);
  const minPop = Math.min(...pops);
  const maxPop = Math.max(...pops);

  appState.settlements.forEach(s => {
    const riskLevel = s.risk_level[tKey];
    const riskScore = s.risk_score[tKey];
    const conf = s.confidence[tKey];

    const normPop = (s.population - minPop) / (maxPop - minPop || 1);
    const radius = 8 + normPop * 6;

    let fillColor = PALETTE.riskLow;
    if (riskLevel === 'high') fillColor = PALETTE.riskHigh;
    else if (riskLevel === 'medium') fillColor = PALETTE.riskMed;

    if (riskLevel === 'high') {
      const pulseCircle = L.circleMarker([s.lat, s.lng], {
        radius: radius + 7,
        color: PALETTE.riskHigh,
        fillColor: 'transparent',
        weight: 1.5,
        opacity: 0.7,
        className: 'marker-pulse-ring'
      });
      markerLayerGroup.addLayer(pulseCircle);
    }

    const circle = L.circleMarker([s.lat, s.lng], {
      radius: radius,
      fillColor: fillColor,
      fillOpacity: 0.9,
      color: '#ffffff',
      weight: 1.8,
      className: 'settlement-marker-circle'
    });

    circle.bindTooltip(`
      <div style="font-size:11.5px; line-height: 1.4;">
        <strong style="color:#ffffff;">${s.name}</strong> (${s.taluk})<br>
        Risk Level: <span style="color:${fillColor};font-weight:700;">${riskLevel.toUpperCase()} (${riskScore.toFixed(2)})</span><br>
        Confidence: <span class="tab-num">${Math.round(conf * 100)}%</span> &bull; Rain: <span class="tab-num">${s.rainfall_mm[tKey]}mm</span>
      </div>
    `, { className: 'custom-map-tooltip', direction: 'top', offset: [0, -radius] });

    circle.on('click', () => {
      openSettlementDrawer(s.id);
    });

    markerLayerGroup.addLayer(circle);
  });
}

function renderGroundReports(tKey) {
  reportLayerGroup.clearLayers();
  const reports = appState.ground_reports || [];
  const currentReports = reports.filter(g => g.timestep === tKey || (g.active_timesteps && g.active_timesteps.includes(tKey)));

  currentReports.forEach(g => {
    const s = appState.settlements.find(item => item.id === g.settlement_id);
    if (!s) return;

    const lat = s.lat + 0.007;
    const lng = s.lng + 0.007;

    const reportIcon = L.divIcon({
      className: 'ground-report-icon',
      html: `<div style="background:#f59e0b; color:#000; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; border:2px solid #ffffff; box-shadow:0 0 8px rgba(245,158,11,0.8);">!</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const isSim = g.is_simulated ? '<span style="display:inline-block; padding:1px 5px; background:rgba(245,158,11,0.2); border:1px solid #f59e0b; border-radius:4px; font-size:9.5px; color:#f59e0b; margin-bottom:4px;">SIMULATED CITIZEN REPORT</span><br>' : '';

    const marker = L.marker([lat, lng], { icon: reportIcon });
    marker.bindTooltip(`
      <div style="font-size:11px; max-width:220px; line-height:1.4;">
        ${isSim}
        <strong style="color:#f59e0b;">Report: ${g.type.replace('_', ' ').toUpperCase()}</strong><br>
        ${g.text}
      </div>
    `, { className: 'custom-map-tooltip' });

    reportLayerGroup.addLayer(marker);
  });
}

function renderAlertsSidebar(tKey) {
  const container = document.getElementById('alerts-container');
  const countBadge = document.getElementById('active-alert-count');
  if (!container) return;

  container.innerHTML = '';
  const activeAlerts = (appState.hazard_alerts || []).filter(a => a.timestep === tKey);

  activeAlerts.sort((a, b) => {
    const sA = appState.settlements.find(s => s.id === a.settlement_id);
    const sB = appState.settlements.find(s => s.id === b.settlement_id);
    const rankA = sA?.priority_rank[tKey] || 99;
    const rankB = sB?.priority_rank[tKey] || 99;
    return rankA - rankB;
  });

  if (countBadge) countBadge.textContent = `${activeAlerts.length} ACTIVE`;

  if (activeAlerts.length === 0) {
    container.innerHTML = `
      <div class="empty-alerts-state">
        <div class="empty-icon">🛡️</div>
        <p><strong>No active alerts at this timestep</strong></p>
        <p style="font-size:11px;">Current rainfall is below inundation thresholds across all catchments.</p>
      </div>
    `;
    return;
  }

  activeAlerts.forEach(alert => {
    const s = appState.settlements.find(item => item.id === alert.settlement_id);
    if (!s) return;

    const rank = s.priority_rank[tKey];
    const riskScore = s.risk_score[tKey];
    const confPercent = Math.round(alert.confidence * 100);

    const card = document.createElement('div');
    card.className = `alert-card ${selectedSettlementId === s.id ? 'selected' : ''}`;
    card.id = `alert-card-${s.id}`;

    card.innerHTML = `
      <div class="alert-card-top">
        <div class="alert-village-title">
          <span class="rank-pill">#${rank}</span>
          <span class="village-name">${s.name}</span>
        </div>
        <span class="risk-badge ${alert.risk_level}">${alert.risk_level} (${riskScore.toFixed(2)})</span>
      </div>

      <div class="alert-label">${alert.label}</div>

      <div class="evidence-block">
        <div class="evidence-header">
          <span>SOURCE EVIDENCE TELEMETRY</span>
          <span class="tab-num">T-STEP: ${tKey}</span>
        </div>
        <div class="evidence-grid">
          <div class="ev-stat">
            <span class="ev-label">Rainfall</span>
            <span class="ev-val tab-num">${alert.evidence.rainfall_mm} mm</span>
          </div>
          <div class="ev-stat">
            <span class="ev-label">Elevation</span>
            <span class="ev-val tab-num">${alert.evidence.elevation_m} m</span>
          </div>
          <div class="ev-stat">
            <span class="ev-label">River Distance</span>
            <span class="ev-val tab-num">${alert.evidence.distance_to_river_km} km</span>
          </div>
          <div class="ev-stat">
            <span class="ev-label">Ground Reports</span>
            <span class="ev-val tab-num">${alert.evidence.ground_reports_nearby} active</span>
          </div>
        </div>
      </div>

      <div class="confidence-row">
        <span>Model Confidence:</span>
        <div class="confidence-bar-track">
          <div class="confidence-bar-fill" style="width: ${confPercent}%;"></div>
        </div>
        <span class="tab-num">${confPercent}%</span>
      </div>
    `;

    card.addEventListener('click', () => {
      openSettlementDrawer(s.id);
    });

    container.appendChild(card);
  });
}

function bindDashboardControls() {
  const slider = document.getElementById('timestep-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      currentTimestepIndex = parseInt(e.target.value, 10);
      renderCurrentTimestep();
    });
  }

  const ticksContainer = document.getElementById('slider-ticks-container');
  if (ticksContainer && appState && appState.timesteps) {
    ticksContainer.innerHTML = '';
    appState.timesteps.forEach((t, idx) => {
      const btn = document.createElement('button');
      btn.className = `tick-btn ${idx === 0 ? 'active' : ''}`;
      btn.textContent = t;
      btn.addEventListener('click', () => {
        currentTimestepIndex = idx;
        renderCurrentTimestep();
      });
      ticksContainer.appendChild(btn);
    });
  }

  const playBtn = document.getElementById('btn-play-pause');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
        if (iconPlay) iconPlay.style.display = 'block';
        if (iconPause) iconPause.style.display = 'none';
      } else {
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconPause) iconPause.style.display = 'block';

        autoPlayInterval = setInterval(() => {
          currentTimestepIndex = (currentTimestepIndex + 1) % appState.timesteps.length;
          renderCurrentTimestep();
        }, 1500);
      }
    });
  }

  document.getElementById('btn-step-prev')?.addEventListener('click', () => {
    currentTimestepIndex = Math.max(0, currentTimestepIndex - 1);
    renderCurrentTimestep();
  });

  document.getElementById('btn-step-next')?.addEventListener('click', () => {
    currentTimestepIndex = Math.min(appState.timesteps.length - 1, currentTimestepIndex + 1);
    renderCurrentTimestep();
  });
}

// ============================================================================
// 4. Settlement Detail Panel (Slide-In Glass Drawer from Right)
// ============================================================================
function openSettlementDrawer(settlementId) {
  selectedSettlementId = settlementId;
  const s = appState.settlements.find(item => item.id === settlementId);
  if (!s || !map) return;

  const tKey = appState.timesteps[currentTimestepIndex];

  // Pan map smoothly to settlement
  map.flyTo([s.lat, s.lng], 13, { duration: 1.0 });

  const drawer = document.getElementById('settlement-detail-drawer');
  if (drawer) {
    drawer.style.display = 'flex';

    // Populate Header
    document.getElementById('drawer-name').textContent = s.name;
    document.getElementById('drawer-taluk').textContent = `${s.taluk} Taluk`;
    document.getElementById('drawer-population').textContent = `Pop: ${s.population.toLocaleString()}`;
    const floodTag = document.getElementById('drawer-flood-flag');
    if (floodTag) {
      floodTag.textContent = s.historical_flood_flag === 1 ? 'Historical Flood: Documented' : 'Historical Flood: None';
      floodTag.style.background = s.historical_flood_flag === 1 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)';
      floodTag.style.color = s.historical_flood_flag === 1 ? '#f87171' : '#94a3b8';
    }

    // Populate Current Risk Badge
    const riskBadge = document.getElementById('drawer-current-risk-badge');
    const curRisk = s.risk_level[tKey];
    const curScore = s.risk_score[tKey];
    if (riskBadge) {
      riskBadge.className = `risk-badge ${curRisk}`;
      riskBadge.textContent = `${curRisk.toUpperCase()} (${curScore.toFixed(2)})`;
    }

    // Render 8-Timestep Sparkline SVG
    renderRiskSparkline(s);

    // Populate Evidence Grid
    const reportsNearby = (appState.ground_reports || []).filter(g => g.settlement_id === s.id && g.timestep === tKey).length;
    document.getElementById('drawer-ev-rain').textContent = `${s.rainfall_mm[tKey]} mm`;
    document.getElementById('drawer-ev-elev').textContent = `${s.elevation_m} m`;
    document.getElementById('drawer-ev-dist').textContent = `${s.distance_to_river_km} km`;
    document.getElementById('drawer-ev-reports').textContent = `${reportsNearby} report(s)`;

    // Populate Connected Roads
    const connectedContainer = document.getElementById('drawer-roads-list');
    if (connectedContainer) {
      connectedContainer.innerHTML = '';
      const conns = appState.roads.filter(r => r.from === s.id || r.to === s.id);
      conns.forEach(r => {
        const destId = (r.from === s.id) ? r.to : r.from;
        const destSettlement = appState.settlements.find(item => item.id === destId);
        const roadStatus = r.status[tKey];

        const row = document.createElement('div');
        row.className = 'drawer-road-row';
        row.innerHTML = `
          <div class="road-dest">
            <span class="road-dot ${roadStatus}"></span>
            <strong>${r.id}:</strong> <span>↔ ${destSettlement?.name || destId}</span>
          </div>
          <span class="tab-num" style="color:${roadStatus === 'open' ? PALETTE.riskLow : PALETTE.riskHigh}; font-weight:700;">
            ${roadStatus.toUpperCase()}
          </span>
        `;
        connectedContainer.appendChild(row);
      });
    }
  }

  // Calculate & Draw Safe Route
  calculateAndRenderSafeRoute(s.id, tKey);
}

function renderRiskSparkline(settlement) {
  const svg = document.getElementById('drawer-sparkline-svg');
  if (!svg) return;

  const width = 360;
  const height = 70;
  const paddingX = 20;
  const paddingY = 12;

  const timesteps = appState.timesteps;
  const points = timesteps.map((t, i) => {
    const score = settlement.risk_score[t] || 0.0;
    const x = paddingX + i * ((width - 2 * paddingX) / (timesteps.length - 1));
    const y = (height - paddingY) - score * (height - 2 * paddingY);
    return { x, y, score, t, i };
  });

  const polylineStr = points.map(p => `${p.x},${p.y}`).join(' ');

  let svgHtml = `
    <!-- Grid Reference Lines -->
    <line x1="${paddingX}" y1="${(height - paddingY) - 0.66 * (height - 2 * paddingY)}" x2="${width - paddingX}" y2="${(height - paddingY) - 0.66 * (height - 2 * paddingY)}" stroke="rgba(231,76,60,0.3)" stroke-dasharray="3,3" />
    <line x1="${paddingX}" y1="${(height - paddingY) - 0.33 * (height - 2 * paddingY)}" x2="${width - paddingX}" y2="${(height - paddingY) - 0.33 * (height - 2 * paddingY)}" stroke="rgba(46,204,113,0.3)" stroke-dasharray="3,3" />
    
    <!-- Sparkline Polyline -->
    <polyline points="${polylineStr}" fill="none" stroke="${PALETTE.accentBlue}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  `;

  // Draw points
  points.forEach(p => {
    const isCurrent = (p.i === currentTimestepIndex);
    const circleColor = p.score > 0.66 ? PALETTE.riskHigh : (p.score >= 0.33 ? PALETTE.riskMed : PALETTE.riskLow);
    const radius = isCurrent ? 5.5 : 3.5;

    svgHtml += `
      <circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${circleColor}" stroke="#ffffff" stroke-width="${isCurrent ? '2' : '1'}" />
    `;
    if (isCurrent) {
      svgHtml += `
        <circle cx="${p.x}" cy="${p.y}" r="9" fill="none" stroke="${PALETTE.accentBlue}" stroke-width="1.5" opacity="0.8" />
      `;
    }
  });

  svg.innerHTML = svgHtml;
}

function bindDrawerControls() {
  document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
    const drawer = document.getElementById('settlement-detail-drawer');
    if (drawer) drawer.style.display = 'none';
    selectedSettlementId = null;
    safeRouteLayer.clearLayers();
    document.getElementById('safe-route-detail').textContent = 'Select any affected settlement to calculate open bypass route.';
  });

  document.getElementById('btn-drawer-find-route')?.addEventListener('click', () => {
    if (selectedSettlementId) {
      const tKey = appState.timesteps[currentTimestepIndex];
      calculateAndRenderSafeRoute(selectedSettlementId, tKey, true);
      // Close drawer to see map cleanly
      const drawer = document.getElementById('settlement-detail-drawer');
      if (drawer) drawer.style.display = 'none';
    }
  });
}

// ============================================================================
// 8. Safe-Route Overlay Engine (OSRM Road-Following Stitched Corridors)
// ============================================================================
async function calculateAndRenderSafeRoute(sourceId, tKey, zoomToBounds = false) {
  safeRouteLayer.clearLayers();
  const infoBox = document.getElementById('safe-route-detail');
  const sourceSettlement = appState.settlements.find(s => s.id === sourceId);

  if (!sourceSettlement) return;

  // Case 1: Settlement is already low risk
  if (sourceSettlement.risk_level[tKey] === 'low') {
    if (infoBox) {
      infoBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#16a34a;"></span>
          <strong style="color:#15803d; font-size:12px;">${sourceSettlement.name} is a Safe Refuge Haven</strong>
        </div>
        <span style="font-size:11px; color:#475569;">Currently evaluated as LOW RISK (${sourceSettlement.risk_score[tKey].toFixed(2)}). Outbound evacuation is not required.</span>
      `;
    }
    return;
  }

  // Look up precomputed / live safe route from pipeline
  let routeData = null;
  if (appState.safe_routes && appState.safe_routes[sourceId]) {
    routeData = appState.safe_routes[sourceId][tKey];
  }

  // Try live API if not in state or needs refresh
  if (!routeData && routeData !== null) {
    try {
      const res = await fetch(`http://localhost:8000/routing/safe-route/${sourceId}?timestep=${tKey}`);
      if (res.ok) {
        const apiData = await res.json();
        if (apiData.available) {
          routeData = apiData;
        }
      }
    } catch (e) {
      // offline fallback
    }
  }

  // Case 2: Open Safe Route Found
  if (routeData && routeData.coordinates && routeData.coordinates.length > 0) {
    const safePoly = L.polyline(routeData.coordinates, {
      color: '#2563eb',
      weight: 6.0,
      opacity: 0.95,
      className: 'safe-route-animated',
      lineCap: 'round',
      lineJoin: 'round'
    });

    const targetSettlement = appState.settlements.find(s => s.id === routeData.target_id) || { name: routeData.target_name, lat: routeData.coordinates[routeData.coordinates.length - 1][0], lng: routeData.coordinates[routeData.coordinates.length - 1][1] };

    safePoly.bindTooltip(`
      <div style="font-size:11.5px; font-family:'Plus Jakarta Sans', sans-serif; line-height:1.4;">
        <strong style="color:#1e40af;">🛡️ SAFE EVACUATION CORRIDOR</strong><br>
        Origin: <strong>${sourceSettlement.name}</strong> &rarr; Refuge Haven: <strong>${routeData.target_name}</strong><br>
        Distance: <span class="tab-num" style="font-weight:700;">${routeData.distance_km} km</span> &bull; ETA: <span class="tab-num" style="font-weight:700; color:#1e40af;">${routeData.eta_min || '—'} min</span><br>
        <span style="font-size:10px; color:#64748b;">Multi-Hop OSRM Road-Following Path</span>
      </div>
    `, { sticky: true, className: 'custom-map-tooltip' });

    safeRouteLayer.addLayer(safePoly);

    // Add Green Refuge Haven Beacon Marker at Destination
    if (targetSettlement && targetSettlement.lat) {
      const havenIcon = L.divIcon({
        className: 'custom-haven-pin',
        html: `
          <div class="haven-beacon-pulse">
            <div class="haven-beacon"></div>
            <div style="position:relative; z-index:5; width:26px; height:26px; border-radius:50%; background:#16a34a; border:2px solid #ffffff; box-shadow:0 3px 10px rgba(22,163,74,0.5); display:flex; align-items:center; justify-content:center; font-size:12px; color:#ffffff;">
              🛡️
            </div>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const havenMarker = L.marker([targetSettlement.lat, targetSettlement.lng], { icon: havenIcon });
      havenMarker.bindPopup(`
        <div style="font-family:'Plus Jakarta Sans', sans-serif; font-size:12px; padding:2px;">
          <strong style="color:#15803d; font-size:13px;">🛡️ DESIGNATED REFUGE HAVEN</strong><br>
          <strong>${routeData.target_name}</strong> (Low Risk Zone)<br>
          <span style="color:#475569; font-size:11px;">Open Highway Corridor Verified</span>
        </div>
      `);
      safeRouteLayer.addLayer(havenMarker);
    }

    // Zoom map smoothly to encompass the full evacuation corridor
    if (zoomToBounds && map) {
      map.fitBounds(safePoly.getBounds(), {
        padding: [90, 90],
        maxZoom: 13,
        duration: 1.0
      });
    }

    const pathNames = (routeData.path || []).map(id => appState.settlements.find(s => s.id === id)?.name || id);
    const roadsStr = (routeData.road_ids && routeData.road_ids.length > 0) ? `Via open links: <strong>${routeData.road_ids.join(', ')}</strong>` : 'Routed strictly over open road segments';

    if (infoBox) {
      infoBox.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
          <strong style="color:#1e40af; font-size:12px;">Safe Corridor: ${sourceSettlement.name} &rarr; ${routeData.target_name}</strong>
          <span style="font-family:'JetBrains Mono', monospace; font-size:11px; font-weight:700; color:#15803d; background:#dcfce7; padding:2px 6px; border-radius:4px;">${routeData.distance_km} km &bull; ${routeData.eta_min || '--'} min</span>
        </div>
        <div style="font-size:11.5px; color:#1e293b; line-height:1.4; margin-bottom:4px;">
          <strong>Route:</strong> ${pathNames.join(' &rarr; ')}
        </div>
        <span style="font-size:10px; color:#64748b;">${roadsStr}</span>
      `;
    }
  } else {
    // Case 3: Isolated settlement (no open route)
    if (infoBox) {
      infoBox.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#dc2626;"></span>
          <strong style="color:#dc2626; font-size:12px;">⚠️ Isolation Alert: No Open Highway Corridor</strong>
        </div>
        <span style="font-size:11px; color:#475569;">All outbound roads from <strong>${sourceSettlement.name}</strong> are submerged/closed at ${tKey}. Recommend vertical evacuation / localized refuge.</span>
      `;
    }

    if (zoomToBounds && map) {
      map.setView([sourceSettlement.lat, sourceSettlement.lng], 13);
    }
  }
}

// ============================================================================
// 5. Validation / Test Scenarios Screen
// ============================================================================
function populateValidationScreen() {
  if (!appState || !appState.test_scenarios) return;

  const t1 = appState.test_scenarios.false_alert_case;
  const t2 = appState.test_scenarios.route_disruption_case;

  if (t1) {
    document.getElementById('val-test1-desc').textContent = t1.description;
    const inp1 = document.getElementById('val-test1-inputs');
    if (inp1 && t1.input_conditions) {
      inp1.innerHTML = `
        <li><span>Settlement:</span> <strong>${t1.input_conditions.settlement}</strong></li>
        <li><span>Timestep:</span> <strong>${t1.input_conditions.timestep}</strong></li>
        <li><span>Rainfall:</span> <strong class="tab-num">${t1.input_conditions.rainfall_mm} mm</strong></li>
        <li><span>Elevation:</span> <strong class="tab-num">${t1.input_conditions.elevation_m} m</strong></li>
        <li><span>River Distance:</span> <strong class="tab-num">${t1.input_conditions.distance_to_river_km} km</strong></li>
        <li><span>Historical Flood:</span> <strong>${t1.input_conditions.historical_flood_flag === 1 ? 'Yes' : 'No (0)'}</strong></li>
      `;
    }
    const out1 = document.getElementById('val-test1-output');
    if (out1) {
      out1.innerHTML = `
        <strong>Verification:</strong> ${t1.result}<br><br>
        <span style="color:#ffffff;">Model Probability Output:</span> <code class="tab-num">${t1.model_output?.risk_score}</code> &bull; Level: <code>${t1.model_output?.risk_level}</code> (Threshold for High: &gt; 0.66)
      `;
    }
  }

  if (t2) {
    document.getElementById('val-test2-desc').textContent = t2.description;
    const inp2 = document.getElementById('val-test2-inputs');
    if (inp2 && t2.input_conditions) {
      inp2.innerHTML = `
        <li><span>Affected Flood Node:</span> <strong>${t2.input_conditions.affected_node}</strong></li>
        <li><span>Classification at T5:</span> <strong style="color:${PALETTE.riskHigh};">${t2.input_conditions.risk_level_at_T5.toUpperCase()}</strong></li>
        <li><span>Ground Reports:</span> <strong>${t2.input_conditions.ground_reports}</strong></li>
        <li><span>Impacted Roads:</span> <strong>${t2.input_conditions.target_roads.join(', ')}</strong></li>
      `;
    }
    const out2 = document.getElementById('val-test2-output');
    if (out2) {
      out2.innerHTML = `
        <strong>Verification:</strong> ${t2.result}<br><br>
        <span style="color:#ffffff;">Dynamic Alternative Path:</span> <code style="font-size:11px;">${t2.model_output?.reroute_path_found}</code>
      `;
    }
  }

  // Populate Literature Feature Importance Comparison Strip
  const litContainer = document.getElementById('lit-bars-container');
  if (litContainer && appState.feature_importances) {
    litContainer.innerHTML = '';
    const feats = [
      { key: 'rainfall', label: 'Rainfall Volume', weight: appState.feature_importances.rainfall },
      { key: 'elevation', label: 'Terrain Elevation', weight: appState.feature_importances.elevation },
      { key: 'distance_to_river', label: 'River Proximity', weight: appState.feature_importances.distance_to_river },
      { key: 'historical_flood', label: 'Historical Record', weight: appState.feature_importances.historical_flood }
    ];

    feats.forEach(f => {
      const pct = Math.round(f.weight * 100);
      const card = document.createElement('div');
      card.className = 'lit-bar-card';
      card.innerHTML = `
        <div class="lit-bar-meta">
          <span>${f.label}</span>
          <strong class="tab-num">${f.weight.toFixed(2)} (${pct}%)</strong>
        </div>
        <div class="lit-track">
          <div class="lit-fill" style="width:${pct}%;"></div>
        </div>
      `;
      litContainer.appendChild(card);
    });
  }
}

// ============================================================================
// 6. Summary / Output Report Screen Implementation
// ============================================================================
function renderOutputReport() {
  if (!appState) return;

  const tKey = appState.timesteps[currentTimestepIndex];
  const tLabel = appState.timestep_labels ? appState.timestep_labels[tKey] : tKey;

  // Header
  document.getElementById('report-timestep-pill').textContent = `SNAPSHOT AT ${tKey}`;
  document.getElementById('report-headline').textContent = `${appState.district} Flood Coordination Executive Summary`;
  document.getElementById('report-timestamp-str').textContent = `Generated from historical replayed event: ${tLabel} (${appState.data_label})`;

  // Stats
  const settlements = appState.settlements;
  const roads = appState.roads;
  const highRisk = settlements.filter(s => s.risk_level[tKey] === 'high');
  const closedRoads = roads.filter(r => r.status[tKey] === 'closed');
  const activeReports = (appState.ground_reports || []).filter(g => g.timestep === tKey);
  const safeHavens = settlements.filter(s => s.risk_level[tKey] === 'low');

  document.getElementById('rep-high-risk-val').textContent = highRisk.length;
  document.getElementById('rep-high-risk-sub').textContent = `of ${settlements.length} settlements`;

  document.getElementById('rep-roads-closed-val').textContent = closedRoads.length;
  document.getElementById('rep-roads-closed-sub').textContent = `of ${roads.length} road segments`;

  document.getElementById('rep-reports-active-val').textContent = activeReports.length;
  document.getElementById('rep-havens-val').textContent = safeHavens.length;

  // Populate Priority Table ("Who to help first and why")
  const tbody = document.getElementById('report-table-body');
  if (tbody) {
    tbody.innerHTML = '';
    // Sort settlements descending by priority_score at current timestep
    const sorted = [...settlements].sort((a, b) => (a.priority_rank[tKey] || 99) - (b.priority_rank[tKey] || 99));

    sorted.forEach(s => {
      const rank = s.priority_rank[tKey];
      const riskLevel = s.risk_level[tKey];
      const riskScore = s.risk_score[tKey];
      const connectedRoads = roads.filter(r => r.from === s.id || r.to === s.id);
      const openCount = connectedRoads.filter(r => r.status[tKey] === 'open').length;

      const reportsCount = (appState.ground_reports || []).filter(g => g.settlement_id === s.id && g.timestep === tKey).length;
      const repNote = reportsCount > 0 ? `, ${reportsCount} active ground reports` : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="tab-num" style="font-weight:700;">#${rank}</td>
        <td><strong>${s.name}</strong></td>
        <td>${s.taluk}</td>
        <td class="tab-num">${s.population.toLocaleString()}</td>
        <td><span class="risk-badge ${riskLevel}">${riskLevel.toUpperCase()}</span></td>
        <td class="tab-num highlight">${riskScore.toFixed(2)}</td>
        <td class="tab-num">${openCount} of ${connectedRoads.length} open</td>
        <td style="color:#cbd5e1; font-size:11px;">Rain: ${s.rainfall_mm[tKey]}mm &bull; Elev: ${s.elevation_m}m &bull; River: ${s.distance_to_river_km}km${repNote}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Frozen Snapshot Map
  renderFrozenMap(tKey);
}

function renderFrozenMap(tKey) {
  const container = document.getElementById('report-frozen-map');
  if (!container) return;

  if (frozenReportMap) {
    frozenReportMap.remove();
    frozenReportMap = null;
  }

  // Create frozen non-interactive map
  frozenReportMap = L.map('report-frozen-map', {
    center: [11.695, 76.140],
    zoom: 10,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri &mdash; National Geographic, DeLorme, NAVTEQ, USGS'
  }).addTo(frozenReportMap);

  // Roads
  appState.roads.forEach(road => {
    const isClosed = (road.status[tKey] === 'closed');
    const color = isClosed ? PALETTE.roadClosed : PALETTE.roadOpen;
    L.polyline(road.coordinates, {
      color: color,
      weight: isClosed ? 3.5 : 2.5,
      opacity: 0.8
    }).addTo(frozenReportMap);
  });

  // Settlements
  appState.settlements.forEach(s => {
    const riskLevel = s.risk_level[tKey];
    let fillColor = PALETTE.riskLow;
    if (riskLevel === 'high') fillColor = PALETTE.riskHigh;
    else if (riskLevel === 'medium') fillColor = PALETTE.riskMed;

    L.circleMarker([s.lat, s.lng], {
      radius: 6,
      fillColor: fillColor,
      fillOpacity: 0.9,
      color: '#ffffff',
      weight: 1.5
    }).addTo(frozenReportMap);
  });

  setTimeout(() => {
    if (frozenReportMap) frozenReportMap.invalidateSize();
  }, 100);
}

function bindReportControls() {
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    window.print();
  });
}

// ============================================================================
// 7. Interactive Live Predict Sandbox Controller
// ============================================================================
function bindPredictSandbox() {
  const btnRun = document.getElementById('btn-run-live-predict');
  const btnPresetFalseAlarm = document.getElementById('btn-preset-false-alarm');
  const btnPresetSevere = document.getElementById('btn-preset-severe-surge');

  const inRain = document.getElementById('predict-input-rain');
  const inElev = document.getElementById('predict-input-elev');
  const inDist = document.getElementById('predict-input-dist');
  const inHist = document.getElementById('predict-input-hist');

  const resBox = document.getElementById('predict-result-box');
  const resBadge = document.getElementById('predict-res-badge');
  const resScore = document.getElementById('predict-res-score');
  const resConf = document.getElementById('predict-res-conf');
  const resRationale = document.getElementById('predict-res-rationale');

  btnPresetFalseAlarm?.addEventListener('click', () => {
    if (inRain) inRain.value = '290';
    if (inElev) inElev.value = '860';
    if (inDist) inDist.value = '22.0';
    if (inHist) inHist.value = '0';
    btnRun?.click();
  });

  btnPresetSevere?.addEventListener('click', () => {
    if (inRain) inRain.value = '350';
    if (inElev) inElev.value = '720';
    if (inDist) inDist.value = '0.5';
    if (inHist) inHist.value = '1';
    btnRun?.click();
  });

  btnRun?.addEventListener('click', async () => {
    const payload = {
      rainfall_mm: parseFloat(inRain?.value || 300),
      elevation_m: parseFloat(inElev?.value || 750),
      distance_to_river_km: parseFloat(inDist?.value || 1.0),
      historical_flood_flag: parseInt(inHist?.value || 0, 10),
      settlement_name: 'Custom Judge Scenario'
    };

    btnRun.disabled = true;
    btnRun.textContent = 'Querying Trained Random Forest...';

    try {
      const resp = await fetch('http://localhost:8000/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) throw new Error(`API returned ${resp.status}`);
      const data = await resp.json();

      if (resBox && resBadge && resScore && resConf && resRationale) {
        resBox.style.display = 'block';
        const level = data.prediction.risk_level.toLowerCase();
        resBadge.className = `risk-badge ${level}`;
        resBadge.textContent = level.toUpperCase();
        resScore.textContent = data.prediction.risk_score.toFixed(4);
        resConf.textContent = `${Math.round(data.prediction.confidence * 100)}%`;
        resRationale.textContent = data.explainability.hydrology_rationale;
      }
    } catch (err) {
      console.warn('Live /predict endpoint unavailable, calculating via client hydrology heuristic:', err);
      // Fallback local heuristic
      const r_norm = Math.min(1.0, payload.rainfall_mm / 350.0);
      const e_norm = Math.max(0.0, Math.min(1.0, (payload.elevation_m - 700) / 250));
      const d_norm = Math.max(0.0, Math.min(1.0, payload.distance_to_river_km / 20.0));
      const h_flag = payload.historical_flood_flag;

      const score = Math.min(1.0, Math.max(0.0, (r_norm * 0.35) + ((1 - e_norm) * 0.30) + ((1 - d_norm) * 0.20) + (h_flag * 0.15)));
      const level = score > 0.66 ? 'high' : (score >= 0.33 ? 'medium' : 'low');
      const conf = Math.abs(score - 0.5) * 2;

      if (resBox && resBadge && resScore && resConf && resRationale) {
        resBox.style.display = 'block';
        resBadge.className = `risk-badge ${level}`;
        resBadge.textContent = level.toUpperCase();
        resScore.textContent = score.toFixed(4);
        resConf.textContent = `${Math.round(conf * 100)}%`;
        resRationale.textContent = `Client Fallback Calculation: Rain ${payload.rainfall_mm}mm, Elev ${payload.elevation_m}m, River ${payload.distance_to_river_km}km.`;
      }
    } finally {
      btnRun.disabled = false;
      btnRun.innerHTML = '<span>Run Real-Time ML Inference &rarr;</span>';
    }
  });
}

// ============================================================================
// 7. Dynamic Rescue Unit Dispatch & Fleet Allocation Module (Part 3)
// ============================================================================
function bindDispatchControls() {
  const btnOpen = document.getElementById('btn-open-dispatch-drawer');
  const btnClose = document.getElementById('btn-close-dispatch-drawer');
  const btnRunDispatch = document.getElementById('btn-run-greedy-dispatch');
  const btnMinus = document.getElementById('btn-unit-minus');
  const btnPlus = document.getElementById('btn-unit-plus');
  const unitInput = document.getElementById('disp-unit-input');
  const toggleRoutes = document.getElementById('toggle-dispatch-routes');

  // Open / Close Drawer
  btnOpen?.addEventListener('click', openDispatchDrawer);
  btnClose?.addEventListener('click', closeDispatchDrawer);

  // Stepper controls
  btnMinus?.addEventListener('click', () => {
    if (availableUnits > 1) {
      availableUnits--;
      updateUnitDisplays();
      executeGreedyDispatch(true);
    }
  });

  btnPlus?.addEventListener('click', () => {
    if (availableUnits < 50) {
      availableUnits++;
      updateUnitDisplays();
      executeGreedyDispatch(true);
    }
  });

  // Preset Buttons
  document.querySelectorAll('.btn-preset-unit').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-preset-unit').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const units = parseInt(btn.dataset.units, 10);
      if (!isNaN(units)) {
        availableUnits = units;
        updateUnitDisplays();
        executeGreedyDispatch(true);
      }
    });
  });

  // Execute Dispatch Button
  btnRunDispatch?.addEventListener('click', async () => {
    // Visual: loading state
    btnRunDispatch.disabled = true;
    const origHTML = btnRunDispatch.innerHTML;
    btnRunDispatch.innerHTML = `
      <svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <span>⚡ Allocating Fleet...</span>
    `;
    btnRunDispatch.style.opacity = '0.85';

    try {
      await executeGreedyDispatch(true);

      // Visual: success state
      const assignedCount = currentDispatchData?.units_used ?? 0;
      const targetCount = currentDispatchData?.settlements_needing_help ?? 0;
      btnRunDispatch.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>✓ Fleet Dispatched — ${assignedCount} Units → ${targetCount} Targets</span>
      `;
      btnRunDispatch.style.background = 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)';

      // Auto-scroll the drawer to show the results table
      setTimeout(() => {
        const tableWrap = document.querySelector('.dispatch-table-wrap');
        if (tableWrap) {
          tableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Brief highlight pulse on the table
          tableWrap.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.5)';
          setTimeout(() => { tableWrap.style.boxShadow = ''; }, 1500);
        }
      }, 200);

      // Fit map bounds to show all dispatch routes
      if (map && dispatchRouteLayer && dispatchRouteLayer.getLayers().length > 0) {
        const routeBounds = dispatchRouteLayer.getBounds();
        if (routeBounds.isValid()) {
          map.fitBounds(routeBounds, { padding: [60, 520, 60, 60], maxZoom: 13 });
        }
      }

      // Reset button after 3 seconds
      setTimeout(() => {
        btnRunDispatch.innerHTML = origHTML;
        btnRunDispatch.style.background = '';
        btnRunDispatch.disabled = false;
        btnRunDispatch.style.opacity = '';
      }, 3000);

    } catch (e) {
      console.error('Dispatch execution error:', e);
      btnRunDispatch.innerHTML = `<span>⚠ Error — Click to Retry</span>`;
      btnRunDispatch.style.background = 'linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)';
      setTimeout(() => {
        btnRunDispatch.innerHTML = origHTML;
        btnRunDispatch.style.background = '';
        btnRunDispatch.disabled = false;
        btnRunDispatch.style.opacity = '';
      }, 2500);
    }
  });

  // Route Overlay Toggle
  toggleRoutes?.addEventListener('change', (e) => {
    dispatchRoutesVisible = e.target.checked;
    if (currentDispatchData) {
      renderDispatchRoutes(currentDispatchData);
    }
  });
}

function updateUnitDisplays() {
  const unitInput = document.getElementById('disp-unit-input');
  const dispActiveCount = document.getElementById('disp-active-count');
  const navPill = document.getElementById('nav-dispatch-pill');

  if (unitInput) unitInput.textContent = availableUnits;
  if (dispActiveCount) dispActiveCount.textContent = availableUnits;
  if (navPill) navPill.textContent = `${availableUnits} Units`;

  // Highlight matching preset if applicable
  document.querySelectorAll('.btn-preset-unit').forEach(btn => {
    if (parseInt(btn.dataset.units, 10) === availableUnits) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function openDispatchDrawer() {
  const drawer = document.getElementById('dispatch-modal-drawer');
  const settlementDrawer = document.getElementById('settlement-detail-drawer');
  if (settlementDrawer) settlementDrawer.style.display = 'none'; // Close other drawer
  if (drawer) {
    drawer.style.display = 'flex';
    executeGreedyDispatch(true);
  }
}

function closeDispatchDrawer() {
  const drawer = document.getElementById('dispatch-modal-drawer');
  if (drawer) drawer.style.display = 'none';
}

/**
 * Executes the greedy unit allocation algorithm via FastAPI backend (/dispatch/assign-units)
 * with robust client fallback calculation if offline.
 */
async function executeGreedyDispatch(isInteractive = false) {
  if (!appState) return;
  const tKey = appState.timesteps[currentTimestepIndex];

  const payload = {
    total_units: availableUnits,
    timestep: tKey
  };

  try {
    const res = await fetch('http://localhost:8000/dispatch/assign-units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    currentDispatchData = data;
    renderDispatchResults(data);
  } catch (err) {
    console.warn('Live /dispatch/assign-units failed, executing local greedy allocation fallback:', err);
    const data = computeLocalGreedyDispatch(availableUnits, tKey);
    currentDispatchData = data;
    renderDispatchResults(data);
  }
}

/**
 * Pure client-side Greedy Unit Allocation algorithm fallback
 */
function computeLocalGreedyDispatch(totalUnits, timestep) {
  const settlements = appState.settlements || [];
  const needingHelp = settlements
    .filter(s => s.risk_level[timestep] === 'medium' || s.risk_level[timestep] === 'high')
    .sort((a, b) => a.priority_rank[timestep] - b.priority_rank[timestep]);

  let unitsLeft = totalUnits;
  const assignments = [];

  const popBand = (pop) => (pop < 20000 ? 1 : (pop < 40000 ? 2 : 3));
  const riskBand = { "medium": 1, "high": 2 };

  needingHelp.forEach(s => {
    const pNeed = popBand(s.population);
    const rNeed = riskBand[s.risk_level[timestep]] || 1;
    const unitsNeeded = pNeed + rNeed;

    if (unitsLeft <= 0) {
      assignments.push({
        settlement_id: s.id,
        name: s.name,
        priority_rank: s.priority_rank[timestep],
        risk_level: s.risk_level[timestep],
        risk_score: s.risk_score[timestep],
        population: s.population,
        units_needed: unitsNeeded,
        units_assigned: 0,
        status: "UNASSIGNED — insufficient fleet units",
        distance_km: null,
        eta_min: null,
        route_geometry: null
      });
      return;
    }

    const assigned = Math.min(unitsLeft, unitsNeeded);
    unitsLeft -= assigned;

    // Approximate distance/ETA from Kalpetta HQ [11.6103, 76.0827]
    const dLat = (s.lat - DEPOT_COORDS[0]) * 111;
    const dLng = (s.lng - DEPOT_COORDS[1]) * 108;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 1.35; // road winding factor
    const eta = (dist / 38) * 60; // 38 km/h mountain speed

    assignments.push({
      settlement_id: s.id,
      name: s.name,
      priority_rank: s.priority_rank[timestep],
      risk_level: s.risk_level[timestep],
      risk_score: s.risk_score[timestep],
      population: s.population,
      units_needed: unitsNeeded,
      units_assigned: assigned,
      status: assigned === unitsNeeded ? "FULLY ASSIGNED" : "PARTIALLY ASSIGNED",
      distance_km: parseFloat(dist.toFixed(2)),
      eta_min: parseFloat(eta.toFixed(1)),
      route_geometry: [DEPOT_COORDS, [s.lat, s.lng]],
      route_source: "straight_line_fallback"
    });
  });

  return {
    total_units: totalUnits,
    units_used: totalUnits - unitsLeft,
    units_remaining: unitsLeft,
    timestep: timestep,
    settlements_needing_help: needingHelp.length,
    assignments: assignments,
    fully_covered: assignments.every(a => a.status === "FULLY ASSIGNED")
  };
}

/**
 * Updates KPI metrics and populates the dispatch schedule table
 */
function renderDispatchResults(data) {
  const kpiUsed = document.getElementById('kpi-units-used');
  const kpiTotal = document.getElementById('kpi-units-total');
  const kpiRem = document.getElementById('kpi-units-remaining');
  const kpiTargets = document.getElementById('kpi-targets-count');
  const kpiStatus = document.getElementById('kpi-coverage-status');
  const kpiSub = document.getElementById('kpi-coverage-sub');
  const tbody = document.getElementById('dispatch-table-tbody');

  if (kpiUsed) kpiUsed.textContent = data.units_used;
  if (kpiTotal) kpiTotal.textContent = data.total_units;
  if (kpiRem) kpiRem.textContent = `${data.units_remaining} units in reserve`;
  if (kpiTargets) kpiTargets.textContent = data.settlements_needing_help;

  if (kpiStatus && kpiSub) {
    if (data.fully_covered) {
      kpiStatus.textContent = '100% COVERED';
      kpiStatus.style.color = '#15803d';
      kpiSub.textContent = 'All at-risk zones allocated';
    } else if (data.units_used === 0) {
      kpiStatus.textContent = 'ZERO FLEET';
      kpiStatus.style.color = '#dc2626';
      kpiSub.textContent = 'Increase available units';
    } else {
      kpiStatus.textContent = 'PARTIAL (PRIORITY)';
      kpiStatus.style.color = '#b45309';
      kpiSub.textContent = 'Greedy top ranks serviced first';
    }
  }

  // Populate Table
  if (tbody) {
    tbody.innerHTML = '';
    if (!data.assignments || data.assignments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px; color:#64748b;">No settlements currently in medium/high risk at this timestep.</td></tr>`;
      return;
    }

    data.assignments.forEach(a => {
      const tr = document.createElement('tr');
      tr.className = 'dispatch-row-interactive';
      
      let statusClass = 'unassigned';
      let statusLabel = 'UNASSIGNED';
      if (a.status === 'FULLY ASSIGNED') {
        statusClass = 'full';
        statusLabel = 'ALLOCATED';
      } else if (a.status === 'PARTIALLY ASSIGNED') {
        statusClass = 'partial';
        statusLabel = 'PARTIAL';
      }

      const riskClass = a.risk_level.toLowerCase();
      const distStr = a.distance_km != null ? `${a.distance_km} km` : '—';
      const etaStr = a.eta_min != null ? `${a.eta_min} min` : '—';

      tr.innerHTML = `
        <td style="font-weight:700; color:var(--accent-navy);" class="tab-num">#${a.priority_rank}</td>
        <td><strong>${a.name}</strong></td>
        <td><span class="risk-badge ${riskClass}">${a.risk_level.toUpperCase()}</span></td>
        <td class="tab-num" style="font-weight:700;">${a.units_assigned} <span style="color:#64748b; font-weight:400;">/ ${a.units_needed}</span></td>
        <td><span class="dispatch-status-badge ${statusClass}">${statusLabel}</span></td>
        <td class="tab-num" style="color:#475569;">${distStr}</td>
        <td class="tab-num" style="font-weight:700; color:#1e40af;">${etaStr}</td>
      `;

      // Click to inspect route on map
      tr.addEventListener('click', () => {
        const s = appState.settlements.find(item => item.id === a.settlement_id);
        if (s && map) {
          map.setView([s.lat, s.lng], 13);
          // Highlight this settlement
          openSettlementDrawer(s.id);
        }
      });

      tbody.appendChild(tr);
    });

    // Scroll the drawer body so the table card is visible
    const drawerBody = document.querySelector('#dispatch-modal-drawer .drawer-body');
    const tableCard = tbody.closest('.drawer-card');
    if (drawerBody && tableCard) {
      setTimeout(() => {
        drawerBody.scrollTo({ top: drawerBody.scrollHeight, behavior: 'smooth' });
        // Flash highlight
        tableCard.style.transition = 'box-shadow 0.3s ease';
        tableCard.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.45)';
        setTimeout(() => { tableCard.style.boxShadow = ''; }, 1400);
      }, 120);
    }
  }

  // Draw routes on map
  renderDispatchRoutes(data);
}

/**
 * Draws the real road dispatch paths from Kalpetta HQ to all assigned targets on the Leaflet map
 */
function renderDispatchRoutes(data) {
  if (!dispatchRouteLayer) return;
  dispatchRouteLayer.clearLayers();

  if (!dispatchRoutesVisible || !data || !data.assignments) {
    // Even if routes hidden, still fit map to assigned settlements
    if (map && data && data.assignments) {
      const assigned = data.assignments.filter(a => a.units_assigned > 0 && a.route_geometry);
      if (assigned.length > 0) {
        const coords = assigned.flatMap(a => a.route_geometry);
        const bounds = L.latLngBounds(coords);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 520, 60, 60], maxZoom: 13 });
        }
      }
    }
    return;
  }

  data.assignments.forEach(a => {
    if (a.units_assigned > 0 && a.route_geometry && a.route_geometry.length > 0) {
      const polyline = L.polyline(a.route_geometry, {
        color: '#0284c7',
        weight: 4.5,
        opacity: 0.9,
        dashArray: '8, 8',
        className: 'dispatch-route-animated',
        lineCap: 'round',
        lineJoin: 'round'
      });

      polyline.bindTooltip(`
        <div style="font-size:11.5px; font-family:'Plus Jakarta Sans', sans-serif;">
          <strong style="color:#0369a1;">🚒 DISPATCHED: ${a.units_assigned} Unit(s)</strong><br>
          Target: <strong>${a.name}</strong> (Priority Rank #${a.priority_rank})<br>
          Driving Dist: <span class="tab-num">${a.distance_km} km</span> &bull; ETA: <span class="tab-num" style="font-weight:700; color:#0369a1;">${a.eta_min} min</span>
        </div>
      `, { sticky: true });

      polyline.addTo(dispatchRouteLayer);
    }
  });

  // Fit map to show all drawn dispatch routes (right-padding accounts for the 480px drawer)
  if (map && dispatchRouteLayer.getLayers().length > 0) {
    try {
      const bounds = dispatchRouteLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 520, 60, 60], maxZoom: 13 });
      }
    } catch (_) {}
  }
}

/**
 * Places the central Emergency Operations Center / Depot marker at Kalpetta
 */
function renderDepotMarker() {
  if (!depotMarkerLayer) return;
  depotMarkerLayer.clearLayers();

  const depotIcon = L.divIcon({
    className: 'custom-depot-pin',
    html: `
      <div class="depot-marker-pulse">
        <div class="depot-beacon"></div>
        <div style="position:relative; z-index:5; width:28px; height:28px; border-radius:50%; background:#1e3a8a; border:2px solid #ffffff; box-shadow:0 3px 12px rgba(30,58,138,0.5); display:flex; align-items:center; justify-content:center; font-size:14px;">
          🏢
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  const marker = L.marker(DEPOT_COORDS, { icon: depotIcon });
  marker.bindPopup(`
    <div style="font-family:'Plus Jakarta Sans', sans-serif; font-size:12px; padding:2px;">
      <strong style="color:#1e3a8a; font-size:13px;">🚨 DISTRICT RESCUE OPERATIONS HQ</strong><br>
      <span style="color:#64748b;">Central Fleet Depot &bull; Kalpetta</span><br>
      <span style="font-size:11px; font-family:'JetBrains Mono', monospace; color:#3b82f6;">Coordinates: 11.6103°N, 76.0827°E</span><br>
      <span style="display:inline-block; margin-top:4px; font-size:11px; font-weight:700; color:#15803d;">Active Units: ${availableUnits} Total Fleet</span>
    </div>
  `);

  marker.addTo(depotMarkerLayer);
}

