/**
 * Property Setbacks Manager
 * Handles edge selection, setback inputs, and buildable area calculations
 */

if (typeof BaseManager === 'undefined') {
  window.BaseManager = class {
    constructor(name){ this.name = name; }
    info(...a){ console.log(`[${this.name}] INFO:`, ...a); }
    warn(...a){ console.warn(`[${this.name}] WARN:`, ...a); }
    error(...a){ console.error(`[${this.name}] ERROR:`, ...a); }
    debug(...a){ console.debug?.(`[${this.name}] DEBUG:`, ...a); }
  };
}

class PropertySetbacksManager extends BaseManager {
  constructor(map) {
    super('PropertySetbacksManager');
    this.map = map;

    // state
    this.polygonEdges = [];
    this.selectedEdges = { front: null, back: null };
    this.isSetbackMode = false;
    this.isEdgeSelectionMode = false;
    this.setbackOverlays = [];
    this.currentBuildableArea = null;
    this.edgeLabels = {};
    this.edgePopups = [];
    this.cachedPolygonEdges = null;

    // listeners we need to remove cleanly
    this._edgeHoverHandlers = {}; // { [index]: { enter, leave } }
    this._clickHandler = null;
  }

  /* -----------------------------
     Init
  ------------------------------ */
  async initialize() {
    try {
      this.info('Initializing Property Setbacks Manager...');
      this.setupEventListeners();
      this.setupUIEventListeners();
      this.setupSiteBoundaryEventListeners(); // was defined but never wired

      await this.loadExistingBuildableArea();

      this.info('Property Setbacks Manager initialized successfully');
    } catch (error) {
      this.error('Failed to initialize Property Setbacks Manager:', error);
      throw error;
    }
  }

  /* -----------------------------
     Load snapshot (if present)
  ------------------------------ */
  async loadExistingBuildableArea() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let projectId = urlParams.get('project') || urlParams.get('project_id');

      if (projectId && (projectId.includes('?') || projectId.includes('&'))) {
        projectId = projectId.split('?')[0].split('&')[0];
      }

      if (projectId) {
        projectId = String(projectId).trim();
        if (!/^\d+$/.test(projectId)) {
          this.warn('Invalid project ID format:', projectId);
          return;
        }
      }
      if (!projectId) {
        this.info('No valid project ID found, skipping buildable area load');
        return;
      }

      const response = await fetch(`/api/project/${projectId}/snapshot`);
      const data = await response.json();

      if (data.success && data.snapshot && data.snapshot.snapshot_type === 'buildable_area') {
        let snapshotData;
        try {
          snapshotData = JSON.parse(data.snapshot.snapshot_data);
        } catch {
          try {
            snapshotData = JSON.parse(data.snapshot.snapshot_data.replace(/'/g, '"'));
          } catch (conversionError) {
            this.error('Failed to parse buildable area snapshot data', conversionError);
            return;
          }
        }

        if (snapshotData.buildable_coords && snapshotData.buildable_coords.length > 0) {
          this.info('Loading existing buildable area from snapshot...');

          this.currentBuildableArea = {
            buildable_coords: snapshotData.buildable_coords,
            buildable_area_m2: snapshotData.buildable_area_m2,
            site_area_m2: snapshotData.site_area_m2,
            coverage_ratio: snapshotData.coverage_ratio,
            calculation_method: snapshotData.calculation_method
          };

          this.displayBuildableArea(snapshotData.buildable_coords, false);

          // restore inputs + warnings
          const setIf = (id, v) => {
            const el = document.getElementById(id);
            if (el && v !== undefined) {
              el.value = v;
              if (id !== 'heightLimit') {
                this.checkSetbackWarnings(id, parseFloat(v) || 0);
              }
            }
          };
          setIf('frontSetback', snapshotData.front_setback);
          setIf('backSetback', snapshotData.rear_setback);
          setIf('sideSetback', snapshotData.side_setback);
          setIf('heightLimit', snapshotData.height_limit);

          // restore selected edges
          if (snapshotData.selected_edges) {
            this.selectedEdges = snapshotData.selected_edges;
            if (this.selectedEdges.front) this.updateEdgeDisplay('front', this.selectedEdges.front.index);
            if (this.selectedEdges.back) this.updateEdgeDisplay('back', this.selectedEdges.back.index);
            this.info('Selected edges restored from snapshot');
          }

          this.showExtrusionControls();
          this.keepInputsVisible();

          if (this.selectedEdges.front && this.selectedEdges.back) {
            setTimeout(() => this.updateSetbackVisualization(), 100);
          }

          setTimeout(() => { window.eventBus?.emit?.('setbacks-applied'); }, 200);
          this.hideEdgeSelectionLabels();
        }
      }
    } catch (error) {
      this.error('Failed to load existing buildable area', error);
    }
  }

