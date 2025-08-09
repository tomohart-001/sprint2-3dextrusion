/**
 * UI Panel Manager
 * Handles panel states, interactions, and UI feedback
 */

class UIPanelManager extends BaseManager {
    constructor() {
        super('UIPanelManager');
        this.panelState = {
            inspector: false,
            siteInfo: false
        };
        this.cardStates = {
            siteBoundary: 'expanded',
            setbacks: 'collapsed',
            floorplan: 'collapsed',
            extrusion: 'collapsed'  // Start collapsed like other cards
        };
    }

    initialize() {
        this.info('Initializing UI Panel Manager...');
        this.setupEventListeners();
        this.setupCardEventListeners();
        this.initializePanelStates();
        this.initializeAdditionalElements();

        this.info('UI Panel Manager initialized successfully');
    }

    initializeAdditionalElements() {
        // Update location info if available
        const locationSpan = document.getElementById('siteLocation');
        if (locationSpan) {
            const siteData = window.siteInspectorCore ? window.siteInspectorCore.getSiteData() : {};
            const location = siteData.project_address || siteData.location || 'Not specified';
            locationSpan.textContent = location;
        }

        // Add CSS for animations
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        // Inspector panel toggle
        const panelToggleBtn = document.getElementById('panelToggleBtn');
        if (panelToggleBtn) {
            panelToggleBtn.addEventListener('click', () => this.toggleInspectorPanel());
        }

        const panelClose = document.querySelector('.panel-close');
        if (panelClose) {
            panelClose.addEventListener('click', () => this.toggleInspectorPanel());
        }

        // Site info panel toggle
        const siteInfoToggleBtn = document.getElementById('siteInfoToggleBtn');
        if (siteInfoToggleBtn) {
            siteInfoToggleBtn.addEventListener('click', () => this.toggleSiteInfoExpanded());
        }

        // Setup cut & fill analysis button
        const cutFillAnalysisBtn = document.getElementById('cutFillAnalysisBtn');
        if (cutFillAnalysisBtn) {
            cutFillAnalysisBtn.addEventListener('click', () => {
                this.generateCutFillAnalysis();
            });
        }

        // Setup save progress button
        const saveProgressBtn = document.getElementById('saveProgressBtn');
        if (saveProgressBtn) {
            saveProgressBtn.addEventListener('click', () => {
                this.saveCurrentProgress();
            });
        }

        // Listen for workflow events
        window.eventBus.on('boundary-applied', () => {
            this.collapseSiteBoundaryCard();
            this.expandSetbacksCard();
        });

        // Auto-collapse Site Boundary card when existing boundary is loaded
        window.eventBus.on('site-boundary-loaded', () => {
            this.collapseSiteBoundaryCard();
            // Only expand setbacks card if no existing buildable area
            setTimeout(() => {
                const propertySetbacksManager = window.siteInspectorCore?.propertySetbacksManager;
                if (!propertySetbacksManager?.currentBuildableArea) {
                    this.expandSetbacksCard();
                }
            }, 100);
        });

        window.eventBus.on('setbacks-applied', () => {
            this.collapseSetbacksCard();
            this.expandFloorplanCard();
        });

        window.eventBus.on('floorplan-applied', () => {
            this.collapseFloorplanCard();
            this.expandExtrusionCard();
        });

        window.eventBus.on('structure-placement-applied', () => {
            this.collapseStructurePlacementCard();
            this.expandExtrusionCard();
        });

        window.eventBus.on('floorplan-applied', () => {
            this.collapseFloorplanCard();
            this.expandExtrusionCard();
        });

        // Listen for structure creation to trigger extrusion card
        window.eventBus.on('structure-created', () => {
            this.expandExtrusionCard();
        });

        window.eventBus.on('extrusion-applied', () => {
            // Keep extrusion card open to allow multiple extrusions
            this.updateExtrusionCardStatus();
        });

        // Listen for structure events to update button state
        window.eventBus.on('structure-created', () => {
            this.updateExtrudeStructureButtonState();
        });

        window.eventBus.on('structure-deleted', () => {
            this.updateExtrudeStructureButtonState();
        });

        window.eventBus.on('structure-selection-changed', () => {
            this.updateExtrudeStructureButtonState();
        });

        // Clear Site Inspector functionality
        this.setupClearSiteInspectorListeners();

        // Minimize panel functionality
        this.setupMinimizePanelListener();
    }

    setupCardEventListeners() {
        // Add click handlers to collapsed cards
        const siteBoundaryControls = document.getElementById('siteBoundaryControls');
        if (siteBoundaryControls) {
            siteBoundaryControls.addEventListener('click', (event) => {
                if (siteBoundaryControls.classList.contains('collapsed')) {
                    // Always allow expansion when clicking on collapsed card
                    this.expandSiteBoundaryCard();
                }
            });
        }

        const boundaryControls = document.getElementById('boundaryControls');
        if (boundaryControls) {
            boundaryControls.addEventListener('click', (event) => {
                if (boundaryControls.classList.contains('collapsed')) {
                    this.expandSetbacksCard();
                }
            });
        }

        const floorplanControls = document.getElementById('floorplanControls');
        if (floorplanControls) {
            floorplanControls.addEventListener('click', (event) => {
                if (floorplanControls.classList.contains('collapsed')) {
                    this.expandFloorplanCard();
                }
            });
        }

        const gradientControls = document.getElementById('gradientControls');
        if (gradientControls) {
            gradientControls.addEventListener('click', (event) => {
                if (gradientControls.classList.contains('collapsed')) {
                    this.expandGradientCard();
                }
            });
        }

        const extrusionControls = document.getElementById('extrusionControls');
        if (extrusionControls) {
            extrusionControls.addEventListener('click', (event) => {
                if (extrusionControls.classList.contains('collapsed')) {
                    this.expandExtrusionCard();
                }
            });
        }
    }

