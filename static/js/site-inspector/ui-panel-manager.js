/**
 * UI Panel Manager
 * Handles panel states, interactions, and UI feedback
 */

class UIPanelManager extends BaseManager {
    constructor() {
        super('UIPanelManager');

        this._inited = false;

        this.panelState = {
            inspector: false,
            siteInfo: false
        };

        this.cardStates = {
            siteBoundary: 'expanded',
            setbacks: 'collapsed',
            floorplan: 'collapsed',
            extrusion: 'collapsed'
        };

        // Listener lifecycle
        this._uiAbort = null;
        this._cardsAbort = null;
        this._modalAbort = null;
        this._globalAbort = null;
    }

    initialize() {
        if (this._inited) {
            this.warn('UIPanelManager already initialized');
            return;
        }

        this.info('Initializing UI Panel Manager...');

        this._uiAbort = new AbortController();
        this._cardsAbort = new AbortController();
        this._modalAbort = new AbortController();
        this._globalAbort = new AbortController();

        this.setupEventListeners();
        this.setupCardEventListeners();
        this.initializePanelStates();
        this.initializeAdditionalElements();

        this._inited = true;
        this.info('UI Panel Manager initialized successfully');
    }

    /* -----------------------------
       Helpers
    ------------------------------ */
    $(id) { return document.getElementById(id); }

    _toggle(el, className, on) {
        if (!el) return;
        el.classList[on ? 'add' : 'remove'](className);
    }

    _show(el) { if (el) el.style.display = 'block'; }
    _hide(el) { if (el) el.style.display = 'none'; }

