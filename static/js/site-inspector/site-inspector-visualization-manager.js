
/**
 * Site Inspector Visualization Manager
 * Handles all map visualization and rendering operations
 */

class SiteInspectorVisualizationManager extends BaseManager {
    constructor(core) {
        super('SiteInspectorVisualizationManager');
        this.core = core;
    }

    // Visualization methods
    createSetbackVisualization(data) {
        if (!data.selectedEdges || !data.selectedEdges.front || !data.selectedEdges.back) {
            return;
        }

        this.clearSetbackVisualization();

        try {
            const frontEdge = data.selectedEdges.front;
            const backEdge = data.selectedEdges.back;
            const features = [];

            if (frontEdge) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [frontEdge.start, frontEdge.end]
                    },
                    properties: {
                        type: 'front-setback',
                        setback: data.front
                    }
                });
            }

            if (backEdge) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [backEdge.start, backEdge.end]
                    },
                    properties: {
                        type: 'back-setback',
                        setback: data.back
                    }
                });
            }

            this.core.map.addSource('setback-lines', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features
                }
            });

            this.core.map.addLayer({
                id: 'front-setback-line',
                type: 'line',
                source: 'setback-lines',
                filter: ['==', ['get', 'type'], 'front-setback'],
                paint: {
                    'line-color': '#28a745',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            this.core.map.addLayer({
                id: 'back-setback-line',
                type: 'line',
                source: 'setback-lines',
                filter: ['==', ['get', 'type'], 'back-setback'],
                paint: {
                    'line-color': '#dc3545',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            this.info('Setback lines visualized on map');

        } catch (error) {
            this.error('Error creating setback visualization:', error);
        }
    }

    clearSetbackVisualization() {
        const layersToRemove = ['front-setback-line', 'back-setback-line'];
        layersToRemove.forEach(layerId => {
            if (this.core.map.getLayer(layerId)) {
                this.core.map.removeLayer(layerId);
            }
        });

        if (this.core.map.getSource('setback-lines')) {
            this.core.map.removeSource('setback-lines');
        }

        this.info('Setback visualization cleared');
    }

    updateBuildableAreaDisplay(result, isPreview = false) {
        try {
            const layersToRemove = ['buildable-area-fill', 'buildable-area-stroke'];
            layersToRemove.forEach(layerId => {
                if (this.core.map.getLayer(layerId)) {
                    this.core.map.removeLayer(layerId);
                }
            });

            if (this.core.map.getSource('buildable-area')) {
                this.core.map.removeSource('buildable-area');
            }

            if (result.buildable_coords && result.buildable_coords.length > 0) {
                let coordinates = result.buildable_coords;

                this.info(`Buildable area coordinates received: ${coordinates.length} points`, coordinates.slice(0, 2));

                if (coordinates[0] && coordinates[0].length === 2) {
                    const firstCoord = coordinates[0];
                    if (Math.abs(firstCoord[0]) <= 90 && Math.abs(firstCoord[1]) > 90) {
                        coordinates = coordinates.map(coord => [coord[1], coord[0]]);
                        this.info('Corrected buildable area coordinate format from [lat, lng] to [lng, lat]');
                        this.info('Converted coordinates sample:', coordinates.slice(0, 2));
                    }
                }

                const firstCoord = coordinates[0];
                const lastCoord = coordinates[coordinates.length - 1];
                if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                    coordinates.push([...firstCoord]);
                }

                const geojsonData = {
                    'type': 'geojson',
                    'data': {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [coordinates]
                        },
                        'properties': {
                            'area_m2': result.buildable_area_m2 || 0,
                            'type': 'buildable-area',
                            'is_preview': isPreview
                        }
                    }
                };

                this.info('Adding buildable area source with data:', geojsonData);
                this.core.map.addSource('buildable-area', geojsonData);

                const fillColor = isPreview ? '#002040' : '#002040';
                const fillOpacity = isPreview ? 0.2 : 0.4;
                const strokeColor = isPreview ? '#002040' : '#002040';
                const strokeOpacity = isPreview ? 0.7 : 0.8;
                const strokeWidth = isPreview ? 2 : 3;

                this.core.map.addLayer({
                    'id': 'buildable-area-fill',
                    'type': 'fill',
                    'source': 'buildable-area',
                    'layout': {},
                    'paint': {
                        'fill-color': fillColor,
                        'fill-opacity': fillOpacity
                    }
                });

                this.core.map.addLayer({
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

                if (!isPreview) {
                    this.info(`Buildable area displayed on map with ${coordinates.length - 1} vertices`);
                }

                this.updateBuildableAreaLegend(true);
            } else {
                if (!isPreview) {
                    this.warn('No buildable coordinates to display');
                }
                this.updateBuildableAreaLegend(false);
            }
        } catch (error) {
            this.error('Error updating buildable area display:', error);
        }
    }

    updateBuildableAreaLegend(show) {
        const legendContent = document.getElementById('legendContent');
        if (!legendContent) return;

        let buildableAreaItem = legendContent.querySelector('.legend-buildable-area-item');

        if (show) {
            if (!buildableAreaItem) {
                buildableAreaItem = document.createElement('div');
                buildableAreaItem.className = 'legend-item legend-buildable-area-item';
                buildableAreaItem.innerHTML = `
                    <div class="legend-color" style="background-color: #002040; opacity: 0.4;"></div>
                    <span class="legend-label">Buildable Area</span>
                `;
                legendContent.appendChild(buildableAreaItem);
            }
            buildableAreaItem.style.display = 'flex';
        } else if (buildableAreaItem) {
            buildableAreaItem.style.display = 'none';
        }
    }

    clearDependentMapLayers() {
        try {
            this.clearSetbackVisualization();

            const layersToRemove = [
                'setback-fill', 'setback-stroke', 'setback-visualization',
                'buildable-area-fill', 'buildable-area-stroke', 'buildable-area-dimension-labels',
                'structure-fill', 'structure-stroke', 'structure-dimension-labels'
            ];

            const sourcesToRemove = [
                'setback-visualization', 'buildable-area', 'buildable-area-dimensions',
                'structure-footprint', 'structure-dimensions'
            ];

            layersToRemove.forEach(layerId => {
                if (this.core.map.getLayer(layerId)) {
                    this.core.map.removeLayer(layerId);
                }
            });

            sourcesToRemove.forEach(sourceId => {
                if (this.core.map.getSource(sourceId)) {
                    this.core.map.removeSource(sourceId);
                }
            });

            this.info('Dependent map layers cleared');
        } catch (error) {
            this.error('Error clearing dependent map layers:', error);
        }
    }

    showMapError(message) {
        const mapContainer = document.getElementById('inspectorMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div style="
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    height: 100%; 
                    background: #f5f5f5;
                    color: #666;
                    font-family: Arial, sans-serif;
                    flex-direction: column;
                    text-align: center;
                    padding: 20px;
                ">
                    <div style="font-size: 48px; margin-bottom: 16px;">🗺️</div>
                    <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Map Failed to Load</div>
                    <div style="font-size: 14px; max-width: 400px;">${message}</div>
                    <button onclick="location.reload()" style="
                        margin-top: 16px; 
                        padding: 8px 16px; 
                        background: #007cbf; 
                        color: white; 
                        border: none; 
                        border-radius: 4px; 
                        cursor: pointer;
                    ">Retry</button>
                </div>
            `;
        }
    }
}

window.SiteInspectorVisualizationManager = SiteInspectorVisualizationManager;