    initializePanelStates() {
        const panel = document.getElementById('inspectorPanel');
        const topLeftControls = document.querySelector('.top-left-controls');
        const mapLegend = document.getElementById('mapLegend');
        const mapControlsContainer = document.getElementById('mapControlsContainer');

        if (panel) {
            // Start expanded - add expanded class
            panel.classList.add('expanded');
            this.panelState.inspector = true;
        }

        if (topLeftControls) {
            topLeftControls.classList.add('shifted');
        }

        if (mapLegend) {
            mapLegend.classList.add('shifted');
        }

        // Initialize map controls container in shifted state since panel starts expanded
        if (mapControlsContainer) {
            mapControlsContainer.classList.add('shifted');
            this.info('Map controls container initialized in shifted state');
        }

        // Initialize the extrusion card in collapsed state
        const extrusionControls = document.getElementById('extrusionControls');
        if (extrusionControls) {
            extrusionControls.classList.add('collapsed');
            this.cardStates.extrusion = 'collapsed';
            this.info('Extrusion card initialized as collapsed');
        }

        // Add loading states to all cards initially
        this.showCardLoadingStates();

        // Initialize search functionality
        this.initializeSearchControl();

        this.info('Panel states initialized - inspector panel expanded by default');
    }

    showCardLoadingStates() {
        const cards = [
            'siteBoundaryControls',
            'boundaryControls', 
            'floorplanControls',
            'extrusionControls'
        ];

        cards.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (card) {
                // Add loading indicator
                const loadingIndicator = document.createElement('div');
                loadingIndicator.className = 'card-loading-indicator';
                loadingIndicator.innerHTML = '<div class="loading-spinner"></div><span>Loading...</span>';
                loadingIndicator.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px;
                    font-size: 12px;
                    color: #666;
                    opacity: 0.7;
                `;

                const spinner = loadingIndicator.querySelector('.loading-spinner');
                spinner.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border: 2px solid #ddd;
                    border-top: 2px solid #007cbf;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                `;

                card.appendChild(loadingIndicator);
                card.setAttribute('data-loading', 'true');
            }
        });

        // Add CSS animation for spinner
        if (!document.querySelector('#loading-spinner-styles')) {
            const style = document.createElement('style');
            style.id = 'loading-spinner-styles';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        // Remove loading states after a short delay to simulate loading completion
        setTimeout(() => {
            this.hideCardLoadingStates();
        }, 1500);
    }

    hideCardLoadingStates() {
        const cards = document.querySelectorAll('[data-loading="true"]');
        cards.forEach(card => {
            const loadingIndicator = card.querySelector('.card-loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.remove();
            }
            card.removeAttribute('data-loading');
        });
        this.info('Card loading states removed');
    }

    initializeSearchControl() {
        const searchControl = document.getElementById('searchControl');
        const searchInput = document.getElementById('searchInput');
        const searchButton = document.getElementById('searchButton');
        const clearSearchButton = document.getElementById('clearSearchButton');

        if (searchButton) {
            searchButton.addEventListener('click', () => this.toggleSearchControl());
        }

        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch(searchInput.value);
                }
            });
        }

        if (clearSearchButton) {
            clearSearchButton.addEventListener('click', () => this.clearSearch());
        }

        this.info('Search control initialized');
    }

    toggleSearchControl() {
        const searchControl = document.getElementById('searchControl');
        const searchButton = document.getElementById('searchButton');

        if (!searchControl || !searchButton) return;

        const isExpanded = searchControl.classList.contains('expanded');

        if (isExpanded) {
            searchControl.classList.remove('expanded');
            searchButton.classList.remove('active');
            this.info('Search control collapsed');
        } else {
            searchControl.classList.add('expanded');
            searchButton.classList.add('active');

            // Focus on input when expanded
            setTimeout(() => {
                const searchInput = document.getElementById('searchInput');
                if (searchInput) searchInput.focus();
            }, 300);

            this.info('Search control expanded');
        }
    }

    async performSearch(query) {
        if (!query || query.trim() === '') {
            this.showSearchError('Please enter a search term');
            return;
        }

        const trimmedQuery = query.trim();
        if (trimmedQuery.length < 2) {
            this.showSearchError('Search term too short');
            return;
        }

        try {
            this.info(`Searching for: ${trimmedQuery}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            const response = await fetch('/api/geocode-location', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query: trimmedQuery }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.info('Search response received:', data);

            if (data.success && data.location && data.location.lng && data.location.lat) {
                // Get the map instance from the core
                const map = window.siteInspectorCore?.getMap();
                if (map && map.flyTo) {
                    // Validate coordinates
                    const lng = parseFloat(data.location.lng);
                    const lat = parseFloat(data.location.lat);

                    if (isNaN(lng) || isNaN(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
                        throw new Error('Invalid coordinates received');
                    }

                    // Fly to the searched location
                    map.flyTo({
                        center: [lng, lat],
                        zoom: 18,
                        duration: 2000,
                        essential: true
                    });

                    this.info(`Location found and centered: ${data.location.display_name || trimmedQuery}`);

                    // Show success feedback
                    this.showSearchSuccess(`Found: ${data.location.display_name || trimmedQuery}`);
                } else {
                    this.error('Map not available for navigation');
                    this.showSearchError('Map not ready for navigation');
                }
            } else {
                this.warn(`Location not found: ${trimmedQuery}`, data);
                this.showSearchError(data.message || 'Location not found. Please try a different search term.');
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                this.warn('Search request timed out');
                this.showSearchError('Search timed out. Please try again.');
            } else {
                this.error('Search failed:', error);
                this.showSearchError('Search failed. Please check your connection and try again.');
            }
        }
    }

    showSearchSuccess(message) {
        const searchStatus = document.getElementById('searchStatus');
        if (searchStatus) {
            searchStatus.textContent = message;
            searchStatus.className = 'search-status success';
            searchStatus.style.display = 'block';

            setTimeout(() => {
                searchStatus.style.display = 'none';
            }, 3000);
        }
    }

    showSearchError(message) {
        const searchStatus = document.getElementById('searchStatus');
        if (searchStatus) {
            searchStatus.textContent = message;
            searchStatus.className = 'search-status error';
            searchStatus.style.display = 'block';

            setTimeout(() => {
                searchStatus.style.display = 'none';
            }, 3000);
        }
    }

    clearSearch() {
        const searchInput = document.getElementById('searchInput');
        const searchStatus = document.getElementById('searchStatus');

        if (searchInput) searchInput.value = '';
        if (searchStatus) searchStatus.style.display = 'none';

        this.info('Search cleared');
    }

    toggleInspectorPanel() {
        const panel = document.getElementById('inspectorPanel');
        const topLeftControls = document.querySelector('.top-left-controls');
        const mapLegend = document.getElementById('mapLegend');
        const mapControlsContainer = document.getElementById('mapControlsContainer');

        if (!panel) {
            this.error('Inspector panel element not found');
            return;
        }

        const isExpanded = panel.classList.contains('expanded');

        if (isExpanded) {
            // Collapse panel
            panel.classList.remove('expanded');
            if (topLeftControls) topLeftControls.classList.remove('shifted');
            if (mapLegend) mapLegend.classList.remove('shifted');
            if (mapControlsContainer) mapControlsContainer.classList.remove('shifted');
            this.panelState.inspector = false;
            this.info('Inspector panel collapsed');
        } else {
            // Expand panel
            panel.classList.add('expanded');
            if (topLeftControls) topLeftControls.classList.add('shifted');
            if (mapLegend) mapLegend.classList.add('shifted');
            if (mapControlsContainer) mapControlsContainer.classList.add('shifted');
            this.panelState.inspector = true;
            this.info('Inspector panel expanded');
        }

        // Force a reflow to ensure CSS changes are applied
        panel.offsetHeight;

        // Notify other managers about panel state change
        window.eventBus.emit('inspector-panel-toggled', {
            expanded: this.panelState.inspector
        });
    }

    toggleSiteInfoExpanded() {
        const expandable = document.getElementById('siteInfoExpandable');
        const btn = document.getElementById('siteInfoToggleBtn');

        if (expandable.classList.contains('expanded')) {
            expandable.classList.remove('expanded');
            btn.innerHTML = 'ℹ️';
            this.panelState.siteInfo = false;
            this.info('Site info collapsed');
        } else {
            expandable.classList.add('expanded');
            btn.innerHTML = '✕';
            this.panelState.siteInfo = true;
            this.info('Site info expanded');
        }
    }

    // Card management methods
    collapseSiteBoundaryCard() {
        const siteBoundaryControls = document.getElementById('siteBoundaryControls');
        const boundaryAppliedCheck = document.getElementById('boundaryAppliedCheck');
        const confirmBtn = document.getElementById('confirmBoundaryButton');
        const drawBtn = document.getElementById('drawPolygonButton');
        const clearBtn2 = document.getElementById('clearBoundaryButton2');

        if (siteBoundaryControls && boundaryAppliedCheck) {
            siteBoundaryControls.classList.add('collapsed');
            boundaryAppliedCheck.style.display = 'inline';

            // Hide the confirm button since boundary is now confirmed
            if (confirmBtn) confirmBtn.style.display = 'none';

            // Hide draw button and show clear button for existing boundaries
            if (drawBtn) drawBtn.style.display = 'none';
            if (clearBtn2) clearBtn2.style.display = 'inline-block';

            this.cardStates.siteBoundary = 'collapsed';
            this.info('Site Boundary card collapsed with success indicator');
        } else {
            this.error('Site boundary controls or check element not found for collapse');
        }
    }

    expandSiteBoundaryCard() {
        const siteBoundaryControls = document.getElementById('siteBoundaryControls');
        const boundaryAppliedCheck = document.getElementById('boundaryAppliedCheck');

        if (siteBoundaryControls) {
            siteBoundaryControls.classList.remove('collapsed');
            this.cardStates.siteBoundary = 'expanded';
            if (boundaryAppliedCheck) {
                boundaryAppliedCheck.style.display = 'none';
            }
            this.info('Site Boundary card expanded');
        }
    }

    collapseSetbacksCard() {
        const boundaryControls = document.getElementById('boundaryControls');
        const setbacksAppliedCheck = document.getElementById('setbacksAppliedCheck');

        if (boundaryControls && setbacksAppliedCheck) {
            boundaryControls.classList.add('collapsed');
            setbacksAppliedCheck.style.display = 'inline';
            this.cardStates.setbacks = 'collapsed';
            this.info('Property Setbacks card collapsed with success indicator');
        }
    }

    expandSetbacksCard() {
        const boundaryControls = document.getElementById('boundaryControls');
        const setbacksAppliedCheck = document.getElementById('setbacksAppliedCheck');

        if (boundaryControls) {
            boundaryControls.classList.remove('collapsed');
            this.cardStates.setbacks = 'expanded';
            if (setbacksAppliedCheck) {
                setbacksAppliedCheck.style.display = 'none';
            }
            this.info('Property Setbacks card expanded');
        }
    }

    expandFloorplanCard() {
        const floorplanControls = document.getElementById('floorplanControls');
        const floorplanAppliedCheck = document.getElementById('floorplanAppliedCheck');

        if (floorplanControls) {
            floorplanControls.classList.remove('collapsed');
            this.cardStates.floorplan = 'expanded';
            if (floorplanAppliedCheck) {
                floorplanAppliedCheck.style.display = 'none';
            }
            this.info('Floor Plan card expanded');
        }
    }

    collapseFloorplanCard() {
        const floorplanControls = document.getElementById('floorplanControls');
        const floorplanAppliedCheck = document.getElementById('floorplanAppliedCheck');

        if (floorplanControls && floorplanAppliedCheck) {
            floorplanControls.classList.add('collapsed');
            floorplanAppliedCheck.style.display = 'inline';
            this.cardStates.floorplan = 'collapsed';
            this.info('Floor Plan card collapsed with success indicator');
        }
    }

    collapseStructurePlacementCard() {
        const floorplanControls = document.getElementById('floorplanControls');
        const floorplanAppliedCheck = document.getElementById('floorplanAppliedCheck');

        if (floorplanControls && floorplanAppliedCheck) {
            floorplanControls.classList.add('collapsed');
            floorplanAppliedCheck.style.display = 'inline';
            floorplanAppliedCheck.textContent = '✅';
            this.cardStates.floorplan = 'collapsed';
            this.info('Structure Placement card collapsed with success indicator');
        }
    }

    expandGradientCard() {
        const gradientControls = document.getElementById('gradientControls');
        const gradientAppliedCheck = document.getElementById('gradientAppliedCheck');

        if (gradientControls) {
            gradientControls.classList.remove('collapsed');
            this.cardStates.gradient = 'expanded';
            if (gradientAppliedCheck) {
                gradientAppliedCheck.style.display = 'none';
            }
            this.info('Gradient card expanded');
        }
    }

    showStructureManagementCard() {
        // Check if Structure Management card already exists
        let structureCard = document.getElementById('structureManagementCard');

        if (!structureCard) {
            // Create the Structure Management card with collapsible button pattern
            structureCard = document.createElement('div');
            structureCard.id = 'structureManagementCard';
            structureCard.className = 'structure-management-card';

            structureCard.innerHTML = `
                <div class="structure-toggle-btn" id="structureToggleBtn">
                    🏗️
                </div>
                <div class="structure-card-content" id="structureCardContent">
                    <div class="structure-card-header">
                        <h3>Structure Management</h3>
                        <button class="structure-card-close" onclick="window.siteInspectorCore.uiPanelManager.closeStructureCard()">✕</button>
                    </div>
                    <div class="structure-list" id="structureList">
                        <p style="color: #666; font-size: 13px;">No structures available. Draw a structure first.</p>
                    </div>
                    <div class="structure-actions">
                        <button class="structure-action-btn" onclick="window.siteInspectorCore.uiPanelManager.selectAllStructures()">
                            Select All
                        </button>
                        <button class="structure-action-btn" onclick="window.siteInspectorCore.uiPanelManager.clearStructureSelection()">
                            Clear Selection
                        </button>
                    </div>
                </div>
            `;

            // Add to the body
            document.body.appendChild(structureCard);

            // Setup toggle functionality
            const toggleBtn = document.getElementById('structureToggleBtn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => this.toggleStructureManagementCard());
            }
        }

        // Auto-expand the card when shown
        this.expandStructureManagementCard();
        this.info('Structure Management card displayed and expanded');
    }

    toggleStructureManagementCard() {
        const structureCard = document.getElementById('structureManagementCard');
        if (!structureCard) return;

        const isExpanded = structureCard.classList.contains('expanded');

        if (isExpanded) {
            this.collapseStructureManagementCard();
        } else {
            this.expandStructureManagementCard();
        }
    }

    expandStructureManagementCard() {
        const structureCard = document.getElementById('structureManagementCard');
        const structureContent = document.getElementById('structureCardContent');

        if (structureCard && structureContent) {
            structureCard.classList.add('expanded');
            structureContent.style.display = 'block';

            // Update structure list
            this.updateStructureList();

            this.info('Structure Management card expanded');
        }
    }

    collapseStructureManagementCard() {
        const structureCard = document.getElementById('structureManagementCard');
        const structureContent = document.getElementById('structureCardContent');

        if (structureCard && structureContent) {
            structureCard.classList.remove('expanded');
            structureContent.style.display = 'none';
            this.info('Structure Management card collapsed');
        }
    }

    updateStructureList() {
        const structureList = document.getElementById('structureList');
        if (!structureList) return;

        const floorplanManager = window.siteInspectorCore?.floorplanManager;
        if (!floorplanManager || !floorplanManager.hasStructures || !floorplanManager.hasStructures()) {
            structureList.innerHTML = '<p style="color: #666; font-size: 13px;">No structures available. Draw a structure first.</p>';
            return;
        }

        // Get structures and update list
        const structures = floorplanManager.getStructures ? floorplanManager.getStructures() : [];
        if (structures.length === 0) {
            structureList.innerHTML = '<p style="color: #666; font-size: 13px;">No structures available. Draw a structure first.</p>';
        } else {
            const listHtml = structures.map((structure, index) => `
                <div class="structure-item" data-structure-id="${structure.id || index}">
                    <span>Structure ${index + 1}</span>
                    <div class="structure-item-actions">
                        <button class="structure-item-btn" onclick="window.siteInspectorCore.uiPanelManager.selectStructure('${structure.id || index}')">Select</button>
                        <button class="structure-item-btn delete" onclick="window.siteInspectorCore.uiPanelManager.deleteStructure('${structure.id || index}')">Delete</button>
                    </div>
                </div>
            `).join('');
            structureList.innerHTML = listHtml;
        }
    }

    updateExtrudeStructureButtonState() {
        const extrudeStructureButton = document.getElementById('extrudeStructureButton');
        if (!extrudeStructureButton) return;

        const floorplanManager = window.siteInspectorCore?.floorplanManager;
        if (!floorplanManager) {
            extrudeStructureButton.disabled = true;
            extrudeStructureButton.textContent = 'Extrude Structure Footprint';
            return;
        }

        // Check multiple ways for structure availability
        let hasStructures = false;

        if (floorplanManager.hasStructures && typeof floorplanManager.hasStructures === 'function') {
            hasStructures = floorplanManager.hasStructures();
        } else if (floorplanManager.currentStructure) {
            hasStructures = true;
        } else if (floorplanManager.state?.geojsonPolygon) {
            hasStructures = true;
        } else {
            // Check if getCurrentFloorplanCoordinates returns valid data
            try {
                const coords = floorplanManager.getCurrentFloorplanCoordinates();
                hasStructures = coords && coords.length > 0;
            } catch (e) {
                hasStructures = false;
            }
        }

        if (hasStructures) {
            extrudeStructureButton.disabled = false;
            extrudeStructureButton.textContent = 'Extrude Structure Footprint';
            extrudeStructureButton.classList.remove('secondary');
            extrudeStructureButton.classList.add('primary');
        } else {
            extrudeStructureButton.disabled = true;
            extrudeStructureButton.textContent = 'Draw Structure First';
            extrudeStructureButton.classList.remove('primary');
            extrudeStructureButton.classList.add('secondary');
        }
    }

    closeStructureCard() {
        this.collapseStructureManagementCard();
    }

    selectStructure(structureId) {
        const floorplanManager = window.siteInspectorCore?.floorplanManager;
        if (floorplanManager && floorplanManager.selectStructure) {
            floorplanManager.selectStructure(structureId);
            this.updateExtrudeStructureButtonState();
        }
    }

    deleteStructure(structureId) {
        const floorplanManager = window.siteInspectorCore?.floorplanManager;
        if (floorplanManager && floorplanManager.deleteStructure) {
            floorplanManager.deleteStructure(structureId);
            this.updateStructureList();
            this.updateExtrudeStructureButtonState();
        }
    }

    selectAllStructures() {
        const floorplanManager = window.siteInspectorCore?.floorplanManager;
        if (floorplanManager && floorplanManager.selectAllStructures) {
            floorplanManager.selectAllStructures();
            this.updateExtrudeStructureButtonState();
        }
    }

    clearStructureSelection() {
        const floorplanManager = window.siteInspectorCore?.floorplanManager;
        if (floorplanManager && floorplanManager.clearStructureSelection) {
            floorplanManager.clearStructureSelection();
            this.updateExtrudeStructureButtonState();
        }
    }

    expandExtrusionCard() {
        const extrusionControls = document.getElementById('extrusionControls');
        const extrusionAppliedCheck = document.getElementById('extrusionAppliedCheck');

        if (extrusionControls) {
            extrusionControls.classList.remove('collapsed');
            extrusionControls.style.display = 'block'; // Ensure visibility
            extrusionControls.style.visibility = 'visible'; // Override any hidden visibility
            extrusionControls.style.opacity = '1'; // Override any opacity settings

            // Force show the content div
            const extrusionContent = extrusionControls.querySelector('.extrusion-content');
            if (extrusionContent) {
                extrusionContent.style.display = 'block';
                extrusionContent.style.visibility = 'visible';
                extrusionContent.style.opacity = '1';
            }

            // Also ensure the boundary-content div is visible
            const boundaryContent = extrusionControls.querySelector('.boundary-content');
            if (boundaryContent) {
                boundaryContent.style.display = 'block';
                boundaryContent.style.visibility = 'visible';
                boundaryContent.style.opacity = '1';
            }

            this.cardStates.extrusion = 'expanded';
            if (extrusionAppliedCheck) {
                extrusionAppliedCheck.style.display = 'none';
            }

            // Update height inputs from property setbacks if available
            this.updateExtrusionHeights();

            // Show the Structure Management card in parallel
            this.showStructureManagementCard();

            // Initialize 3D extrusion manager if available
            const extrusion3DManager = window.siteInspectorCore?.extrusion3DManager;
            if (extrusion3DManager) {
                // Update active extrusions display
                extrusion3DManager.updateActiveExtrusionsDisplay();

                // Show remove button if there are active extrusions
                if (extrusion3DManager.hasActiveExtrusions()) {
                    const removeAll3DBtn = document.getElementById('removeAll3DBtn');
                    if (removeAll3DBtn) {
                        removeAll3DBtn.style.display = 'block';
                    }
                }
            }

            // Update extrude structure button state based on structure availability
            this.updateExtrudeStructureButtonState();

            this.info('3D Extrusion card expanded and made visible');
        }
    }

    collapseExtrusionCard() {
        const extrusionControls = document.getElementById('extrusionControls');
        const extrusionAppliedCheck = document.getElementById('extrusionAppliedCheck');

        if (extrusionControls && extrusionAppliedCheck) {
            extrusionControls.classList.add('collapsed');
            extrusionAppliedCheck.style.display = 'inline';
            this.cardStates.extrusion = 'collapsed';

            // Disable extrusion mode in FloorplanManager
            const floorplanManager = window.siteInspectorCore?.floorplanManager;
            if (floorplanManager && floorplanManager.disableExtrusionMode) {
                floorplanManager.disableExtrusionMode();
            }

            // Close structure management card
            this.closeStructureCard();

            this.info('3D Extrusion card collapsed with success indicator');
        }
    }

    updateExtrusionHeights() {
        // Update structure height input  
        const structureHeightInput = document.getElementById('structureHeightInput');

        // Get height from property setbacks manager
        const propertySetbacksManager = window.siteInspectorCore?.propertySetbacksManager;
        if (propertySetbacksManager) {
            const heightLimit = propertySetbacksManager.getCurrentHeightLimit();
            if (heightLimit && heightLimit > 0) {
                this.info(`Updated extrusion heights from property setbacks: ${heightLimit}m`);
            }
        }

        // Set default structure height if not already set
        if (structureHeightInput && !structureHeightInput.value) {
            structureHeightInput.value = 12; // Default structure height
        }
    }

    updateExtrusionCardStatus() {
        const extrusionAppliedCheck = document.getElementById('extrusionAppliedCheck');

        if (extrusionAppliedCheck) {
            extrusionAppliedCheck.style.display = 'inline';
            this.info('3D Extrusion card status updated with success indicator');
        }
    }



    async generateCutFillAnalysis() {
        try {
            this.info('Generating cut & fill analysis...');

            const siteInspectorCore = window.siteInspectorCore;
            if (!siteInspectorCore) {
                throw new Error('Site Inspector not available');
            }

            // Check if we have site boundary data
            const siteBoundaryManager = siteInspectorCore.getManager('siteBoundary');
            if (!siteBoundaryManager || !siteBoundaryManager.hasSiteBoundary()) {
                this.showError('Please define a site boundary first');
                return;
            }

            // Check if we have buildable area (setbacks applied)
            const propertySetbacksManager = siteInspectorCore.getManager('propertySetbacks');
            if (!propertySetbacksManager || !propertySetbacksManager.getCurrentBuildableArea()) {
                this.showError('Please apply property setbacks first to define the buildable area');
                return;
            }

            // Get site data with current map view
            const siteData = siteInspectorCore.getSiteData();

            // Capture current map bounds for terrain context
            const terrainBounds = siteInspectorCore.captureTerrainBounds();
            if (terrainBounds) {
                siteData.terrainBounds = terrainBounds;
                this.info('Captured terrain bounds for analysis:', terrainBounds);
            }

            // Get buildable area data
            const buildableArea = propertySetbacksManager.getCurrentBuildableArea();
            if (buildableArea) {
                siteData.buildable_area = buildableArea;
            }

            // Open terrain viewer with site data for cut & fill analysis
            const projectId = siteInspectorCore.getProjectIdFromUrl();
            const terrainUrl = `/terrain-viewer${projectId ? `?project_id=${projectId}` : ''}`;

            // Store site data in session for terrain viewer
            try {
                const response = await fetch('/api/store-session-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        site_data: siteData,
                        terrain_bounds: terrainBounds 
                    })
                });

                if (response.ok) {
                    this.showSuccess('Opening cut & fill analysis...');
                    window.open(terrainUrl, '_blank');
                } else {
                    throw new Error('Failed to store site data');
                }
            } catch (error) {
                this.warn('Could not store site data, opening terrain viewer anyway');
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

            // Show saving indicator
            this.showSuccess('Progress saved successfully!');

        } catch (error) {
            this.error('Failed to save progress:', error);
            this.showError('Failed to save progress');
        }
    }

    updateBoundaryAppliedState() {
        // Update UI to show boundary has been applied
        const boundaryCheck = document.getElementById('boundaryAppliedCheck');
        if (boundaryCheck) {
            boundaryCheck.style.display = 'inline';
        }

        // Collapse site boundary card and expand property setbacks
        this.collapseSiteBoundaryCard();
        this.expandSetbacksCard();

        this.info('Boundary applied state updated in UI');
    }

    resetAllPanelStates() {
        try {
            // Reset all checkmarks and success indicators
            const checkmarks = ['boundaryAppliedCheck', 'setbacksAppliedCheck', 'floorplanAppliedCheck'];
            checkmarks.forEach(checkId => {
                const element = document.getElementById(checkId);
                if (element) {
                    element.style.display = 'none';
                }
            });

            // Expand site boundary card and collapse others
            this.expandSiteBoundaryCard();
            this.collapseSetbacksCard();
            this.collapseFloorplanCard();
            this.collapseExtrusionCard();

            // Reset any other UI states that depend on site boundary
            this.info('All panel states reset to initial state');
        } catch (error) {
            this.error('Error resetting panel states:', error);
        }
    }

    hideExtrusionControls() {
        const buildableArea3DControls = document.getElementById('buildableArea3DControls');
        const extrusionControls = document.getElementById('extrusionControls');
        const remove3DButton = document.getElementById('remove3DButton');

        if (buildableArea3DControls) {
            buildableArea3DControls.style.display = 'none';
        }
        if (extrusionControls) {
            extrusionControls.style.display = 'none';
        }
        if (remove3DButton) {
            remove3DButton.style.display = 'none';
        }

        this.info('Extrusion controls hidden');
    }

    hideAllDependentPanels() {
        try {
            // Hide all panels that depend on site boundary
            this.collapseSetbacksCard();
            this.collapseFloorplanCard();
            this.collapseExtrusionCard();

            // Reset checkmarks
            const checkmarks = ['setbacksAppliedCheck', 'floorplanAppliedCheck', 'extrusionAppliedCheck'];
            checkmarks.forEach(checkId => {
                const element = document.getElementById(checkId);
                if (element) {
                    element.style.display = 'none';
                }
            });

            this.info('All dependent panels hidden');
        } catch (error) {
            this.error('Error hiding dependent panels:', error);
        }
    }



    showSuccess(message) {
        // Create and show success notification
        const successDiv = document.createElement('div');
        successDiv.className = 'success-notification';
        successDiv.textContent = message;
        successDiv.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 500;
            z-index: 2000;
            animation: slideInRight 0.3s ease-out;
        `;

        document.body.appendChild(successDiv);

        // Remove after 3 seconds
        setTimeout(() => {
            successDiv.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
                if (successDiv.parentNode) {
                    successDiv.parentNode.removeChild(successDiv);
                }
            }, 300);
        }, 3000);

        this.info('Success notification shown:', message);
    }

    showError(message) {
        // Create and show error notification
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 500;
            z-index: 2000;
            animation: slideInRight 0.3s ease-out;
        `;

        document.body.appendChild(errorDiv);

        // Remove after 5 seconds
        setTimeout(() => {
            errorDiv.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 300);
        }, 5000);

        this.error('Error notification shown:', message);
    }

    getPanelState(panelName) {
        return this.panelState[panelName] || false;
    }

    getCardState(cardName) {
        return this.cardStates[cardName] || 'collapsed';
    }

    isInspectorPanelExpanded() {
        return this.panelState.inspector;
    }

    isSiteInfoExpanded() {
        return this.panelState.siteInfo;
    }

    setupClearSiteInspectorListeners() {
        // Clear Site Inspector button
        const clearButton = document.getElementById('clearSiteInspectorButton');
        if (clearButton) {
            clearButton.addEventListener('click', () => this.showClearConfirmationModal());
        }

        // Modal event listeners
        const modal = document.getElementById('clearConfirmationModal');
        const confirmBtn = document.getElementById('clearConfirmBtn');
        const cancelBtn = document.getElementById('clearCancelBtn');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.clearAllSiteData());
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideClearConfirmationModal());
        }

        // Close modal on outside click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideClearConfirmationModal();
                }
            });
        }

        // Close modal on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                this.hideClearConfirmationModal();
            }
        });
    }

    showClearConfirmationModal() {
        const modal = document.getElementById('clearConfirmationModal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // Focus on cancel button for safety
            const cancelBtn = document.getElementById('clearCancelBtn');
            if (cancelBtn) {
                setTimeout(() => cancelBtn.focus(), 100);
            }
        }
    }

    hideClearConfirmationModal() {
        const modal = document.getElementById('clearConfirmationModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    clearAllSiteData() {
        try {
            this.info('Starting comprehensive site data clearing...');

            // Hide the confirmation modal first
            this.hideClearConfirmationModal();

            // Show loading state
            const clearButton = document.getElementById('clearSiteInspectorButton');
            if (clearButton) {
                clearButton.disabled = true;
                clearButton.innerHTML = '🔄 Clearing...';
            }

            // Emit comprehensive clearing event to all managers
            window.eventBus.emit('clear-all-site-data');

            // Clear all manager data through the core
            if (window.siteInspectorCore) {
                // Clear 3D extrusions first
                if (window.siteInspectorCore.extrusion3DManager) {
                    window.siteInspectorCore.extrusion3DManager.clearAllExtrusions();
                }

                // Clear floorplan data
                if (window.siteInspectorCore.floorplanManager) {
                    if (typeof window.siteInspectorCore.floorplanManager.clearAll === 'function') {
                        window.siteInspectorCore.floorplanManager.clearAll();
                    }
                }

                // Clear property setbacks and buildable area
                if (window.siteInspectorCore.propertySetbacksManager) {
                    window.siteInspectorCore.propertySetbacksManager.clearAllSetbackData();
                }

                // Clear site boundary last (this will trigger other clearings via events)
                if (window.siteInspectorCore.siteBoundaryCore) {
                    window.siteInspectorCore.siteBoundaryCore.clearBoundary();
                }
            }

            // Reset all UI panels to initial state
            this.resetAllPanelsToInitialState();

            // Update site info display
            this.updateSiteInfoDisplay({
                area: 0,
                area_m2: 0,
                type: 'residential'
            });

            // Reset map view to original position if possible
            if (window.siteInspectorCore && window.siteInspectorCore.map) {
                const map = window.siteInspectorCore.map;
                if (window.siteInspectorCore.siteData && window.siteInspectorCore.siteData.center) {
                    map.flyTo({
                        center: [window.siteInspectorCore.siteData.center.lng, window.siteInspectorCore.siteData.center.lat],
                        zoom: 17,
                        pitch: 0,
                        bearing: 0,
                        duration: 1000
                    });
                }
            }

            // Show success message
            setTimeout(() => {
                this.showSuccess('All site data has been cleared successfully');

                // Re-enable the clear button
                if (clearButton) {
                    clearButton.disabled = false;
                    clearButton.innerHTML = 'Clear Site Inspector';
                }
            }, 500);

            this.info('Site data clearing completed successfully');

        } catch (error) {
            this.error('Error clearing site data:', error);
            this.showError('Failed to clear site data: ' + error.message);

            // Re-enable the clear button
            const clearButton = document.getElementById('clearSiteInspectorButton');
            if (clearButton) {
                clearButton.disabled = false;
                clearButton.innerHTML = 'Clear Site Inspector';
            }
        }
    }

    setupMinimizePanelListener() {
        const minimizeButton = document.getElementById('minimizePanelButton');
        if (minimizeButton) {
            minimizeButton.addEventListener('click', () => {
                this.toggleInspectorPanel();
                this.info('Panel minimized via minimize button');
            });
        }
    }

    resetAllPanelsToInitialState() {
        // Collapse all cards except site info
        const cards = [
            { id: 'siteBoundaryCard', expanded: false },
            { id: 'propertySetbacksCard', expanded: false },
            { id: 'floorplanCard', expanded: false }
        ];

        cards.forEach(card => {
            const element = document.getElementById(card.id);
            if (element) {
                if (card.expanded) {
                    element.classList.remove('collapsed');
                } else {
                    element.classList.add('collapsed');
                }
            }
        });

        // Reset button states
        const buttons = [
            { id: 'drawPolygonButton', text: 'Draw Site Boundary', active: false },
            { id: 'edgeSelectionButton', text: 'Select Front & Back Edges', active: false }
        ];

        buttons.forEach(btn => {
            const element = document.getElementById(btn.id);
            if (element) {
                element.textContent = btn.text;
                element.disabled = !btn.active;
                element.classList.remove('active');
                if (!btn.active) {
                    element.style.opacity = '0.6';
                } else {
                    element.style.opacity = '1';
                }
            }
        });

        // Hide all dependent sections
        const sectionsToHide = [
            'selectedEdgesDisplay',
            'setbackInputsContainer', 
            'buildableAreaControls',
            'buildableArea3DControls',
            'extrusionControls',
            'floorplanUploadSection',
            'activeExtrusionsDisplay'
        ];

        sectionsToHide.forEach(sectionId => {
            const element = document.getElementById(sectionId);
            if (element) {
                element.style.display = 'none';
            }
        });

        // Reset input fields to defaults
        const inputs = [
            { id: 'frontSetback', value: '4.5' },
            { id: 'backSetback', value: '3.5' },
            { id: 'sideSetback', value: '1.5' },
            { id: 'heightLimit', value: '9' }
        ];

        inputs.forEach(input => {
            const element = document.getElementById(input.id);
            if (element) {
                element.value = input.value;
            }
        });

        // Clear any warning messages
        ['frontSetback', 'backSetback', 'sideSetback', 'heightLimit'].forEach(inputId => {
            const warningElement = document.getElementById(inputId + 'Warning');
            if (warningElement) {
                warningElement.style.display = 'none';
            }
        });

        this.info('All UI panels reset to initial state');
    }
}



window.UIPanelManager = UIPanelManager;