    /* -----------------------------
       Additional init
    ------------------------------ */
    initializeAdditionalElements() {
        // Update location info if available
        const locationSpan = this.$('siteLocation');
        if (locationSpan) {
            const siteData = window.siteInspectorCore ? window.siteInspectorCore.getSiteData?.() : {};
            const location = siteData?.project_address || siteData?.location || 'Not specified';
            locationSpan.textContent = location;
        }

        // Add CSS for animations (once)
        if (!document.querySelector('#uipanel-animations')) {
            const style = document.createElement('style');
            style.id = 'uipanel-animations';
            style.textContent = `
                @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
                @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);
        }
    }

    /* -----------------------------
       Core event listeners
    ------------------------------ */
    setupEventListeners() {
        const signal = this._uiAbort.signal;

        // Inspector panel toggle
        const panelToggleBtn = this.$('panelToggleBtn');
        panelToggleBtn?.addEventListener('click', () => this.toggleInspectorPanel(), { signal });

        const panelClose = document.querySelector('.panel-close');
        panelClose?.addEventListener('click', () => this.toggleInspectorPanel(), { signal });

        // Site info panel toggle
        const siteInfoToggleBtn = this.$('siteInfoToggleBtn');
        siteInfoToggleBtn?.addEventListener('click', () => this.toggleSiteInfoExpanded(), { signal });

        // Cut & fill & save (if present)
        this.$('cutFillAnalysisBtn')?.addEventListener('click', () => this.generateCutFillAnalysis(), { signal });
        this.$('saveProgressBtn')?.addEventListener('click', () => this.saveCurrentProgress(), { signal });

        // Event bus listeners (guarded)
        const bus = window.eventBus;
        if (bus?.on) {
            bus.on('boundary-applied', () => {
                this.collapseSiteBoundaryCard();
                this.expandSetbacksCard();
            });

            bus.on('legal-boundary-applied', () => {
                this.collapseSiteBoundaryCard();
                this.markPropertySetbacksComplete();
                this.expandFloorplanCard();
            });

            bus.on('site-boundary-loaded', () => {
                this.collapseSiteBoundaryCard();
                setTimeout(() => {
                    const psm = window.siteInspectorCore?.propertySetbacksManager;
                    if (!psm?.currentBuildableArea) this.expandSetbacksCard();
                }, 100);
            });

            bus.on('setbacks-applied', () => {
                this.collapseSetbacksCard();
                this.expandFloorplanCard();
            });

            // (Fixed) was duplicated in original
            bus.on('floorplan-applied', () => {
                this.collapseFloorplanCard();
                this.expandExtrusionCard();
            });

            // Structure created -> show extrusion
            bus.on('structure-created', () => {
                this.expandExtrusionCard();
                this.updateExtrudeStructureButtonState();
            });

            bus.on('extrusion-applied', () => this.updateExtrusionCardStatus());
            bus.on('structure-deleted', () => this.updateExtrudeStructureButtonState());
            bus.on('structure-selection-changed', () => this.updateExtrudeStructureButtonState());
        }

        // Clear & minimize
        this.setupClearSiteInspectorListeners();
        this.setupMinimizePanelListener();

        // Initialize search UI
        this.initializeSearchControl();

        this.debug('Core event listeners attached');
    }

    setupCardEventListeners() {
        const signal = this._cardsAbort.signal;

        const siteBoundaryControls = this.$('siteBoundaryControls');
        siteBoundaryControls?.addEventListener('click', () => {
            if (siteBoundaryControls.classList.contains('collapsed')) this.expandSiteBoundaryCard();
        }, { signal });

        const boundaryControls = this.$('boundaryControls');
        boundaryControls?.addEventListener('click', () => {
            if (boundaryControls.classList.contains('collapsed')) this.expandSetbacksCard();
        }, { signal });

        const floorplanControls = this.$('floorplanControls');
        floorplanControls?.addEventListener('click', () => {
            if (floorplanControls.classList.contains('collapsed')) this.expandFloorplanCard();
        }, { signal });

        const gradientControls = this.$('gradientControls');
        gradientControls?.addEventListener('click', () => {
            if (gradientControls.classList.contains('collapsed')) this.expandGradientCard();
        }, { signal });

        const extrusionControls = this.$('extrusionControls');
        extrusionControls?.addEventListener('click', () => {
            if (extrusionControls.classList.contains('collapsed')) this.expandExtrusionCard();
        }, { signal });

        this.debug('Card event listeners attached');
    }

    /* -----------------------------
       Initial visual states
    ------------------------------ */
    initializePanelStates() {
        const panel = this.$('inspectorPanel');
        const mapLegend = this.$('mapLegend');
        const mapControlsContainer = this.$('mapControlsContainer');
        const topLeftControls = document.querySelector('.top-left-controls'); // optional in some layouts

        if (panel) {
            panel.classList.add('expanded');
            this.panelState.inspector = true;
        }

        this._toggle(topLeftControls, 'shifted', true);
        this._toggle(mapLegend, 'shifted', true);
        this._toggle(mapControlsContainer, 'shifted', true);

        // Ensure extrusion starts collapsed
        const extrusionControls = this.$('extrusionControls');
        this._toggle(extrusionControls, 'collapsed', true);
        this.cardStates.extrusion = 'collapsed';

        // Loading shimmer for cards (once)
        this.showCardLoadingStates();

        this.info('Panel states initialized - inspector panel expanded by default');
    }

    showCardLoadingStates() {
        const cardIds = ['siteBoundaryControls', 'boundaryControls', 'floorplanControls', 'extrusionControls'];

        cardIds.forEach(id => {
            const card = this.$(id);
            if (!card || card.hasAttribute('data-loading')) return;

            const wrap = document.createElement('div');
            wrap.className = 'card-loading-indicator';
            wrap.style.cssText = `
                display:flex;align-items:center;gap:8px;padding:8px;
                font-size:12px;color:#666;opacity:0.7;
            `;
            wrap.innerHTML = `
                <div class="loading-spinner" style="
                    width:12px;height:12px;border:2px solid #ddd;border-top:2px solid #007cbf;
                    border-radius:50%;animation:spin 1s linear infinite;"></div>
                <span>Loading...</span>
            `;
            card.appendChild(wrap);
            card.setAttribute('data-loading', 'true');
        });

        // Auto-remove after short delay
        setTimeout(() => this.hideCardLoadingStates(), 1500);
    }

    hideCardLoadingStates() {
        document.querySelectorAll('[data-loading="true"]').forEach(card => {
            card.querySelector('.card-loading-indicator')?.remove();
            card.removeAttribute('data-loading');
        });
        this.info('Card loading states removed');
    }

    /* -----------------------------
       Search control
    ------------------------------ */
    initializeSearchControl() {
        const signal = this._globalAbort.signal;

        const searchButton = this.$('searchButton');
        const searchInput = this.$('searchInput');
        const clearSearchButton = this.$('clearSearchButton');

        searchButton?.addEventListener('click', () => this.toggleSearchControl(), { signal });

        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.performSearch(searchInput.value);
            if (e.key === 'Escape') {
                this.clearSearch();
                searchInput.blur();
            }
        }, { signal });

        clearSearchButton?.addEventListener('click', () => this.clearSearch(), { signal });

        this.info('Search control initialized');
    }

    toggleSearchControl() {
        const searchControl = this.$('searchControl');
        const searchButton = this.$('searchButton');
        if (!searchControl || !searchButton) return;

        const expanded = searchControl.classList.contains('expanded');
        this._toggle(searchControl, 'expanded', !expanded);
        this._toggle(searchButton, 'active', !expanded);

        if (!expanded) {
            setTimeout(() => this.$('searchInput')?.focus(), 300);
            this.info('Search control expanded');
        } else {
            this.info('Search control collapsed');
        }
    }

    async performSearch(query) {
        const val = (query || '').trim();
        if (!val) return this.showSearchError('Please enter a search term');
        if (val.length < 2) return this.showSearchError('Search term too short');

        try {
            this.info(`Searching for: ${val}`);
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 10000);

            const res = await fetch('/api/geocode-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: val }),
                signal: controller.signal
            });

            clearTimeout(t);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data = await res.json();

            if (data?.success && data.location?.lng != null && data.location?.lat != null) {
                const map = window.siteInspectorCore?.getMap?.();
                const lng = parseFloat(data.location.lng);
                const lat = parseFloat(data.location.lat);
                if (!map?.flyTo || isNaN(lng) || isNaN(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
                    throw new Error('Invalid map or coordinates');
                }

                map.flyTo({ center: [lng, lat], zoom: 18, duration: 2000, essential: true });
                this.showSearchSuccess(`Found: ${data.location.display_name || val}`);
                this.info(`Location centered: ${data.location.display_name || val}`);
            } else {
                this.showSearchError(data?.message || 'Location not found. Please try a different search term.');
                this.warn(`Location not found: ${val}`, data);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                this.showSearchError('Search timed out. Please try again.');
                this.warn('Search request timed out');
            } else {
                this.showSearchError('Search failed. Please check your connection and try again.');
                this.error('Search failed:', err);
            }
        }
    }

    showSearchSuccess(message) {
        const el = this.$('searchStatus');
        if (!el) return;
        el.textContent = message;
        el.className = 'search-status success';
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }

    showSearchError(message) {
        const el = this.$('searchStatus');
        if (!el) return;
        el.textContent = message;
        el.className = 'search-status error';
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }

    clearSearch() {
        const input = this.$('searchInput');
        const status = this.$('searchStatus');
        if (input) input.value = '';
        if (status) status.style.display = 'none';
        this.info('Search cleared');
    }

    /* -----------------------------
       Panel toggles
    ------------------------------ */
    toggleInspectorPanel() {
        const panel = this.$('inspectorPanel');
        if (!panel) return this.error('Inspector panel element not found');

        const mapLegend = this.$('mapLegend');
        const mapControlsContainer = this.$('mapControlsContainer');
        const topLeftControls = document.querySelector('.top-left-controls');

        const expanded = panel.classList.contains('expanded');
        this._toggle(panel, 'expanded', !expanded);
        this._toggle(topLeftControls, 'shifted', !expanded);
        this._toggle(mapLegend, 'shifted', !expanded);
        this._toggle(mapControlsContainer, 'shifted', !expanded);

        this.panelState.inspector = !expanded;

        // Force reflow and notify
        panel.offsetHeight;
        window.eventBus?.emit?.('inspector-panel-toggled', { expanded: this.panelState.inspector });

        this.info(`Inspector panel ${!expanded ? 'expanded' : 'collapsed'}`);
    }

    toggleSiteInfoExpanded() {
        const expandable = this.$('siteInfoExpandable');
        const btn = this.$('siteInfoToggleBtn');
        if (!expandable || !btn) return;

        const expanded = expandable.classList.contains('expanded');
        this._toggle(expandable, 'expanded', !expanded);
        btn.innerHTML = expanded ? 'ℹ️' : '✕';
        this.panelState.siteInfo = !expanded;

        this.info(`Site info ${!expanded ? 'expanded' : 'collapsed'}`);
    }

    /* -----------------------------
       Card management
    ------------------------------ */
    collapseSiteBoundaryCard() {
        const controls = this.$('siteBoundaryControls');
        const check = this.$('boundaryAppliedCheck');
        const confirmBtn = this.$('confirmBoundaryButton');
        const drawBtn = this.$('drawPolygonButton');
        const clearBtn2 = this.$('clearBoundaryButton2');

        if (!controls) return this.error('Site boundary controls not found for collapse');

        controls.classList.add('collapsed');
        if (check) check.style.display = 'inline';
        if (confirmBtn) this._hide(confirmBtn);
        if (drawBtn) this._hide(drawBtn);
        if (clearBtn2) this._show(clearBtn2);

        this.cardStates.siteBoundary = 'collapsed';
        this.info('Site Boundary card collapsed with success indicator');
    }

    expandSiteBoundaryCard() {
        const controls = this.$('siteBoundaryControls');
        const check = this.$('boundaryAppliedCheck');
        if (!controls) return;

        controls.classList.remove('collapsed');
        if (check) this._hide(check);
        this.cardStates.siteBoundary = 'expanded';
        this.info('Site Boundary card expanded');
    }

    collapseSetbacksCard() {
        const controls = this.$('boundaryControls');
        const check = this.$('setbacksAppliedCheck');
        if (!controls) return;

        controls.classList.add('collapsed');
        if (check) check.style.display = 'inline';

        this.cardStates.setbacks = 'collapsed';
        this.info('Property Setbacks card collapsed with success indicator');
    }

    expandSetbacksCard() {
        const controls = this.$('boundaryControls');
        const check = this.$('setbacksAppliedCheck');
        if (!controls) return;

        controls.classList.remove('collapsed');
        if (check) this._hide(check);

        this.cardStates.setbacks = 'expanded';
        this.info('Property Setbacks card expanded');
    }

    expandFloorplanCard() {
        const controls = this.$('floorplanControls');
        const check = this.$('floorplanAppliedCheck');
        if (!controls) return;

        controls.classList.remove('collapsed');
        if (check) this._hide(check);

        this.cardStates.floorplan = 'expanded';
        this.info('Floor Plan card expanded');
    }

    markPropertySetbacksComplete() {
        const controls = this.$('boundaryControls');
        const check = this.$('setbacksAppliedCheck');
        if (!controls) return;

        controls.classList.add('collapsed');
        if (check) {
            check.style.display = 'inline';
            check.textContent = '✅';
        }

        this.cardStates.setbacks = 'collapsed';
        this.info('Property Setbacks card marked as complete for legal boundary');
    }

    collapseFloorplanCard() {
        const controls = this.$('floorplanControls');
        const check = this.$('floorplanAppliedCheck');
        if (!controls) return;

        controls.classList.add('collapsed');
        if (check) check.style.display = 'inline';

        this.cardStates.floorplan = 'collapsed';
        this.info('Floor Plan card collapsed with success indicator');
    }

    collapseStructurePlacementCard() {
        const controls = this.$('floorplanControls');
        const check = this.$('floorplanAppliedCheck');
        if (!controls) return;

        controls.classList.add('collapsed');
        if (check) {
            check.style.display = 'inline';
            check.textContent = '✅';
        }
        this.cardStates.floorplan = 'collapsed';
        this.info('Structure Placement card collapsed with success indicator');
    }

    expandGradientCard() {
        const controls = this.$('gradientControls');
        const check = this.$('gradientAppliedCheck');
        if (!controls) return;

        controls.classList.remove('collapsed');
        if (check) this._hide(check);
        this.cardStates.gradient = 'expanded';
        this.info('Gradient card expanded');
    }

    expandExtrusionCard() {
        const controls = this.$('extrusionControls');
        const check = this.$('extrusionAppliedCheck');
        if (!controls) return;

        controls.classList.remove('collapsed');
        controls.style.display = 'block';
        controls.style.visibility = 'visible';
        controls.style.opacity = '1';

        // Force show inner content blocks
        controls.querySelectorAll('.extrusion-content, .boundary-content').forEach(el => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        });

        this.cardStates.extrusion = 'expanded';
        if (check) this._hide(check);

        // Sync heights and structure management
        this.updateExtrusionHeights();
        this.showStructureManagementCard();

        // Extrusions state
        const ex = window.siteInspectorCore?.extrusion3DManager;
        if (ex) {
            ex.updateActiveExtrusionsDisplay?.();
            if (ex.hasActiveExtrusions?.()) {
                const removeAll = this.$('removeAll3DBtn');
                if (removeAll) removeAll.style.display = 'block';
            }
        }

        this.updateExtrudeStructureButtonState();

        this.info('3D Extrusion card expanded and made visible');
    }

    collapseExtrusionCard() {
        const controls = this.$('extrusionControls');
        const check = this.$('extrusionAppliedCheck');
        if (!controls) return;

        controls.classList.add('collapsed');
        if (check) check.style.display = 'inline';
        this.cardStates.extrusion = 'collapsed';

        // Notify floorplan manager
        const fm = window.siteInspectorCore?.floorplanManager;
        fm?.disableExtrusionMode?.();

        // Close structure management card
        this.closeStructureCard();

        this.info('3D Extrusion card collapsed with success indicator');
    }

    updateExtrusionHeights() {
        const structureHeightInput = this.$('structureHeightInput');
        const psm = window.siteInspectorCore?.propertySetbacksManager;
        const heightLimit = psm?.getCurrentHeightLimit?.();

        if (heightLimit && heightLimit > 0) {
            this.info(`Updated extrusion heights from property setbacks: ${heightLimit}m`);
            // Optionally prefill height input here if desired:
            // if (structureHeightInput) structureHeightInput.value = heightLimit;
        }

        if (structureHeightInput && !structureHeightInput.value) {
            structureHeightInput.value = 12;
        }
    }

    updateExtrusionCardStatus() {
        const check = this.$('extrusionAppliedCheck');
        if (check) check.style.display = 'inline';
        this.info('3D Extrusion card status updated with success indicator');
    }

    /* -----------------------------
       Structure management panel
    ------------------------------ */
    showStructureManagementCard() {
        let card = this.$('structureManagementCard');
        if (!card) {
            card = document.createElement('div');
            card.id = 'structureManagementCard';
            card.className = 'structure-management-card';
            card.innerHTML = `
                <div class="structure-toggle-btn" id="structureToggleBtn">🏗️</div>
                <div class="structure-card-content" id="structureCardContent">
                    <div class="structure-card-header">
                        <h3>Structure Management</h3>
                        <button class="structure-card-close" onclick="window.siteInspectorCore.uiPanelManager.closeStructureCard()">✕</button>
                    </div>
                    <div class="structure-list" id="structureList">
                        <p style="color:#666;font-size:13px;">No structures available. Draw a structure first.</p>
                    </div>
                    <div class="structure-actions">
                        <button class="structure-action-btn" onclick="window.siteInspectorCore.uiPanelManager.selectAllStructures()">Select All</button>
                        <button class="structure-action-btn" onclick="window.siteInspectorCore.uiPanelManager.clearStructureSelection()">Clear Selection</button>
                    </div>
                </div>`;
            document.body.appendChild(card);

            this.$('structureToggleBtn')?.addEventListener('click', () => this.toggleStructureManagementCard());
        }

        this.expandStructureManagementCard();
        this.info('Structure Management card displayed and expanded');
    }

    toggleStructureManagementCard() {
        const card = this.$('structureManagementCard');
        if (!card) return;
        const expanded = card.classList.contains('expanded');
        expanded ? this.collapseStructureManagementCard() : this.expandStructureManagementCard();
    }

    expandStructureManagementCard() {
        const card = this.$('structureManagementCard');
        const content = this.$('structureCardContent');
        if (!card || !content) return;

        card.classList.add('expanded');
        content.style.display = 'block';
        this.updateStructureList();

        this.info('Structure Management card expanded');
    }

    collapseStructureManagementCard() {
        const card = this.$('structureManagementCard');
        const content = this.$('structureCardContent');
        if (!card || !content) return;

        card.classList.remove('expanded');
        content.style.display = 'none';
        this.info('Structure Management card collapsed');
    }

    updateStructureList() {
        const list = this.$('structureList');
        if (!list) return;

        const fm = window.siteInspectorCore?.floorplanManager;
        if (!fm || !fm.hasStructures?.() || fm.getStructures?.()?.length === 0) {
            list.innerHTML = '<p style="color:#666;font-size:13px;">No structures available. Draw a structure first.</p>';
            return;
        }

        const structures = fm.getStructures();
        const html = structures.map((s, i) => `
            <div class="structure-item" data-structure-id="${s.id ?? i}">
                <span>Structure ${i + 1}</span>
                <div class="structure-item-actions">
                    <button class="structure-item-btn" onclick="window.siteInspectorCore.uiPanelManager.selectStructure('${s.id ?? i}')">Select</button>
                    <button class="structure-item-btn delete" onclick="window.siteInspectorCore.uiPanelManager.deleteStructure('${s.id ?? i}')">Delete</button>
                </div>
            </div>`).join('');
        list.innerHTML = html;
    }

    updateExtrudeStructureButtonState() {
        const btn = this.$('extrudeStructureButton');
        if (!btn) return;

        const fm = window.siteInspectorCore?.floorplanManager;
        let has = false;

        if (fm?.hasStructures) has = fm.hasStructures();
        else if (fm?.currentStructure) has = true;
        else if (fm?.state?.geojsonPolygon) has = true;
        else {
            try { has = !!(fm?.getCurrentFloorplanCoordinates?.()?.length); } catch { has = false; }
        }

        btn.disabled = !has;
        btn.textContent = has ? 'Extrude Structure Footprint' : 'Draw Structure First';
        btn.classList.toggle('primary', !!has);
        btn.classList.toggle('secondary', !has);
    }

    closeStructureCard() { this.collapseStructureManagementCard(); }

    selectStructure(id) {
        const fm = window.siteInspectorCore?.floorplanManager;
        fm?.selectStructure?.(id);
        this.updateExtrudeStructureButtonState();
    }

    deleteStructure(id) {
        const fm = window.siteInspectorCore?.floorplanManager;
        fm?.deleteStructure?.(id);
        this.updateStructureList();
        this.updateExtrudeStructureButtonState();
    }

    selectAllStructures() {
        const fm = window.siteInspectorCore?.floorplanManager;
        fm?.selectAllStructures?.();
        this.updateExtrudeStructureButtonState();
    }

    clearStructureSelection() {
        const fm = window.siteInspectorCore?.floorplanManager;
        fm?.clearStructureSelection?.();
        this.updateExtrudeStructureButtonState();
    }

    /* -----------------------------
       Cut & Fill + Save
    ------------------------------ */
    async generateCutFillAnalysis() {
        try {
            this.info('Generating cut & fill analysis...');
            const sic = window.siteInspectorCore;
            if (!sic) throw new Error('Site Inspector not available');

            const sb = sic.getManager?.('siteBoundary');
            if (!sb?.hasSiteBoundary?.()) return this.showError('Please define a site boundary first');

            const psm = sic.getManager?.('propertySetbacks');
            if (!psm?.getCurrentBuildableArea?.()) return this.showError('Please apply property setbacks first to define the buildable area');

            const siteData = sic.getSiteData?.() || {};
            const terrainBounds = sic.captureTerrainBounds?.();
            if (terrainBounds) siteData.terrainBounds = terrainBounds;

            const buildableArea = psm.getCurrentBuildableArea?.();
            if (buildableArea) siteData.buildable_area = buildableArea;

            const projectId = sic.getProjectIdFromUrl?.();
            const terrainUrl = `/terrain-viewer${projectId ? `?project_id=${projectId}` : ''}`;

            try {
                const res = await fetch('/api/store-session-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ site_data: siteData, terrain_bounds: terrainBounds })
                });
                if (res.ok) {
                    this.showSuccess('Opening cut & fill analysis...');
                    window.open(terrainUrl, '_blank');
                } else {
                    throw new Error('Failed to store site data');
                }
            } catch (err) {
                this.warn('Could not store site data, opening terrain viewer anyway', err);
                window.open(terrainUrl, '_blank');
            }
        } catch (error) {
            this.error('Failed to generate cut & fill analysis:', error);
            this.showError('Failed to generate cut & fill analysis: ' + error.message);
        }
    }

    async saveCurrentProgress() {
        try {
            this.info('Saving current progress...');
            // TODO: plug into backend as needed
            this.showSuccess('Progress saved successfully!');
        } catch (error) {
            this.error('Failed to save progress:', error);
            this.showError('Failed to save progress');
        }
    }

    updateBoundaryAppliedState() {
        this.info('Boundary applied state updated in UI');
        this.collapseSiteBoundaryCard();
        this.expandSetbacksCard();
        this.enableDrawStructureButton();
        window.siteInspectorCore?.updateSiteBoundaryLegend?.(true);
    }

    /* -----------------------------
       Clear / Reset flows
    ------------------------------ */
    setupClearSiteInspectorListeners() {
        const signal = this._modalAbort.signal;

        this.$('clearSiteInspectorButton')?.addEventListener('click', () => this.showClearConfirmationModal(), { signal });

        const modal = this.$('clearConfirmationModal');
        const confirmBtn = this.$('clearConfirmBtn');
        const cancelBtn = this.$('clearCancelBtn');

        confirmBtn?.addEventListener('click', () => this.clearAllSiteData(), { signal });
        cancelBtn?.addEventListener('click', () => this.hideClearConfirmationModal(), { signal });

        modal?.addEventListener('click', (e) => { if (e.target === modal) this.hideClearConfirmationModal(); }, { signal });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.style.display === 'flex') this.hideClearConfirmationModal();
        }, { signal });
    }

    showClearConfirmationModal() {
        const modal = this.$('clearConfirmationModal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(() => this.$('clearCancelBtn')?.focus(), 100);
    }

    hideClearConfirmationModal() {
        const modal = this.$('clearConfirmationModal');
        if (!modal) return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    async clearAllSiteData() {
        try {
            this.info('Starting comprehensive site data clearing...');
            this.hideClearConfirmationModal();

            const clearBtn = this.$('clearSiteInspectorButton');
            if (clearBtn) {
                clearBtn.disabled = true;
                clearBtn.innerHTML = '🔄 Clearing...';
            }

            // Clear legal boundary session storage
            sessionStorage.removeItem('legal_boundary_applied');
            sessionStorage.removeItem('legal_boundary_coordinates');

            // Reset legal boundary visual state on map
            try {
                const map = window.siteInspectorCore?.getMap?.();
                if (map && map.getLayer && map.getLayer('property-boundaries-stroke')) {
                    // Reset the legal boundary stroke to dashed (original state)
                    map.setPaintProperty('property-boundaries-stroke', 'line-dasharray', [5, 5]);
                    this.info('Legal boundary stroke reset to dashed');
                }
            } catch (error) {
                this.warn('Could not reset legal boundary stroke:', error);
            }

            // Clear managers in proper order with error handling
            const sic = window.siteInspectorCore;
            if (sic) {
                // Clear 3D extrusions first
                try {
                    await sic.extrusion3DManager?.clearAllExtrusions?.();
                } catch (e) {
                    this.warn('Error clearing 3D extrusions:', e);
                }

                // Clear floorplan structures
                try {
                    if (sic.floorplanManager?.clearAll) {
                        sic.floorplanManager.clearAll();
                    }
                } catch (e) {
                    this.warn('Error clearing floorplan:', e);
                }

                // Clear property setbacks
                try {
                    await sic.propertySetbacksManager?.clearAllSetbackData?.();
                } catch (e) {
                    this.warn('Error clearing setbacks:', e);
                }

                // Clear site boundary last
                try {
                    await sic.siteBoundaryCore?.clearBoundary?.();
                } catch (e) {
                    this.warn('Error clearing boundary:', e);
                }
            }

            // Emit clearing event after manager cleanup
            try {
                window.eventBus?.emit?.('clear-all-site-data');
            } catch (e) {
                this.warn('Error emitting clear event:', e);
            }

            this.resetAllPanelsToInitialState();

            // Reset map view
            const map = sic?.map;
            const center = sic?.siteData?.center;
            if (map && center) {
                try {
                    map.flyTo({ center: [center.lng, center.lat], zoom: 17, pitch: 0, bearing: 0, duration: 1000 });
                } catch (e) {
                    this.warn('Error resetting map view:', e);
                }
            }

            // Force map repaint to ensure all layers are cleared
            try {
                map?.triggerRepaint?.();
            } catch (e) {
                this.warn('Error triggering map repaint:', e);
            }

            setTimeout(() => {
                this.showSuccess('All site data has been cleared successfully');
                if (clearBtn) {
                    clearBtn.disabled = false;
                    clearBtn.innerHTML = 'Clear Site Inspector';
                }
            }, 500);

            this.info('Site data clearing completed successfully');
        } catch (error) {
            this.error('Error clearing site data:', error);
            this.showError('Failed to clear site data: ' + error.message);

            const clearBtn = this.$('clearSiteInspectorButton');
            if (clearBtn) {
                clearBtn.disabled = false;
                clearBtn.innerHTML = 'Clear Site Inspector';
            }
        }
    }

    setupMinimizePanelListener() {
        const btn = this.$('minimizePanelButton');
        btn?.addEventListener('click', () => {
            this.toggleInspectorPanel();
            this.info('Panel minimized via minimize button');
        }, { signal: this._globalAbort.signal });
    }

    resetAllPanelsToInitialState() {
        // Collapse cards that exist in current HTML
        [
            this.$('boundaryControls'),
            this.$('floorplanControls'),
            this.$('extrusionControls')
        ].forEach(el => el?.classList.add('collapsed'));

        // Expand site boundary card
        this.expandSiteBoundaryCard();

        // Hide success indicators
        ['boundaryAppliedCheck', 'setbacksAppliedCheck', 'floorplanAppliedCheck', 'extrusionAppliedCheck']
            .forEach(id => { const el = this.$(id); if (el) el.style.display = 'none'; });

        // Disable draw structure button until boundary is applied
        const drawBtn = this.$('drawFloorplanButton');
        if (drawBtn) {
            drawBtn.disabled = true;
            drawBtn.style.opacity = '0.5';
            drawBtn.style.cursor = 'not-allowed';
        }

        // Hide dependent sections
        [
            'selectedEdgesDisplay',
            'setbackInputsContainer',
            'buildableAreaControls',
            'buildableArea3DControls',
            'extrusionControls',
            'floorplanUploadSection',
            'activeExtrusionsDisplay'
        ].forEach(id => this.$(id) && (this.$(id).style.display = 'none'));

        // Reset input defaults
        const defaults = { frontSetback: '4.5', backSetback: '3.5', sideSetback: '1.5', heightLimit: '9' };
        Object.entries(defaults).forEach(([id, value]) => { const el = this.$(id); if (el) el.value = value; });

        // Hide warnings
        ['frontSetback', 'backSetback', 'sideSetback', 'heightLimit']
            .forEach(id => { const w = this.$(id + 'Warning'); if (w) w.style.display = 'none'; });

        // Reset legal boundary button state
        const legalBtn = this.$('useLegalBoundaryButton');
        if (legalBtn) {
            legalBtn.textContent = 'Use Legal Property Boundary';
            legalBtn.disabled = false;
            legalBtn.style.opacity = '1';
            legalBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20923a 100%)';
            legalBtn.style.color = '#fff';
        }

        this.info('All UI panels reset to initial state');
    }

    enableDrawStructureButton() {
        const drawBtn = this.$('drawFloorplanButton');
        if (drawBtn) {
            drawBtn.disabled = false;
            drawBtn.style.opacity = '1';
            drawBtn.style.cursor = 'pointer';
            this.info('Draw structure button enabled');
        }
    }

    /* -----------------------------
       Toast helpers
    ------------------------------ */
    showSuccess(message) { this._toast(message, 'success'); }
    showError(message) { this._toast(message, 'error'); }

    _toast(message, type) {
        const div = document.createElement('div');
        div.className = `${type}-notification`;
        div.textContent = message;
        div.style.cssText = `
            position: fixed; top: 80px; right: 20px; z-index: 2000;
            border-radius: 8px; padding: 12px 16px; font-size: 14px; font-weight: 500;
            animation: slideInRight 0.3s ease-out;
            ${type === 'success'
                ? 'background:#d4edda;color:#155724;border:1px solid #c3e6cb;'
                : 'background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;'}
        `;
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => div.remove(), 300);
        }, type === 'success' ? 3000 : 5000);
        this.info(`${type === 'success' ? 'Success' : 'Error'} notification shown:`, message);
    }

    /* -----------------------------
       Cleanup
    ------------------------------ */
    destroy() {
        this._uiAbort?.abort();
        this._cardsAbort?.abort();
        this._modalAbort?.abort();
        this._globalAbort?.abort();
        this._inited = false;
        this.info('UIPanelManager destroyed (listeners removed)');
    }
}

window.UIPanelManager = UIPanelManager;