  /* -----------------------------
     Event wiring
  ------------------------------ */
  setupEventListeners() {
    // site boundary events
    window.eventBus?.on?.('site-boundary-created', (data) => {
      this.info('Site boundary created event received:', data);
      this.polygonEdges = data?.edges || [];
      this.enableSetbackTools();
    });

    window.eventBus?.on?.('site-boundary-loaded', (data) => {
      this.info('Site boundary loaded event received:', data);
      this.polygonEdges = data?.edges || [];
      this.enableSetbackTools();
    });

    window.eventBus?.on?.('site-boundary-deleted', () => {
      this.info('Site boundary deleted event received');
      this.polygonEdges = [];
      this.disableSetbackTools();
      this.clearAllSetbackData();
    });

    // comprehensive clearing
    window.eventBus?.on?.('clear-all-dependent-features', () => {
      this.info('Comprehensive clearing requested - clearing all setback data');
      this.clearAllSetbackData();
    });
    window.eventBus?.on?.('clear-all-site-data', () => {
      this.info('Complete site data clearing requested - clearing all setback data');
      this.clearAllSetbackData();
    });

    // hide labels after apply
    window.eventBus?.on?.('setbacks-applied', () => this.hideEdgeSelectionLabels());

    // check for existing boundary (now + retries)
    this.checkForExistingBoundary();
    let retryCount = 0;
    const maxRetries = 5;
    const checkInterval = setInterval(() => {
      const bm = window.siteInspectorCore?.siteBoundaryManager;
      const edges = bm?.getPolygonEdges?.();
      if (edges?.length) {
        this.info('Found existing polygon edges:', edges.length);
        this.polygonEdges = edges;
        this.enableSetbackTools();
        clearInterval(checkInterval);
        return;
      }
      if (++retryCount >= maxRetries) {
        this.info('No existing boundaries found after retries');
        clearInterval(checkInterval);
      }
    }, 500);
  }

