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
let autoPlayInterval = null;
let selectedSettlementId = null;

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
  bindReportControls();

  // Initial View
  switchView('home');
});

/**
 * Loads shared state data from state.json with fallback to state_data.js
 */
async function loadStateData() {
  try {
    const response = await fetch('state.json');
    if (!response.ok) throw new Error('Network fetch failed');
    appState = await response.json();
    console.log('Loaded appState via fetch:', appState);
  } catch (err) {
    console.warn('Fetch failed, falling back to window.DEFAULT_STATE:', err);
    if (window.DEFAULT_STATE) {
      appState = window.DEFAULT_STATE;
    } else {
      console.error('Fatal: No state data available!');
      return;
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
  // Launch button triggers processing sequence
  document.getElementById('btn-launch-model')?.addEventListener('click', () => {
    switchView('processing');
  });

  // How this works inline expander
  const btnToggleExplainer = document.getElementById('btn-toggle-explainer');
  const explainerContent = document.getElementById('home-explainer-content');
  if (btnToggleExplainer && explainerContent) {
    btnToggleExplainer.addEventListener('click', () => {
      const isHidden = explainerContent.style.display === 'none';
      explainerContent.style.display = isHidden ? 'flex' : 'none';
    });
  }
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

  // 6. Render Alert Sidebar
  renderAlertsSidebar(tKey);

  // 7. Re-calculate Safe Route if a settlement is selected
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
  const currentReports = reports.filter(g => g.timestep === tKey);

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

    const marker = L.marker([lat, lng], { icon: reportIcon });
    marker.bindTooltip(`
      <div style="font-size:11px; max-width:200px;">
        <strong style="color:#f59e0b;">Ground Report (${g.type})</strong><br>
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
      calculateAndRenderSafeRoute(selectedSettlementId, tKey);
      // Close drawer to see map cleanly
      const drawer = document.getElementById('settlement-detail-drawer');
      if (drawer) drawer.style.display = 'none';
    }
  });
}

// ============================================================================
// 8. Safe-Route Overlay Heuristic Engine
// ============================================================================
function calculateAndRenderSafeRoute(sourceId, tKey) {
  safeRouteLayer.clearLayers();
  const infoBox = document.getElementById('safe-route-detail');
  const sourceSettlement = appState.settlements.find(s => s.id === sourceId);

  if (!sourceSettlement) return;

  if (sourceSettlement.risk_level[tKey] === 'low') {
    if (infoBox) {
      infoBox.innerHTML = `
        <span style="color:${PALETTE.riskLow}; font-weight:600;">${sourceSettlement.name} is currently LOW RISK.</span>
        Designated safe refuge zone. Outbound evacuation not required.
      `;
    }
    return;
  }

  const openRoads = appState.roads.filter(r => r.status[tKey] === 'open');
  const adjList = {};
  appState.settlements.forEach(s => { adjList[s.id] = []; });

  openRoads.forEach(r => {
    adjList[r.from].push({ to: r.to, roadId: r.id, coords: r.coordinates });
    adjList[r.to].push({ to: r.from, roadId: r.id, coords: [r.coordinates[1], r.coordinates[0]] });
  });

  const safeHavens = appState.settlements.filter(s => s.risk_level[tKey] === 'low');
  if (safeHavens.length === 0) {
    if (infoBox) {
      infoBox.innerHTML = `<span style="color:${PALETTE.riskHigh}; font-weight:600;">No low-risk settlements remain in district at ${tKey}.</span> Coordinate inter-district NDRF airlift.`;
    }
    return;
  }

  // BFS search
  const queue = [{ id: sourceId, path: [sourceId], segments: [] }];
  const visited = new Set([sourceId]);
  let foundRoute = null;

  while (queue.length > 0) {
    const current = queue.shift();
    const currSettlement = appState.settlements.find(s => s.id === current.id);

    if (currSettlement.risk_level[tKey] === 'low') {
      foundRoute = current;
      break;
    }

    for (const edge of adjList[current.id]) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({
          id: edge.to,
          path: [...current.path, edge.to],
          segments: [...current.segments, edge.coords]
        });
      }
    }
  }

  if (foundRoute) {
    const pathCoords = [];
    foundRoute.segments.forEach(seg => {
      pathCoords.push(seg[0]);
      pathCoords.push(seg[1]);
    });

    if (pathCoords.length > 0) {
      const safePoly = L.polyline(pathCoords, {
        color: PALETTE.accentBlue,
        weight: 5.5,
        opacity: 0.95,
        className: 'safe-route-animated'
      });
      safePoly.bindTooltip(`
        <strong>Safe Evacuation Path (${foundRoute.path.length - 1} hops)</strong><br>
        Destination: ${appState.settlements.find(s => s.id === foundRoute.id).name} (Low Risk)
      `, { className: 'custom-map-tooltip' });
      safeRouteLayer.addLayer(safePoly);
    }

    const routeNames = foundRoute.path.map(id => appState.settlements.find(s => s.id === id).name);
    if (infoBox) {
      infoBox.innerHTML = `
        <span style="color:${PALETTE.accentBlue}; font-weight:700;">Open Route Found (${foundRoute.path.length - 1} hops):</span><br>
        ${routeNames.join(' &rarr; ')}<br>
        <span style="font-size:10px; color:#94a3b8;">Routed strictly through verified open road segments.</span>
      `;
    }
  } else {
    if (infoBox) {
      infoBox.innerHTML = `
        <span style="color:${PALETTE.riskHigh}; font-weight:700;">⚠️ No open route currently available.</span><br>
        All outbound roads from ${sourceSettlement.name} are severed or submerged at ${tKey}. Recommend vertical evacuation / shelter-in-place.
      `;
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
