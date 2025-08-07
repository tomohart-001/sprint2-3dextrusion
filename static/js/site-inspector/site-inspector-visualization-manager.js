
/**
 * Site Inspector Visualization Manager
 * Handles all visualization and display operations
 */

class SiteInspectorVisualizationManager extends BaseManager {
    constructor(core) {
        super('SiteInspectorVisualizationManager');
        this.core = core;
    }

    updateBuildableAreaDisplay(result, isPreview = false) {
        this.info('Updating buildable area display:', { 
            area: result.buildable_area_m2, 
            isPreview 
        });

        try {
            if (!this.core.map) {
                this.warn('Map not available for buildable area display');
                return;
            }

            // Remove existing buildable area layers
            this.clearBuildableAreaLayers();

            if (result.buildable_coords && result.buildable_coords.length > 0) {
                const layerId = isPreview ? 'buildable-area-preview' : 'buildable-area';
                
                // Add buildable area source and layer
                this.addBuildableAreaLayer(layerId, result.buildable_coords, isPreview);
                
                this.info(`✅ Buildable area ${isPreview ? 'preview' : 'final'} displayed`);
            }

        } catch (error) {
            this.error('Failed to update buildable area display:', error);
        }
    }

    addBuildableAreaLayer(layerId, coordinates, isPreview) {
        const sourceId = `${layerId}-source`;
        
        try {
            // Remove existing layer and source
            if (this.core.map.getLayer(layerId)) {
                this.core.map.removeLayer(layerId);
            }
            if (this.core.map.getSource(sourceId)) {
                this.core.map.removeSource(sourceId);
            }

            // Add new source
            this.core.map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [coordinates]
                    }
                }
            });

            // Add new layer
            this.core.map.addLayer({
                id: layerId,
                type: 'fill',
                source: sourceId,
                paint: {
                    'fill-color': isPreview ? '#ffeb3b' : '#4caf50',
                    'fill-opacity': isPreview ? 0.3 : 0.4
                }
            });

            // Add stroke layer
            this.core.map.addLayer({
                id: `${layerId}-stroke`,
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': isPreview ? '#ff9800' : '#2e7d32',
                    'line-width': 2
                }
            });

        } catch (error) {
            this.error(`Failed to add buildable area layer ${layerId}:`, error);
        }
    }

    clearBuildableAreaLayers() {
        const layerIds = [
            'buildable-area-preview',
            'buildable-area-preview-stroke',
            'buildable-area',
            'buildable-area-stroke'
        ];

        layerIds.forEach(layerId => {
            try {
                if (this.core.map.getLayer(layerId)) {
                    this.core.map.removeLayer(layerId);
                }
            } catch (error) {
                // Layer might not exist, which is fine
            }
        });

        const sourceIds = [
            'buildable-area-preview-source',
            'buildable-area-source'
        ];

        sourceIds.forEach(sourceId => {
            try {
                if (this.core.map.getSource(sourceId)) {
                    this.core.map.removeSource(sourceId);
                }
            } catch (error) {
                // Source might not exist, which is fine
            }
        });
    }

    clearDependentMapLayers() {
        this.info('Clearing dependent map layers');
        
        try {
            this.clearBuildableAreaLayers();
            
            // Clear other dependent layers
            const dependentLayers = [
                'setback-lines',
                'setback-labels',
                'dimension-lines',
                'dimension-labels'
            ];

            dependentLayers.forEach(layerId => {
                try {
                    if (this.core.map.getLayer(layerId)) {
                        this.core.map.removeLayer(layerId);
                    }
                    
                    const sourceId = `${layerId}-source`;
                    if (this.core.map.getSource(sourceId)) {
                        this.core.map.removeSource(sourceId);
                    }
                } catch (error) {
                    // Layer/source might not exist
                }
            });

            this.info('✅ Dependent layers cleared');
        } catch (error) {
            this.error('Failed to clear dependent layers:', error);
        }
    }

    showMapError(message) {
        this.error('Map error:', message);
        
        const mapContainer = document.getElementById('inspectorMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f8f9fa; color: #666; flex-direction: column; text-align: center; padding: 20px;">
                    <h3 style="margin-bottom: 10px; color: #d32f2f;">⚠️ Map Error</h3>
                    <p style="margin-bottom: 15px; max-width: 400px;">${message}</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: #007cbf; color: white; border: none; border-radius: 4px; cursor: pointer; margin: 5px;">
                        Refresh Page
                    </button>
                    <button onclick="window.siteInspectorCore && window.siteInspectorCore.diagnoseMapState()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; margin: 5px;">
                        Show Diagnostics
                    </button>
                </div>
            `;
        }
    }

    showLoadingState(message = 'Loading map...') {
        const mapContainer = document.getElementById('inspectorMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #f8f9fa; color: #666; flex-direction: column;">
                    <div style="width: 40px; height: 40px; border: 4px solid #e0e0e0; border-top: 4px solid #007cbf; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 15px;"></div>
                    <p>${message}</p>
                </div>
                <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                </style>
            `;
        }
    }

    hideLoadingState() {
        const mapLoading = document.getElementById('mapLoading');
        if (mapLoading) {
            mapLoading.style.display = 'none';
        }
    }
}

window.SiteInspectorVisualizationManager = SiteInspectorVisualizationManager;
