
"""
Comment Management Routes Module
"""
from flask import request, jsonify, session
from typing import Tuple, Dict, Any
from datetime import datetime
from database import DatabaseManager
from utils.logger import app_logger
from services import response_service


class CommentRoutes:
    """Comment management route handlers"""

    def __init__(self):
        self.db_manager = DatabaseManager()

    def register_routes(self, app):
        """Register comment management routes"""
        app.route('/api/comments', methods=['GET', 'POST'])(self.handle_comments)
        app.route('/api/comments/<int:comment_id>', methods=['DELETE'])(self.handle_delete_comment)

    def handle_comments(self):
        """Handle comment creation and retrieval"""
        try:
            if request.method == 'GET':
                return self.get_comments()
            elif request.method == 'POST':
                return self.create_comment()
        except Exception as e:
            app_logger.error(f"Error handling comments: {e}")
            return jsonify({'error': 'Failed to handle comments'}), 500

    def get_comments(self):
        """Get comments for a project"""
        try:
            if 'user' not in session:
                return jsonify({'error': 'Not logged in'}), 401

            project_id = request.args.get('project_id')
            comment_type = request.args.get('type', 'site_comment')

            if not project_id:
                return jsonify({'error': 'Project ID required'}), 400

            user_id = session['user']['id']

            # Verify user has access to this project
            with self.db_manager.db.get_cursor() as cursor:
                cursor.execute('''
                    SELECT id FROM projects 
                    WHERE id = ? AND user_id = ?
                ''', (project_id, user_id))

                if not cursor.fetchone():
                    return jsonify({'error': 'Project not found or access denied'}), 404

                # Get comments for this project
                cursor.execute('''
                    SELECT c.id, c.coordinates_lng, c.coordinates_lat, c.comment_text, 
                           c.comment_type, c.created_at, u.username
                    FROM project_comments c
                    JOIN users u ON c.user_id = u.id
                    WHERE c.project_id = ? AND c.comment_type = ?
                    ORDER BY c.created_at DESC
                ''', (project_id, comment_type))

                comment_rows = cursor.fetchall()

            comments = []
            for row in comment_rows:
                comments.append({
                    'id': row[0],
                    'coordinates': [row[1], row[2]],  # [lng, lat]
                    'text': row[3],
                    'type': row[4],
                    'timestamp': row[5],
                    'user': row[6]
                })

            app_logger.info(f"Retrieved {len(comments)} comments for project {project_id}")

            return jsonify({
                'success': True,
                'comments': comments
            }), 200

        except Exception as e:
            app_logger.error(f"Error getting comments: {e}")
            return jsonify({'error': 'Failed to get comments'}), 500

    def create_comment(self):
        """Create a new comment"""
        try:
            if 'user' not in session:
                return jsonify({'error': 'Not logged in'}), 401

            data = request.get_json()
            if not data:
                return jsonify({'error': 'Request body must be JSON'}), 400

            user_id = session['user']['id']
            project_id = data.get('project_id')
            coordinates = data.get('coordinates')
            text = data.get('text')
            comment_type = data.get('type', 'site_comment')

            if not all([project_id, coordinates, text]):
                return jsonify({'error': 'Project ID, coordinates, and text are required'}), 400

            if not isinstance(coordinates, list) or len(coordinates) != 2:
                return jsonify({'error': 'Coordinates must be [lng, lat] array'}), 400

            # Verify user has access to this project
            with self.db_manager.db.get_cursor() as cursor:
                cursor.execute('''
                    SELECT id FROM projects 
                    WHERE id = ? AND user_id = ?
                ''', (project_id, user_id))

                if not cursor.fetchone():
                    return jsonify({'error': 'Project not found or access denied'}), 404

                # Create the comments table if it doesn't exist
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS project_comments (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        project_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        coordinates_lng REAL NOT NULL,
                        coordinates_lat REAL NOT NULL,
                        comment_text TEXT NOT NULL,
                        comment_type TEXT DEFAULT 'site_comment',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
                        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                    )
                ''')

                # Insert the comment
                cursor.execute('''
                    INSERT INTO project_comments 
                    (project_id, user_id, coordinates_lng, coordinates_lat, comment_text, comment_type)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (project_id, user_id, coordinates[0], coordinates[1], text, comment_type))

                comment_id = cursor.lastrowid
                self.db_manager.db.commit()

            # Add comment event to project history
            self.db_manager.add_project_history_event(
                project_id, 
                user_id, 
                'comment_added', 
                f"Comment added: {text[:50]}{'...' if len(text) > 50 else ''}"
            )

            app_logger.info(f"Comment created for project {project_id} by user {user_id}")

            return jsonify({
                'success': True,
                'comment_id': comment_id,
                'message': 'Comment created successfully'
            }), 201

        except Exception as e:
            app_logger.error(f"Error creating comment: {e}")
            return jsonify({'error': 'Failed to create comment'}), 500

    def handle_delete_comment(self, comment_id: int):
        """Delete a comment"""
        try:
            if 'user' not in session:
                return jsonify({'error': 'Not logged in'}), 401

            user_id = session['user']['id']

            with self.db_manager.db.get_cursor() as cursor:
                # Check if comment exists and belongs to user
                cursor.execute('''
                    SELECT project_id, comment_text FROM project_comments 
                    WHERE id = ? AND user_id = ?
                ''', (comment_id, user_id))

                comment_data = cursor.fetchone()

                if not comment_data:
                    return jsonify({'error': 'Comment not found or access denied'}), 404

                project_id, comment_text = comment_data

                # Delete the comment
                cursor.execute('DELETE FROM project_comments WHERE id = ?', (comment_id,))
                self.db_manager.db.commit()

            # Add deletion event to project history
            self.db_manager.add_project_history_event(
                project_id, 
                user_id, 
                'comment_deleted', 
                f"Comment deleted: {comment_text[:50]}{'...' if len(comment_text) > 50 else ''}"
            )

            app_logger.info(f"Comment {comment_id} deleted by user {user_id}")

            return jsonify({
                'success': True,
                'message': 'Comment deleted successfully'
            }), 200

        except Exception as e:
            app_logger.error(f"Error deleting comment {comment_id}: {e}")
            return jsonify({'error': 'Failed to delete comment'}), 500
