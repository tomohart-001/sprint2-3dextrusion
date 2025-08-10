
/**
 * Collaborative Presence Manager
 * 
 * Manages real-time user presence for collaborative editing
 * Shows profile photos of users currently viewing/editing the project
 */

class CollaborativePresenceManager extends BaseManager {
    constructor() {
        super('CollaborativePresenceManager');
        
        this.projectId = null;
        this.currentUser = null;
        this.activeUsers = new Map();
        this.presenceInterval = null;
        this.heartbeatInterval = 10000; // 10 seconds
        this.inactivityTimeout = 30000; // 30 seconds
        this.lastActivity = Date.now();
        
        // DOM elements
        this.presenceContainer = null;
        this.avatarsContainer = null;
        
        this.info('Collaborative Presence Manager initialized');
    }

    /**
     * Initialize the collaborative presence system
     * @param {number} projectId - Current project ID
     * @param {object} currentUser - Current user data
     */
    async initialize(projectId, currentUser) {
        try {
            this.projectId = projectId;
            this.currentUser = currentUser;
            
            this.info('Initializing collaborative presence', {
                projectId,
                userId: currentUser?.id,
                username: currentUser?.username
            });

            // Get DOM elements
            this.presenceContainer = document.getElementById('collaborativePresence');
            this.avatarsContainer = document.getElementById('presenceAvatars');
            
            if (!this.presenceContainer || !this.avatarsContainer) {
                this.warn('Presence containers not found in DOM');
                return false;
            }

            // Set up activity tracking
            this.setupActivityTracking();
            
            // Start presence heartbeat
            this.startPresenceHeartbeat();
            
            // Load initial presence data
            await this.loadPresenceData();
            
            // Set up cleanup on page unload
            window.addEventListener('beforeunload', () => {
                this.leaveProject();
            });

            this.info('Collaborative presence initialized successfully');
            return true;
            
        } catch (error) {
            this.error('Failed to initialize collaborative presence', error);
            return false;
        }
    }

