
/**
 * Comments Manager
 * Handles comment placement, viewing, and management on the map
 */

class CommentsManager extends BaseManager {
    constructor(map) {
        super('CommentsManager');
        this.map = map;
        this.isCommenting = false;
        this.comments = [];
        this.commentPopups = [];
        this.projectId = null;
    }

    async initialize() {
        this.info('Initializing Comments Manager...');
        this.setupEventListeners();
        this.setupCommentsControl();
        this.loadProjectComments();
        this.info('Comments Manager initialized successfully');
    }

    setupEventListeners() {
        // Comments tool button
        const commentsBtn = document.getElementById('commentsToolButton');
        if (commentsBtn) {
            commentsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCommentsTool();
            });
        }

        // Listen for other tool activations to stop commenting
        if (window.eventBus) {
            window.eventBus.on('tool-activated', (toolName) => {
                if (toolName !== 'comments' && this.isCommenting) {
                    this.stopCommenting();
                }
            });
        }

        // Listen for project changes
        window.eventBus.on('project-changed', (data) => {
            this.projectId = data.projectId;
            this.loadProjectComments();
        });
    }

    setupCommentsControl() {
        this.info('Comments control ready');
    }

    toggleCommentsTool() {
        const button = document.getElementById('commentsToolButton');

        if (this.isCommenting) {
            this.stopCommenting();
            button.classList.remove('active');
            button.innerHTML = '💬';
        } else {
            this.startCommenting();
            button.classList.add('active');
            button.innerHTML = '✖';

            // Notify other tools
            window.eventBus.emit('tool-activated', 'comments');
        }
    }

    startCommenting() {
        this.isCommenting = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this.handleCommentClick);
        this.showExistingComments();
        this.addCommentToolExitListeners();
        this.info('Comments tool started - click on map to add comments');
    }

    stopCommenting() {
        this.isCommenting = false;

        // Remove event listeners safely
        if (this.handleCommentClick) {
            this.map.off('click', this.handleCommentClick);
        }

        // Reset cursor
        if (this.map.getCanvas()) {
            this.map.getCanvas().style.cursor = '';
        }

        this.hideComments();
        this.removeCommentToolExitListeners();

        const button = document.getElementById('commentsToolButton');
        if (button) {
            button.classList.remove('active');
            button.innerHTML = '💬';
        }

        this.info('Comments tool stopped');
    }

    handleCommentClick = (e) => {
        if (!this.isCommenting) return;

        e.preventDefault();
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
        }

        const point = [e.lngLat.lng, e.lngLat.lat];
        this.showCommentDialog(point);
    }

    showCommentDialog(coordinates) {
        const modal = document.createElement('div');
        modal.className = 'comment-modal';
        modal.innerHTML = `
            <div class="comment-modal-content">
                <div class="comment-modal-header">
                    <h3>Add Comment</h3>
                    <button class="comment-modal-close">×</button>
                </div>
                <div class="comment-modal-body">
                    <textarea 
                        id="commentText" 
                        placeholder="Enter your comment here..."
                        rows="4"
                        maxlength="500"
                    ></textarea>
                    <div class="comment-character-count">
                        <span id="commentCharCount">0</span>/500
                    </div>
                </div>
                <div class="comment-modal-footer">
                    <button class="comment-btn-cancel">Cancel</button>
                    <button class="comment-btn-save">Save Comment</button>
                </div>
            </div>
        `;

        // Add modal styles
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const content = modal.querySelector('.comment-modal-content');
        content.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 20px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;

        const textarea = modal.querySelector('#commentText');
        const charCount = modal.querySelector('#commentCharCount');
        
        textarea.addEventListener('input', () => {
            charCount.textContent = textarea.value.length;
        });

        // Event listeners
        modal.querySelector('.comment-modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('.comment-btn-cancel').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.querySelector('.comment-btn-save').addEventListener('click', () => {
            const text = textarea.value.trim();
            if (text) {
                this.saveComment(coordinates, text);
                document.body.removeChild(modal);
            }
        });

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });

        document.body.appendChild(modal);
        textarea.focus();
    }

    async saveComment(coordinates, text) {
        try {
            const comment = {
                id: Date.now(), // Temporary ID
                coordinates: coordinates,
                text: text,
                timestamp: new Date().toISOString(),
                user: 'Current User' // TODO: Get from session
            };

            // Save to backend
            const projectId = this.getProjectId();
            if (projectId) {
                const response = await fetch('/api/comments', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        project_id: projectId,
                        coordinates: coordinates,
                        text: text,
                        type: 'site_comment'
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    comment.id = result.comment_id;
                    this.info('Comment saved to database');
                } else {
                    this.warn('Failed to save comment to database, storing locally');
                }
            }

            this.comments.push(comment);
            this.addCommentToMap(comment);
            this.info('Comment added successfully');

        } catch (error) {
            this.error('Failed to save comment:', error);
            // Still add to local comments for user experience
            this.comments.push(comment);
            this.addCommentToMap(comment);
        }
    }

    addCommentToMap(comment) {
        const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: 'comment-popup',
            anchor: 'bottom',
            offset: [0, -10]
        })
        .setLngLat(comment.coordinates)
        .setHTML(`
            <div class="comment-content">
                <div class="comment-header">
                    <span class="comment-user">${comment.user}</span>
                    <span class="comment-time">${this.formatTimestamp(comment.timestamp)}</span>
                </div>
                <div class="comment-text">${comment.text}</div>
                <div class="comment-actions">
                    <button class="comment-delete-btn" onclick="window.siteInspectorCore?.commentsManager?.deleteComment('${comment.id}')">Delete</button>
                </div>
            </div>
        `)
        .addTo(this.map);

        // Store popup reference
        comment.popup = popup;
        this.commentPopups.push(popup);

        // Add comment marker
        this.addCommentMarker(comment);
    }

    addCommentMarker(comment) {
        const markerElement = document.createElement('div');
        markerElement.className = 'comment-marker';
        markerElement.innerHTML = '💬';
        markerElement.style.cssText = `
            width: 24px;
            height: 24px;
            background: #007cbf;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            cursor: pointer;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        `;

        const marker = new mapboxgl.Marker(markerElement)
            .setLngLat(comment.coordinates)
            .addTo(this.map);

        comment.marker = marker;

        // Click to show popup
        markerElement.addEventListener('click', () => {
            if (comment.popup.isOpen()) {
                comment.popup.remove();
            } else {
                comment.popup.addTo(this.map);
            }
        });
    }

    async loadProjectComments() {
        try {
            const projectId = this.getProjectId();
            if (!projectId) return;

            const response = await fetch(`/api/comments?project_id=${projectId}&type=site_comment`);
            if (response.ok) {
                const data = await response.json();
                this.comments = data.comments || [];
                this.info(`Loaded ${this.comments.length} comments for project ${projectId}`);
                
                if (this.isCommenting) {
                    this.showExistingComments();
                }
            }
        } catch (error) {
            this.warn('Failed to load project comments:', error);
        }
    }

    showExistingComments() {
        this.comments.forEach(comment => {
            if (!comment.marker) {
                this.addCommentToMap(comment);
            }
        });
    }

    hideComments() {
        this.commentPopups.forEach(popup => {
            if (popup.remove) {
                popup.remove();
            }
        });

        this.comments.forEach(comment => {
            if (comment.marker) {
                comment.marker.remove();
            }
            if (comment.popup) {
                comment.popup.remove();
            }
        });
    }

    async deleteComment(commentId) {
        try {
            const projectId = this.getProjectId();
            if (projectId) {
                const response = await fetch(`/api/comments/${commentId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    this.info('Comment deleted from database');
                } else {
                    this.warn('Failed to delete comment from database');
                }
            }

            // Remove from local array and map
            const commentIndex = this.comments.findIndex(c => c.id == commentId);
            if (commentIndex !== -1) {
                const comment = this.comments[commentIndex];
                
                if (comment.marker) {
                    comment.marker.remove();
                }
                if (comment.popup) {
                    comment.popup.remove();
                }

                this.comments.splice(commentIndex, 1);
                this.info('Comment removed from map');
            }

        } catch (error) {
            this.error('Failed to delete comment:', error);
        }
    }

    getProjectId() {
        // Try multiple sources for project ID
        return this.projectId || 
               window.siteInspectorCore?.projectId ||
               sessionStorage.getItem('current_project_id') ||
               new URLSearchParams(window.location.search).get('project_id');
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    addCommentToolExitListeners() {
        const uiElements = [
            '#inspectorPanel',
            '#edgeSelectionButton',
            '#recalculateButton',
            '#uploadFloorplanButton',
            '#drawFloorplanButton',
            '#buildingsToggle',
            '#styleSelector',
            '#measureToolButton',
            '.boundary-option',
            '.setback-input'
        ];

        uiElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.addEventListener('click', this.handleUIClick);
            });
        });

        document.addEventListener('keydown', this.handleKeyDown);
    }

    removeCommentToolExitListeners() {
        const uiElements = [
            '#inspectorPanel',
            '#edgeSelectionButton',
            '#recalculateButton',
            '#uploadFloorplanButton',
            '#drawFloorplanButton',
            '#buildingsToggle',
            '#styleSelector',
            '#measureToolButton',
            '.boundary-option',
            '.setback-input'
        ];

        uiElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.removeEventListener('click', this.handleUIClick);
            });
        });

        document.removeEventListener('keydown', this.handleKeyDown);
    }

    handleUIClick = (e) => {
        if (this.isCommenting) {
            this.info('UI element clicked, stopping comments tool');
            this.stopCommenting();
        }
    }

    handleKeyDown = (e) => {
        if (this.isCommenting && e.key === 'Escape') {
            this.info('Escape pressed, stopping comments tool');
            this.stopCommenting();
        }
    }

    // Get all comments for dashboard integration
    getAllComments() {
        return this.comments;
    }

    // Cleanup method
    dispose() {
        this.info('Disposing Comments Manager...');

        if (this.isCommenting) {
            this.stopCommenting();
        }

        this.hideComments();
        this.removeCommentToolExitListeners();

        this.info('Comments Manager disposed');
    }
}

// Export and make globally available
window.CommentsManager = CommentsManager;
