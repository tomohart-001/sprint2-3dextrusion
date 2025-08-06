"""
Core Application Routes Module - Streamlined
"""
from flask import Flask, request, jsonify, render_template, session
from typing import Tuple, Dict, Any
import asyncio
from datetime import datetime

from auth import get_session_id
from database import DatabaseManager
from services import ChatService, response_service
from database import MessageRepository
from utils.validators import validate_message, validate_session_id, ValidationError
from utils.logger import app_logger
from utils.error_handler import ErrorHandler, ErrorCategories


class MainRoutes:
    """Core application routes handler - streamlined for essential functionality"""

    def __init__(self):
        self.chat_service = ChatService(enable_streaming=True)
        self.db_manager = DatabaseManager()

    def register_routes(self, app: Flask) -> None:
        """Register core application routes"""

        # Core functionality routes only
        app.route('/dashboard', methods=['GET'])(self.handle_dashboard)
        app.route('/chat', methods=['POST'])(self.handle_chat)
        app.route('/api/chat', methods=['POST'])(self.handle_chat)
        app.route('/reset', methods=['POST'])(self.handle_reset_session)
        app.route('/history', methods=['GET'])(self.handle_get_history)
        app.route('/conversations', methods=['GET'])(self.handle_get_conversations)




    def handle_dashboard(self):
        """Handle dashboard page"""
        user_info = session.get('user')
        if not user_info:
            from flask import redirect, url_for
            return redirect(url_for('login'))

        # Get user profile to include account type
        try:
            with self.db_manager.db.get_cursor() as cursor:
                cursor.execute('''
                    SELECT u.username, u.email, p.account_type
                    FROM users u
                    LEFT JOIN user_profiles p ON u.id = p.user_id
                    WHERE u.id = ?
                ''', (user_info['id'],))

                user_data = cursor.fetchone()
                if user_data:
                    user_info.update({
                        'username': user_data[0],
                        'email': user_data[1],
                        'account_type': user_data[2] or 'individual'
                    })
        except Exception as e:
            app_logger.error(f"Failed to get user profile for dashboard: {e}")

        app_logger.info(f"Dashboard accessed by user: {user_info.get('username', 'Unknown')}")
        return render_template('dashboard.html', user=user_info)

    def handle_chat(self):
        """Handle chat requests"""
        try:
            # Validate request
            if not request.is_json:
                return jsonify({'success': False, 'error': 'Invalid request format'}), 400

            data = request.get_json()
            message = data.get('message', '').strip()
            conversation_id = data.get('conversation_id')
            agent_type = data.get('agent', 'default')

            # Validate inputs
            try:
                validate_message(message)
                session_id = validate_session_id(get_session_id())
            except ValidationError as e:
                return jsonify({'success': False, 'error': str(e)}), 400

            # Process message
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                response_text, message_id = loop.run_until_complete(
                    self.chat_service.process_message(message, session_id, conversation_id, agent_type)
                )
            finally:
                loop.close()

            return jsonify({
                'success': True,
                'response': response_text,
                'message_id': message_id,
                'conversation_id': conversation_id
            }), 200

        except Exception as e:
            app_logger.error(f"Chat error: {e}")
            return jsonify({'success': False, 'error': 'Chat service unavailable'}), 500

    def handle_reset_session(self) -> Tuple[Dict[str, Any], int]:
        """Reset user session with proper cleanup"""
        try:
            session_id = get_session_id()
            app_logger.info(f"Resetting session {session_id[:8]}")

            cleared_count = MessageRepository.clear_session_history(session_id)
            session.clear()

            app_logger.info(f"Session reset completed - cleared {cleared_count} messages")
            return response_service.success({
                'messages_cleared': cleared_count
            }, "Session reset successfully")

        except Exception as e:
            return ErrorHandler.handle_error(
                e,
                category=ErrorCategories.DATABASE,
                context={'operation': 'session_reset'}
            ), 500

    def handle_get_history(self) -> Tuple[Dict[str, Any], int]:
        """Retrieve conversation history for current session"""
        try:
            session_id = get_session_id()
            history = MessageRepository.get_conversation_history(session_id)
            return response_service.success({'history': history})

        except Exception as e:
            return ErrorHandler.handle_error(
                e,
                category=ErrorCategories.DATABASE,
                context={'operation': 'history_retrieval'}
            ), 500

    def handle_get_conversations(self) -> Tuple[Dict[str, Any], int]:
        """Get conversations for current user"""
        try:
            # For now, return empty conversations list
            return response_service.success({'conversations': []})
        except Exception as e:
            return ErrorHandler.handle_error(
                e,
                category=ErrorCategories.DATABASE,
                context={'operation': 'get_conversations'}
            ), 500


def main_route_handler():
    """Legacy route handler function for compatibility"""
    return MainRoutes()