    /**
     * Set up activity tracking to detect when user is active
     */
    setupActivityTracking() {
        const trackActivity = () => {
            this.lastActivity = Date.now();
        };

        // Track various user activities
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.addEventListener(event, trackActivity, { passive: true });
        });

        this.debug('Activity tracking setup complete');
    }

    /**
     * Start the presence heartbeat to maintain active status
     */
    startPresenceHeartbeat() {
        // Clear any existing interval
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
        }

        // Send initial presence
        this.sendPresenceHeartbeat();

        // Set up recurring heartbeat
        this.presenceInterval = setInterval(async () => {
            const timeSinceActivity = Date.now() - this.lastActivity;
            
            if (timeSinceActivity < this.inactivityTimeout) {
                await this.sendPresenceHeartbeat();
            } else {
                this.debug('User inactive, skipping heartbeat');
            }
        }, this.heartbeatInterval);

        this.debug('Presence heartbeat started');
    }

    /**
     * Send presence heartbeat to server
     */
    async sendPresenceHeartbeat() {
        try {
            if (!this.projectId || !this.currentUser) return;

            let response;
            
            // Use API client if available, otherwise fall back to fetch
            if (window.apiClient && window.apiClient.post) {
                response = await window.apiClient.post('/project-presence/heartbeat', {
                    project_id: this.projectId,
                    user_id: this.currentUser.id,
                    timestamp: Date.now()
                });
            } else {
                const fetchResponse = await fetch('/api/project-presence/heartbeat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        project_id: this.projectId,
                        user_id: this.currentUser.id,
                        timestamp: Date.now()
                    })
                });
                response = await fetchResponse.json();
            }

            if (response.success) {
                // Update presence data if provided
                if (response.active_users) {
                    this.updateActiveUsers(response.active_users);
                }
            }

        } catch (error) {
            this.debug('Heartbeat failed (non-critical)', error.message);
        }
    }

    /**
     * Load current presence data from server
     */
    async loadPresenceData() {
        try {
            if (!this.projectId) return;

            let response;
            
            // Use API client if available, otherwise fall back to fetch
            if (window.apiClient && window.apiClient.get) {
                response = await window.apiClient.get(`/project-presence/${this.projectId}`);
            } else {
                const fetchResponse = await fetch(`/api/project-presence/${this.projectId}`);
                response = await fetchResponse.json();
            }
            
            if (response.success && response.active_users) {
                this.updateActiveUsers(response.active_users);
            }

        } catch (error) {
            this.warn('Failed to load presence data', error);
        }
    }

    /**
     * Update active users and refresh UI
     * @param {Array} activeUsers - List of active users
     */
    updateActiveUsers(activeUsers) {
        // Clear existing users
        this.activeUsers.clear();
        
        // Add current users
        activeUsers.forEach(user => {
            this.activeUsers.set(user.id, {
                ...user,
                lastSeen: new Date(user.last_seen || Date.now())
            });
        });

        this.debug('Updated active users', {
            count: this.activeUsers.size,
            users: activeUsers.map(u => u.username)
        });

        // Refresh UI
        this.renderPresenceAvatars();
    }

    /**
     * Render presence avatars in the UI
     */
    renderPresenceAvatars() {
        if (!this.avatarsContainer) return;

        // Clear existing avatars
        this.avatarsContainer.innerHTML = '';

        const users = Array.from(this.activeUsers.values());
        
        if (users.length === 0) {
            this.presenceContainer.style.display = 'none';
            return;
        }

        this.presenceContainer.style.display = 'flex';

        // Sort users - current user first, then by join time
        users.sort((a, b) => {
            if (a.id === this.currentUser?.id) return -1;
            if (b.id === this.currentUser?.id) return 1;
            return new Date(a.last_seen) - new Date(b.last_seen);
        });

        // Render each user avatar
        users.forEach(user => {
            const avatarElement = this.createAvatarElement(user);
            this.avatarsContainer.appendChild(avatarElement);
        });

        this.debug('Rendered presence avatars', { count: users.length });
    }

    /**
     * Create avatar element for a user
     * @param {object} user - User data
     * @returns {HTMLElement} Avatar element
     */
    createAvatarElement(user) {
        const avatar = document.createElement('div');
        avatar.className = 'presence-avatar';
        avatar.dataset.userId = user.id;
        
        // Mark current user
        if (user.id === this.currentUser?.id) {
            avatar.classList.add('current-user');
        }

        // Create avatar content
        if (user.profile_picture && user.profile_picture.trim()) {
            const img = document.createElement('img');
            img.src = user.profile_picture;
            img.alt = user.username || 'User';
            img.onerror = () => {
                // Fallback to initials if image fails
                img.style.display = 'none';
                const initials = this.createInitialsElement(user);
                avatar.appendChild(initials);
            };
            avatar.appendChild(img);
        } else {
            // Use initials
            const initials = this.createInitialsElement(user);
            avatar.appendChild(initials);
        }

        // Add status indicator
        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'presence-status-indicator';
        avatar.appendChild(statusIndicator);

        // Add tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'presence-tooltip';
        tooltip.textContent = user.username || 'Anonymous User';
        avatar.appendChild(tooltip);

        return avatar;
    }

    /**
     * Create initials element for users without profile pictures
     * @param {object} user - User data
     * @returns {HTMLElement} Initials element
     */
    createInitialsElement(user) {
        const initials = document.createElement('div');
        initials.className = 'avatar-initials';
        
        const username = user.username || 'U';
        const initialsText = username.length >= 2 
            ? username.substring(0, 2).toUpperCase()
            : username.substring(0, 1).toUpperCase();
            
        initials.textContent = initialsText;
        
        // Generate color based on user ID
        const colors = [
            'linear-gradient(45deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(45deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(45deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(45deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(45deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(45deg, #a8edea 0%, #fed6e3 100%)',
            'linear-gradient(45deg, #ffecd2 0%, #fcb69f 100%)',
            'linear-gradient(45deg, #ff8a80 0%, #ea4c89 100%)'
        ];
        
        const colorIndex = user.id % colors.length;
        initials.style.background = colors[colorIndex];
        
        return initials;
    }

    /**
     * Handle user leaving the project
     */
    async leaveProject() {
        try {
            if (this.presenceInterval) {
                clearInterval(this.presenceInterval);
                this.presenceInterval = null;
            }

            if (this.projectId && this.currentUser) {
                // Send leave notification
                try {
                    if (window.apiClient && window.apiClient.post) {
                        await window.apiClient.post('/project-presence/leave', {
                            project_id: this.projectId,
                            user_id: this.currentUser.id
                        });
                    } else {
                        await fetch('/api/project-presence/leave', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                project_id: this.projectId,
                                user_id: this.currentUser.id
                            })
                        });
                    }
                } catch (error) {
                    this.debug('Failed to send leave notification', error);
                }
            }

            this.info('Left project presence');

        } catch (error) {
            this.debug('Error leaving project presence', error);
        }
    }

    /**
     * Animate user leaving
     * @param {number} userId - User ID that's leaving
     */
    animateUserLeaving(userId) {
        const avatar = this.avatarsContainer.querySelector(`[data-user-id="${userId}"]`);
        if (avatar) {
            avatar.classList.add('leaving');
            
            // Remove after animation
            setTimeout(() => {
                avatar.remove();
                
                // Hide container if no users left
                if (this.avatarsContainer.children.length === 0) {
                    this.presenceContainer.style.display = 'none';
                }
            }, 400);
        }
    }

    /**
     * Clean up and destroy the presence manager
     */
    destroy() {
        this.leaveProject();
        this.info('Collaborative presence manager destroyed');
    }
}

// Export for global use
window.CollaborativePresenceManager = CollaborativePresenceManager;
