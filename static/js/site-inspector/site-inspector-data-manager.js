
/**
 * Site Inspector Data Manager
 * Handles data operations for the site inspector
 */

class SiteInspectorDataManager extends BaseManager {
    constructor(core) {
        super('SiteInspectorDataManager');
        this.core = core;
    }

    loadSiteData() {
        if (typeof window.siteData !== 'undefined' && window.siteData) {
            this.core.siteData = window.siteData;
            this.info('Site data loaded from template');
        } else {
            this.core.siteData = {
                ready_for_new_polygon: true,
                area: 0,
                area_m2: 0,
                type: 'residential',
                coordinates: [],
                center: null
            };
        }
    }

    async loadProjectAddress() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            let projectId = urlParams.get('project_id') || urlParams.get('project') || 
                           sessionStorage.getItem('project_id');

            if (!projectId || !/^\d+$/.test(String(projectId).trim())) {
                this.info('No valid project ID found');
                return false;
            }

            projectId = String(projectId).trim();

            try {
                const response = await fetch(`/api/project-address?project_id=${projectId}`);

                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.site_address) {
                        this.core.siteData.project_address = data.site_address;
                        this.info('✅ Project address loaded:', data.site_address);

                        if (data.location && data.location.lat && data.location.lng) {
                            this.core.siteData.center = {
                                lat: parseFloat(data.location.lat),
                                lng: parseFloat(data.location.lng)
                            };
                            this.info('✅ Project coordinates available:', this.core.siteData.center);
                            return true;
                        } else {
                            return await this.geocodeProjectAddress(data.site_address);
                        }
                    }
                }
            } catch (error) {
                this.warn('Failed to fetch project address directly:', error.message);
            }

            if (window.projectData && window.projectData.address) {
                this.core.siteData.project_address = window.projectData.address;
                this.info('✅ Using project address from template:', window.projectData.address);
                return await this.geocodeProjectAddress(window.projectData.address);
            }

            return false;
        } catch (error) {
            this.error('Error loading project address:', error);
            return false;
        }
    }

    async geocodeProjectAddress(address) {
        try {
            this.info('🌍 Geocoding project address:', address);

            const geocodeCacheKey = `geocode_${btoa(address)}`;
            const cached = this.getFromCache(geocodeCacheKey);
            if (cached && cached.timestamp > Date.now() - 86400000) {
                this.info('✅ Using cached geocoding result');
                this.core.siteData.center = cached.center;
                return true;
            }

            const response = await fetch('/api/geocode-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: address })
            });

            if (!response.ok) {
                this.warn(`Geocoding API returned ${response.status} ${response.statusText}`);
                return false;
            }

            const data = await response.json();

            if (data.success && data.location && data.location.lat && data.location.lng) {
                this.core.siteData.center = {
                    lat: parseFloat(data.location.lat),
                    lng: parseFloat(data.location.lng)
                };

                this.setCache(geocodeCacheKey, {
                    center: this.core.siteData.center,
                    timestamp: Date.now()
                });

                this.info('✅ Project address geocoded successfully:', this.core.siteData.center);
                return true;
            } else {
                this.warn('Geocoding failed - no valid coordinates returned:', data.error || 'Unknown error');
                return false;
            }
        } catch (error) {
            this.error('Error geocoding project address:', error);
            return false;
        }
    }

    getFromCache(key) {
        try {
            const cached = localStorage.getItem(`siteInspector_${key}`);
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    }

    setCache(key, data) {
        try {
            localStorage.setItem(`siteInspector_${key}`, JSON.stringify(data));
        } catch (error) {
            this.warn('Failed to cache data:', error);
        }
    }

    getSiteData() {
        const boundaryData = this.core.siteBoundaryCore.getSiteData();
        
        const siteData = {
            ...this.core.siteData,
            ...boundaryData
        };

        if (!siteData.type) {
            siteData.type = 'residential';
        }
        
        if (!siteData.center && siteData.center_lng && siteData.center_lat) {
            siteData.center = {
                lng: siteData.center_lng,
                lat: siteData.center_lat
            };
        }
        
        if (!siteData.area_m2 && siteData.area) {
            siteData.area_m2 = siteData.area;
        }

        return siteData;
    }

    updateSiteData(data) {
        this.core.siteData.coordinates = data.coordinates;
        this.core.siteData.area = data.area;
        this.core.siteData.area_m2 = data.area_m2 || data.area;
        this.core.siteData.center = data.center;
        this.core.siteData.center_lng = data.center_lng;
        this.core.siteData.center_lat = data.center_lat;
        this.core.siteData.type = data.type || 'residential';
        this.core.siteData.perimeter = data.perimeter;
        this.core.siteData.terrainBounds = data.terrainBounds;
        
        this.info('Site data updated with complete structure:', this.core.siteData);
    }

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
        if (!this.core.map) {
            this.warn('Map not available for terrain bounds capture');
            return null;
        }

        try {
            const bounds = this.core.map.getBounds();
            const center = this.core.map.getCenter();
            const zoom = this.core.map.getZoom();

            const width = bounds.getEast() - bounds.getWest();
            const height = bounds.getNorth() - bounds.getSouth();

            return {
                bounds: {
                    north: bounds.getNorth(),
                    south: bounds.getSouth(),
                    east: bounds.getEast(),
                    west: bounds.getWest()
                },
                center: [center.lng, center.lat],
                zoom: zoom,
                width: width,
                height: height,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.error('Error capturing terrain bounds:', error);
            return null;
        }
    }

    async saveBuildableAreaToProject(result, setbackData) {
        try {
            const projectId = this.getProjectIdFromUrl();

            if (!projectId) {
                this.warn('No project ID found, cannot save buildable area');
                return;
            }

            const terrainBounds = this.captureTerrainBounds();

            let siteCoords = null;
            let siteArea = null;
            if (this.core.siteBoundaryCore && this.core.siteBoundaryCore.hasSiteBoundary()) {
                const sitePolygon = this.core.siteBoundaryCore.getSitePolygon();
                if (sitePolygon && sitePolygon.geometry && sitePolygon.geometry.coordinates) {
                    siteCoords = sitePolygon.geometry.coordinates[0];
                    siteArea = this.core.siteBoundaryCore.calculatePolygonArea(siteCoords);
                    this.info('Site coordinates captured for snapshot:', siteCoords.length, 'points');
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
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    snapshot_type: 'buildable_area',
                    snapshot_data: JSON.stringify(snapshotData)
                })
            });

            const data = await response.json();

            if (!data.success) {
                this.error('Failed to save buildable area', data.error);
            } else {
                this.info('Buildable area saved successfully to project', projectId);
            }

        } catch (error) {
            this.error('Error saving buildable area:', error);
        }
    }

    async loadProjectData() {
        const projectId = this.getProjectIdFromUrl();
        this.info(`Project ID from URL: ${projectId || 'none'}`, '');

        if (projectId) {
            try {
                const projectResponse = await window.apiClient.get(`/project/${projectId}`);
                if (projectResponse.success) {
                    const project = projectResponse.project;
                    this.info(`✅ Project loaded: ${project.name} at ${project.address}`, '');

                    const geocodeResponse = await window.apiClient.post('/geocode-location', {
                        query: project.address
                    });

                    if (geocodeResponse.success && geocodeResponse.location) {
                        const coords = [geocodeResponse.location.lng, geocodeResponse.location.lat];
                        this.info(`✅ Project geocoded successfully to: ${coords}`, '');
                        this.core.map.flyTo({
                            center: coords,
                            zoom: 16,
                            essential: true
                        });
                        return;
                    }
                }
            } catch (error) {
                this.warn(`Failed to load project data: ${error.message}`, '');
            }
        }

        const projectAddress = sessionStorage.getItem('project_site_address');
        const projectName = sessionStorage.getItem('project_name');

        if (projectAddress) {
            this.info(`Project address from session: ${projectAddress}`, '');

            try {
                const response = await window.apiClient.post('/geocode-location', {
                    query: projectAddress
                });

                if (response.success && response.location) {
                    const coords = [response.location.lng, response.location.lat];
                    this.info(`✅ Project geocoded successfully to: ${coords}`, '');
                    this.core.map.flyTo({
                        center: coords,
                        zoom: 16,
                        essential: true
                    });
                    return;
                }
            } catch (error) {
                this.warn(`Geocoding failed for project address: ${error.message}`, '');
            }
        }

        this.warn('⚠️ Project address could not be loaded, proceeding with default location', '');
    }
}

window.SiteInspectorDataManager = SiteInspectorDataManager;
