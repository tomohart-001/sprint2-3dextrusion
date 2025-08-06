"""
General API Routes Module
"""
from flask import request, jsonify, session, Response
from typing import Tuple, Dict, Any
from services import api_calculation_service
from services.location_service import LocationService
from utils.logger import app_logger
from utils.error_handler import ErrorHandler, ErrorCategories
from services import response_service
from utils.timezone_helper import TimezoneHelper
from services.chat_service import ChatService
import asyncio
from database import get_conversation_history

# API routes for general functionalities, including ADAM chat handling.
class ApiRoutes:
    """General API route handlers"""

    def register_routes(self, app):
        """Register general API routes"""
        app.add_url_rule('/api/locations', 'api_get_locations', self.handle_get_locations, methods=['GET'])
        app.add_url_rule('/api/calculate-buildable-area', 'api_calculate_buildable_area', self.handle_calculate_buildable_area, methods=['POST'])
        app.add_url_rule('/api/set-timezone', 'api_set_timezone', self.handle_set_timezone, methods=['POST'])
        app.add_url_rule('/api/chat', 'api_chat', self.handle_chat, methods=['POST'])
        app.add_url_rule('/api/chat/stream', 'api_chat_stream', self.handle_chat_stream, methods=['POST'])
        app.add_url_rule('/api/chat/history/<conversation_id>', 'get_chat_history', self.get_chat_history, methods=['GET'])


    def handle_get_locations(self) -> Tuple[Dict[str, Any], int]:
        """Get available locations for user selection"""
        try:
            # Standard New Zealand locations
            locations = [
                "Auckland", "Wellington", "Christchurch", "Hamilton", 
                "Tauranga", "Dunedin", "Palmerston North", "Hastings",
                "Napier", "Rotorua", "New Plymouth", "Whangarei"
            ]
            return jsonify(locations), 200

        except Exception as e:
            return ErrorHandler.handle_error(
                e,
                category=ErrorCategories.UNKNOWN,
                context={'operation': 'get_locations'}
            ), 500

    def handle_calculate_buildable_area(self) -> Tuple[Dict[str, Any], int]:
        """Calculate buildable area based on site parameters"""
        try:
            data = request.get_json()
            if not data:
                return response_service.validation_error("Request body must be JSON")

            site_coords = data.get('site_coords', [])
            requirements = data.get('requirements', {})
            frontage = data.get('frontage', [])
            edge_classifications = data.get('edge_classifications', [])

            if not site_coords or not requirements:
                return response_service.validation_error(
                    "Site coordinates and requirements are required"
                )

            app_logger.info(f"Calculating buildable area - coords: {len(site_coords)}")

            result = api_calculation_service.calculate_buildable_area(
                site_coords=site_coords,
                requirements=requirements,
                frontage=frontage,
                edge_classifications=edge_classifications
            )

            app_logger.info(f"Buildable area calculated: {result.get('buildable_area_m2', 0):.1f} m²")
            return response_service.success(result, "Buildable area calculated successfully")

        except Exception as e:
            return ErrorHandler.handle_error(
                e,
                category=ErrorCategories.CALCULATION,
                context={'operation': 'buildable_area_calculation'}
            ), 500

    def handle_geocode_location(self) -> Tuple[Dict[str, Any], int]:
        """Geocode a location query"""
        try:
            data = request.get_json()
            if not data or not data.get('query'):
                return response_service.validation_error('Location query is required'), 400

            query = data['query'].strip()
            if not query:
                return response_service.validation_error('Location query cannot be empty'), 400

            app_logger.info(f"Geocoding location query: {query}")

            # Use the location service to geocode
            location_data, error = LocationService.geocode_location(query)

            if error:
                app_logger.warning(f"Geocoding failed for '{query}': {error}")
                return response_service.validation_error(error), 400

            if not location_data:
                return response_service.validation_error(f"No results found for '{query}'"), 404

            app_logger.info(f"Successfully geocoded '{query}' to {location_data['display_name']}")

            return response_service.success({
                'location': location_data
            }, "Location geocoded successfully")

        except Exception as e:
            app_logger.error(f"Geocoding error: {e}")
            return ErrorHandler.handle_error(
                e,
                category=ErrorCategories.UNKNOWN,
                context={'operation': 'geocode_location', 'query': data.get('query') if 'data' in locals() else None}
            ), 500

    def handle_set_timezone(self):
        """Set user's timezone preference"""
        try:
            data = request.get_json()
            if not data or 'timezone' not in data:
                return jsonify({'error': 'Timezone is required'}), 400

            timezone_name = data['timezone']

            if TimezoneHelper.set_user_timezone(timezone_name):
                app_logger.info(f"User timezone set to: {timezone_name}")
                return jsonify({'success': True, 'timezone': timezone_name})
            else:
                return jsonify({'error': 'Invalid timezone'}), 400

        except Exception as e:
            app_logger.error(f"Error setting user timezone: {e}")
            return jsonify({'error': 'Failed to set timezone'}), 500

    def handle_chat(self) -> Tuple[Dict[str, Any], int]:
        """Handle chat messages with enhanced error handling and agent support"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': 'No data provided'}), 400

            user_message = data.get('message', '').strip()
            conversation_id = data.get('conversation_id')
            agent_type = data.get('agent_type', data.get('agent'))  # Support both parameter names
            context = data.get('context', {})

            if not user_message:
                return jsonify({'success': False, 'error': 'Message cannot be empty'}), 400

            # Get session ID - for ADAM use conversation_id or session
            if agent_type == 'ADAM' or agent_type == 'sitedeveloper_agent':
                session_id = conversation_id or session.get('session_id') or self.get_session_id()
            else:
                session_id = self.get_session_id()

            # Ensure session_id is a string
            if not isinstance(session_id, str):
                app_logger.error(f"🚨 ERROR: session_id is not string in API route: {type(session_id)} - {session_id}")
                session_id = str(session_id) if session_id is not None else self.get_session_id()

            app_logger.info(f"🔍 DEBUG: Chat request received")
            app_logger.info(f"🔍 DEBUG: Message: {user_message[:100]}...")
            app_logger.info(f"🔍 DEBUG: Agent type: {agent_type}")
            app_logger.info(f"🔍 DEBUG: Session ID: {session_id[:8] if session_id else 'None'}")
            app_logger.info(f"🔍 DEBUG: Conversation ID: {conversation_id}")
            app_logger.info(f"🔍 DEBUG: Context keys: {list(context.keys()) if context else 'None'}")

            # Initialize chat service
            chat_service = ChatService(enable_streaming=True)

            # Process message with async wrapper
            import asyncio

            async def process_chat_message():
                return await chat_service.process_message(
                    user_message=user_message,
                    session_id=session_id,
                    conversation_id=conversation_id,
                    agent_type=agent_type,
                    **context
                )

            # Run async function
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            response_text, message_id = loop.run_until_complete(process_chat_message())

            app_logger.info(f"🔍 DEBUG: Chat processing completed")
            app_logger.info(f"🔍 DEBUG: Response length: {len(response_text) if response_text else 0}")
            app_logger.info(f"🔍 DEBUG: Message ID: {message_id}")

            return jsonify({
                'success': True,
                'response': response_text,
                'message_id': message_id,
                'conversation_id': conversation_id or session_id
            }), 200

        except Exception as e:
            app_logger.error(f"🚨 CRITICAL: Chat API error: {e}")
            app_logger.error(f"🔍 DEBUG: Exception type: {type(e)}")
            import traceback
            app_logger.error(f"🔍 DEBUG: Full traceback:")
            for line in traceback.format_exc().split('\n'):
                if line.strip():
                    app_logger.error(f"  {line}")

            return jsonify({
                'success': False,
                'error': f'Failed to process message: {str(e)}'
            }), 500

    def handle_chat_stream(self):
        """Handle streaming chat responses"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided'}), 400

            user_message = data.get('message', '').strip()
            conversation_id = data.get('conversation_id')
            agent_type = data.get('agent_type', data.get('agent'))
            context = data.get('context', {})

            if not user_message:
                return jsonify({'error': 'Message cannot be empty'}), 400

            # Get session ID - for ADAM use conversation_id or session
            if agent_type == 'ADAM' or agent_type == 'sitedeveloper_agent':
                session_id = conversation_id or session.get('session_id') or self.get_session_id()
            else:
                session_id = self.get_session_id()

            # Ensure session_id is a string
            if not isinstance(session_id, str):
                app_logger.error(f"🚨 ERROR: session_id is not string in streaming route: {type(session_id)} - {session_id}")
                session_id = str(session_id) if session_id is not None else self.get_session_id()

            # Initialize chat service
            chat_service = ChatService(enable_streaming=True)

            # Process message and get response
            import asyncio

            async def process_chat_message():
                return await chat_service.process_message(
                    user_message=user_message,
                    session_id=session_id,
                    conversation_id=conversation_id,
                    agent_type=agent_type,
                    **context
                )

            # Run async function
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            response_text, message_id = loop.run_until_complete(process_chat_message())

            # Return streaming generator
            def generate_stream():
                yield from chat_service.generate_streaming_response(response_text, message_id)

            return Response(
                generate_stream(),
                mimetype='text/plain',
                headers={
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no'
                }
            )

        except Exception as e:
            app_logger.error(f"Streaming chat error: {e}")
            return jsonify({'error': 'Failed to process streaming message'}), 500

    def get_chat_history(self, conversation_id: str):
        """Get chat history for conversation"""
        try:
            history = get_conversation_history(conversation_id)

            return jsonify({
                'success': True,
                'history': history
            }), 200

        except Exception as e:
            app_logger.error(f"Error getting chat history: {e}")
            return jsonify({
                'success': False,
                'error': 'Failed to retrieve chat history'
            }), 500

    def get_session_id(self):
        """Get session ID"""
        from flask import session
        if 'session_id' not in session:
            import uuid
            session['session_id'] = str(uuid.uuid4())
        return session['session_id']