/**
 * Property Setbacks Manager
 * Handles edge selection, setback inputs, and buildable area calculations
 */

class PropertySetbacksManager extends BaseManager {
    constructor(map) {
        super('PropertySetbacksManager');
        this.map = map;
        this.polygonEdges = [];
        this.selectedEdges = { front: null, back: null };
        this.isSetbackMode = false;
        this.isEdgeSelectionMode = false;
        this.setbackOverlays = [];
        this.currentBuildableArea = null;
        this.edgeLabels = {};
        this.edgePopups = []; // Initialize the edge popups array
        this.cachedPolygonEdges = null;
    }

    async initialize() {
        try {
            this.info('Initializing Property Setbacks Manager...');
            this.setupEventListeners();
            this.setupUIEventListeners();

            // Load existing buildable area if available
            await this.loadExistingBuildableArea();

            this.info('Property Setbacks Manager initialized successfully');
        } catch (error) {
            this.error('Failed to initialize Property Setbacks Manager:', error);
            throw error;
        }
    }

    async loadExistingBuildableArea() {
        try {
            // Get project ID from URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            let projectId = urlParams.get('project') || urlParams.get('project_id');

            // Clean up malformed project IDs
            if (projectId && (projectId.includes('?') || projectId.includes('&'))) {
                projectId = projectId.split('?')[0].split('&')[0];
            }

            // Validate project ID is numeric
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

            // Fetch project snapshot for buildable area
            const response = await fetch(`/api/project/${projectId}/snapshot`);
            const data = await response.json();

            if (data.success && data.snapshot && data.snapshot.snapshot_type === 'buildable_area') {
                let snapshotData;

                try {
                    snapshotData = JSON.parse(data.snapshot.snapshot_data);
                } catch (jsonError) {
                    try {
                        let jsonString = data.snapshot.snapshot_data.replace(/'/g, '"');
                        snapshotData = JSON.parse(jsonString);
                    } catch (conversionError) {
                        this.error('Failed to parse buildable area snapshot data', conversionError);
                        return;
                    }
                }

                if (snapshotData.buildable_coords && snapshotData.buildable_coords.length > 0) {
                    this.info('Loading existing buildable area from snapshot...');

                    // Store the current buildable area data
                    this.currentBuildableArea = {
                        buildable_coords: snapshotData.buildable_coords,
                        buildable_area_m2: snapshotData.buildable_area_m2,
                        site_area_m2: snapshotData.site_area_m2,
                        coverage_ratio: snapshotData.coverage_ratio,
                        calculation_method: snapshotData.calculation_method
                    };

                    // Update the map display
                    this.displayBuildableArea(snapshotData.buildable_coords, false);

                    // Restore setback values if available
                    if (snapshotData.front_setback !== undefined) {
                        const frontInput = document.getElementById('frontSetback');
                        if (frontInput) {
                            frontInput.value = snapshotData.front_setback;
                            this.checkSetbackWarnings('frontSetback', parseFloat(snapshotData.front_setback) || 0);
                        }
                    }
                    if (snapshotData.rear_setback !== undefined) {
                        const rearInput = document.getElementById('backSetback');
                        if (rearInput) {
                            rearInput.value = snapshotData.rear_setback;
                            this.checkSetbackWarnings('backSetback', parseFloat(snapshotData.rear_setback) || 0);
                        }
                    }
                    if (snapshotData.side_setback !== undefined) {
                        const sideInput = document.getElementById('sideSetback');
                        if (sideInput) {
                            sideInput.value = snapshotData.side_setback;
                            this.checkSetbackWarnings('sideSetback', parseFloat(snapshotData.side_setback) || 0);
                        }
                    }
                    if (snapshotData.height_limit !== undefined) {
                        const heightInput = document.getElementById('heightLimit');
                        if (heightInput) heightInput.value = snapshotData.height_limit;
                    }

                    // Restore selected edges if available
                    if (snapshotData.selected_edges) {
                        this.selectedEdges = snapshotData.selected_edges;

                        // Update edge displays
                        if (this.selectedEdges.front) {
                            this.updateEdgeDisplay('front', this.selectedEdges.front.index);
                        }
                        if (this.selectedEdges.back) {
                            this.updateEdgeDisplay('back', this.selectedEdges.back.index);
                        }

                        this.info('Selected edges restored from snapshot');
                    }

                    this.info('Existing buildable area loaded successfully');

                    // Show that setbacks are configured and keep UI in correct state
                    this.showExtrusionControls();
                    this.keepInputsVisible();

                    // Show setback visualization since buildable area is visible
                    if (this.selectedEdges.front && this.selectedEdges.back) {
                        setTimeout(() => {
                            this.updateSetbackVisualization();
                        }, 100);
                    }

                    // Emit event to update UI state and hide edge labels
                    setTimeout(() => {
                        window.eventBus.emit('setbacks-applied');
                    }, 200);
                    this.hideEdgeSelectionLabels();
                }
            }
        } catch (error) {
            this.error('Failed to load existing buildable area', error);
        }
    }

    setupEventListeners() {
        // Listen for site boundary events
        window.eventBus.on('site-boundary-created', (data) => {
            this.info('Site boundary created event received:', data);
            this.polygonEdges = data.edges || [];
            this.enableSetbackTools();
        });

        window.eventBus.on('site-boundary-loaded', (data) => {
            this.info('Site boundary loaded event received:', data);
            this.polygonEdges = data.edges || [];
            this.enableSetbackTools();
        });

        window.eventBus.on('site-boundary-deleted', () => {
            this.info('Site boundary deleted event received');
            this.polygonEdges = [];
            this.disableSetbackTools();
            this.clearAllSetbackData();
        });

        // Listen for comprehensive clearing event
        window.eventBus.on('clear-all-dependent-features', () => {
            this.info('Comprehensive clearing requested - clearing all setback data');
            this.clearAllSetbackData();
        });

        // Listen for setbacks applied event to hide edge labels
        window.eventBus.on('setbacks-applied', () => {
            this.hideEdgeSelectionLabels();
        });

        // Check for existing boundaries immediately
        this.checkForExistingBoundary();

        // Also check if boundary manager already has edges available with retries
        let retryCount = 0;
        const maxRetries = 5;
        const checkInterval = setInterval(() => {
            const boundaryManager = window.siteInspectorCore?.siteBoundaryManager;
            if (boundaryManager && boundaryManager.getPolygonEdges) {
                const edges = boundaryManager.getPolygonEdges();
                if (edges && edges.length > 0) {
                    this.info('Found existing polygon edges:', edges.length);
                    this.polygonEdges = edges;
                    this.enableSetbackTools();
                    clearInterval(checkInterval);
                    return;
                }
            }

            retryCount++;
            if (retryCount >= maxRetries) {
                this.info('No existing boundaries found after retries');
                clearInterval(checkInterval);
            }
        }, 500);
    }

    setupUIEventListeners() {
        // Edge selection button
        const edgeSelectionBtn = document.getElementById('edgeSelectionButton');
        if (edgeSelectionBtn) {
            edgeSelectionBtn.addEventListener('click', () => this.toggleEdgeSelectionMode());
        }

        // Setback input listeners for visualization updates and dynamic preview
        ['frontSetback', 'backSetback', 'sideSetback', 'heightLimit'].forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                let debounceTimer;
                input.addEventListener('input', () => {
                    this.updateSetbackVisualization();
                    // Use ?? instead of || to allow 0 values
                    const value = parseFloat(input.value);
                    this.checkSetbackWarnings(inputId, isNaN(value) ? 0 : value);

                    // Immediate preview for faster feedback, then debounced for final calculation
                    if (this.selectedEdges.front && this.selectedEdges.back) {
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            this.calculateBuildableAreaPreview();
                        }, 300);
                    }
                });
            }
        });

        // Recalculate button
        const recalculateBtn = document.getElementById('recalculateButton');
        if (recalculateBtn) {
            recalculateBtn.addEventListener('click', () => this.recalculateBuildableArea());
        }
    }

    enableSetbackTools() {
        const edgeSelectionBtn = document.getElementById('edgeSelectionButton');
        if (edgeSelectionBtn) {
            edgeSelectionBtn.disabled = false;
            edgeSelectionBtn.style.opacity = '1';
        }
        this.info('Setback tools enabled');
    }

    disableSetbackTools() {
        const edgeSelectionBtn = document.getElementById('edgeSelectionButton');
        if (edgeSelectionBtn) {
            edgeSelectionBtn.disabled = true;
            edgeSelectionBtn.style.opacity = '0.6';
        }
        this.exitEdgeSelectionMode();
        this.clearEdgeSelections();
        this.info('Setback tools disabled');
    }

    toggleEdgeSelectionMode() {
        const button = document.getElementById('edgeSelectionButton');
        const overlay = document.getElementById('edgeSelectionOverlay');

        if (!button) {
            this.error('Edge selection button not found');
            return;
        }

        if (this.isEdgeSelectionMode) {
            // Exit edge selection mode
            this.exitEdgeSelectionMode();
            button.textContent = 'Select Front & Back Edges';
            button.classList.remove('active');
            if (overlay) overlay.classList.remove('show');
        } else if (this.selectedEdges.front && this.selectedEdges.back) {
            // Clear existing selections and start over
            this.clearEdgeSelections();
            this.enterEdgeSelectionMode();
            button.textContent = 'Exit Edge Selection';
            button.classList.add('active');
            if (overlay) overlay.classList.add('show');
        } else {
            // Enter edge selection mode
            this.startEdgeSelection();
            this.enterEdgeSelectionMode();
            button.textContent = 'Exit Edge Selection';
            button.classList.add('active');
            if (overlay) overlay.classList.add('show');
        }
    }

    startEdgeSelection() {
        // Get polygon edges from the site boundary
        const siteBoundaryCore = window.siteInspectorCore?.siteBoundaryCore;
        if (!siteBoundaryCore) {
            this.error('Site boundary core not available');
            this.showError('Site boundary system not available. Please refresh the page.');
            return;
        }

        // Check if site boundary exists first
        if (!siteBoundaryCore.hasSiteBoundary()) {
            this.warn('No site boundary available');
            this.showError('Please draw a site boundary first before selecting edges.');
            return;
        }

        let polygonEdges = siteBoundaryCore.getPolygonEdges();

        // If no edges from site boundary core, try cached edges
        if (!polygonEdges || polygonEdges.length === 0) {
            polygonEdges = this.cachedPolygonEdges;
        }

        // If still no edges, try to calculate them from the site polygon
        if (!polygonEdges || polygonEdges.length === 0) {
            this.info('No cached polygon edges, calculating from site polygon...');
            const sitePolygon = siteBoundaryCore.getSitePolygon();
            if (sitePolygon && sitePolygon.geometry && sitePolygon.geometry.coordinates) {
                polygonEdges = this.calculatePolygonEdges(sitePolygon.geometry.coordinates[0]);
                // Cache the calculated edges
                this.cachedPolygonEdges = polygonEdges;
            }
        }

        if (!polygonEdges || polygonEdges.length === 0) {
            this.warn('No polygon edges available for selection');
            this.showError('Unable to detect site boundary edges. Please redraw the site boundary.');
            return;
        }
        this.polygonEdges = polygonEdges; // Assign to the class property
    }

    enterEdgeSelectionMode() {
        if (!this.polygonEdges || this.polygonEdges.length === 0) {
            this.warn('No polygon edges available for selection');
            alert('Please draw a site boundary first before selecting edges.');
            return;
        }

        this.isEdgeSelectionMode = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this.handleEdgeSelection);
        this.highlightPolygonEdges();
        this.updateOverlayPosition();
        this.info('Entered edge selection mode with', this.polygonEdges.length, 'edges');
    }

    exitEdgeSelectionMode() {
        this.isEdgeSelectionMode = false;
        this.map.getCanvas().style.cursor = '';
        this.map.off('click', this.handleEdgeSelection);

        // Always hide edge labels when exiting edge selection mode
        this.hideEdgeSelectionLabels();

        if (!this.selectedEdges.front && !this.selectedEdges.back) {
            this.clearEdgeHighlights();
        } else {
            this.removeEdgeHoverListeners();
            this.updateEdgeVisualization();
        }

        const overlay = document.getElementById('edgeSelectionOverlay');
        if (overlay) overlay.classList.remove('show');
        this.info('Exited edge selection mode');
    }

    handleEdgeSelection = (e) => {
        try {
            if (!this.isEdgeSelectionMode) return;

            if (!e || !e.lngLat) {
                this.warn('Invalid click event in edge selection');
                return;
            }

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

                    const overlay = document.getElementById('edgeSelectionOverlay');
                    if (overlay) overlay.classList.remove('show');

                    this.exitEdgeSelectionMode();
                    this.updateSetbackVisualization();

                    // Hide edge labels since selection is complete
                    this.hideEdgeSelectionLabels();

                    // Immediately calculate and show buildable area preview
                    this.calculateBuildableAreaPreview();

                    this.info('Back edge selected:', selectedEdge.index);
                }
                this.updateEdgeVisualization();
            }
        } catch (error) {
            this.error('Error in edge selection:', error);
        }
    }

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
        if (lenSq !== 0) {
            param = dot / lenSq;
        }

        let xx, yy;
        if (param < 0) {
            xx = lineStart[0];
            yy = lineStart[1];
        } else if (param > 1) {
            xx = lineEnd[0];
            yy = lineEnd[1];
        } else {
            xx = lineStart[0] + param * C;
            yy = lineStart[1] + param * D;
        }

        const dx = point[0] - xx;
        const dy = point[1] - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

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
        const setbackInputsContainer = document.getElementById('setbackInputsContainer');
        const buildableAreaControls = document.getElementById('buildableAreaControls');

        if (this.selectedEdges.front && this.selectedEdges.back) {
            if (setbackInputsContainer) setbackInputsContainer.style.display = 'block';
            if (buildableAreaControls) buildableAreaControls.style.display = 'block';

            // Trigger initial buildable area preview with default values
            setTimeout(() => {
                this.calculateBuildableAreaPreview();
            }, 100);
        } else {
            if (setbackInputsContainer) setbackInputsContainer.style.display = 'none';
            if (buildableAreaControls) buildableAreaControls.style.display = 'none';
        }
    }

    showExtrusionControls() {
        const buildableArea3DControls = document.getElementById('buildableArea3DControls');
        const extrusionControls = document.getElementById('extrusionControls');
        if (buildableArea3DControls) {
            buildableArea3DControls.style.display = 'block';
        }
        if (extrusionControls) {
            extrusionControls.style.display = 'block';
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
    }

    clearEdgeSelections() {
        this.selectedEdges.front = null;
        this.selectedEdges.back = null;
        this.clearEdgeHighlights();
        this.clearSetbackVisualization();
        this.remove3DExtrusion();

        // Clear current buildable area data
        this.currentBuildableArea = null;

        // Reset input fields to default values
        const frontInput = document.getElementById('frontSetback');
        const backInput = document.getElementById('backSetback');
        const sideInput = document.getElementById('sideSetback');
        const heightInput = document.getElementById('heightLimit');

        if (frontInput) frontInput.value = '4.5';
        if (backInput) backInput.value = '3.5';
        if (sideInput) sideInput.value = '1.5';
        if (heightInput) heightInput.value = '9';

        // Hide UI elements
        const selectedEdgesDisplay = document.getElementById('selectedEdgesDisplay');
        const setbackInputsContainer = document.getElementById('setbackInputsContainer');
        const buildableAreaControls = document.getElementById('buildableAreaControls');
        const frontEdgeDisplay = document.getElementById('frontEdgeDisplay');
        const backEdgeDisplay = document.getElementById('backEdgeDisplay');

        if (selectedEdgesDisplay) selectedEdgesDisplay.style.display = 'none';
        if (setbackInputsContainer) setbackInputsContainer.style.display = 'none';
        if (buildableAreaControls) buildableAreaControls.style.display = 'none';
        if (frontEdgeDisplay) frontEdgeDisplay.textContent = 'Not selected';
        if (backEdgeDisplay) backEdgeDisplay.textContent = 'Not selected';

        // Reset edge selection button
        const edgeSelectionBtn = document.getElementById('edgeSelectionButton');
        if (edgeSelectionBtn) {
            edgeSelectionBtn.textContent = 'Select Front & Back Edges';
            edgeSelectionBtn.classList.remove('active');
        }

        // Hide edge selection overlay
        const overlay = document.getElementById('edgeSelectionOverlay');
        if (overlay) overlay.classList.remove('show');

        this.hideExtrusionControls();

        // Clear any remaining edge popups
        this.hideEdgeSelectionLabels();

        this.info('Edge selections and all associated data cleared');
    }

    clearAllSetbackData() {
        try {
            this.info('Starting comprehensive setback data clearing...');

            // Clear setback visualization first
            this.clearSetbackVisualization();

            // Clear all edge selections and UI state
            this.clearEdgeSelections();

            // Clear buildable area visualization completely
            this.clearBuildableAreaVisualization();

            // Clear all edge highlights and labels completely
            this.clearEdgeHighlights();
            this.hideEdgeSelectionLabels();

            // Clear any remaining setback warnings
            ['frontSetback', 'backSetback', 'sideSetback', 'heightLimit'].forEach(inputId => {
                const warningElement = document.getElementById(inputId + 'Warning');
                if (warningElement) {
                    warningElement.style.display = 'none';
                }
            });

            // Reset all internal state
            this.polygonEdges = [];
            this.selectedEdges = { front: null, back: null };
            this.currentBuildableArea = null;
            this.setbackOverlays = [];

            // Force exit any active modes
            if (this.isEdgeSelectionMode) {
                this.exitEdgeSelectionMode();
            }

            // Hide all related UI elements
            this.hideExtrusionControls();

            // Reset UI panel state  
            if (window.siteInspectorCore?.uiPanelManager) {
                window.siteInspectorCore.uiPanelManager.hideExtrusionControls();
                window.siteInspectorCore.uiPanelManager.hideAllDependentPanels();
            }

            this.info('All setback data cleared comprehensively');
        } catch (error) {
            this.error('Error clearing all setback data:', error);
        }
    }

    clearBuildableAreaVisualization() {
        try {
            // Remove ALL possible buildable area and related layers
            const layersToRemove = [
                'buildable-area-fill',
                'buildable-area-stroke',
                'buildable-area-dimension-labels',
                'buildable-area-dimensions',
                'buildable-dimension-labels',
                'setback-dimension-labels',
                'setback-dimensions',
                'buildable-area-3d-extrusion'
            ];
            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                    this.info(`Removed layer: ${layerId}`);
                }
            });

            // Remove ALL possible buildable area and related sources
            const sourcesToRemove = [
                'buildable-area',
                'buildable-area-dimensions',
                'buildable-dimension-labels',
                'setback-dimensions',
                'buildable-area-3d'
            ];
            sourcesToRemove.forEach(sourceId => {
                if (this.map.getSource(sourceId)) {
                    this.map.removeSource(sourceId);
                    this.info(`Removed source: ${sourceId}`);
                }
            });

            // Also clear setback visualization when buildable area is cleared
            this.clearSetbackVisualization();

            // Clear all edge highlights and labels
            this.clearEdgeHighlights();
            this.hideEdgeSelectionLabels();

            // Remove from legend
            this.removeLegendSetbacks();
            const legendContent = document.getElementById('legendContent');
            if (legendContent) {
                const buildableAreaItems = legendContent.querySelectorAll('.legend-buildable-area-item, .legend-3d-extrusion-item');
                buildableAreaItems.forEach(item => item.remove());
            }

            this.info('Buildable area visualization cleared completely');
        } catch (error) {
            this.error('Error clearing buildable area visualization:', error);
        }
    }

    highlightPolygonEdges() {
        this.clearEdgeHighlights();

        if (this.polygonEdges.length > 0) {
            this.info('Highlighting', this.polygonEdges.length, 'polygon edges');

            this.polygonEdges.forEach((edge, index) => {
                // Validate edge data
                if (!edge.start || !edge.end || edge.start.length < 2 || edge.end.length < 2) {
                    this.warn('Invalid edge data at index', index, edge);
                    return;
                }

                const lineString = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [edge.start, edge.end]
                    },
                    properties: { edgeIndex: index }
                };

                const sourceId = `edge-highlight-${index}`;
                const layerId = `edge-highlight-${index}`;

                // Remove existing layer/source if it exists
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
                if (this.map.getSource(sourceId)) {
                    this.map.removeSource(sourceId);
                }

                // Add new source and layer
                this.map.addSource(sourceId, {
                    type: 'geojson',
                    data: lineString
                });

                this.addEdgeLabel(edge, index);
                this.addEdgeHoverEffects(index);
            });

            this.info('Edge highlighting completed');
        } else {
            this.warn('No polygon edges to highlight');
        }
    }

    addEdgeHoverEffects(index) {
        this.map.on('mouseenter', `edge-highlight-${index}`, () => {
            if (this.isEdgeSelectionMode) {
                this.map.getCanvas().style.cursor = 'pointer';
                if (this.isEdgeSelected(index)) {
                    const isFront = this.selectedEdges.front && this.selectedEdges.front.index === index;
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-color', isFront ? '#34ce57' : '#e14752');
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-width', 7);
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-opacity', 1);
                } else {
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-color', '#0096d6');
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-width', 6);
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-opacity', 1);
                }
            }
        });

        this.map.on('mouseleave', `edge-highlight-${index}`, () => {
            if (this.isEdgeSelectionMode) {
                this.map.getCanvas().style.cursor = 'crosshair';
                if (!this.isEdgeSelected(index)) {
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-color', '#007cbf');
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-width', 3);
                    this.map.setPaintProperty(`edge-highlight-${index}`, 'line-opacity', 0.6);
                } else {
                    this.updateEdgeVisualization();
                }
            }
        });
    }

    updateEdgeVisualization() {
        this.polygonEdges.forEach((edge, index) => {
            let color = '#007cbf';
            let width = 3;
            let opacity = 0.6;

            if (this.selectedEdges.front && this.selectedEdges.front.index === index) {
                color = '#28a745';
                width = 6;
                opacity = 1;
            } else if (this.selectedEdges.back && this.selectedEdges.back.index === index) {
                color = '#dc3545';
                width = 6;
                opacity = 1;
            }

            if (this.map.getLayer(`edge-highlight-${index}`)) {
                this.map.setPaintProperty(`edge-highlight-${index}`, 'line-color', color);
                this.map.setPaintProperty(`edge-highlight-${index}`, 'line-width', width);
                this.map.setPaintProperty(`edge-highlight-${index}`, 'line-opacity', opacity);
            }
        });

        this.updateEdgeLabels();
    }

    isEdgeSelected(edgeIndex) {
        return (this.selectedEdges.front && this.selectedEdges.front.index === edgeIndex) ||
               (this.selectedEdges.back && this.selectedEdges.back.index === edgeIndex);
    }

    removeEdgeHoverListeners() {
        this.polygonEdges.forEach((edge, index) => {
            if (this.map.getLayer(`edge-highlight-${index}`)) {
                this.map.off('mouseenter', `edge-highlight-${index}`);
                this.map.off('mouseleave', `edge-highlight-${index}`);
            }
        });
    }

    clearEdgeHighlights() {
        this.polygonEdges.forEach((edge, index) => {
            if (this.map.getLayer(`edge-highlight-${index}`)) {
                this.map.off('mouseenter', `edge-highlight-${index}`);
                this.map.off('mouseleave', `edge-highlight-${index}`);
                this.map.removeLayer(`edge-highlight-${index}`);
            }
            if (this.map.getSource(`edge-highlight-${index}`)) {
                this.map.removeSource(`edge-highlight-${index}`);
            }

            this.removeEdgeLabel(index);
        });
    }

    addEdgeLabel(edge, index) {
        const labelPosition = edge.midpoint;
        let labelText = `Edge ${index + 1}`;
        let labelClass = 'edge-label-popup';

        if (this.selectedEdges.front && this.selectedEdges.front.index === index) {
            labelText = `Front Edge ${index + 1}`;
            labelClass += ' front-edge';
        } else if (this.selectedEdges.back && this.selectedEdges.back.index === index) {
            labelText = `Back Edge ${index + 1}`;
            labelClass += ' back-edge';
        }

        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'edge-label-popup-container',
            anchor: 'center',
            offset: [0, 0]
        })
        .setLngLat(labelPosition)
        .setHTML(`<div class="${labelClass}" data-edge-index="${index}" style="color: #333333; background: rgba(255,255,255,0.9); padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; border: 1px solid rgba(0,0,0,0.1);">${labelText}</div>`)
        .addTo(this.map);

        const labelElement = popup.getElement().querySelector('.edge-label-popup');
        if (labelElement) {
            labelElement.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (this.isEdgeSelectionMode) {
                    const selectedEdge = this.polygonEdges[index];
                    if (selectedEdge) {
                        if (!this.selectedEdges.front) {
                            this.selectedEdges.front = selectedEdge;
                            this.updateEdgeDisplay('front', selectedEdge.index);
                            this.info('Front edge selected via label:', selectedEdge.index, this.selectedEdges);
                        } else if (!this.selectedEdges.back && selectedEdge.index !== this.selectedEdges.front.index) {
                            this.selectedEdges.back = selectedEdge;
                            this.updateEdgeDisplay('back', selectedEdge.index);
                            this.info('Back edge selected via label:', selectedEdge.index, this.selectedEdges);

                            const overlay = document.getElementById('edgeSelectionOverlay');
                            if (overlay) overlay.classList.remove('show');

                            this.exitEdgeSelectionMode();
                            this.updateSetbackVisualization();

                            // Hide edge labels since selection is complete
                            this.hideEdgeSelectionLabels();

                            // Verify edges are properly set before calculating
                            if (this.selectedEdges.front && this.selectedEdges.back) {
                                this.info('Both edges confirmed selected, triggering preview');
                                // Immediately calculate and show buildable area preview
                                this.calculateBuildableAreaPreview();
                            } else {
                                this.warn('Edge selection incomplete after back edge selection');
                            }
                        }
                        this.updateEdgeVisualization();
                    }
                }
            });
        }

        this.edgeLabels[index] = popup;
        this.edgePopups.push(popup); // Track popup for later removal
    }

    removeEdgeLabel(index) {
        if (this.edgeLabels && this.edgeLabels[index]) {
            this.edgeLabels[index].remove();
            delete this.edgeLabels[index];
        }
    }

    updateEdgeLabels() {
        this.polygonEdges.forEach((edge, index) => {
            this.removeEdgeLabel(index);
            this.addEdgeLabel(edge, index);
        });
    }

    // Hide edge selection labels while keeping setback lines
    hideEdgeSelectionLabels() {
        try {
            // Remove all edge labels with proper error handling
            Object.values(this.edgeLabels).forEach(popup => {
                try {
                    if (popup && popup.remove) {
                        popup.remove();
                    }
                } catch (e) {
                    this.warn('Error removing edge label popup:', e);
                }
            });
            this.edgeLabels = {};

            // Clear the popups array with proper error handling
            this.edgePopups.forEach(popup => {
                try {
                    if (popup && popup.remove) {
                        popup.remove();
                    }
                } catch (e) {
                    this.warn('Error removing popup from array:', e);
                }
            });
            this.edgePopups = [];

            // Also check for any orphaned Mapbox popups and remove them
            const allPopups = document.querySelectorAll('.mapboxgl-popup');
            allPopups.forEach(popupElement => {
                try {
                    if (popupElement.querySelector('.edge-label-popup')) {
                        popupElement.remove();
                    }
                } catch (e) {
                    this.warn('Error removing orphaned popup element:', e);
                }
            });

            this.info('Edge selection labels hidden and cleaned up');
        } catch (error) {
            this.error('Error in hideEdgeSelectionLabels:', error);
        }
    }

    updateSetbackVisualization() {
        if (!this.selectedEdges.front || !this.selectedEdges.back) {
            this.info('Front and back edges not selected yet');
            return;
        }

        this.clearSetbackVisualization();

        const frontInput = document.getElementById('frontSetback');
        const backInput = document.getElementById('backSetback');
        const sideInput = document.getElementById('sideSetback');

        // Use input values if they exist, otherwise use defaults for calculation only
        const frontSetback = frontInput?.value !== '' ? parseFloat(frontInput.value) || 0 : 4.5;
        const backSetback = backInput?.value !== '' ? parseFloat(backInput.value) || 0 : 3.5;
        const sideSetback = sideInput?.value !== '' ? parseFloat(sideInput.value) || 0 : 1.5;

        this.info('Updating setback visualization:', {
            front: frontSetback,
            back: backSetback,
            side: sideSetback
        });

        this.createSetbackLines(frontSetback, backSetback, sideSetback, sideSetback);
        this.updateLegendWithSetbacks(frontSetback, backSetback, sideSetback);
    }

    createSetbackLines(frontSetback, backSetback, leftSetback, rightSetback) {
        try {
            // Skip creating dashed setback lines - they are causing visual clutter
            // The buildable area polygon itself shows the setback boundaries
            this.info('Setback calculation completed - buildable area shows setback boundaries');

        } catch (error) {
            this.error('Error in setback processing:', error);
        }

        // Emit event for site inspector to handle
        window.eventBus.emit('setbacks-updated', {
            front: frontSetback,
            back: backSetback,
            left: leftSetback,
            right: rightSetback,
            selectedEdges: this.selectedEdges
        });
    }

    clearSetbackVisualization() {
        try {
            // Remove setback layers - including all possible setback layer variations
            const layersToRemove = [
                'setback-fill',
                'setback-stroke',
                'front-setback-line',
                'back-setback-line',
                'side-setback-line'
            ];
            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            // Remove setback sources - including all possible source variations
            const sourcesToRemove = [
                'setback-visualization',
                'setback-lines'
            ];
            sourcesToRemove.forEach(sourceId => {
                if (this.map.getSource(sourceId)) {
                    this.map.removeSource(sourceId);
                }
            });

            this.removeLegendSetbacks();
            this.info('Setback visualization cleared');
        } catch (error) {
            this.error('Error clearing setback visualization:', error);
        }
    }

    updateLegendWithSetbacks(frontSetback, backSetback, sideSetback) {
        const legendContent = document.getElementById('legendContent');
        if (!legendContent) return;

        this.removeLegendSetbacks();

        const buildableAreaItem = legendContent.querySelector('.legend-buildable-area-item');
        if (buildableAreaItem) {
            buildableAreaItem.style.display = 'flex';
        }

        const frontSetbackItem = document.createElement('div');
        frontSetbackItem.className = 'legend-item legend-setback-item';
        frontSetbackItem.innerHTML = `
            <div class="legend-color" style="background-color: #28a745; width: 16px; height: 3px; border-radius: 0;"></div>
            <span class="legend-label">Front Setback</span>
        `;
        legendContent.appendChild(frontSetbackItem);

        const backSetbackItem = document.createElement('div');
        backSetbackItem.className = 'legend-item legend-setback-item';
        backSetbackItem.innerHTML = `
            <div class="legend-color" style="background-color: #dc3545; width: 16px; height: 3px; border-radius: 0;"></div>
            <span class="legend-label">Back Setback</span>
        `;
        legendContent.appendChild(backSetbackItem);

        this.info('Legend updated with setback information');
    }

    removeLegendSetbacks() {
        const legendContent = document.getElementById('legendContent');
        if (!legendContent) return;

        const buildableAreaItem = legendContent.querySelector('.legend-buildablearea-item');
        if (buildableAreaItem) {
            buildableAreaItem.style.display = 'none';
        }

        const setbackItems = legendContent.querySelectorAll('.legend-setback-item:not(.legend-buildable-area-item)');
        setbackItems.forEach(item => item.remove());
    }

    async calculateBuildableAreaPreview() {
        if (!this.selectedEdges.front || !this.selectedEdges.back) {
            return;
        }

        try {
            const frontInput = document.getElementById('frontSetback');
            const backInput = document.getElementById('backSetback');
            const sideInput = document.getElementById('sideSetback');
            const heightInput = document.getElementById('heightLimit');

            // Use input values if they exist, otherwise use defaults for calculation only
            const frontSetback = frontInput?.value !== '' ? parseFloat(frontInput.value) || 0 : 4.5;
            const backSetback = backInput?.value !== '' ? parseFloat(backInput.value) || 0 : 3.5;
            const sideSetback = sideInput?.value !== '' ? parseFloat(sideInput.value) || 0 : 1.5;
            const heightLimit = heightInput?.value !== '' ? parseFloat(heightInput.value) || 0 : 9;

            this.info('Calculating buildable area preview with setbacks:', {
                front: frontSetback,
                back: backSetback,
                side: sideSetback,
                heightLimit: heightLimit
            });

            // Emit preview event for site inspector to handle calculation
            window.eventBus.emit('preview-buildable-area', {
                frontSetback,
                backSetback,
                sideSetback,
                heightLimit,
                selectedEdges: this.selectedEdges,
                polygonEdges: this.polygonEdges,
                isPreview: true
            });

        } catch (error) {
            this.error('Preview calculation failed:', error);
        }
    }

    async recalculateBuildableArea() {
        const button = document.getElementById('recalculateButton');
        const originalText = button?.textContent || 'Calculate';

        // Check if edges are properly selected with more detailed validation
        if (!this.selectedEdges || !this.selectedEdges.front || !this.selectedEdges.back) {
            this.warn('Edge validation failed:', {
                selectedEdges: this.selectedEdges,
                hasFront: !!this.selectedEdges?.front,
                hasBack: !!this.selectedEdges?.back
            });
            alert('Please select both front and back edges first');
            return;
        }

        // Additional validation to ensure edges have required properties
        if (this.selectedEdges.front.index === undefined || this.selectedEdges.back.index === undefined) {
            this.warn('Edge index validation failed:', {
                frontIndex: this.selectedEdges.front?.index,
                backIndex: this.selectedEdges.back?.index
            });
            alert('Please select both front and back edges first');
            return;
        }

        try {
            if (button) {
                button.textContent = 'Calculating...';
                button.disabled = true;
            }

            const frontInput = document.getElementById('frontSetback');
            const backInput = document.getElementById('backSetback');
            const sideInput = document.getElementById('sideSetback');
            const heightInput = document.getElementById('heightLimit');

            // Use input values if they exist, otherwise use defaults for calculation only
            const frontSetback = frontInput?.value !== '' ? parseFloat(frontInput.value) || 0 : 4.5;
            const backSetback = backInput?.value !== '' ? parseFloat(backInput.value) || 0 : 3.5;
            const sideSetback = sideInput?.value !== '' ? parseFloat(sideInput.value) || 0 : 1.5;
            const heightLimit = heightInput?.value !== '' ? parseFloat(heightInput.value) || 0 : 9;

            this.info('Recalculating buildable area with setbacks:', {
                front: frontSetback,
                back: backSetback,
                side: sideSetback,
                heightLimit: heightLimit
            });

            // Emit event for site inspector to handle calculation
            window.eventBus.emit('recalculate-buildable-area', {
                frontSetback,
                backSetback,
                sideSetback,
                heightLimit,
                selectedEdges:this.selectedEdges,
                polygonEdges: this.polygonEdges
            });

            // Wait for calculation to complete
            setTimeout(() => {
                if (button) {
                    button.textContent = originalText;
                    button.disabled = false;
                }
            }, 2000);

        } catch (error) {
            this.error('Recalculation failed:', error);
            alert('Failed to recalculate buildable area');
            if (button) {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
    }

    async extrudeBuildableArea() {
        if (!this.currentBuildableArea || !this.currentBuildableArea.buildable_coords) {
            alert('Please calculate buildable area first before extruding');
            return;
        }

        const heightLimit = parseFloat(document.getElementById('heightLimit')?.value) || 9;

        try {
            this.info('Extruding buildable area to height:', heightLimit + 'm');

            // Get buildable area coordinates
            const buildableCoords = this.currentBuildableArea.buildable_coords;

            // Convert coordinates to proper format for 3D extrusion
            let coordinates = buildableCoords.map(coord => {
                // Ensure coordinates are in [lng, lat] format
                if (coord[0] < 0 && coord[0] > -90 && coord[1] > 100) {
                    return [coord[1], coord[0]]; // Swap from [lat, lng] to [lng, lat]
                } else {
                    return coord;
                }
            });

            // Add 3D extrusion layer to map
            this.add3DExtrusionLayer(coordinates, heightLimit);

            // Update legend
            this.updateLegendWith3DExtrusion(heightLimit);

            // Show remove 3D button
            const remove3DButton = document.getElementById('remove3DButton');
            if (remove3DButton) {
                remove3DButton.style.display = 'block';
            }

            this.info('Buildable area extruded successfully to', heightLimit + 'm height');

        } catch (error) {
            this.error('Failed to extrude buildable area:', error);
            alert('Failed to extrude buildable area: ' + error.message);
        }
    }

    add3DExtrusionLayer(coordinates, height) {
        try {
            // Remove existing 3D extrusion layers
            const layersToRemove = ['buildable-area-3d-extrusion'];
            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            if (this.map.getSource('buildable-area-3d')) {
                this.map.removeSource('buildable-area-3d');
            }

            // Ensure coordinates form a closed polygon
            const firstCoord = coordinates[0];
            const lastCoord = coordinates[coordinates.length - 1];
            if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                coordinates.push([...firstCoord]);
            }

            // Add 3D source
            this.map.addSource('buildable-area-3d', {
                'type': 'geojson',
                'data': {
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Polygon',
                        'coordinates': [coordinates]
                    },
                    'properties': {
                        'height': height,
                        'type': 'buildable-area-3d'
                    }
                }
            });

            // Add 3D fill-extrusion layer with improved styling
            this.map.addLayer({
                'id': 'buildable-area-3d-extrusion',
                'type': 'fill-extrusion',
                'source': 'buildable-area-3d',
                'layout': {},
                'paint': {
                    'fill-extrusion-color': [
                        'interpolate',
                        ['linear'],
                        ['get', 'height'],
                        0, '#4a90e2',
                        50, '#2c5aa0'
                    ],
                    'fill-extrusion-height': height,
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.4,
                    'fill-extrusion-vertical-gradient': true
                }
            });

            // Calculate center of buildable area for better camera positioning
            const centerLng = coordinates.reduce((sum, coord) => sum + coord[0], 0) / coordinates.length;
            const centerLat = coordinates.reduce((sum, coord) => sum + coord[1], 0) / coordinates.length;

            // Enable 3D view with improved positioning
            this.map.easeTo({
                center: [centerLng, centerLat],
                zoom: 18,
                pitch: 60,
                bearing: -30,
                duration: 2000
            });

            this.info(`3D extrusion layer added with ${height}m height`);

        } catch (error) {
            this.error('Error adding 3D extrusion layer:', error);
            throw error;
        }
    }

    updateLegendWith3DExtrusion(height) {
        const legendContent = document.getElementById('legendContent');
        if (!legendContent) return;

        // Remove existing 3D extrusion legend item
        const existing3DItem = legendContent.querySelector('.legend-3d-extrusion-item');
        if (existing3DItem) {
            existing3DItem.remove();
        }

        // Add new 3D extrusion legend item
        const extrusionItem = document.createElement('div');
        extrusionItem.className = 'legend-item legend-3d-extrusion-item';
        extrusionItem.innerHTML = `
            <div class="legend-color" style="background: linear-gradient(45deg, #4a90e2, #6ba3f0); opacity: 0.8;"></div>
            <span class="legend-label">3D Buildable Volume (${height}m)</span>
        `;
        legendContent.appendChild(extrusionItem);
    }

    remove3DExtrusion() {
        try {
            // Remove 3D extrusion layers
            if (this.map.getLayer('buildable-area-3d-extrusion')) {
                this.map.removeLayer('buildable-area-3d-extrusion');
            }
            if (this.map.getSource('buildable-area-3d')) {
                this.map.removeSource('buildable-area-3d');
            }

            // Remove from legend
            const legendContent = document.getElementById('legendContent');
            if (legendContent) {
                const extrusionItem = legendContent.querySelector('.legend-3d-extrusion-item');
                if (extrusionItem) {
                    extrusionItem.remove();
                }
            }

            // Reset map view
            this.map.easeTo({
                pitch: 0,
                bearing: 0,
                duration: 1000
            });

            this.info('3D extrusion removed');

        } catch (error) {
            this.error('Error removing 3D extrusion:', error);
        }
    }

    updateOverlayPosition() {
        const overlay = document.getElementById('edgeSelectionOverlay');
        const panel = document.getElementById('inspectorPanel');

        if (overlay && panel) {
            if (panel.classList.contains('expanded')) {
                overlay.classList.add('shifted');
            } else {
                overlay.classList.remove('shifted');
            }
        }
    }

    checkForExistingBoundary() {
        const boundaryManager = window.siteInspectorCore?.siteBoundaryManager;
        if (boundaryManager) {
            if (boundaryManager.hasSiteBoundary && boundaryManager.hasSiteBoundary()) {
                const edges = boundaryManager.getPolygonEdges();
                if (edges && edges.length > 0) {
                    this.info('Found existing site boundary with', edges.length, 'edges');
                    this.polygonEdges = edges;
                    this.enableSetbackTools();
                    return true;
                }
            }
        }
        return false;
    }

    getSelectedEdges() {
        return this.selectedEdges;
    }

    hasSelectedEdges() {
        const hasBoth = this.selectedEdges &&
                       this.selectedEdges.front &&
                       this.selectedEdges.back &&
                       this.selectedEdges.front.index !== undefined &&
                       this.selectedEdges.back.index !== undefined;

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

    getCurrentBuildableArea() {
        return this.currentBuildableArea;
    }

    getCurrentHeightLimit() {
        const heightInput = document.getElementById('heightLimit');
        if (heightInput) {
            return parseFloat(heightInput.value) || 9;
        }
        return 9; // Default height
    }

    keepInputsVisible() {
        // Ensure input containers remain visible when loading existing data
        const setbackInputsContainer = document.getElementById('setbackInputsContainer');
        const buildableAreaControls = document.getElementById('buildableAreaControls');
        const selectedEdgesDisplay = document.getElementById('selectedEdgesDisplay');

        if (setbackInputsContainer) setbackInputsContainer.style.display = 'block';
        if (buildableAreaControls) buildableAreaControls.style.display = 'block';
        if (selectedEdgesDisplay) selectedEdgesDisplay.style.display = 'block';

        this.info('Input containers kept visible for existing buildable area');
    }

    displayBuildableArea(buildableCoords, isPreview = false) {
        try {
            // Remove existing buildable area layers
            const layersToRemove = ['buildable-area-fill', 'buildable-area-stroke'];
            layersToRemove.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            if (this.map.getSource('buildable-area')) {
                this.map.removeSource('buildable-area');
            }

            if (buildableCoords && buildableCoords.length > 0) {
                // Convert coordinates to proper format [lng, lat] for Mapbox
                let coordinates = buildableCoords.map(coord => {
                    // Check if coordinates are in [lat, lng] format and need to be swapped
                    if (coord[0] < 0 && coord[0] > -90 && coord[1] > 100) {
                        return [coord[1], coord[0]];
                    } else {
                        return coord;
                    }
                });

                // Ensure coordinates form a closed polygon
                const firstCoord = coordinates[0];
                const lastCoord = coordinates[coordinates.length - 1];
                if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                    coordinates.push([...firstCoord]);
                }

                this.map.addSource('buildable-area', {
                    'type': 'geojson',
                    'data': {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [coordinates]
                        },
                        'properties': {
                            'type': 'buildable-area',
                            'is_preview': isPreview
                        }
                    }
                });

                // Different styling for preview vs confirmed
                const fillColor = isPreview ? '#002040' : '#002040';
                const fillOpacity = isPreview ? 0.2 : 0.4;
                const strokeColor = isPreview ? '#002040' : '#002040';
                const strokeOpacity = isPreview ? 0.7 : 0.8;
                const strokeWidth = isPreview ? 2 : 3;

                // Add fill layer
                this.map.addLayer({
                    'id': 'buildable-area-fill',
                    'type': 'fill',
                    'source': 'buildable-area',
                    'layout': {},
                    'paint': {
                        'fill-color': fillColor,
                        'fill-opacity': fillOpacity
                    }
                });

                // Add stroke layer
                this.map.addLayer({
                    'id': 'buildable-area-stroke',
                    'type': 'line',
                    'source': 'buildable-area',
                    'layout': {},
                    'paint': {
                        'line-color': strokeColor,
                        'line-width': strokeWidth,
                        'line-opacity': strokeOpacity
                    }
                });

                // Generate dimension data for buildable area
                this.generateBuildableAreaDimensions(coordinates);

                if (!isPreview) {
                    this.info(`Buildable area displayed on map with ${coordinates.length - 1} vertices`);
                }
            }
        } catch (error) {
            this.error('Error displaying buildable area:', error);
        }
    }

    generateBuildableAreaDimensions(coordinates) {
        try {
            // Remove existing dimensions source if it exists
            if (this.map.getSource('buildable-area-dimensions')) {
                this.map.removeSource('buildable-area-dimensions');
            }

            const dimensionFeatures = [];

            // Create dimensions for each edge of the buildable area
            for (let i = 0; i < coordinates.length - 1; i++) {
                const start = coordinates[i];
                const end = coordinates[i + 1];

                // Ensure coordinates are in [lng, lat] format for Mapbox
                let startCoord, endCoord;

                // Check if coordinates are in [lat, lng] format and need to be swapped
                if (start[0] < 0 && start[0] > -90 && start[1] > 100) {
                    startCoord = [start[1], start[0]];
                    endCoord = [end[1], end[0]];
                } else {
                    startCoord = start;
                    endCoord = end;
                }

                // Calculate the midpoint for label placement
                const midpoint = [
                    (startCoord[0] + endCoord[0]) / 2,
                    (startCoord[1] + endCoord[1]) / 2
                ];

                // Calculate distance using the same method as boundary manager
                const distance = this.calculateDistance(
                    { lng: startCoord[0], lat: startCoord[1] },
                    { lng: endCoord[0], lat: endCoord[1] }
                );

                // Create dimension feature
                dimensionFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: midpoint
                    },
                    properties: {
                        distance: `${distance.toFixed(1)}m`,
                        edge_index: i,
                        type: 'buildable-dimension'
                    }
                });
            }

            // Add the dimensions source
            this.map.addSource('buildable-area-dimensions', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: dimensionFeatures
                }
            });

            // Wait for source to be added before creating layers
            setTimeout(() => {
                // Add buildable area dimension labels layer
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
                        paint: {
                            'text-color': '#0066cc',
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 2
                        }
                    });
                } else {
                    this.map.setLayoutProperty('buildable-area-dimension-labels', 'visibility', 'visible');
                }

                // Check dimensions toggle state
                const mapFeaturesManager = window.siteInspectorCore?.mapFeaturesManager;
                if (mapFeaturesManager) {
                    const areDimensionsVisible = mapFeaturesManager.areDimensionsVisible();
                    if (!areDimensionsVisible) {
                        this.map.setLayoutProperty('buildable-area-dimension-labels', 'visibility', 'none');
                    }
                }
            }, 100);

            this.info(`Generated ${dimensionFeatures.length} buildable area dimension labels`);

        } catch (error) {
            this.error('Error generating buildable area dimensions:', error);
        }
    }

    calculateDistance(point1, point2) {
        const R = 6371000; // Earth's radius in meters
        const lat1 = point1.lat * Math.PI / 180;
        const lat2 = point2.lat * Math.PI / 180;
        const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
        const deltaLng = (point2.lng - point1.lng) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                 Math.cos(lat1) * Math.cos(lat2) *
                 Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        const distance = R * c;
        return distance;
    }

    checkSetbackWarnings(inputId, value) {
        const defaultValues = {
            'frontSetback': 4.5,
            'backSetback': 3.5,
            'sideSetback': 1.5
        };

        const warningId = inputId + 'Warning';
        let warningElement = document.getElementById(warningId);

        let showWarning = false;
        let warningMessage = '';

        if (inputId === 'heightLimit') {
            // Show warning for height limit above 9m
            if (value > 9) {
                showWarning = true;
                warningMessage = 'Height limits are based on council averages. Higher builds may breach local rules—check with your council.';
            }
        } else {
            // Show warning if setback value is below default (including 0)
            const defaultValue = defaultValues[inputId];
            if (value < defaultValue) {
                showWarning = true;
                warningMessage = 'Setbacks are based on council averages. Smaller setbacks may breach local rules—check with your council.';
            }
        }

        if (showWarning) {
            if (!warningElement) {
                // Create warning element if it doesn't exist
                warningElement = document.createElement('div');
                warningElement.id = warningId;
                warningElement.className = 'setback-warning';
                warningElement.style.cssText = `
                    color: #f56565;
                    font-size: 12px;
                    margin-top: 4px;
                    line-height: 1.3;
                    display: flex;
                    align-items: flex-start;
                    gap: 4px;
                `;

                // Insert warning after the input field
                const input = document.getElementById(inputId);
                if (input && input.parentNode) {
                    input.parentNode.insertBefore(warningElement, input.nextSibling);
                }
            }

            warningElement.innerHTML = `
                <span style="color: #f56565; font-weight: bold; margin-top: -1px;">⚠</span>
                <span>${warningMessage}</span>
            `;
            warningElement.style.display = 'flex';
        } else {
            // Hide warning if conditions are not met
            if (warningElement) {
                warningElement.style.display = 'none';
            }
        }
    }

    keepInputsVisible() {
        const setbackInputsContainer = document.getElementById('setbackInputsContainer');
        if (setbackInputsContainer) {
            setbackInputsContainer.style.display = 'block';
        }
    }

    // Utility methods
    isValidCoordinate(coord) {
        return coord && coord.length >= 2 &&
               typeof coord[0] === 'number' &&
               typeof coord[1] === 'number' &&
               !isNaN(coord[0]) && !isNaN(coord[1]);
    }

    calculatePolygonEdges(coordinates) {
        const edges = [];
        if (!coordinates || coordinates.length < 3) return edges;

        try {
            // Normalize coordinates (remove duplicate closing point if present)
            let coords = coordinates;
            if (coords.length > 3 &&
                coords[0][0] === coords[coords.length - 1][0] &&
                coords[0][1] === coords[coords.length - 1][1]) {
                coords = coords.slice(0, -1);
            }

            for (let i = 0; i < coords.length; i++) {
                const start = coords[i];
                const end = coords[(i + 1) % coords.length];

                if (this.isValidCoordinate(start) && this.isValidCoordinate(end)) {
                    edges.push({
                        index: i,
                        start: start,
                        end: end,
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

    setupSiteBoundaryEventListeners() {
        // Listen for site boundary creation and updates
        window.eventBus.on('site-boundary-created', (data) => {
            this.info('Site boundary created - updating polygon edges cache');
            if (data.edges) {
                this.cachedPolygonEdges = data.edges;
            }
        });

        window.eventBus.on('site-boundary-loaded', (data) => {
            this.info('Site boundary loaded - updating polygon edges cache');
            if (data.edges) {
                this.cachedPolygonEdges = data.edges;
            }
        });

        window.eventBus.on('site-boundary-deleted', () => {
            this.info('Site boundary deleted - clearing polygon edges cache');
            this.cachedPolygonEdges = null;
        });
    }
}

window.PropertySetbacksManager = PropertySetbacksManager;