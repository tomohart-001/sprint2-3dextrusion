
"""
Presence Routes Module

Handles real-time user presence tracking for collaborative features.
Tracks which users are currently active in projects.
"""

from flask import Blueprint, request, jsonify, session
from datetime import datetime, timedelta
import logging
from functools import wraps
from database import db_manager

# Configure logging
logger = logging.getLogger('engineroom')

# Create blueprint
presence_routes = Blueprint('presence_routes', __name__)

# In-memory store for active user presence (in production, use Redis)
active_presence = {}

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def cleanup_expired_presence():
    """Clean up expired presence records"""
    current_time = datetime.now()
    expired_keys = []
    
    for key, data in active_presence.items():
        if current_time - data['last_seen'] > timedelta(seconds=30):
            expired_keys.append(key)
    
    for key in expired_keys:
        del active_presence[key]

@presence_routes.route('/api/project-presence/heartbeat', methods=['POST'])
@require_auth
def presence_heartbeat():
    """
    Update user presence with heartbeat
    """
    try:
        data = request.get_json()
        
        if not data or 'project_id' not in data:
            return jsonify({'error': 'Project ID required'}), 400
        
        project_id = data['project_id']
        user_id = session['user']['id']
        
        # Clean up expired presence
        cleanup_expired_presence()
        
        # Update user presence
        presence_key = f"{project_id}:{user_id}"
        active_presence[presence_key] = {
            'user_id': user_id,
            'project_id': project_id,
            'username': session['user']['username'],
            'profile_picture': session['user'].get('profile_picture', ''),
            'last_seen': datetime.now()
        }
        
        # Get all active users for this project
        active_users = []
        for key, presence in active_presence.items():
            if presence['project_id'] == project_id:
                active_users.append({
                    'id': presence['user_id'],
                    'username': presence['username'],
                    'profile_picture': presence['profile_picture'],
                    'last_seen': presence['last_seen'].isoformat()
                })
        
        logger.info(f"Presence heartbeat from user {user_id} for project {project_id}")
        
        return jsonify({
            'success': True,
            'active_users': active_users,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error in presence heartbeat: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@presence_routes.route('/api/project-presence/<int:project_id>', methods=['GET'])
@require_auth
def get_project_presence(project_id):
    """
    Get active users for a project
    """
    try:
        # Clean up expired presence
        cleanup_expired_presence()
        
        # Get active users for this project
        active_users = []
        for key, presence in active_presence.items():
            if presence['project_id'] == project_id:
                active_users.append({
                    'id': presence['user_id'],
                    'username': presence['username'],
                    'profile_picture': presence['profile_picture'],
                    'last_seen': presence['last_seen'].isoformat()
                })
        
        logger.info(f"Retrieved {len(active_users)} active users for project {project_id}")
        
        return jsonify({
            'success': True,
            'active_users': active_users,
            'project_id': project_id
        })
        
    except Exception as e:
        logger.error(f"Error getting project presence: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@presence_routes.route('/api/project-presence/leave', methods=['POST'])
@require_auth
def leave_project_presence():
    """
    Remove user from project presence
    """
    try:
        data = request.get_json()
        
        if not data or 'project_id' not in data:
            return jsonify({'error': 'Project ID required'}), 400
        
        project_id = data['project_id']
        user_id = session['user']['id']
        
        # Remove user presence
        presence_key = f"{project_id}:{user_id}"
        if presence_key in active_presence:
            del active_presence[presence_key]
        
        logger.info(f"User {user_id} left project {project_id}")
        
        return jsonify({
            'success': True,
            'message': 'Left project presence'
        })
        
    except Exception as e:
        logger.error(f"Error leaving project presence: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@presence_routes.route('/api/project-presence/stats', methods=['GET'])
@require_auth
def get_presence_stats():
    """
    Get overall presence statistics (for debugging)
    """
    try:
        # Clean up expired presence
        cleanup_expired_presence()
        
        stats = {
            'total_active_users': len(active_presence),
            'projects_with_activity': len(set(p['project_id'] for p in active_presence.values())),
            'presence_records': len(active_presence)
        }
        
        return jsonify({
            'success': True,
            'stats': stats
        })
        
    except Exception as e:
        logger.error(f"Error getting presence stats: {e}")
        return jsonify({'error': 'Internal server error'}), 500

# Export the blueprint
__all__ = ['presence_routes']
