/**
 * Site Inspector Core
 * Main orchestrator for the modular site inspector system
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

class SiteInspectorCore extends BaseManager {
  constructor() {
    super('SiteInspectorCore');

    this.map = null;
    this.draw = null;
    this.siteData = {};

    // Manager instances
    this.siteBoundaryCore = null;
    this.propertySetbacksManager = null;
    this.floorplanManager = null;
    this.mapFeaturesManager = null;
    this.uiPanelManager = null;
    this.extrusion3DManager = null;

    this.isInitialized = false;

    // Teardown helpers
    this._abort = new AbortController(); // DOM + fetch lifetimes
    this._mapHandlers = [];              // mapbox 'on' handlers to clean later: [event, handler]
    this._busUnsubs = [];                // eventBus unsubs if available
  }

  async initialize() {
    try {
      this.info('🚀 Starting Site Inspector initialization...');

      if (!this.validateDependencies()) {
        throw new Error('Required dependencies not available (MapboxGL)');
      }

      // Clear any stale session storage from previous sessions
      this.clearStaleSessionData();

      this.loadSiteData();

      // Resolve address before map init to get center if possible
      const addressLoaded = await this.loadProjectAddress();
      if (!addressLoaded && !this.siteData.center) {
        // Default to Auckland if nothing found
        this.siteData.center = { lat: -36.8485, lng: 174.7633 };
        this.warn('Project address unavailable; using default Auckland center');
      }

      await this.initializeMap();
      await this.initializeManagers();
      this.setupEventHandlers();

      this.isInitialized = true;

      const mapLoading = document.getElementById('mapLoading');
      if (mapLoading) mapLoading.style.display = 'none';

      this.info('✅ Site Inspector initialization completed successfully');
    } catch (error) {
      this.error('❌ Site Inspector initialization failed:', error);
      this.showMapError(error.message || 'Unknown initialization error');
      this.attemptRecovery();
    }
  }

  /* -----------------------------
     Boot helpers
  ------------------------------ */
  clearStaleSessionData() {
    try {
      // Check URL parameters for forced clearing
      const urlParams = new URLSearchParams(window.location.search);
      const forceClear = urlParams.get('clear') === 'true' || urlParams.get('reset') === 'true';

      // Check if we're entering the site inspector fresh (no active site boundary)
      const hasActiveBoundary = this.siteData?.coordinates?.length > 0;

      if (!hasActiveBoundary || forceClear) {
        const staleKeys = [
          'site_boundary_data',
          'buildable_area_data',
          'setback_data',
          'structure_data',
          'edge_classifications',
          'edge_selections',
          'site_inspector_state',
          'boundary_confirmed',
          'setbacks_applied',
          'structure_created',
          'extrusion_applied'
        ];

        staleKeys.forEach(key => {
          if (sessionStorage.getItem(key)) {
            sessionStorage.removeItem(key);
            this.info(`Cleared ${forceClear ? 'forced' : 'stale'} session data: ${key}`);
          }
        });

        if (forceClear) {
          this.info('Session storage force-cleared due to URL parameter');
          // Remove the parameter from URL to clean up
          urlParams.delete('clear');
          urlParams.delete('reset');
          const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
          window.history.replaceState({}, '', newUrl);
        }
      }
    } catch (error) {
      this.warn('Error clearing stale session data:', error);
    }
  }

  loadSiteData() {
    if (typeof window.siteData !== 'undefined' && window.siteData) {
      this.siteData = window.siteData;
      this.info('Site data loaded from template');
    } else {
      this.siteData = {
        ready_for_new_polygon: true,
        area: 0,
        area_m2: 0,
        type: 'residential',
        coordinates: [],
        center: null
      };
    }
  }

  validateDependencies() {
    return typeof mapboxgl !== 'undefined';
  }

  async loadProjectAddress() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let projectId = urlParams.get('project_id') || urlParams.get('project');

      if (projectId && projectId.includes('?')) {
        projectId = projectId.split('?')[0];
        this.info('Cleaned malformed project ID from URL:', projectId);
      }

      if (!projectId) {
        projectId = sessionStorage.getItem('project_id')
          || sessionStorage.getItem('current_project_id')
          || sessionStorage.getItem('selectedProjectId');
      }

      const sessionProjectAddress = sessionStorage.getItem('current_project_address')
        || sessionStorage.getItem('project_site_address');

      if (sessionProjectAddress && sessionProjectAddress !== 'undefined' && sessionProjectAddress.trim() !== '') {
        this.info('✅ Using project address from session:', sessionProjectAddress);
        this.siteData.project_address = sessionProjectAddress;
        return await this.geocodeProjectAddress(sessionProjectAddress);
      }

      if (!projectId || !/^\d+$/.test(String(projectId).trim())) {
        if (window.projectData?.address?.trim()) {
          this.siteData.project_address = window.projectData.address;
          this.info('✅ Using project address from template:', window.projectData.address);
          return await this.geocodeProjectAddress(window.projectData.address);
        }
        return false;
      }

      projectId = String(projectId).trim();
      this.info('Loading project address for project ID:', projectId);

      try {
        const response = await fetch(`/api/project-address?project_id=${projectId}`, { signal: this._abort.signal });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.site_address?.trim()) {
            this.siteData.project_address = data.site_address;
            this.info('✅ Project address loaded from API:', data.site_address);

            sessionStorage.setItem('current_project_address', data.site_address);
            sessionStorage.setItem('current_project_id', projectId);

            if (data.location?.lat && data.location?.lng) {
              this.siteData.center = { lat: parseFloat(data.location.lat), lng: parseFloat(data.location.lng) };
              this.info('✅ Project coordinates from API:', this.siteData.center);
              return true;
            }
            this.info('🌍 Geocoding project address from API:', data.site_address);
            return await this.geocodeProjectAddress(data.site_address);
          }
          this.warn('No valid site address in API response:', data);
        } else {
          this.warn('Failed to fetch project address, status:', response.status);
        }
      } catch (err) {
        this.warn('Failed to fetch project address from API:', err.message);
      }

      if (window.projectData?.address?.trim()) {
        this.siteData.project_address = window.projectData.address;
        this.info('✅ Using project address from template fallback:', window.projectData.address);
        sessionStorage.setItem('current_project_address', window.projectData.address);
        if (projectId) sessionStorage.setItem('current_project_id', projectId);
        return await this.geocodeProjectAddress(window.projectData.address);
      }

      this.warn('No project address found from any source');
      return false;
    } catch (error) {
      this.error('Error loading project address:', error);
      return false;
    }
  }

  async geocodeProjectAddress(address) {
    try {
      this.info('🌍 Geocoding project address:', address);
      const cacheKey = `geocode_${btoa(address)}`;
      const cached = this.getFromCache(cacheKey);
      if (cached && cached.timestamp > Date.now() - 86400000) {
        this.info('✅ Using cached geocoding result');
        this.siteData.center = cached.center;
        return true;
      }

      const response = await fetch('/api/geocode-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: address }),
        signal: this._abort.signal
      });

      if (!response.ok) {
        this.warn(`Geocoding API returned ${response.status} ${response.statusText}`);
        return false;
      }

      const data = await response.json();
      if (data.success && data.location?.lat && data.location?.lng) {
        this.siteData.center = { lat: parseFloat(data.location.lat), lng: parseFloat(data.location.lng) };
        this.setCache(cacheKey, { center: this.siteData.center, timestamp: Date.now() });
        this.info('✅ Geocoded successfully:', this.siteData.center);
        return true;
      }

      this.warn('Geocoding failed - invalid coordinates:', data.error || 'Unknown error');
      return false;
    } catch (error) {
      this.error('Error geocoding project address:', error);
      return false;
    }
  }

  getFromCache(key) {
    try { return JSON.parse(localStorage.getItem(`siteInspector_${key}`)) || null; }
    catch { return null; }
  }

  setCache(key, data) {
    try { localStorage.setItem(`siteInspector_${key}`, JSON.stringify(data)); }
    catch (e) { this.warn('Failed to cache data:', e); }
  }

  /* -----------------------------
     Map init + draw
  ------------------------------ */
  async initializeMap() {
    this.info('Initializing Mapbox map...');
    const mapContainer = document.getElementById('inspectorMap');
    if (!mapContainer) throw new Error('Map container element not found');

    if (typeof mapboxgl === 'undefined') throw new Error('MapboxGL library not loaded');
    if (typeof MapboxDraw === 'undefined') this.warn('MapboxDraw library not loaded - drawing limited');

    let tokenData;
    try {
      tokenData = await this.getMapboxTokenWithRetry();
    } catch (err) {
      this.error('Failed to get Mapbox token:', err);
      throw new Error('Unable to authenticate with Mapbox services');
    }
    mapboxgl.accessToken = tokenData.token;

    let center = [174.7762, -41.2865]; // Wellington fallback
    let zoom = 13;
    if (this.siteData.center?.lat && this.siteData.center?.lng) {
      center = [this.siteData.center.lng, this.siteData.center.lat];
      zoom = 17;
      this.info('✅ Using project location for map center:', center, 'for address:', this.siteData.project_address);
    } else {
      this.warn('⚠️ No project coordinates available, using fallback:', center);
    }

    this.map = new mapboxgl.Map({
      container: 'inspectorMap',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center, zoom, pitch: 0, bearing: 0,
      attributionControl: false,
      logoPosition: 'bottom-left',
      maxZoom: 22,
      minZoom: 8
    });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Map loading timeout')), 15000);

      const onLoad = async () => {
        clearTimeout(t);
        try {
          this.setupMapControls();
          this.setup3DTerrain();
          this.info('Map loaded');

          if (!this.siteData.center && this.siteData.project_address) {
            this.info('📍 Geocoding project address post-load:', this.siteData.project_address);
            const ok = await this.geocodeProjectAddress(this.siteData.project_address);
            if (ok && this.siteData.center) {
              this.map.flyTo({ center: [this.siteData.center.lng, this.siteData.center.lat], zoom: 17, essential: true });
              this.info('✅ Recentered to project location');
            }
          }

          if (this.siteData.center) {
            await this.loadPropertyBoundaries(this.siteData.center.lat, this.siteData.center.lng);
            this.updatePropertyBoundaryLegend(true);
          }

          resolve();
        } catch (e) {
          reject(e);
        }
      };

      const onError = (e) => {
        clearTimeout(t);
        reject(new Error(`Map error: ${e.error?.message || 'Unknown map error'}`));
      };

      this.map.on('load', onLoad);
      this._mapHandlers.push(['load', onLoad]);

      this.map.on('error', onError);
      this._mapHandlers.push(['error', onError]);
    });
  }

  async initializeDrawControl() {
    this.info('Creating MapboxDraw instance...');
    if (typeof MapboxDraw === 'undefined') { this.draw = null; return; }

    if (!this.map.isStyleLoaded()) {
      this.info('Waiting for style load before initializing draw…');
      await new Promise((res) => {
        const handler = () => { this.map.off('styledata', handler); res(); };
        this.map.on('styledata', handler);
        this._mapHandlers.push(['styledata', handler]);
      });
    }

    const config = window.SiteInspectorConfig || {
      get: (k) => {
        const defaults = {
          'colors.primary': '#007cbf',
          'drawing.previewOpacity': 0.2,
          'drawing.lineWidth': 2,
          'drawing.activeLineWidth': 3
        };
        return defaults[k] ?? (k.includes('Opacity') ? 0.2 : 2);
      }
    };

    try {
      this.draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'simple_select',
        styles: [
          { id: 'gl-draw-polygon-fill-inactive', type: 'fill',
            filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: { 'fill-color': config.get('colors.primary'), 'fill-opacity': config.get('drawing.previewOpacity') } },
          { id: 'gl-draw-polygon-stroke-inactive', type: 'line',
            filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: { 'line-color': config.get('colors.primary'), 'line-width': config.get('drawing.lineWidth') } },
          { id: 'gl-draw-polygon-fill-active', type: 'fill',
            filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
            paint: { 'fill-color': config.get('colors.primary'), 'fill-opacity': config.get('drawing.previewOpacity') + 0.1 } },
          { id: 'gl-draw-polygon-stroke-active', type: 'line',
            filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
            paint: { 'line-color': config.get('colors.primary'), 'line-width': config.get('drawing.activeLineWidth') } },
          { id: 'gl-draw-line-active', type: 'line',
            filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'LineString']],
            paint: { 'line-color': config.get('colors.primary'), 'line-width': config.get('drawing.activeLineWidth'), 'line-dasharray': [2, 2] } },
          { id: 'gl-draw-point-active', type: 'circle',
            filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Point']],
            paint: { 'circle-radius': 6, 'circle-color': config.get('colors.primary'), 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
          { id: 'gl-draw-point-inactive', type: 'circle',
            filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point']],
            paint: { 'circle-radius': 4, 'circle-color': config.get('colors.primary'), 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } }
        ]
      });

      await new Promise(r => setTimeout(r, 100));
      this.map.addControl(this.draw);
      await new Promise(r => setTimeout(r, 150));
      this.info('✅ Draw control added');
    } catch (e) {
      this.error('Failed to set up MapboxDraw:', e);
      this.draw = null;
    }
  }

  async getMapboxTokenWithRetry() {
    const res = await fetch('/api/mapbox-token', { signal: this._abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (!data.success || !data.token) throw new Error(data.error || 'No token in response');
    return data;
  }

  setupMapControls() {
    try {
      // Hide Mapbox logo by setting display: none
      const logoDiv = document.querySelector('.mapboxgl-ctrl-logo');
      if (logoDiv) logoDiv.style.display = 'none';

      // Add controls
      this.map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-right');
      this.map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');

      // Ensure logo stays hidden (in case it renders late)
      const onLoad = () => {
        const logo = document.querySelector('.mapboxgl-ctrl-logo');
        if (logo) logo.style.display = 'none';
      };
      this.map.on('load', onLoad);
      this._mapHandlers.push(['load', onLoad]);

      this.info('✅ Map controls added with hidden logo and repositioned scale');
    } catch (error) {
      this.error('Failed to add map controls:', error);
    }
  }

  /* -----------------------------
     Managers
  ------------------------------ */
  async initializeManagers() {
    this.info('Initializing manager modules...');
    if (!this.map) throw new Error('Map not initialized before managers');

    await this.initializeDrawControl();

    // UIPanelManager first for immediate UI
    try {
      this.uiPanelManager = new UIPanelManager();
      await this.uiPanelManager.initialize?.();
      this.info('✅ UIPanelManager initialized');
    } catch (error) {
      this.error('Failed to initialize UIPanelManager:', error);
      this.uiPanelManager = {
        initialize: () => Promise.resolve(),
        showError: (msg) => alert(msg),
        showSuccess: (msg) => console.log(msg),
        toggleInspectorPanel: () => {},
        toggleSiteInfoExpanded: () => {},
        updateBoundaryAppliedState: () => {},
        resetAllPanelStates: () => {},
        destroy: () => {}
      };
    }

    const initResults = {
        mapFeatures: await this.initializeManager('mapFeatures', () => new MapFeaturesManager(this.map)),
        extrusion3D: await this.initializeManager('extrusion3D', () => new Extrusion3DManager(this.map)),
        floorplan: await this.initializeManager('floorplan', () => new FloorplanManager(this.map)),
        propertySetbacks: await this.initializeManager('propertySetbacks', () => new PropertySetbacksManager(this.map)),
        siteBoundary: await this.initializeManager('siteBoundary', () => new SiteBoundaryCore(this.map)),
        comments: await this.initializeManager('comments', () => new CommentsManager(this.map))
    };

    const failedCritical = ['siteBoundary', 'propertySetbacks'].filter(k => initResults[k] === 'failed');
    if (failedCritical.length) this.warn(`Critical managers failed: ${failedCritical.join(', ')}`);

    this.info('Managers initialized:', initResults);
  }

  async initializeManager(name, createInstance) {
    try {
      // Special handling for comments manager - it should always be available
      if (name === 'comments') {
        try {
          const manager = createInstance();
          if (typeof manager.initialize === 'function') {
            await manager.initialize();
          }
          this[this.toCamelCase(name)] = manager;
          this.info(`✅ CommentsManager initialized`);
          return 'success';
        } catch (error) {
          this.error(`Failed to initialize CommentsManager:`, error);
          // Create fallback comments manager
          this.commentsManager = this.createCommentsManagerFallback();
          return 'fallback';
        }
      }
      
      if (typeof window[this.toPascalCase(name)] === 'undefined') {
        this.warn(`${this.toPascalCase(name)} class not available`);
        return 'skipped';
      }
      const manager = createInstance();
      if (typeof manager.initialize === 'function') {
        await manager.initialize();
      }
      this[this.toCamelCase(name)] = manager;
      this.info(`✅ ${this.toPascalCase(name)} initialized`);
      return 'success';
    } catch (error) {
      this.error(`Failed to initialize ${this.toPascalCase(name)}:`, error);
      // Provide a fallback instance if initialization fails
      const fallbackManager = {
        initialize: () => Promise.resolve(),
        destroy: () => {},
        // Add other common methods with no-op implementations if needed
        hasSiteBoundary: () => false,
        getSitePolygon: () => null,
        isDrawingActive: () => false,
        toggleDrawingMode: () => alert(`${this.toPascalCase(name)} is unavailable. Error: ${error.message}`),
        startDrawingMode() { this.toggleDrawingMode(); },
        stopDrawingMode: () => {},
        clearBoundary: () => {},
        getBuildableAreaData: () => null,
        calculateBuildableArea: () => Promise.reject(new Error('Not available')),
        previewBuildableArea: () => Promise.resolve(),
        getSiteData: () => ({}),
        removeFloorplanFromMap: () => {},
        hasStructures: () => false,
        getStructures: () => [],
        state: {},
        getCurrentFloorplanCoordinates: () => null,
        extrudeStructure: () => this.error('Extrusion failed: Manager unavailable'),
        clearStructure: () => {},
        isDrawing: false,
        stopDrawing: () => {},
        removeStructure3D: () => {},
        toggleInspectorPanel: () => {},
        toggleSiteInfoExpanded: () => {},
        updateBoundaryAppliedState: () => {},
        resetAllPanelStates: () => {},
        showError: (msg) => alert(msg),
        showSuccess: (msg) => console.log(msg),
        handleSiteDataUpdate: () => {},
        handleBuildableAreaPreview: () => {},
        handleBuildableAreaCalculation: () => {},
        handleSetbacksUpdated: () => {},
        clearAllSiteData: () => {},
        handleBoundaryApplied: () => {},
        handlePanelToggled: () => {},
        updateOverlayPosition: () => {},
        removeAllExtrusions: () => {},
        clearAllStructures: () => {},
        isMeasuring: false,
        toggleDimensions: () => {},
        toggle3DBuildings: () => {},
        toggleMeasureTool: () => {},
        startMeasuring: () => {},
        stopMeasuring:  () => {},
        isMeasuringActive: () => false,
        changeMapStyle: (styleValue) => {
          let url = styleValue.startsWith('mapbox://') ? styleValue : `mapbox://styles/mapbox/${styleValue}`;
          this.warn(`Map style change requested on fallback manager: ${url}`);
          this.map?.setStyle(url);
        },
        setupFallbackEventListeners: () => {},
        captureTerrainBounds: () => null,
        saveBuildableAreaToProject: () => {},
        clearDependentMapLayers: () => {}
      };
      this[this.toCamelCase(name)] = fallbackManager;
      return 'failed';
    }
  }

  toPascalCase(str) {
    return str.replace(/(\-[a-z])/g, (match) => match.toUpperCase().replace('-', ''));
  }

  toCamelCase(str) {
    return str.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`).replace(/^-/, '');
  }

  async initializeSiteBoundaryCore() {
    try {
      if (typeof SiteBoundaryCore === 'undefined') throw new Error('SiteBoundaryCore not available');
      this.siteBoundaryCore = new SiteBoundaryCore(this.map, this.draw);
      await this.siteBoundaryCore.initialize();
      this.info('✅ SiteBoundaryCore initialized');
      return 'success';
    } catch (error) {
      this.error('Failed to initialize SiteBoundaryCore:', error);
      const self = this;
      this.siteBoundaryCore = {
        initialize: () => Promise.resolve(),
        hasSiteBoundary: () => false,
        getSitePolygon: () => null,
        getBuildableAreaData: () => null,
        getPolygonEdges: () => [],
        isDrawingActive: () => false,
        calculateBuildableArea: () => Promise.reject(new Error('Not available')),
        previewBuildableArea: () => Promise.resolve(),
        getSiteData: () => ({}),
        toggleDrawingMode: () => {
          self.warn('SiteBoundaryCore not available - drawing disabled');
          alert('Site boundary drawing is currently unavailable. Please refresh the page.');
        },
        startDrawingMode() { this.toggleDrawingMode(); },
        stopDrawingMode: () => {},
        clearBoundary: () => {},
        destroy: () => {}
      };
      return 'failed';
    }
  }

  async initializePropertySetbacksManager() {
    try {
      this.propertySetbacksManager = new PropertySetbacksManager(this.map);
      await this.propertySetbacksManager.initialize();
      this.info('✅ PropertySetbacksManager initialized');
      return 'success';
    } catch (error) {
      this.error('Failed to initialize PropertySetbacksManager:', error);
      return 'failed';
    }
  }

  async initializeFloorplanManager() {
    try {
      if (typeof FloorplanManager === 'undefined') {
        this.warn('FloorplanManager class not available');
        const self = this;
        this.floorplanManager = {
          initialize: () => Promise.resolve(),
          cleanup: () => {},
          isDrawing: false,
          stopDrawing: () => {},
          removeFloorplanFromMap: () => {},
          hasStructures: () => false,
          getStructures: () => [],
          state: {},
          getCurrentFloorplanCoordinates: () => null,
          extrudeStructure: () => self.warn('Extrusion unavailable (no FloorplanManager)'),
          toggleDrawingMode: () => {
            self.warn('FloorplanManager not available - drawing disabled');
            alert('Structure drawing is currently unavailable. Please refresh the page.');
          },
          startDrawing() { this.toggleDrawingMode(); },
          stopDrawing: () => {},
          clearStructure: () => {},
          destroy: () => {}
        };
        return 'fallback';
      }
      this.floorplanManager = new FloorplanManager(this.map);
      await this.floorplanManager.initialize();
      this.info('✅ FloorplanManager initialized');
      return 'success';
    } catch (error) {
      this.error('Failed to initialize FloorplanManager:', error);
      this.floorplanManager = {
        initialize: () => Promise.resolve(),
        cleanup: () => {},
        isDrawing: false,
        stopDrawing: () => {},
        removeFloorplanFromMap: () => {},
        hasStructures: () => false,
        getStructures: () => [],
        state: {},
        getCurrentFloorplanCoordinates: () => null,
        extrudeStructure: () => this.error('Extrusion failed: FloorplanManager unavailable'),
        toggleDrawingMode: () => alert('Structure drawing failed to initialize. Error: ' + error.message),
        startDrawing() { this.toggleDrawingMode(); },
        stopDrawing: () => {},
        clearStructure: () => {},
        destroy: () => {}
      };
      return 'failed';
    }
  }

  async initializeMapFeaturesManager() {
    try {
      if (typeof MapFeaturesManager === 'undefined') throw new Error('MapFeaturesManager class not found');
      this.mapFeaturesManager = new MapFeaturesManager(this.map);
      await this.mapFeaturesManager.initialize();
      window.mapFeaturesManager = this.mapFeaturesManager;
      this.info('✅ MapFeaturesManager initialized');
      return 'success';
    } catch (error) {
      this.error('Failed to initialize MapFeaturesManager:', error);
      this.createMapFeaturesFallback();
      return 'failed';
    }
  }

  async initializeExtrusion3DManager() {
    try {
      if (typeof Extrusion3DManager === 'undefined') {
        this.warn('Extrusion3DManager not available - skipping');
        return 'skipped';
      }
      this.extrusion3DManager = new Extrusion3DManager(this.map);
      await this.extrusion3DManager.initialize();
      this.info('✅ Extrusion3DManager initialized');
      return 'success';
    } catch (error) {
      this.error('Failed to initialize Extrusion3DManager:', error);
      return 'failed';
    }
  }

  /* -----------------------------
     Cross-manager events
  ------------------------------ */
  setupEventHandlers() {
    this.info('Setting up inter-manager event handlers...');

    const bus = window.eventBus;
    if (bus?.on) {
      // Return values of .on might be unsubscribe fns; keep them
      this._busUnsubs.push(
        bus.on('site-data-updated',   (d) => this.handleSiteDataUpdate?.(d)),
        bus.on('preview-buildable-area', (d) => this.handleBuildableAreaPreview(d)),
        bus.on('recalculate-buildable-area', (d) => this.handleBuildableAreaCalculation(d)),
        bus.on('setbacks-updated',   (d) => this.handleSetbacksUpdated(d)),
        bus.on('clear-all-site-data',    () => this.clearAllSiteData?.()),
        bus.on('boundary-applied',       () => this.handleBoundaryApplied()),
        bus.on('panel-toggled',          () => this.handlePanelToggled())
      );
    }

    const styleHandler = () => {
      this.info('Map style changed, reinitializing features...');
      setTimeout(() => this.restoreMapFeatures(), 500);
    };
    this.map.on('styledata', styleHandler);
    this._mapHandlers.push(['styledata', styleHandler]);

    this.info('Event handlers setup completed');
  }

  restoreMapFeatures() {
    this.info('Restoring map features after style change...');
    try {
      this.setup3DTerrain(); // ensure terrain is present after style swap
    } catch (error) {
      this.error('Error restoring map features:', error);
    }
  }

  /* -----------------------------
     Legend helpers
  ------------------------------ */
  updateBuildableAreaLegend(show = null) {
    const legendItem = document.querySelector('.legend-item:has(.legend-color.buildable-area)');
    if (!legendItem) return;

    if (show === null) {
      show = !!(this.siteBoundaryCore && this.siteBoundaryCore.getBuildableAreaData?.());
    }
    legendItem.style.display = show ? 'flex' : 'none';
    this.info(`Buildable area legend ${show ? 'shown' : 'hidden'}`);
  }

  updatePropertyBoundaryLegend(hasProperty) {
    const legend = document.querySelector('.map-legend');
    const propertyBoundaryItem = document.querySelector('.legend-property-boundary-item');
    if (legend) legend.classList.toggle('has-property-boundary', !!hasProperty);
    if (propertyBoundaryItem) propertyBoundaryItem.style.display = hasProperty ? 'flex' : 'none';
  }

  /* -----------------------------
     Property boundaries
  ------------------------------ */
  async loadPropertyBoundaries(lat, lng) {
    try {
      this.info('Loading property boundaries for location:', lat, lng);

      const response = await fetch('/api/property-boundaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
        signal: this._abort.signal
      });

      if (!response.ok) {
        this.warn('Property boundaries API returned error:', response.status);
        this.updateLegalBoundaryButtonState(false);
        return;
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.properties) && data.properties.length > 0) {
        this.info(`Loaded ${data.properties.length} property boundaries`);
        this.displayPropertyBoundaries(data.properties, data.containing_property);
        if (data.containing_property) this.updateLegalBoundaryButtonState(true, data.containing_property);
        else this.updateLegalBoundaryButtonState(false);
      } else {
        this.info('No property boundaries found for this location');
        this.updateLegalBoundaryButtonState(false);
      }
    } catch (error) {
      this.error('Error loading property boundaries:', error);
      this.updateLegalBoundaryButtonState(false);
    }
  }

  updateLegalBoundaryButtonState(available, propertyInfo = null) {
    const button = document.getElementById('useLegalBoundaryButton');
    if (!button) return;

    // Check if legal boundary has already been applied
    const legalBoundaryApplied = sessionStorage.getItem('legal_boundary_applied') === 'true';

    if (legalBoundaryApplied) {
      button.disabled = true;
      button.style.opacity = '0.7';
      button.style.background = '#28a745';
      button.style.color = '#fff';
      button.textContent = 'Use Legal Property Boundary';
      button.title = 'Legal property boundary has been applied';
    } else if (available && propertyInfo) {
      button.disabled = false;
      button.style.opacity = '1';
      button.style.background = 'linear-gradient(135deg, #28a745 0%, #20923a 100%)';
      button.textContent = 'Use Legal Property Boundary';
      button.title = `Apply legal property boundary: ${propertyInfo.title || 'Unknown property'}`;
    } else {
      button.disabled = true;
      button.style.opacity = '0.5';
      button.style.background = '#e9ecef';
      button.textContent = 'Use Legal Property Boundary';
      button.title = 'Legal property boundaries are only available in New Zealand';
    }
  }

  displayPropertyBoundaries(properties, containingProperty) {
    try {
      // Normalize features
      const features = properties.map((property) => {
        const isContaining = !!(containingProperty && property.id === containingProperty.id);
        let geometry;

        if (property.coordinates && property.coordinates.length > 0) {
          if (property.coordinates.length === 1) {
            geometry = { type: 'Polygon', coordinates: property.coordinates };
          } else {
            geometry = { type: 'MultiPolygon', coordinates: property.coordinates.map(coords => [coords]) };
          }
        } else if (property.geometry) {
          geometry = property.geometry; // already GeoJSON
        } else {
          this.warn('Property has no valid coordinates:', property);
          return null;
        }

        return {
          type: 'Feature',
          geometry,
          properties: {
            id: property.id,
            type: isContaining ? 'containing-property' : 'nearby-property',
            title: property.title || 'Unknown Title',
            area_ha: property.area_ha || 0
          }
        };
      }).filter(Boolean);

      if (!features.length) {
        this.info('No valid property features to display');
        return;
      }

      // Remove existing layers/sources
      ['property-boundaries-fill', 'property-boundaries-stroke'].forEach(id => {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      });
      if (this.map.getSource('property-boundaries')) this.map.removeSource('property-boundaries');

      this.map.addSource('property-boundaries', { type: 'geojson', data: { type: 'FeatureCollection', features } });

      this.map.addLayer({
        id: 'property-boundaries-fill',
        type: 'fill',
        source: 'property-boundaries',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'type'], 'containing-property'], '#32cd32',
            '#87ceeb'
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'type'], 'containing-property'], 0.3,
            0.15
          ]
        }
      });

      this.map.addLayer({
        id: 'property-boundaries-stroke',
        type: 'line',
        source: 'property-boundaries',
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'type'], 'containing-property'], '#32cd32',
            '#5f9ea0'
          ],
          'line-width': [
            'case',
            ['==', ['get', 'type'], 'containing-property'], 3,
            2
          ],
          'line-dasharray': [
            'case',
            ['==', ['get', 'type'], 'containing-property'], [5, 5],
            [1, 0]
          ],
          'line-opacity': 0.8
        }
      });

      this.info('Property boundaries displayed on map');
      if (containingProperty) this.info('Project within property:', containingProperty.title || 'Unknown title');
    } catch (error) {
      this.error('Error displaying property boundaries:', error);
    }
  }

  /* -----------------------------
     Buildable area + setbacks
  ------------------------------ */
  async handleBuildableAreaPreview(data) {
    try {
      this.info('Handling buildable area preview:', data);
      const result = await this.siteBoundaryCore.previewBuildableArea(data);
      if (result?.buildable_coords) {
        this.updateBuildableAreaDisplay(result, true);
        this.info('Buildable area preview displayed');
      }
    } catch (error) {
      this.error('Error handling buildable area preview:', error);
    }
  }

  async handleBuildableAreaCalculation(data) {
    this.info('Handling buildable area calculation:', data);
    try {
      const result = await this.siteBoundaryCore.calculateBuildableArea(data);

      if (this.propertySetbacksManager) {
        this.propertySetbacksManager.currentBuildableArea = result;
        this.propertySetbacksManager.showExtrusionControls?.();
        this.propertySetbacksManager.keepInputsVisible?.();
      }

      this.uiPanelManager?.showSuccess?.('Buildable area calculated successfully');
      window.eventBus?.emit?.('setbacks-applied');
      this.updateBuildableAreaDisplay(result, false);
    } catch (error) {
      this.error('Buildable area calculation failed:', error);
      if (this.uiPanelManager?.showError) {
        this.uiPanelManager.showError('Failed to calculate buildable area: ' + error.message);
      } else {
        alert('Failed to calculate buildable area: ' + error.message);
      }
    }
  }

  handleSetbacksUpdated(data) {
    this.info('Setbacks updated:', data);
    this.createSetbackVisualization(data);
  }

  createSetbackVisualization(data) {
    if (!data?.selectedEdges?.front || !data?.selectedEdges?.back) {
      this.warn('Missing data for setback visualization');
      return;
    }

    const { front: frontEdge, back: backEdge } = data.selectedEdges;

    this.clearSetbackVisualization();
    try {
      const features = [];
      if (frontEdge) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [frontEdge.start, frontEdge.end] },
          properties: { type: 'front-setback', setback: data.front }
        });
      }
      if (backEdge) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [backEdge.start, backEdge.end] },
          properties: { type: 'back-setback', setback: data.back }
        });
      }

      this.map.addSource('setback-lines', { type: 'geojson', data: { type: 'FeatureCollection', features } });

      this.map.addLayer({
        id: 'front-setback-line', type: 'line', source: 'setback-lines',
        filter: ['==', ['get', 'type'], 'front-setback'],
        paint: { 'line-color': '#28a745', 'line-width': 4, 'line-opacity': 0.8 }
      });

      this.map.addLayer({
        id: 'back-setback-line', type: 'line', source: 'setback-lines',
        filter: ['==', ['get', 'type'], 'back-setback'],
        paint: { 'line-color': '#dc3545', 'line-width': 4, 'line-opacity': 0.8 }
      });

      this.info('Setback lines visualized on map');
    } catch (error) {
      this.error('Error creating setback visualization:', error);
    }
  }

  clearSetbackVisualization() {
    ['front-setback-line', 'back-setback-line'].forEach(id => this.map.getLayer(id) && this.map.removeLayer(id));
    if (this.map.getSource('setback-lines')) this.map.removeSource('setback-lines');
    this.info('Setback visualization cleared');
  }

  handleSiteBoundaryCreated(data) {
    this.info('Site boundary created; updating site data');
    Object.assign(this.siteData, {
      coordinates: data.coordinates,
      area: data.area,
      area_m2: data.area_m2 || data.area,
      center: data.center,
      center_lng: data.center_lng,
      center_lat: data.center_lat,
      type: data.type || 'residential',
      perimeter: data.perimeter,
      terrainBounds: data.terrainBounds
    });
  }

  handleSiteBoundaryLoaded(data) {
    this.info('Site boundary loaded; updating site data');
    Object.assign(this.siteData, {
      coordinates: data.coordinates,
      area: data.area,
      area_m2: data.area_m2 || data.area,
      center: data.center,
      center_lng: data.center_lng,
      center_lat: data.center_lat,
      type: data.type || 'residential',
      perimeter: data.perimeter,
      terrainBounds: data.terrainBounds
    });

    window.eventBus?.emit?.('boundary-applied');
  }

  handleToolActivated(toolName) {
    this.info('Tool activated:', toolName);

    // Stop conflicting tools when a new tool is activated
    if (toolName === 'floorplan') {
      // Stop site boundary drawing
      if (this.siteBoundaryCore?.isDrawingActive?.()) {
        this.siteBoundaryCore.stopDrawingMode();
      }
      // Stop measuring tool
      if (this.mapFeaturesManager?.isMeasuringActive?.()) {
        this.mapFeaturesManager.stopMeasuring();
      }
    }

    if (toolName === 'site-boundary') {
      // Stop structure drawing
      if (this.floorplanManager?.isDrawing) {
        this.floorplanManager.stopDrawing();
      }
      // Stop measuring tool
      if (this.mapFeaturesManager?.isMeasuringActive?.()) {
        this.mapFeaturesManager.stopMeasuring();
      }
    }

    if (toolName === 'measure') {
      // Stop all drawing modes
      if (this.floorplanManager?.stopDrawing) {
        this.floorplanManager.stopDrawing();
      }
      if (this.siteBoundaryCore?.isDrawingActive?.()) {
        this.siteBoundaryCore.stopDrawingMode();
      }
    }
  }

  handlePanelToggled() {
    this.propertySetbacksManager?.updateOverlayPosition?.();
  }

  updateBuildableAreaDisplay(result, isPreview = false) {
    try {
      ['buildable-area-fill', 'buildable-area-stroke'].forEach(id => this.map.getLayer(id) && this.map.removeLayer(id));
      if (this.map.getSource('buildable-area')) this.map.removeSource('buildable-area');

      if (result.buildable_coords?.length) {
        let coordinates = result.buildable_coords;
        const first = coordinates[0];
        if (first && Math.abs(first[0]) <= 90 && Math.abs(first[1]) > 90) {
          coordinates = coordinates.map(([lat, lng]) => [lng, lat]);
          this.info('Corrected buildable coords from [lat,lng] to [lng,lat]');
        }
        if (coordinates.length && (coordinates[0][0] !== coordinates.at(-1)[0] || coordinates[0][1] !== coordinates.at(-1)[1])) {
          coordinates.push([...coordinates[0]]);
        }

        this.map.addSource('buildable-area', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [coordinates] },
            properties: { area_m2: result.buildable_area_m2 || 0, type: 'buildable-area', is_preview: isPreview }
          }
        });

        const fillColor = '#002040';
        const fillOpacity = isPreview ? 0.2 : 0.4;
        const strokeColor = '#002040';
        const strokeOpacity = isPreview ? 0.7 : 0.8;
        const strokeWidth = isPreview ? 2 : 3;

        this.map.addLayer({ id: 'buildable-area-fill', type: 'fill', source: 'buildable-area', paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity } });
        this.map.addLayer({ id: 'buildable-area-stroke', type: 'line', source: 'buildable-area',
          paint: { 'line-color': strokeColor, 'line-width': strokeWidth, 'line-opacity': strokeOpacity } });

        this.updateBuildableAreaLegend(true);
      } else {
        if (!isPreview) this.warn('No buildable coordinates to display');
        this.updateBuildableAreaLegend(false);
      }
    } catch (error) {
      this.error('Error updating buildable area display:', error);
    }
  }

  /* -----------------------------
     3D Terrain
  ------------------------------ */
  setup3DTerrain() {
    try {
      if (!this.map.isStyleLoaded()) {
        const handler = () => { this.map.off('styledata', handler); this.setup3DTerrain(); };
        this.map.on('styledata', handler);
        this._mapHandlers.push(['styledata', handler]);
        return;
      }

      setTimeout(() => {
        try {
          let hasDEM = false;
          try { hasDEM = !!this.map.getSource('mapbox-dem'); } catch {}
          if (!hasDEM) {
            try {
              this.map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.terrain-rgb', tileSize: 512, maxzoom: 14 });
              this.info('Added mapbox-dem terrain source');
            } catch (e) {
              if (e.message?.includes('already exists')) this.info('DEM source already exists; skipping');
              else throw e;
            }
          }

          try { this.map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 }); } catch (e) { this.warn('Failed to set terrain:', e.message); }

          try {
            if (!this.map.getLayer('sky')) {
              this.map.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 90.0], 'sky-atmosphere-sun-intensity': 15 } });
              this.info('Added sky layer');
            }
          } catch (e) { this.warn('Failed to add sky layer:', e.message); }

          try {
            this.map.setFog({ range: [1, 20], 'horizon-blend': 0.3, color: 'white', 'high-color': '#add8e6', 'space-color': '#d8f2ff', 'star-intensity': 0 });
          } catch (e) { this.warn('Failed to set fog:', e.message); }

          this.info('✅ 3D terrain features setup completed');
        } catch (terrainError) {
          if (terrainError.message?.includes('already exists')) {
            this.warn('Terrain source conflict detected; ignoring:', terrainError.message);
          } else {
            this.error('Failed to add 3D terrain features:', terrainError);
          }
        }
      }, 5000);
    } catch (error) {
      this.error('Error setting up 3D terrain:', error);
    }
  }

  /* -----------------------------
     Error / recovery
  ------------------------------ */
  showMapError(message) {
    const mapLoading = document.getElementById('mapLoading');
    const mapError = document.getElementById('mapError');
    const errorDetails = document.getElementById('errorDetails');
    if (mapLoading) mapLoading.style.display = 'none';
    if (mapError) mapError.style.display = 'flex';
    if (errorDetails) errorDetails.textContent = message;

    // Fallback inline UI if those elements aren’t present
    const mapContainer = document.getElementById('inspectorMap');
    if (mapContainer && !mapError) {
      mapContainer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;background:#f5f5f5;color:#666;font-family:Arial, sans-serif;flex-direction:column;text-align:center;padding:20px;">
          <div style="font-size:48px;margin-bottom:16px;">🗺️</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Map Failed to Load</div>
          <div style="font-size:14px;max-width:400px;">${message}</div>
          <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:#007cbf;color:#fff;border:none;border-radius:4px;cursor:pointer;">Retry</button>
        </div>
      `;
    }
  }

  attemptRecovery() {
    this.warn('Attempting recovery...');
    setTimeout(() => {
      if (!this.isInitialized) {
        this.warn('Recovery: Reloading page…');
        location.reload();
      }
    }, 3000);
  }

  /* -----------------------------
     Public UI hooks / utils
  ------------------------------ */
  extrudeSelectedStructures() {
    try {
      const floorplanManager = this.getManager('floorplan');
      if (!floorplanManager || !floorplanManager.state?.geojsonPolygon) {
        this.uiPanelManager?.showError?.('No structures available to extrude');
        return;
      }
      const heightLimit = parseFloat(document.getElementById('heightLimit')?.value) || 9;
      floorplanManager.extrudeStructure?.(heightLimit);

      // Announce via event bus (don’t call missing UIPanelManager methods)
      window.eventBus?.emit?.('extrusion-applied', { height: heightLimit });
      this.info(`Structure(s) extruded to ${heightLimit}m height`);
    } catch (error) {
      this.error('Failed to extrude structures:', error);
      this.uiPanelManager?.showError?.('Failed to extrude structures: ' + error.message);
    }
  }

  removeStructure3D() {
    try {
      const floorplanManager = this.getManager('floorplan');
      floorplanManager?.removeStructure3D?.();
      window.eventBus?.emit?.('extrusion-removed');
      this.info('3D structures removed');
    } catch (error) {
      this.error('Failed to remove 3D structures:', error);
      this.uiPanelManager?.showError?.('Failed to remove 3D structures: ' + error.message);
    }
  }

  getSiteData() {
    const boundaryData = this.siteBoundaryCore?.getSiteData?.() || {};
    const out = { ...this.siteData, ...boundaryData };
    if (!out.type) out.type = 'residential';
    if (!out.center && out.center_lng != null && out.center_lat != null) {
      out.center = { lng: out.center_lng, lat: out.center_lat };
    }
    if (!out.area_m2 && out.area) out.area_m2 = out.area;
    return out;
  }

  getMap() { return this.map; }
  getDraw() { return this.draw; }

  getManager(name) {
    const m = {
      siteBoundary: this.siteBoundaryCore,
      propertySetbacks: this.propertySetbacksManager,
      floorplan: this.floorplanManager,
      mapFeatures: this.mapFeaturesManager,
      uiPanel: this.uiPanelManager,
      extrusion3D: this.extrusion3DManager
    };
    return m[name] || null;
  }

  /* -----------------------------
     Fallback MapFeaturesManager
  ------------------------------ */
  createCommentsManagerFallback() {
    this.info('Creating comments manager fallback');
    
    return {
      initialize: () => Promise.resolve(),
      isCommenting: false,
      comments: [],
      toggleCommentsTool: () => {
        const button = document.getElementById('commentsToolButton');
        if (!button) return;
        
        if (this.commentsManager.isCommenting) {
          this.commentsManager.stopCommenting();
          button.classList.remove('active');
          button.innerHTML = '💬';
        } else {
          this.commentsManager.startCommenting();
          button.classList.add('active');
          button.innerHTML = '✖';
          window.eventBus?.emit('tool-activated', 'comments');
        }
      },
      startCommenting: () => {
        this.commentsManager.isCommenting = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this.commentsManager.handleCommentClick);
        this.info('Comments tool started (fallback)');
      },
      stopCommenting: () => {
        this.commentsManager.isCommenting = false;
        this.map.off('click', this.commentsManager.handleCommentClick);
        this.map.getCanvas().style.cursor = '';
        this.info('Comments tool stopped (fallback)');
      },
      handleCommentClick: (e) => {
        if (!this.commentsManager.isCommenting) return;
        
        e.preventDefault();
        if (e.originalEvent) {
          e.originalEvent.stopPropagation();
        }
        
        const coordinates = [e.lngLat.lng, e.lngLat.lat];
        const text = prompt('Enter your comment:');
        if (text && text.trim()) {
          this.commentsManager.addCommentToMap({
            id: Date.now(),
            coordinates: coordinates,
            text: text.trim(),
            timestamp: new Date().toISOString(),
            user: 'Current User'
          });
          this.info('Comment added (fallback)');
        }
      },
      addCommentToMap: (comment) => {
        const popup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: false,
          className: 'comment-popup',
          anchor: 'bottom',
          offset: [0, -10]
        })
        .setLngLat(comment.coordinates)
        .setHTML(`
          <div class="comment-content" style="padding: 8px; max-width: 200px;">
            <div class="comment-header" style="font-size: 12px; color: #666; margin-bottom: 4px;">
              <span class="comment-user">${comment.user}</span>
              <span class="comment-time" style="float: right;">${new Date(comment.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="comment-text" style="font-size: 14px; color: #333;">${comment.text}</div>
          </div>
        `)
        .addTo(this.map);
        
        this.commentsManager.comments.push(comment);
      },
      dispose: () => {
        if (this.commentsManager.isCommenting) {
          this.commentsManager.stopCommenting();
        }
      }
    };
  }

  createMapFeaturesFallback() {
    this.info('Creating comprehensive map features fallback');

    window.mapFeaturesManager = {
      isMeasuring: false,
      initialize: () => { this.setupFallbackEventListeners(); return Promise.resolve(); },
      toggleDimensions: () => {
        const dimensionLayers = [
          'boundary-dimension-labels', 'site-dimension-labels', 'site-dimensions',
          'buildable-area-dimension-labels', 'buildable-dimension-labels', 'buildable-dimensions',
          'setback-dimension-labels', 'setback-dimensions',
          'structure-dimension-labels', 'structure-dimensions',
          'footprint-dimension-labels', 'footprint-dimensions',
          'building-dimension-labels', 'building-dimensions',
          'floorplan-dimension-labels', 'floorplan-dimensions',
          'measure-dimension-labels', 'measure-dimensions',
          'polygon-dimensions', 'polygon-dimension-labels'
        ];

        const dimensionsBtn = document.querySelector('.dimensions-toggle-btn');
        const dimensionsToggle = document.querySelector('.dimensions-toggle-switch input');

        let isVisible = false;
        if (dimensionsToggle) {
          isVisible = dimensionsToggle.checked;
        } else {
          for (const id of dimensionLayers) {
            if (this.map.getLayer(id) && this.map.getLayoutProperty(id, 'visibility') !== 'none') { isVisible = true; break; }
          }
        }

        const visibility = isVisible ? 'none' : 'visible';
        const newState = !isVisible;

        let count = 0;
        dimensionLayers.forEach(id => {
          if (this.map.getLayer(id)) {
            this.map.setLayoutProperty(id, 'visibility', visibility);
            count++;
          }
        });

        if (dimensionsBtn) dimensionsBtn.classList.toggle('active', newState);
        if (dimensionsToggle) dimensionsToggle.checked = newState;
        this.map?.triggerRepaint?.();
        this.info(`Fallback dimensions toggled: ${count} layers -> ${visibility}`);
      },
      toggle3DBuildings: () => {
        const buildingsBtn = document.getElementById('buildingsToggle');
        const buildingsControl = document.getElementById('buildingsControl');
        if (!buildingsBtn || !buildingsControl) return this.warn('3D Buildings elements not found');

        const hasLayer = this.map.getLayer('3d-buildings');
        if (hasLayer) {
          this.map.removeLayer('3d-buildings');
          buildingsBtn.classList.remove('active');
          buildingsBtn.textContent = '3D Buildings';
          buildingsControl.classList.remove('expanded');
          this.info('3D Buildings disabled (fallback)');
        } else {
          try {
            this.map.addLayer({
              id: '3d-buildings', source: 'composite', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 8,
              paint: { 'fill-extrusion-color': '#999999', 'fill-extrusion-height': 15, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.8 }
            });
            buildingsBtn.classList.add('active');
            buildingsControl.classList.add('expanded');
            this.info('3D Buildings enabled (fallback)');
          } catch (e) { this.error('Failed to add 3D buildings (fallback):', e); }
        }
      },
      toggleMeasureTool: () => {
        const button = document.getElementById('measureToolButton');
        if (!button) return;
        if (window.mapFeaturesManager.isMeasuring) {
          window.mapFeaturesManager.stopMeasuring();
          button.classList.remove('active'); button.innerHTML = '📐';
        } else {
          window.mapFeaturesManager.startMeasuring();
          button.classList.add('active'); button.innerHTML = '✖';
        }
      },
      startMeasuring: () => { window.mapFeaturesManager.isMeasuring = true; this.map.getCanvas().style.cursor = 'crosshair'; this.info('Measurement tool started (fallback)'); },
      stopMeasuring:  () => { window.mapFeaturesManager.isMeasuring = false; this.map.getCanvas().style.cursor = '';        this.info('Measurement tool stopped (fallback)'); },
      isMeasuringActive: () => window.mapFeaturesManager.isMeasuring,
      changeMapStyle: (styleValue) => {
        let url = styleValue.startsWith('mapbox://') ? styleValue : `mapbox://styles/mapbox/${styleValue}`;
        this.info('Fallback map style change:', url);
        this.map?.setStyle(url);
      },
      destroy: () => {}
    };

    this.setupFallbackEventListeners();
  }

  setupFallbackEventListeners() {
    this.info('Setting up fallback event listeners for map controls');

    const styleSelector = document.getElementById('styleSelector');
    styleSelector?.addEventListener('change', (e) => window.mapFeaturesManager.changeMapStyle(e.target.value), { signal: this._abort.signal });

    const measureBtn = document.getElementById('measureToolButton');
    measureBtn?.addEventListener('click', (e) => { e.stopPropagation(); window.mapFeaturesManager.toggleMeasureTool(); }, { signal: this._abort.signal });

    const buildingsBtn = document.getElementById('buildingsToggle');
    buildingsBtn?.addEventListener('click', () => window.mapFeaturesManager.toggle3DBuildings(), { signal: this._abort.signal });

    const dimensionsBtn = document.querySelector('.dimensions-toggle-btn');
    dimensionsBtn?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); window.mapFeaturesManager.toggleDimensions(); }, { signal: this._abort.signal });

    const dimensionsToggle = document.querySelector('.dimensions-toggle-switch input');
    dimensionsToggle?.addEventListener('change', (e) => { e.preventDefault(); e.stopPropagation(); window.mapFeaturesManager.toggleDimensions(); }, { signal: this._abort.signal });

    // Comments tool
    const commentsBtn = document.getElementById('commentsToolButton');
    commentsBtn?.addEventListener('click', (e) => { 
      e.stopPropagation(); 
      if (this.commentsManager?.toggleCommentsTool) {
        this.commentsManager.toggleCommentsTool();
      } else {
        this.warn('Comments manager not available');
      }
    }, { signal: this._abort.signal });

    this.info('Fallback event listeners setup completed');
  }

  updateSiteBoundaryLegend(show = null) {
    const item = document.querySelector('.legend-item:has(.legend-color.site-boundary)');
    if (!item) return;
    if (show === null) show = !!(this.siteBoundaryCore && this.siteBoundaryCore.hasSiteBoundary?.());
    item.style.display = show ? 'flex' : 'none';
  }

  updateLegend() {
    this.updateSiteBoundaryLegend();
    this.updateBuildableAreaLegend();
    this.info('Legend update requested');
  }

  isReady() { return this.isInitialized; }

  getProjectIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    let projectId = urlParams.get('project_id') || urlParams.get('project');
    if (projectId && projectId.includes('?')) {
      projectId = projectId.split('?')[0];
      this.info('Cleaned malformed project ID from URL:', projectId);
    }
    if (projectId) {
      projectId = String(projectId).trim();
      if (!/^\d+$/.test(projectId)) {
        this.warn('Invalid project ID format in URL:', projectId);
        return null;
      }
    }
    return projectId;
  }

  captureTerrainBounds() {
    if (!this.map) { this.warn('Map not available for terrain bounds capture'); return null; }
    try {
      const b = this.map.getBounds(); const c = this.map.getCenter();
      return {
        bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        center: [c.lng, c.lat],
        zoom: this.map.getZoom(),
        width: b.getEast() - b.getWest(),
        height: b.getNorth() - b.getSouth(),
        timestamp: new Date().toISOString()
      };
    } catch (e) { this.error('Error capturing terrain bounds:', e); return null; }
  }

  async saveBuildableAreaToProject(result, setbackData) {
    try {
      const projectId = this.getProjectIdFromUrl();
      if (!projectId) { this.warn('No project ID found, cannot save buildable area'); return; }

      const terrainBounds = this.captureTerrainBounds();
      let siteCoords = null, siteArea = null;
      if (this.siteBoundaryCore?.hasSiteBoundary?.()) {
        const poly = this.siteBoundaryCore.getSitePolygon?.();
        if (poly?.geometry?.coordinates) {
          siteCoords = poly.geometry.coordinates[0];
          siteArea = this.siteBoundaryCore.calculatePolygonArea?.(siteCoords);
        }
      }

      const snapshotData = {
        buildable_coords: result.buildable_coords,
        buildable_area_m2: result.buildable_area_m2,
        site_area_m2: result.site_area_m2,
        coverage_ratio: result.coverage_ratio,
        front_setback: setbackData.frontSetback,
        rear_setback: setbackData.backSetback,
        side_setback: setbackData.sideSetback,
        height_limit: setbackData.heightLimit,
        selected_edges: setbackData.selectedEdges,
        calculation_method: result.calculation_method,
        terrain_bounds: terrainBounds,
        site_coords: siteCoords,
        site_area_calculated: siteArea,
        timestamp: new Date().toISOString()
      };

      const response = await fetch(`/api/project/${projectId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_type: 'buildable_area', snapshot_data: JSON.stringify(snapshotData) }),
        signal: this._abort.signal
      });

      const data = await response.json();
      if (!data.success) this.error('Failed to save buildable area', data.error);
      else this.info('Buildable area saved successfully to project', projectId);
    } catch (error) {
      this.error('Error saving buildable area:', error);
    }
  }

  /* -----------------------------
     Comprehensive clearing
  ------------------------------ */
  handleBoundaryApplied() {
    this.info('Boundary applied - updating UI state');
    this.uiPanelManager?.updateBoundaryAppliedState?.();
  }

  handleComprehensiveClearing() {
    this.info('Comprehensive clearing requested');

    try {
      this.extrusion3DManager?.removeAllExtrusions?.();
      if (this.floorplanManager?.clearAllStructures) this.floorplanManager.clearAllStructures();
      this.clearDependentMapLayers();
      this.uiPanelManager?.resetAllPanelStates?.();
      this.info('Comprehensive clearing completed');
    } catch (error) {
      this.error('Error during comprehensive clearing:', error);
    }
  }

  clearDependentMapLayers() {
    try {
      this.clearSetbackVisualization();
      const layers = [
        'setback-fill', 'setback-stroke', 'setback-visualization',
        'buildable-area-fill', 'buildable-area-stroke', 'buildable-area-dimension-labels',
        'structure-fill', 'structure-stroke', 'structure-dimension-labels'
      ];
      const sources = ['setback-visualization', 'buildable-area', 'buildable-area-dimensions', 'structure-footprint', 'structure-dimensions'];

      layers.forEach(id => this.map.getLayer(id) && this.map.removeLayer(id));
      sources.forEach(id => this.map.getSource(id) && this.map.removeSource(id));

      this.info('Dependent map layers cleared');
    } catch (error) {
      this.error('Error clearing dependent map layers:', error);
    }
  }

  /* -----------------------------
     Destroy
  ------------------------------ */
  destroy() {
    try {
      this._abort?.abort();

      // Unsubscribe event bus
      try { this._busUnsubs.forEach(u => typeof u === 'function' && u()); } catch {}

      // Remove map handlers
      if (this.map) {
        this._mapHandlers.forEach(([evt, handler]) => {
          try { this.map.off(evt, handler); } catch {}
        });
      }

      this.siteBoundaryCore?.destroy?.();
      this.propertySetbacksManager?.destroy?.();
      this.floorplanManager?.destroy?.();
      this.mapFeaturesManager?.destroy?.();
      this.uiPanelManager?.destroy?.();
      this.extrusion3DManager?.destroy?.();

      if (this.map) { try { this.map.remove(); } catch {} this.map = null; }

      super.destroy?.();
      this.info('SiteInspectorCore destroyed');
    } catch (e) {
      this.error('Error during destroy:', e);
    }
  }
}

/* -----------------------------
   Global helpers (template compat)
------------------------------ */
window.toggleInspectorPanel = function () {
  const ui = window.siteInspectorCore?.uiPanelManager;
  ui?.toggleInspectorPanel?.();
};

window.toggleSiteInfoExpanded = function () {
  const ui = window.siteInspectorCore?.uiPanelManager;
  ui?.toggleSiteInfoExpanded?.();
};

window.toggle3DBuildings = function () {
  const mf = window.siteInspectorCore?.mapFeaturesManager;
  mf?.toggle3DBuildings?.();
};

/* -----------------------------
   Bootstrap
------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[SiteInspectorCore] DOM loaded, initializing modular site inspector...');
  try {
    // Wait for BaseManager if needed
    if (typeof BaseManager === 'undefined') {
      await new Promise(resolve => {
        const check = () => (typeof BaseManager !== 'undefined' ? resolve() : setTimeout(check, 100));
        check();
      });
    }

    if (!window.siteInspectorCore) {
      window.siteInspectorCore = new SiteInspectorCore();
      await window.siteInspectorCore.initialize();
    }
    console.log('[SiteInspectorCore] ✅ Modular site inspector initialized successfully');
  } catch (error) {
    console.error('[SiteInspectorCore] ❌ Initialization failed:', error);
    const mapContainer = document.getElementById('inspectorMap');
    if (mapContainer) {
      mapContainer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;background:#f8f9fa;color:#666;flex-direction:column;text-align:center;padding:20px;">
          <h3 style="margin-bottom:10px;">Map Loading Error</h3>
          <p style="margin-bottom:15px;">Unable to initialize the map. Please refresh the page to try again.</p>
          <button onclick="location.reload()" style="padding:10px 20px;background:#007cbf;color:white;border:none;border-radius:4px;cursor:pointer;">
            Refresh Page
          </button>
          <p style="margin-top:15px;font-size:12px;color:#999;">Error: ${error.message}</p>
        </div>
      `;
    }
  }
});

window.SiteInspectorCore = SiteInspectorCore;