  setupUIEventListeners() {
    const edgeSelectionBtn = document.getElementById('edgeSelectionButton');
    edgeSelectionBtn?.addEventListener('click', () => this.toggleEdgeSelectionMode());

    ['frontSetback', 'backSetback', 'sideSetback', 'heightLimit'].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      let t;
      input.addEventListener('input', () => {
        this.updateSetbackVisualization();
        const val = parseFloat(input.value);
        this.checkSetbackWarnings(id, isNaN(val) ? 0 : val);

        if (this.selectedEdges.front && this.selectedEdges.back) {
          clearTimeout(t);
          t = setTimeout(() => this.calculateBuildableAreaPreview(), 300);
        }
      });
    });

    const recalculateBtn = document.getElementById('recalculateButton');
    recalculateBtn?.addEventListener('click', () => this.recalculateBuildableArea());
  }

  setupSiteBoundaryEventListeners() {
    window.eventBus?.on?.('site-boundary-created', (data) => {
      if (data?.edges) this.cachedPolygonEdges = data.edges;
    });
    window.eventBus?.on?.('site-boundary-loaded', (data) => {
      if (data?.edges) this.cachedPolygonEdges = data.edges;
    });
    window.eventBus?.on?.('site-boundary-deleted', () => {
      this.cachedPolygonEdges = null;
    });
  }

  /* -----------------------------
     UI enable/disable
  ------------------------------ */
  enableSetbackTools() {
    const btn = document.getElementById('edgeSelectionButton');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    this.info('Setback tools enabled');
  }

  disableSetbackTools() {
    const btn = document.getElementById('edgeSelectionButton');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    this.exitEdgeSelectionMode();
    this.clearEdgeSelections();
    this.info('Setback tools disabled');
  }

  /* -----------------------------
     Edge selection flow
  ------------------------------ */
  toggleEdgeSelectionMode() {
    const button = document.getElementById('edgeSelectionButton');
    const overlay = document.getElementById('edgeSelectionOverlay');
    if (!button) return this.error('Edge selection button not found');

    if (this.isEdgeSelectionMode) {
      this.exitEdgeSelectionMode();
      button.textContent = 'Select Front & Back Edges';
      button.classList.remove('active');
      overlay?.classList.remove('show');
    } else if (this.selectedEdges.front && this.selectedEdges.back) {
      // start fresh
      this.clearEdgeSelections();
      this.startEdgeSelection();           // ensure edges are ready
      this.enterEdgeSelectionMode();
      button.textContent = 'Exit Edge Selection';
      button.classList.add('active');
      overlay?.classList.add('show');
    } else {
      this.startEdgeSelection();
      this.enterEdgeSelectionMode();
      button.textContent = 'Exit Edge Selection';
      button.classList.add('active');
      overlay?.classList.add('show');
    }
  }

  startEdgeSelection() {
    const siteBoundaryCore = window.siteInspectorCore?.siteBoundaryCore;
    if (!siteBoundaryCore) {
      this.error('Site boundary core not available');
      this.showError?.('Site boundary system not available. Please refresh the page.');
      return;
    }
    if (!siteBoundaryCore.hasSiteBoundary?.()) {
      this.warn('No site boundary available');
      this.showError?.('Please draw a site boundary first before selecting edges.');
      return;
    }

    let edges = siteBoundaryCore.getPolygonEdges?.();
    if (!edges?.length) edges = this.cachedPolygonEdges;

    if (!edges?.length) {
      this.info('No cached polygon edges, calculating from site polygon...');
      const sitePolygon = siteBoundaryCore.getSitePolygon?.();
      const ring = sitePolygon?.geometry?.coordinates?.[0];
      if (ring) edges = this.calculatePolygonEdges(ring);
      this.cachedPolygonEdges = edges;
    }

    if (!edges?.length) {
      this.warn('No polygon edges available for selection');
      this.showError?.('Unable to detect site boundary edges. Please redraw the site boundary.');
      return;
    }
    this.polygonEdges = edges;
  }

  enterEdgeSelectionMode() {
    if (!this.polygonEdges?.length) {
      this.warn('No polygon edges available for selection');
      alert('Please draw a site boundary first before selecting edges.');
      return;
    }

    this.isEdgeSelectionMode = true;
    this.map.getCanvas().style.cursor = 'crosshair';
    this._clickHandler = (e) => this.handleEdgeSelection(e);
    this.map.on('click', this._clickHandler);
    this.highlightPolygonEdges();
    this.updateOverlayPosition();
    this.info('Entered edge selection mode with', this.polygonEdges.length, 'edges');
  }

  exitEdgeSelectionMode() {
    this.isEdgeSelectionMode = false;
    this.map.getCanvas().style.cursor = '';

    if (this._clickHandler) {
      this.map.off('click', this._clickHandler);
      this._clickHandler = null;
    }

    // Always hide labels
    this.hideEdgeSelectionLabels();

    if (!this.selectedEdges.front && !this.selectedEdges.back) {
      this.clearEdgeHighlights();
    } else {
      this.removeEdgeHoverListeners();
      this.updateEdgeVisualization();
    }

    const overlay = document.getElementById('edgeSelectionOverlay');
    overlay?.classList.remove('show');
    this.info('Exited edge selection mode');
  }

  handleEdgeSelection = (e) => {
    try {
      if (!this.isEdgeSelectionMode || !e?.lngLat) return;

      const clickPoint = [e.lngLat.lng, e.lngLat.lat];
      const selectedEdge = this.findNearestEdge(clickPoint);

      if (selectedEdge) {
        if (!this.selectedEdges.front) {
          this.selectedEdges.front = selectedEdge;
          this.updateEdgeDisplay('front', selectedEdge.index);
          this.info('Front edge selected:', selectedEdge.index);
        } else if (!this.selectedEdges.back && selectedEdge.index !== this.selectedEdges.front.index) {
          this.selectedEdges.back = selectedEdge;
          this.updateEdgeDisplay('back', selectedEdge.index);
          document.getElementById('edgeSelectionOverlay')?.classList.remove('show');
          this.exitEdgeSelectionMode();
          this.updateSetbackVisualization();
          this.hideEdgeSelectionLabels();
          this.calculateBuildableAreaPreview();
          this.info('Back edge selected:', selectedEdge.index);
        }
        this.updateEdgeVisualization();
      }
    } catch (error) {
      this.error('Error in edge selection:', error);
    }
  };

  findNearestEdge(clickPoint) {
    let nearestEdge = null;
    let minDistance = Infinity;
    const threshold = 0.0001;

    this.polygonEdges.forEach(edge => {
      const distance = this.distanceToLineSegment(clickPoint, edge.start, edge.end);
      if (distance < minDistance && distance < threshold) {
        minDistance = distance;
        nearestEdge = edge;
      }
    });

    return nearestEdge;
  }

  distanceToLineSegment(point, lineStart, lineEnd) {
    const A = point[0] - lineStart[0];
    const B = point[1] - lineStart[1];
    const C = lineEnd[0] - lineStart[0];
    const D = lineEnd[1] - lineStart[1];

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) { xx = lineStart[0]; yy = lineStart[1]; }
    else if (param > 1) { xx = lineEnd[0]; yy = lineEnd[1]; }
    else { xx = lineStart[0] + param * C; yy = lineStart[1] + param * D; }

    const dx = point[0] - xx;
    const dy = point[1] - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* -----------------------------
     Edge UI / labels
  ------------------------------ */
  updateEdgeDisplay(type, edgeIndex) {
    const display = document.getElementById(`${type}EdgeDisplay`);
    const edgesDisplay = document.getElementById('selectedEdgesDisplay');

    if (display) {
      display.textContent = `Edge ${edgeIndex + 1}`;
      if (edgesDisplay) edgesDisplay.style.display = 'block';
    }
    this.toggleSetbackInputs();
  }

  toggleSetbackInputs() {
    const inputs = document.getElementById('setbackInputsContainer');
    const controls = document.getElementById('buildableAreaControls');

    if (this.selectedEdges.front && this.selectedEdges.back) {
      if (inputs) inputs.style.display = 'block';
      if (controls) controls.style.display = 'block';
      setTimeout(() => this.calculateBuildableAreaPreview(), 100);
    } else {
      if (inputs) inputs.style.display = 'none';
      if (controls) controls.style.display = 'none';
    }
  }

  showExtrusionControls() {
    const c1 = document.getElementById('buildableArea3DControls');
    const c2 = document.getElementById('extrusionControls');
    if (c1) c1.style.display = 'block';
    if (c2) c2.style.display = 'block';
  }

  hideExtrusionControls() {
    ['buildableArea3DControls', 'extrusionControls', 'remove3DButton'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  clearEdgeSelections() {
    this.selectedEdges.front = null;
    this.selectedEdges.back = null;
    this.clearEdgeHighlights();
    this.clearSetbackVisualization();
    this.remove3DExtrusion();

    this.currentBuildableArea = null;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('frontSetback', '4.5');
    set('backSetback', '3.5');
    set('sideSetback', '1.5');
    set('heightLimit', '9');

    ['selectedEdgesDisplay', 'setbackInputsContainer', 'buildableAreaControls'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const fe = document.getElementById('frontEdgeDisplay'); if (fe) fe.textContent = 'Not selected';
    const be = document.getElementById('backEdgeDisplay'); if (be) be.textContent = 'Not selected';

    const btn = document.getElementById('edgeSelectionButton');
    if (btn) { btn.textContent = 'Select Front & Back Edges'; btn.classList.remove('active'); }

    document.getElementById('edgeSelectionOverlay')?.classList.remove('show');

    this.hideExtrusionControls();
    this.hideEdgeSelectionLabels();
    this.info('Edge selections and all associated data cleared');
  }

  clearAllSetbackData() {
    try {
      this.info('Starting comprehensive setback data clearing...');
      this.clearSetbackVisualization();
      this.clearEdgeSelections();
      this.clearBuildableAreaVisualization();
      this.clearEdgeHighlights();
      this.hideEdgeSelectionLabels();

      ['frontSetback','backSetback','sideSetback','heightLimit'].forEach(id => {
        const w = document.getElementById(id + 'Warning'); if (w) w.style.display = 'none';
      });

      this.polygonEdges = [];
      this.selectedEdges = { front: null, back: null };
      this.currentBuildableArea = null;
      this.setbackOverlays = [];

      if (this.isEdgeSelectionMode) this.exitEdgeSelectionMode();

      this.hideExtrusionControls();

      if (window.siteInspectorCore?.uiPanelManager) {
        window.siteInspectorCore.uiPanelManager.hideExtrusionControls?.();
        window.siteInspectorCore.uiPanelManager.hideAllDependentPanels?.();
      }

      this.info('All setback data cleared comprehensively');
    } catch (error) {
      this.error('Error clearing all setback data:', error);
    }
  }

  clearBuildableAreaVisualization() {
    try {
      this._removeLayers([
        'buildable-area-fill',
        'buildable-area-stroke',
        'buildable-area-dimension-labels',
        'buildable-area-dimensions',
        'buildable-dimension-labels',
        'setback-dimension-labels',
        'setback-dimensions',
        'buildable-area-3d-extrusion'
      ]);
      this._removeSources([
        'buildable-area',
        'buildable-area-dimensions',
        'buildable-dimension-labels',
        'setback-dimensions',
        'buildable-area-3d'
      ]);

      this.clearSetbackVisualization();
      this.clearEdgeHighlights();
      this.hideEdgeSelectionLabels();

      this.removeLegendSetbacks();
      const legend = document.getElementById('legendContent');
      if (legend) {
        legend.querySelectorAll('.legend-buildable-area-item, .legend-3d-extrusion-item').forEach(el => el.remove());
      }

      this.info('Buildable area visualization cleared completely');
    } catch (error) {
      this.error('Error clearing buildable area visualization:', error);
    }
  }

  highlightPolygonEdges() {
    this.clearEdgeHighlights();
    if (!this.polygonEdges.length) {
      this.warn('No polygon edges to highlight');
      return;
    }

    this.info('Highlighting', this.polygonEdges.length, 'polygon edges');
    this.polygonEdges.forEach((edge, index) => {
      if (!edge?.start?.length || !edge?.end?.length) {
        this.warn('Invalid edge data at index', index, edge);
        return;
      }

      const sourceId = `edge-highlight-${index}`;
      const layerId = `edge-highlight-${index}`;

      // remove old
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);

      // add source
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [edge.start, edge.end] },
          properties: { edgeIndex: index }
        }
      });
      // add line layer (BUGFIX)
      this.map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#007cbf',
          'line-width': 3,
          'line-opacity': 0.6
        }
      });

      this.addEdgeLabel(edge, index);
      this.addEdgeHoverEffects(index);
    });

    this.info('Edge highlighting completed');
  }

  addEdgeHoverEffects(index) {
    const layerId = `edge-highlight-${index}`;
    const enter = () => {
      if (!this.isEdgeSelectionMode) return;
      this.map.getCanvas().style.cursor = 'pointer';
      if (this.isEdgeSelected(index)) {
        const isFront = this.selectedEdges.front && this.selectedEdges.front.index === index;
        this.map.setPaintProperty(layerId, 'line-color', isFront ? '#34ce57' : '#e14752');
        this.map.setPaintProperty(layerId, 'line-width', 7);
        this.map.setPaintProperty(layerId, 'line-opacity', 1);
      } else {
        this.map.setPaintProperty(layerId, 'line-color', '#0096d6');
        this.map.setPaintProperty(layerId, 'line-width', 6);
        this.map.setPaintProperty(layerId, 'line-opacity', 1);
      }
    };
    const leave = () => {
      if (!this.isEdgeSelectionMode) return;
      this.map.getCanvas().style.cursor = 'crosshair';
      if (!this.isEdgeSelected(index)) {
        this.map.setPaintProperty(layerId, 'line-color', '#007cbf');
        this.map.setPaintProperty(layerId, 'line-width', 3);
        this.map.setPaintProperty(layerId, 'line-opacity', 0.6);
      } else {
        this.updateEdgeVisualization();
      }
    };

    this.map.on('mouseenter', layerId, enter);
    this.map.on('mouseleave', layerId, leave);
    this._edgeHoverHandlers[index] = { enter, leave };
  }

  updateEdgeVisualization() {
    this.polygonEdges.forEach((_, index) => {
      const layerId = `edge-highlight-${index}`;
      if (!this.map.getLayer(layerId)) return;

      let color = '#007cbf', width = 3, opacity = 0.6;
      if (this.selectedEdges.front?.index === index) { color = '#28a745'; width = 6; opacity = 1; }
      else if (this.selectedEdges.back?.index === index) { color = '#dc3545'; width = 6; opacity = 1; }

      this.map.setPaintProperty(layerId, 'line-color', color);
      this.map.setPaintProperty(layerId, 'line-width', width);
      this.map.setPaintProperty(layerId, 'line-opacity', opacity);
    });

    this.updateEdgeLabels();
  }

  isEdgeSelected(edgeIndex) {
    return (this.selectedEdges.front?.index === edgeIndex) || (this.selectedEdges.back?.index === edgeIndex);
  }

  removeEdgeHoverListeners() {
    this.polygonEdges.forEach((_, index) => {
      const layerId = `edge-highlight-${index}`;
      const h = this._edgeHoverHandlers[index];
      if (h) {
        this.map.off('mouseenter', layerId, h.enter);
        this.map.off('mouseleave', layerId, h.leave);
        delete this._edgeHoverHandlers[index];
      }
    });
  }

  clearEdgeHighlights() {
    this.removeEdgeHoverListeners();
    this.polygonEdges.forEach((_, index) => {
      const layerId = `edge-highlight-${index}`;
      const sourceId = `edge-highlight-${index}`;
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
      this.removeEdgeLabel(index);
    });
  }

  addEdgeLabel(edge, index) {
    if (typeof mapboxgl === 'undefined' || !mapboxgl.Popup) return;

    const labelPosition = edge.midpoint;
    let labelText = `Edge ${index + 1}`;
    let labelClass = 'edge-label-popup';
    if (this.selectedEdges.front?.index === index) { labelText = `Front Edge ${index + 1}`; labelClass += ' front-edge'; }
    else if (this.selectedEdges.back?.index === index) { labelText = `Back Edge ${index + 1}`; labelClass += ' back-edge'; }

    const popup = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, className: 'edge-label-popup-container', anchor: 'center', offset: [0, 0]
    })
      .setLngLat(labelPosition)
      .setHTML(`<div class="${labelClass}" data-edge-index="${index}" style="color:#333;background:rgba(255,255,255,0.9);padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600;border:1px solid rgba(0,0,0,0.1);">${labelText}</div>`)
      .addTo(this.map);

    const labelElement = popup.getElement().querySelector('.edge-label-popup');
    if (labelElement) {
      labelElement.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.isEdgeSelectionMode) return;
        const selectedEdge = this.polygonEdges[index];
        if (!selectedEdge) return;

        if (!this.selectedEdges.front) {
          this.selectedEdges.front = selectedEdge;
          this.updateEdgeDisplay('front', selectedEdge.index);
          this.info('Front edge selected via label:', selectedEdge.index, this.selectedEdges);
        } else if (!this.selectedEdges.back && selectedEdge.index !== this.selectedEdges.front.index) {
          this.selectedEdges.back = selectedEdge;
          this.updateEdgeDisplay('back', selectedEdge.index);
          document.getElementById('edgeSelectionOverlay')?.classList.remove('show');
          this.exitEdgeSelectionMode();
          this.updateSetbackVisualization();
          this.hideEdgeSelectionLabels();

          if (this.selectedEdges.front && this.selectedEdges.back) {
            this.info('Both edges confirmed selected, triggering preview');
            this.calculateBuildableAreaPreview();
          }
        }
        this.updateEdgeVisualization();
      });
    }

    this.edgeLabels[index] = popup;
    this.edgePopups.push(popup);
  }

  removeEdgeLabel(index) {
    if (this.edgeLabels?.[index]) {
      try { this.edgeLabels[index].remove(); } catch {}
      delete this.edgeLabels[index];
    }
  }

  updateEdgeLabels() {
    this.polygonEdges.forEach((edge, index) => {
      this.removeEdgeLabel(index);
      this.addEdgeLabel(edge, index);
    });
  }

  hideEdgeSelectionLabels() {
    try {
      Object.values(this.edgeLabels).forEach(p => { try { p?.remove?.(); } catch {} });
      this.edgeLabels = {};
      this.edgePopups.forEach(p => { try { p?.remove?.(); } catch {} });
      this.edgePopups = [];
      document.querySelectorAll('.mapboxgl-popup').forEach(el => {
        try { if (el.querySelector('.edge-label-popup')) el.remove(); } catch {}
      });
      this.info('Edge selection labels hidden and cleaned up');
    } catch (error) {
      this.error('Error in hideEdgeSelectionLabels:', error);
    }
  }

  /* -----------------------------
     Setback visualization
  ------------------------------ */
  updateSetbackVisualization() {
    if (!this.selectedEdges.front || !this.selectedEdges.back) {
      this.info('Front and back edges not selected yet');
      return;
    }
    this.clearSetbackVisualization();

    const gi = (id, def) => {
      const n = parseFloat(document.getElementById(id)?.value);
      return isNaN(n) ? def : n;
    };
    const frontSetback = gi('frontSetback', 4.5);
    const backSetback  = gi('backSetback', 3.5);
    const sideSetback  = gi('sideSetback', 1.5);

    this.info('Updating setback visualization:', { front: frontSetback, back: backSetback, side: sideSetback });
    this.createSetbackLines(frontSetback, backSetback, sideSetback, sideSetback);
    this.updateLegendWithSetbacks(frontSetback, backSetback, sideSetback);
  }

  createSetbackLines(frontSetback, backSetback, leftSetback, rightSetback) {
    try {
      // No dashed lines; buildable area polygon shows boundaries
      this.info('Setback calculation completed - buildable area shows setback boundaries');
    } catch (error) {
      this.error('Error in setback processing:', error);
    }

    window.eventBus?.emit?.('setbacks-updated', {
      front: frontSetback, back: backSetback, left: leftSetback, right: rightSetback,
      selectedEdges: this.selectedEdges
    });
  }

  clearSetbackVisualization() {
    try {
      this._removeLayers(['setback-lines', 'setback-fill', 'setback-labels']);
      this._removeSources(['setback-lines', 'setback-fill', 'setback-labels']);
      this.info('Setback visualization cleared');
    } catch (error) {
      this.error('Error clearing setback visualization:', error);
    }
  }

  updateLegendWithSetbacks(frontSetback, backSetback /*, sideSetback*/) {
    const legendContent = document.getElementById('legendContent');
    if (!legendContent) return;

    this.removeLegendSetbacks();

    const buildableAreaItem = legendContent.querySelector('.legend-buildable-area-item');
    if (buildableAreaItem) buildableAreaItem.style.display = 'flex';

    const mk = (html) => { const d = document.createElement('div'); d.className = 'legend-item legend-setback-item'; d.innerHTML = html; return d; };

    legendContent.appendChild(mk(`
      <div class="legend-color" style="background-color:#28a745;width:16px;height:3px;border-radius:0;"></div>
      <span class="legend-label">Front Setback</span>
    `));
    legendContent.appendChild(mk(`
      <div class="legend-color" style="background-color:#dc3545;width:16px;height:3px;border-radius:0;"></div>
      <span class="legend-label">Back Setback</span>
    `));
    this.info('Legend updated with setback information');
  }

  removeLegendSetbacks() {
    const legendContent = document.getElementById('legendContent');
    if (!legendContent) return;

    // BUGFIX: class name consistent with creation
    const buildableAreaItem = legendContent.querySelector('.legend-buildable-area-item');
    if (buildableAreaItem) buildableAreaItem.style.display = 'none';

    legendContent.querySelectorAll('.legend-setback-item:not(.legend-buildable-area-item)').forEach(item => item.remove());
  }

  /* -----------------------------
     Buildable area compute hooks
  ------------------------------ */
  async calculateBuildableAreaPreview() {
    if (!this.selectedEdges.front || !this.selectedEdges.back) return;

    try {
      const gi = (id, def) => {
        const n = parseFloat(document.getElementById(id)?.value);
        return isNaN(n) ? def : n;
      };
      const payload = {
        frontSetback: gi('frontSetback', 4.5),
        backSetback : gi('backSetback', 3.5),
        sideSetback : gi('sideSetback', 1.5),
        heightLimit : gi('heightLimit', 9),
        selectedEdges: this.selectedEdges,
        polygonEdges : this.polygonEdges,
        isPreview   : true
      };

      this.info('Calculating buildable area preview with setbacks:', payload);
      window.eventBus?.emit?.('preview-buildable-area', payload);
    } catch (error) {
      this.error('Preview calculation failed:', error);
    }
  }

  async recalculateBuildableArea() {
    const button = document.getElementById('recalculateButton');
    const originalText = button?.textContent || 'Calculate';

    if (!this.selectedEdges?.front || !this.selectedEdges?.back ||
        this.selectedEdges.front.index === undefined || this.selectedEdges.back.index === undefined) {
      this.warn('Edge validation failed:', {
        selectedEdges: this.selectedEdges,
        hasFront: !!this.selectedEdges?.front,
        hasBack: !!this.selectedEdges?.back
      });
      alert('Please select both front and back edges first');
      return;
    }

    try {
      if (button) { button.textContent = 'Calculating...'; button.disabled = true; }

      const gi = (id, def) => {
        const n = parseFloat(document.getElementById(id)?.value);
        return isNaN(n) ? def : n;
      };

      const payload = {
        frontSetback: gi('frontSetback', 4.5),
        backSetback : gi('backSetback', 3.5),
        sideSetback : gi('sideSetback', 1.5),
        heightLimit : gi('heightLimit', 9),
        selectedEdges: this.selectedEdges,
        polygonEdges : this.polygonEdges
      };

      this.info('Recalculating buildable area with setbacks:', payload);
      window.eventBus?.emit?.('recalculate-buildable-area', payload);

      setTimeout(() => {
        if (button) { button.textContent = originalText; button.disabled = false; }
      }, 2000);
    } catch (error) {
      this.error('Recalculation failed:', error);
      alert('Failed to recalculate buildable area');
      if (button) { button.textContent = originalText; button.disabled = false; }
    }
  }

  /* -----------------------------
     3D Extrusion helpers (optional)
  ------------------------------ */
  async extrudeBuildableArea() {
    if (!this.currentBuildableArea?.buildable_coords) {
      alert('Please calculate buildable area first before extruding');
      return;
    }
    const heightLimit = parseFloat(document.getElementById('heightLimit')?.value) || 9;

    try {
      this.info('Extruding buildable area to height:', heightLimit + 'm');

      const coords = this.currentBuildableArea.buildable_coords.map(c => this._normalizeLngLat(c));
      this.add3DExtrusionLayer(coords, heightLimit);
      this.updateLegendWith3DExtrusion(heightLimit);
      const btn = document.getElementById('remove3DButton');
      if (btn) btn.style.display = 'block';

      this.info('Buildable area extruded successfully to', heightLimit + 'm height');
    } catch (error) {
      this.error('Failed to extrude buildable area:', error);
      alert('Failed to extrude buildable area: ' + error.message);
    }
  }

  add3DExtrusionLayer(coordinates, height) {
    try {
      this._removeLayers(['buildable-area-3d-extrusion']);
      this._removeSources(['buildable-area-3d']);

      // ensure closed ring
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);

      this.map.addSource('buildable-area-3d', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coordinates] },
          properties: { height, type: 'buildable-area-3d' }
        }
      });

      this.map.addLayer({
        id: 'buildable-area-3d-extrusion',
        type: 'fill-extrusion',
        source: 'buildable-area-3d',
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'height'],
            0, '#4a90e2',
            50, '#2c5aa0'
          ],
          'fill-extrusion-height': height,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.4,
          'fill-extrusion-vertical-gradient': true
        }
      });

      const centerLng = coordinates.reduce((s, c) => s + c[0], 0) / coordinates.length;
      const centerLat = coordinates.reduce((s, c) => s + c[1], 0) / coordinates.length;

      this.map.easeTo({ center: [centerLng, centerLat], zoom: 18, pitch: 60, bearing: -30, duration: 2000 });
      this.info(`3D extrusion layer added with ${height}m height`);
    } catch (error) {
      this.error('Error adding 3D extrusion layer:', error);
      throw error;
    }
  }

  updateLegendWith3DExtrusion(height) {
    const legendContent = document.getElementById('legendContent');
    if (!legendContent) return;

    const existing = legendContent.querySelector('.legend-3d-extrusion-item');
    if (existing) existing.remove();

    const d = document.createElement('div');
    d.className = 'legend-item legend-3d-extrusion-item';
    d.innerHTML = `
      <div class="legend-color" style="background:linear-gradient(45deg,#4a90e2,#6ba3f0);opacity:0.8;"></div>
      <span class="legend-label">3D Buildable Volume (${height}m)</span>
    `;
    legendContent.appendChild(d);
  }

  remove3DExtrusion() {
    try {
      this._removeLayers(['buildable-area-3d-extrusion']);
      this._removeSources(['buildable-area-3d']);

      const legendContent = document.getElementById('legendContent');
      legendContent?.querySelector('.legend-3d-extrusion-item')?.remove();

      this.map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
      this.info('3D extrusion removed');
    } catch (error) {
      this.error('Error removing 3D extrusion:', error);
    }
  }

  /* -----------------------------
     Panel / overlay helpers
  ------------------------------ */
  updateOverlayPosition() {
    const overlay = document.getElementById('edgeSelectionOverlay');
    const panel = document.getElementById('inspectorPanel');
    if (!overlay || !panel) return;
    if (panel.classList.contains('expanded')) overlay.classList.add('shifted');
    else overlay.classList.remove('shifted');
  }

  checkForExistingBoundary() {
    const bm = window.siteInspectorCore?.siteBoundaryManager;
    if (bm?.hasSiteBoundary?.() && bm?.getPolygonEdges) {
      const edges = bm.getPolygonEdges();
      if (edges?.length) {
        this.info('Found existing site boundary with', edges.length, 'edges');
        this.polygonEdges = edges;
        this.enableSetbackTools();
        return true;
      }
    }
    return false;
  }

  getSelectedEdges() { return this.selectedEdges; }

  hasSelectedEdges() {
    const hasBoth = !!(this.selectedEdges?.front && this.selectedEdges?.back &&
                       this.selectedEdges.front.index !== undefined &&
                       this.selectedEdges.back.index !== undefined);
    if (!hasBoth) {
      this.warn('hasSelectedEdges validation failed:', {
        selectedEdges: this.selectedEdges,
        hasFront: !!this.selectedEdges?.front,
        hasBack: !!this.selectedEdges?.back,
        frontIndex: this.selectedEdges?.front?.index,
        backIndex: this.selectedEdges?.back?.index
      });
    }
    return hasBoth;
  }

  getCurrentBuildableArea() { return this.currentBuildableArea; }

  getCurrentHeightLimit() {
    const el = document.getElementById('heightLimit');
    return el ? (parseFloat(el.value) || 9) : 9;
  }

  keepInputsVisible() {
    // single, non-duplicated version
    const ids = ['setbackInputsContainer', 'buildableAreaControls', 'selectedEdgesDisplay'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; });
    this.info('Input containers kept visible for existing buildable area');
  }

  /* -----------------------------
     Buildable area display + dimensions
  ------------------------------ */
  displayBuildableArea(buildableCoords, isPreview = false) {
    try {
      this._removeLayers(['buildable-area-fill', 'buildable-area-stroke']);
      this._removeSources(['buildable-area']);

      if (buildableCoords?.length) {
        let coordinates = buildableCoords.map(c => this._normalizeLngLat(c));

        const first = coordinates[0];
        const last  = coordinates[coordinates.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);

        this.map.addSource('buildable-area', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [coordinates] },
            properties: { type: 'buildable-area', is_preview: isPreview }
          }
        });

        const fillColor   = '#002040';
        const fillOpacity = isPreview ? 0.2 : 0.4;
        const strokeColor = '#002040';
        const strokeOpacity = isPreview ? 0.7 : 0.8;
        const strokeWidth = isPreview ? 2 : 3;

        this.map.addLayer({
          id: 'buildable-area-fill',
          type: 'fill',
          source: 'buildable-area',
          paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity }
        });

        this.map.addLayer({
          id: 'buildable-area-stroke',
          type: 'line',
          source: 'buildable-area',
          paint: { 'line-color': strokeColor, 'line-width': strokeWidth, 'line-opacity': strokeOpacity }
        });

        this.generateBuildableAreaDimensions(coordinates);
        if (!isPreview) this.info(`Buildable area displayed on map with ${coordinates.length - 1} vertices`);
      }
    } catch (error) {
      this.error('Error displaying buildable area:', error);
    }
  }

  generateBuildableAreaDimensions(coordinates) {
    try {
      this._removeSources(['buildable-area-dimensions']);

      const dimensionFeatures = [];
      for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end   = coordinates[i + 1];

        const startCoord = this._normalizeLngLat(start);
        const endCoord   = this._normalizeLngLat(end);

        const midpoint = [(startCoord[0] + endCoord[0]) / 2, (startCoord[1] + endCoord[1]) / 2];
        const distance = this.calculateDistance(
          { lng: startCoord[0], lat: startCoord[1] },
          { lng: endCoord[0],   lat: endCoord[1] }
        );

        dimensionFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: midpoint },
          properties: { distance: `${distance.toFixed(1)}m`, edge_index: i, type: 'buildable-dimension' }
        });
      }

      this.map.addSource('buildable-area-dimensions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: dimensionFeatures }
      });

      setTimeout(() => {
        if (!this.map.getLayer('buildable-area-dimension-labels')) {
          this.map.addLayer({
            id: 'buildable-area-dimension-labels',
            type: 'symbol',
            source: 'buildable-area-dimensions',
            layout: {
              'text-field': ['get', 'distance'],
              'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-size': 12,
              'text-offset': [0, -1],
              'text-anchor': 'center',
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'visibility': 'visible'
            },
            paint: { 'text-color': '#0066cc', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
          });
        } else {
          this.map.setLayoutProperty('buildable-area-dimension-labels', 'visibility', 'visible');
        }

        const mfm = window.siteInspectorCore?.mapFeaturesManager;
        if (mfm && mfm.areDimensionsVisible && !mfm.areDimensionsVisible()) {
          this.map.setLayoutProperty('buildable-area-dimension-labels', 'visibility', 'none');
        }
      }, 100);

      this.info(`Generated ${dimensionFeatures.length} buildable area dimension labels`);
    } catch (error) {
      this.error('Error generating buildable area dimensions:', error);
    }
  }

  /* -----------------------------
     Utils
  ------------------------------ */
  calculateDistance(point1, point2) {
    const R = 6371000; // meters
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;

    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  isValidCoordinate(coord) {
    return coord && coord.length >= 2 &&
           typeof coord[0] === 'number' && typeof coord[1] === 'number' &&
           !isNaN(coord[0]) && !isNaN(coord[1]);
  }

  calculatePolygonEdges(coordinates) {
    const edges = [];
    if (!coordinates || coordinates.length < 3) return edges;

    try {
      let coords = coordinates;
      if (coords.length > 3 &&
          coords[0][0] === coords[coords.length - 1][0] &&
          coords[0][1] === coords[coords.length - 1][1]) {
        coords = coords.slice(0, -1);
      }

      for (let i = 0; i < coords.length; i++) {
        const start = coords[i];
        const end   = coords[(i + 1) % coords.length];
        if (this.isValidCoordinate(start) && this.isValidCoordinate(end)) {
          edges.push({
            index: i,
            start,
            end,
            midpoint: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
          });
        }
      }

      this.info(`Calculated ${edges.length} polygon edges from coordinates`);
      return edges;
    } catch (error) {
      this.error('Error calculating polygon edges:', error);
      return [];
    }
  }

  _normalizeLngLat([a, b]) {
    // If it *looks* like [lat, lng], swap to [lng, lat]
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];
    return [a, b];
  }

  _removeLayers(ids) {
    ids.forEach(id => {
      try { if (this.map.getLayer(id)) this.map.removeLayer(id); }
      catch (e) { this.warn(`Error removing layer ${id}:`, e); }
    });
  }

  _removeSources(ids) {
    ids.forEach(id => {
      try { if (this.map.getSource(id)) this.map.removeSource(id); }
      catch (e) { this.warn(`Error removing source ${id}:`, e); }
    });
  }
}

window.PropertySetbacksManager = PropertySetbacksManager;