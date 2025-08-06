/**
 * Site Developer Core Module
 * Main orchestrator for 3D visualization and terrain rendering
 */
class SiteDeveloperCore {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.siteData = null;
        this.terrainData = null;
        this.adamChat = null;
        this.isInitialized = false;
        this.drawingManager = null;
    }

    initialize() {
        console.log('[SiteDeveloper] Initializing Site Developer Core...');

        try {
            // Load data from global variables
            this.siteData = window.siteData || {};
            this.terrainData = window.terrainData || {};

            // Validate data availability
            console.log('[SiteDeveloper] Site data available:', Object.keys(this.siteData).length > 0);
            console.log('[SiteDeveloper] Terrain data available:', Object.keys(this.terrainData).length > 0);

            if (Object.keys(this.siteData).length === 0) {
                console.warn('[SiteDeveloper] No site data available - site inspection may be incomplete');
            }

            if (Object.keys(this.terrainData).length === 0) {
                console.warn('[SiteDeveloper] No terrain data available - terrain analysis may be incomplete');
            }

            // Initialize 3D visualizer
            this.initVisualizer();

            // Initialize drawing manager
            this.initDrawingManager();

            // Set up ADAM chat
            this.setupSiteDeveloperChat();

            // Set up event listeners
            this.setupEventListeners();

            // Set up navigation
            this.setupNavigation();

            this.isInitialized = true;
            console.log('[SiteDeveloper] Site Developer Core initialized successfully');
        } catch (error) {
            console.error('[SiteDeveloper] Failed to initialize Site Developer Core:', error);
            console.error('[SiteDeveloper] Error details:', error.message);
            console.error('[SiteDeveloper] Stack trace:', error.stack);

            // Show user-friendly error message
            this.showInitializationError(error);
        }
    }

    initVisualizer() {
        console.log('[SiteDeveloper] Initializing 3D visualizer...');

        try {
            const container = document.getElementById('visualizerCanvas');
            const loadingOverlay = document.getElementById('loadingOverlay');

            if (!container) {
                throw new Error('Visualizer canvas container not found');
            }

            // Create plot container
            const plotContainer = document.createElement('div');
            plotContainer.id = 'plotContainer';
            plotContainer.style.width = '100%';
            plotContainer.style.height = '100%';
            plotContainer.style.position = 'relative';
            container.appendChild(plotContainer);

            // Load site data and create terrain visualization
            this.loadSiteModel();

            // Hide loading overlay
            setTimeout(() => {
                if (loadingOverlay) {
                    loadingOverlay.style.display = 'none';
                }
            }, 1000);

            console.log('[SiteDeveloper] 3D visualizer initialized successfully');
        } catch (error) {
            console.error('[SiteDeveloper] Error initializing 3D visualizer:', error);
            throw error;
        }
    }

    initDrawingManager() {
        console.log('[SiteDeveloper] Initializing drawing manager...');

        try {
            if (typeof SiteDeveloperDrawing !== 'undefined') {
                this.drawingManager = new SiteDeveloperDrawing(this);
                this.drawingManager.initialize();
                console.log('[SiteDeveloper] Drawing manager initialized successfully');
            } else {
                console.error('[SiteDeveloper] SiteDeveloperDrawing class not available');
                // Don't throw error for missing drawing manager - it's not critical for basic functionality
            }
        } catch (error) {
            console.error('[SiteDeveloper] Error initializing drawing manager:', error);
            // Don't throw error - allow core to continue initializing
        }
    }

    loadSiteModel() {
        console.log('[SiteDeveloper] Loading combined site model...');
        console.log('[SiteDeveloper] Available terrain data keys:', this.terrainData ? Object.keys(this.terrainData) : 'none');
        console.log('[SiteDeveloper] Available site data keys:', this.siteData ? Object.keys(this.siteData) : 'none');

        // Check if we have terrain data to visualize
        if (this.terrainData && this.terrainData.elevation_data) {
            console.log('[SiteDeveloper] Creating Plotly terrain visualization');
            this.createPlotlyTerrainVisualization(this.terrainData);
        } else {
            console.log('[SiteDeveloper] No terrain data available, showing placeholder');
            this.showNoDataMessage();
        }
    }

    createPlotlyTerrainVisualization(data) {
        console.log('[SiteDeveloper] Creating Plotly terrain visualization with data:', Object.keys(data));

        if (!data.elevation_data || !Array.isArray(data.elevation_data)) {
            console.error('[SiteDeveloper] Invalid elevation data for Plotly visualization');
            this.showNoDataMessage();
            return;
        }

        const plotContainer = document.getElementById('plotContainer');
        if (!plotContainer) {
            console.error('[SiteDeveloper] Plot container not found');
            return;
        }

        // Prepare traces array
        const traces = [];

        // Add terrain surface trace
        const terrainTrace = {
            z: data.elevation_data,
            type: 'surface',
            colorscale: [
                        [0, '#0d1421'],      // Deep navy
                        [0.15, '#1a2332'],   // Dark blue-grey
                        [0.3, '#2d4a5a'],    // Medium blue-grey
                        [0.45, '#547bf7'],   // EngineRoom blue
                        [0.6, '#6287ff'],    // Bright blue
                        [0.75, '#84a7f7'],   // Light blue
                        [0.85, '#a3c4f3'],   // Very light blue
                        [0.95, '#e8f2ff'],   // Almost white blue
                        [1, '#ffffff']       // Pure white
                    ],
            opacity: 1.0,
            name: 'Terrain',
            showscale: true,
            colorbar: {
                    title: 'Elevation (m)',
                    titlefont: { color: 'white', size: 12 },
                    tickfont: { color: 'white', size: 10 },
                    len: 0.8,
                    thickness: 20,
                    bgcolor: 'rgba(0,0,0,0.5)',
                    bordercolor: 'white',
                    borderwidth: 1
                }
        };

        traces.push(terrainTrace);

        // Add polygon overlays if available
        if (data.polygon_overlays) {
            Object.keys(data.polygon_overlays).forEach(key => {
                const overlay = data.polygon_overlays[key];
                if (overlay.coordinates && overlay.coordinates.length > 0) {
                    const x_coords = overlay.coordinates.map(coord => coord[0]);
                    const y_coords = overlay.coordinates.map(coord => coord[1]);

                    // Add Z coordinates at ground level
                    const z_coords = new Array(x_coords.length).fill(0);

                    traces.push({
                        x: x_coords,
                        y: y_coords,
                        z: z_coords,
                        mode: 'lines',
                        type: 'scatter3d',
                        line: {
                            color: overlay.color || '#007cbf',
                            width: 6
                        },
                        name: overlay.name || key,
                        showlegend: true,
                        opacity: 0.9
                    });

                    // Add area information to legend if available
                    if (overlay.area_m2) {
                        const lastTrace = traces[traces.length - 1];
                        lastTrace.name += ` (${overlay.area_m2.toFixed(1)} m²)`;
                    }
                }
            });

            // Log overlay summary
            const overlayTypes = Object.keys(data.polygon_overlays);
            console.log(`[SiteDeveloper] Successfully added ${overlayTypes.length} polygon overlays: ${overlayTypes.join(', ')}`);
        }

        // Calculate appropriate scaling for terrain visualization
        const maxX = data.width_m || 50;
        const maxY = data.length_m || 50;
        const elevationRange = Math.max(...data.elevation_data.flat()) - Math.min(...data.elevation_data.flat());

        // Use proper elevation scaling to maintain realistic proportions
        const elevationScale = Math.max(elevationRange * 2.5, maxX * 0.3);
        const maxDimension = Math.max(maxX, maxY);

        // Calculate aspect ratios to maintain realistic terrain proportions
        const aspectRatio = {
            x: maxX / maxDimension,
            y: maxY / maxDimension,
            z: elevationScale / maxDimension
        };

        const layout = {
            scene: {
                aspectmode: 'manual',
                aspectratio: aspectRatio,
                xaxis: { 
                    title: 'Width (m)',
                    titlefont: { color: 'white', size: 14 },
                    tickformat: '.0f',
                    tickfont: { color: 'white', size: 12 },
                    showgrid: true,
                    gridcolor: 'rgba(255, 255, 255, 0.3)',
                    gridwidth: 2,
                    range: [0, maxX]
                },
                yaxis: { 
                    title: 'Length (m)',
                    titlefont: { color: 'white', size: 14 },
                    tickformat: '.0f',
                    tickfont: { color: 'white', size: 12 },
                    showgrid: true,
                    gridcolor: 'rgba(255, 255, 255, 0.3)',
                    gridwidth: 2,
                    range: [0, maxY]
                },
                zaxis: { 
                    title: 'Elevation (m)',
                    titlefont: { color: 'white', size: 14 },
                    tickformat: '.1f',
                    tickfont: { color: 'white', size: 12 },
                    showgrid: true,
                    gridcolor: 'rgba(255, 255, 255, 0.3)',
                    gridwidth: 2
                },
                bgcolor: 'rgba(0,0,0,0)',
                camera: {
                    eye: { x: 1.5, y: 1.5, z: 1.2 },
                    center: { x: 0, y: 0, z: 0 },
                    up: { x: 0, y: 0, z: 1 }
                }
            },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: 'white', size: 12 },
            margin: { l: 0, r: 0, t: 30, b: 0 },
            showlegend: true,
            legend: {
                x: 0.02,
                y: 0.98,
                bgcolor: 'rgba(0,0,0,0.7)',
                bordercolor: 'white',
                borderwidth: 1,
                font: { color: 'white', size: 11 }
            },
            title: {
                text: `Site Development Visualization - ${data.address || 'Site'}`,
                font: { color: 'white', size: 16 },
                x: 0.5,
                y: 0.95
            }
        };

        const config = {
            displayModeBar: true,
            modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d', 'autoScale2d'],
            modeBarButtonsToAdd: ['resetScale3d'],
            displaylogo: false,
            responsive: true
        };

        try {
            if (typeof Plotly !== 'undefined') {
                Plotly.newPlot(plotContainer, traces, layout, config);
                console.log('[SiteDeveloper] Plotly terrain visualization created successfully');

                // Initialize drawing overlay after plot is created
                if (this.drawingManager) {
                    this.drawingManager.setupDrawingOverlay();
                }

            } else {
                console.error('[SiteDeveloper] Plotly not available, falling back to basic message');
                this.showNoDataMessage();
            }
        } catch (error) {
            console.error('[SiteDeveloper] Error creating Plotly visualization:', error);
            this.showNoDataMessage();
        }
    }

    createSiteBoundary(coordinates) {
        if (!coordinates || coordinates.length < 3) {
            console.warn('[SiteDeveloper] Invalid site boundary coordinates');
            return;
        }

        const validCoordinates = coordinates.filter(coord => {
            return Array.isArray(coord) && 
                   coord.length >= 2 && 
                   isFinite(coord[0]) && 
                   isFinite(coord[1]);
        });

        if (validCoordinates.length < 3) {
            console.warn('[SiteDeveloper] Insufficient valid coordinates for site boundary');
            return;
        }

        const points = validCoordinates.map(coord => {
            const x = coord[0] * 1000;
            const z = coord[1] * 1000;

            if (!isFinite(x) || !isFinite(z)) {
                console.warn('[SiteDeveloper] Invalid coordinate calculation:', coord);
                return new THREE.Vector3(0, 0, 0);
            }

            return new THREE.Vector3(x, 0, z);
        });

        try {
            // Create boundary line
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: 0x007cbf, linewidth: 3 });
            const boundary = new THREE.Line(geometry, material);
            boundary.name = 'siteBoundary';
            this.scene.add(boundary);

            // Create boundary fill
            const shape = new THREE.Shape();
            points.forEach((point, index) => {
                if (isFinite(point.x) && isFinite(point.z)) {
                    if (index === 0) {
                        shape.moveTo(point.x, point.z);
                    } else {
                        shape.lineTo(point.x, point.z);
                    }
                }
            });

            const fillGeometry = new THREE.ShapeGeometry(shape);
            const fillMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x007cbf, 
                transparent: true, 
                opacity: 0.2,
                side: THREE.DoubleSide
            });
            const fill = new THREE.Mesh(fillGeometry, fillMaterial);
            fill.rotation.x = -Math.PI / 2;
            fill.name = 'siteBoundaryFill';
            this.scene.add(fill);

            console.log('[SiteDeveloper] Site boundary created successfully');
        } catch (error) {
            console.error('[SiteDeveloper] Error creating site boundary:', error);
        }
    }

    showNoDataMessage() {
        const messageOverlay = document.createElement('div');
        messageOverlay.style.position = 'absolute';
        messageOverlay.style.top = '50%';
        messageOverlay.style.left = '50%';
        messageOverlay.style.transform = 'translate(-50%, -50%)';
        messageOverlay.style.color = '#ffffff';
        messageOverlay.style.fontSize = '16px';
        messageOverlay.style.textAlign = 'center';
        messageOverlay.style.background = 'rgba(0, 0, 0, 0.7)';
        messageOverlay.style.padding = '20px';
        messageOverlay.style.borderRadius = '8px';
        messageOverlay.style.zIndex = '1000';
        messageOverlay.innerHTML = `
            <div style="margin-bottom: 10px;">🏗️</div>
            <div style="font-weight: bold; margin-bottom: 8px;">No Site Data Available</div>
            <div style="font-size: 14px; opacity: 0.8; margin-bottom: 15px;">Complete the Site Inspector and Terrain Analysis steps first</div>
            <button onclick="window.navigateToStep(1)" style="background: #007cbf; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-right: 10px;">Go to Site Inspector</button>
            <button onclick="window.navigateToStep(2)" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">Terrain Analysis</button>
        `;

        document.getElementById('visualizerCanvas').appendChild(messageOverlay);
    }

    showInitializationError(error) {
        const container = document.getElementById('visualizerCanvas');
        if (!container) return;

        const errorOverlay = document.createElement('div');
        errorOverlay.style.position = 'absolute';
        errorOverlay.style.top = '50%';
        errorOverlay.style.left = '50%';
        errorOverlay.style.transform = 'translate(-50%, -50%)';
        errorOverlay.style.color = '#ffffff';
        errorOverlay.style.fontSize = '16px';
        errorOverlay.style.textAlign = 'center';
        errorOverlay.style.background = 'rgba(220, 53, 69, 0.9)';
        errorOverlay.style.padding = '20px';
        errorOverlay.style.borderRadius = '8px';
        errorOverlay.style.zIndex = '1000';
        errorOverlay.style.maxWidth = '400px';
        errorOverlay.innerHTML = `
            <div style="margin-bottom: 10px;">⚠️</div>
            <div style="font-weight: bold; margin-bottom: 8px;">Site Developer Initialization Failed</div>
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 15px;">There was an error loading the Site Developer. Please try refreshing the page or contact support if the issue persists.</div>
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 15px;">Error: ${error.message || 'Unknown error'}</div>
            <button onclick="location.reload()" style="background: #007cbf; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-right: 10px;">Refresh Page</button>
            <button onclick="window.navigateToStep(2)" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">Terrain Analysis</button>
        `;

        container.appendChild(errorOverlay);
    }

    showTerrainOnlyMessage() {
        const messageOverlay = document.createElement('div');
        messageOverlay.style.position = 'absolute';
        messageOverlay.style.top = '20px';
        messageOverlay.style.right = '20px';
        messageOverlay.style.color = '#ffffff';
        messageOverlay.style.fontSize = '14px';
        messageOverlay.style.textAlign = 'center';
        messageOverlay.style.background = 'rgba(34, 139, 34, 0.8)';
        messageOverlay.style.padding = '15px';
        messageOverlay.style.borderRadius = '8px';
        messageOverlay.style.zIndex = '1000';
        messageOverlay.style.maxWidth = '300px';
        messageOverlay.innerHTML = `
            <div style="margin-bottom: 8px;">🌍</div>
            <div style="font-weight: bold; margin-bottom: 8px;">Terrain Analysis Loaded</div>
            <div style="font-size: 12px; opacity: 0.9;">Terrain visualization is available. Complete Site Inspector to add site boundaries and buildable areas.</div>
        `;

        document.getElementById('visualizerCanvas').appendChild(messageOverlay);

        // Auto-hide the message after 8 seconds
        setTimeout(() => {
            if (messageOverlay.parentNode) {
                messageOverlay.parentNode.removeChild(messageOverlay);
            }
        }, 8000);
    }

    setupSiteDeveloperChat() {
        const chatInput = document.getElementById('adamChatInput');
        const sendBtn = document.getElementById('adamSendBtn');
        const conversation = document.getElementById('adamConversation');

        let currentConversationId = null;
        let isTyping = false;

        // Add initial greeting
        let welcomeMessage = 'Welcome to Site Developer! ';

        if (this.terrainData && (this.terrainData.elevation_data || this.terrainData.terrain_points)) {
            welcomeMessage += 'I can see you\'ve completed your site inspection and terrain analysis. The 3D terrain visualization is now available in the viewer. ';
        } else if (this.siteData && this.siteData.coordinates) {
            welcomeMessage += 'I can see you\'ve completed your site inspection. ';
        }

        welcomeMessage += 'I\'m here to help you make informed decisions about your development. What would you like to explore first?';

        this.addAssistantMessage(welcomeMessage, conversation);

        const handleInputChange = () => {
            const hasText = chatInput.value.trim().length > 0;
            sendBtn.disabled = !hasText || isTyping;
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    this.sendMessage(chatInput, conversation, currentConversationId, isTyping);
                }
            }
        };

        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
            handleInputChange();
        });

        chatInput.addEventListener('keydown', handleKeyDown);
        sendBtn.addEventListener('click', () => this.sendMessage(chatInput, conversation, currentConversationId, isTyping));

        console.log('Site Developer chat initialized successfully');
    }

    async sendMessage(chatInput, conversation, currentConversationId, isTyping) {
        const message = chatInput.value.trim();
        if (!message || isTyping) return;

        this.addUserMessage(message, conversation);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        isTyping = true;
        this.showTypingIndicator(conversation);

        try {
            // Check if this is a building layout request
            const isBuildingLayoutRequest = this.isBuildingLayoutRequest(message);

            if (isBuildingLayoutRequest && this.drawingManager && this.drawingManager.buildPlatform) {
                // Handle as building layout generation
                await this.handleBuildingLayoutMessage(message, conversation);
            } else {
                // Handle as regular chat
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: message,
                        conversation_id: currentConversationId,
                        agent_type: 'ADAM',
                        agent: 'ADAM',  // Include both for compatibility
                        context: {
                            page: 'site-developer',
                            project_id: window.projectId,
                            site_data: this.siteData,
                            terrain_data: this.terrainData,
                            platform_data: this.drawingManager?.buildPlatform?.meta,
                            building_units: this.drawingManager?.buildingUnits?.map(unit => unit.metadata) || []
                        }
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                if (data.success) {
                    currentConversationId = data.conversation_id;
                    this.addAssistantMessage(data.response, conversation);
                } else {
                    throw new Error(data.error || 'Unknown error occurred');
                }
            }

        } catch (error) {
            console.error('Failed to send message to ADAM:', error);
            this.addErrorMessage('Sorry, I encountered an error. Please try again.', conversation);
        } finally {
            isTyping = false;
            this.hideTypingIndicator(conversation);
        }
    }

    isBuildingLayoutRequest(message) {
        const buildingKeywords = ['townhouse', 'house', 'building', 'unit', 'duplex', 'apartment', 'studio', 'layout', 'row', 'cluster'];
        const layoutKeywords = ['arrange', 'place', 'position', 'generate', 'create', 'design', 'layout'];

        const lowerMessage = message.toLowerCase();
        const hasBuildingKeyword = buildingKeywords.some(keyword => lowerMessage.includes(keyword));
        const hasLayoutKeyword = layoutKeywords.some(keyword => lowerMessage.includes(keyword));
        const hasNumbers = /\d+/.test(message);

        return hasBuildingKeyword && (hasLayoutKeyword || hasNumbers);
    }

    async handleBuildingLayoutMessage(message, conversation) {
        try {
            // Check if drawing manager and platform exist
            if (!this.drawingManager) {
                throw new Error('Drawing manager not initialized');
            }
            
            if (!this.drawingManager.buildPlatform) {
                throw new Error('No build platform found. Please create a platform first');
            }

            // Generate layout using the message as prompt
            await this.drawingManager.generateBuildingLayoutFromChat(message, conversation);
        } catch (error) {
            console.error('Building layout generation failed:', error);
            this.addAssistantMessage(`I couldn't generate the building layout: ${error.message}. Please make sure you have created a build platform first, or try describing your layout differently.`, conversation);
        }
    }

    addUserMessage(message, conversation) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'adam-message user';
        messageDiv.innerHTML = `
            <div class="adam-message-content">
                <div class="adam-message-text">${this.escapeHtml(message)}</div>
                <div class="adam-message-time">${this.formatTime(new Date())}</div>
            </div>
        `;
        conversation.appendChild(messageDiv);
        this.scrollToBottom(conversation);
    }

    addAssistantMessage(message, conversation) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'adam-message assistant';
        messageDiv.innerHTML = `
            <div class="adam-message-avatar">A</div>
            <div class="adam-message-content">
                <div class="adam-message-header">
                    <span class="adam-message-sender">ADAM</span>
                    <span class="adam-message-time">${this.formatTime(new Date())}</span>
                </div>
                <div class="adam-message-text">${this.formatMessageContent(message)}</div>
            </div>
        `;
        conversation.appendChild(messageDiv);

        // Execute any embedded scripts for platform creation
        const scripts = messageDiv.querySelectorAll('script');
        scripts.forEach(script => {
            try {
                eval(script.textContent);
            } catch (error) {
                console.error('[SiteDeveloper] Error executing chat script:', error);
            }
        });

        this.scrollToBottom(conversation);
    }

    addErrorMessage(message, conversation) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'adam-message error';
        messageDiv.innerHTML = `
            <div class="adam-message-content">
                <div class="adam-message-text" style="color: #ef4444;">${this.escapeHtml(message)}</div>
                <div class="adam-message-time">${this.formatTime(new Date())}</div>
            </div>
        `;
        conversation.appendChild(messageDiv);
        this.scrollToBottom(conversation);
    }

    showTypingIndicator(conversation) {
        const existingIndicator = conversation.querySelector('.adam-typing-indicator');
        if (existingIndicator) return;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'adam-message assistant adam-typing-indicator';
        typingDiv.innerHTML = `
            <div class="adam-message-avatar">A</div>
            <div class="adam-message-content">
                <div class="adam-typing-animation">
                    <span style="animation: pulse 1.4s infinite; animation-delay: 0s;">•</span>
                    <span style="animation: pulse 1.4s infinite; animation-delay: 0.2s;">•</span>
                    <span style="animation: pulse 1.4s infinite; animation-delay: 0.4s;">•</span>
                </div>
            </div>
        `;
        conversation.appendChild(typingDiv);
        this.scrollToBottom(conversation);
    }

    hideTypingIndicator(conversation) {
        const typingIndicator = conversation.querySelector('.adam-typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    scrollToBottom(conversation) {
        setTimeout(() => {
            conversation.scrollTop = conversation.scrollHeight;
        }, 100);
    }

    formatMessageContent(content) {
        // Handle script tags specially - don't escape them
        const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
        const scripts = [];
        let scriptIndex = 0;

        // Extract scripts and replace with placeholders
        let processedContent = content.replace(scriptRegex, (match, scriptContent) => {
            scripts.push(match);
            return `__SCRIPT_PLACEHOLDER_${scriptIndex++}__`;
        });

        // Escape HTML for the rest of the content
        processedContent = this.escapeHtml(processedContent)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');

        // Restore scripts
        scripts.forEach((script, index) => {
            processedContent = processedContent.replace(`__SCRIPT_PLACEHOLDER_${index}__`, script);
        });

        return processedContent;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTime(date) {
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
    }

    setupEventListeners() {
        // Window resize handler
        window.addEventListener('resize', () => this.onWindowResize(), false);

        // View control buttons for Plotly
        document.getElementById('view3DBtn').addEventListener('click', () => {
            this.setPlotlyView('3d');
            document.getElementById('view3DBtn').classList.add('active');
            document.getElementById('viewTopBtn').classList.remove('active');
        });

        document.getElementById('viewTopBtn').addEventListener('click', () => {
            this.setPlotlyView('top');
            document.getElementById('viewTopBtn').classList.add('active');
            document.getElementById('view3DBtn').classList.remove('active');
        });

        document.getElementById('viewResetBtn').addEventListener('click', () => {
            this.resetPlotlyView();
        });
    }

    setPlotlyView(viewType) {
        try {
            if (typeof Plotly !== 'undefined') {
                const plotContainer = document.getElementById('plotContainer');
                if (plotContainer) {
                    let cameraUpdate;

                    if (viewType === 'top') {
                        cameraUpdate = {
                            'scene.camera': {
                                eye: { x: 0, y: 0, z: 2.5 },
                                center: { x: 0, y: 0, z: 0 },
                                up: { x: 0, y: 1, z: 0 }
                            }
                        };
                    } else {
                        cameraUpdate = {
                            'scene.camera': {
                                eye: { x: 1.5, y: 1.5, z: 1.2 },
                                center: { x: 0, y: 0, z: 0 },
                                up: { x: 0, y: 0, z: 1 }
                            }
                        };
                    }

                    Plotly.relayout(plotContainer, cameraUpdate);
                }
            }
        } catch (error) {
            console.error('[SiteDeveloper] Error setting Plotly view:', error);
        }
    }

    resetPlotlyView() {
        try {
            if (typeof Plotly !== 'undefined') {
                const plotContainer = document.getElementById('plotContainer');
                if (plotContainer) {
                    Plotly.relayout(plotContainer, {
                        'scene.camera': {
                            eye: { x: 1.5, y: 1.5, z: 1.2 },
                            center: { x: 0, y: 0, z: 0 },
                            up: { x: 0, y: 0, z: 1 }
                        }
                    });
                }
            }
        } catch (error) {
            console.error('[SiteDeveloper] Error resetting Plotly view:', error);
        }
    }

    setupNavigation() {
        // Global platform creation function for chat integration
        window.createPlatformFromChat = (length, width, height, rotation = 0) => {
            console.log('[SiteDeveloper] Creating platform from chat:', length, width, height, 'rotation:', rotation);

            if (this.drawingManager) {
                this.drawingManager.platformDimensions = {
                    length: length,
                    width: width,
                    height: height,
                    rotation: rotation  // Store rotation in platform dimensions
                };

                // Update input fields if they exist
                const lengthInput = document.getElementById('platformLength');
                const widthInput = document.getElementById('platformWidth');
                const heightInput = document.getElementById('platformHeight');
                const rotationInput = document.getElementById('platformRotation');
                const rotationValue = document.getElementById('rotationValue');

                if (lengthInput) lengthInput.value = length;
                if (widthInput) widthInput.value = width;
                if (heightInput) heightInput.value = height;
                if (rotationInput) rotationInput.value = rotation;
                if (rotationValue) rotationValue.textContent = rotation + '°';

                // Create the platform with rotation directly
                this.drawingManager.createBuildPlatformWithRotation(rotation);

                console.log('[SiteDeveloper] Platform created successfully from chat with rotation:', rotation);
                return true;
            } else {
                console.error('[SiteDeveloper] Drawing manager not available');
                return false;
            }
        };

        // Navigation function for engineering flow steps
        window.navigateToStep = (step) => {
            let projectId = new URLSearchParams(window.location.search).get('project_id') || 
                           new URLSearchParams(window.location.search).get('project');

            if (projectId && (projectId.includes('?') || projectId.includes('&'))) {
                projectId = projectId.split('?')[0].split('&')[0];
            }

            if (window.projectData && window.projectData.id && (!projectId || projectId === 'null' || projectId === '')) {
                projectId = window.projectData.id;
            }

            if (projectId && typeof projectId === 'string') {
                projectId = projectId.split('?')[0].split('&')[0].trim();
                if (!/^\d+$/.test(projectId)) {
                    console.error('Invalid project ID format:', projectId);
                    return;
                }
            }

            if (!projectId) {
                console.error('No valid project ID found for navigation');
                return;
            }

            const routes = {
                1: `/site-inspector?project_id=${projectId}`,
                2: `/terrain-viewer?project_id=${projectId}`,
                3: `/site-developer?project_id=${projectId}`,
                4: `/structure-designer?project_id=${projectId}`,
                5: `/structural-analyser?project_id=${projectId}`
            };

            if (routes[step] && projectId) {
                window.location.href = routes[step];
            } else {
                console.error('No project ID available for navigation');
            }
        };
    }

    onWindowResize() {
        try {
            if (typeof Plotly !== 'undefined') {
                const plotContainer = document.getElementById('plotContainer');
                if (plotContainer) {
                    Plotly.Plots.resize(plotContainer);
                }
            }
        } catch (error) {
            console.error('[SiteDeveloper] Error resizing plot:', error);
        }
    }
}

// Make SiteDeveloperCore available globally
window.SiteDeveloperCore = SiteDeveloperCore;