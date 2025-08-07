"""
Earthworks Routes Module - Handles earthworks calculation requests
"""
from flask import request, jsonify, session
from utils.logger import app_logger
# Placeholder for EarthworksService and its methods. In a real scenario, this would be imported.
# from services.earthworks_service import EarthworksService # Uncomment this line when EarthworksService is available


# Mock EarthworksService for demonstration purposes if the actual service is not available
class MockEarthworksService:
    def __init__(self):
        self.available = True # Assume available for mock

    def calculate_earthworks(self, terrain_data, platform_coords, ffl=None, optimize_ffl=False):
        # Mock implementation
        app_logger.info("Mock earthworks calculation called")
        if not terrain_data or not platform_coords:
            return {'success': False, 'error': 'Mock: Terrain data or platform coordinates missing'}

        cut = 0
        fill = 0
        if optimize_ffl:
            # Mock optimization
            optimal_ffl = 10.0 # Arbitrary optimal FFL
            ffl_relative_to_base = 5.0 # Arbitrary relative FFL
            return {'success': True, 'ffl': optimal_ffl, 'ffl_relative_to_base': ffl_relative_to_base, 'cut_volume_m3': 150.5, 'fill_volume_m3': 120.2}
        else:
            # Mock calculation with given FFL
            return {'success': True, 'cut_volume_m3': 100.0, 'fill_volume_m3': 80.0, 'ffl': ffl if ffl is not None else 15.0}

    def define_platform(self, length, width, rotation, center_x, center_y, terrain_data):
        # Mock implementation for platform definition
        app_logger.info(f"Mock defining platform: {length}x{width} at {rotation}°")
        # In a real implementation, this would generate platform coordinates based on the parameters and potentially terrain_data
        # For this mock, we'll just return a simplified representation.
        mock_coordinates = [
            {"x": -length/2, "y": -width/2},
            {"x": length/2, "y": -width/2},
            {"x": length/2, "y": width/2},
            {"x": -length/2, "y": width/2}
        ] # Simplified rectangular platform coordinates
        return {
            'length': length,
            'width': width,
            'rotation': rotation,
            'center_x': center_x,
            'center_y': center_y,
            'coordinates': mock_coordinates # Placeholder for actual coordinates
        }

# Use the mock service if the real one is not available
try:
    # This import should be uncommented in a real application
    # from services.earthworks_service import EarthworksService
    # earthworks_service = EarthworksService()
    # EARTHWORKS_AVAILABLE = earthworks_service.available
    # app_logger.info(f"Earthworks service import result: available={EARTHWORKS_AVAILABLE}")

    # Using Mock for demonstration
    earthworks_service = MockEarthworksService()
    EARTHWORKS_AVAILABLE = earthworks_service.available
    app_logger.info(f"Using Mock Earthworks service: available={EARTHWORKS_AVAILABLE}")

except ImportError as e:
    app_logger.warning(f"Earthworks service unavailable: {e}. Using mock service.")
    earthworks_service = MockEarthworksService()
    EARTHWORKS_AVAILABLE = earthworks_service.available


class EarthworksRoutes:
    """Earthworks route handlers"""

    # Mock Blueprint for demonstration purposes. In a real Flask app, you would import and use a Blueprint.
    class MockBlueprint:
        def __init__(self, name):
            self.name = name
            self.routes = {}

        def route(self, rule, **options):
            def decorator(f):
                self.routes[rule] = {'func': f, 'methods': options.get('methods', ['GET'])}
                return f
            return decorator

    # Instantiate the mock blueprint
    earthworks_bp = MockBlueprint('earthworks')

    def handle_calculate_earthworks(self):
        """Handle earthworks calculation API endpoint"""
        try:
            if not EARTHWORKS_AVAILABLE:
                app_logger.warning("Earthworks calculation requested but service unavailable")
                return jsonify({
                    'success': False,
                    'error': 'Earthworks calculation service unavailable - missing geospatial dependencies'
                }), 503

            app_logger.info("Earthworks calculation request - Service available: True")

            data = request.get_json()

            # Get terrain data
            terrain_data = data.get('terrain_data') or session.get('terrain_data')

            # Get platform coordinates - check for defined platform first
            platform_coords = data.get('platform_coords')

            # If no platform coords provided, check for defined platform in session
            if not platform_coords:
                platform_definition = session.get('platform_definition')
                if platform_definition and 'coordinates' in platform_definition:
                    platform_coords = platform_definition['coordinates']
                    app_logger.info(f"Using defined platform: {platform_definition['length']}m x {platform_definition['width']}m at {platform_definition['rotation']}°")

            ffl = data.get('ffl')
            optimize_ffl = data.get('optimize_ffl', False)

            app_logger.info(f"Earthworks calculation - Platform: {len(platform_coords) if platform_coords else 'None'} points, FFL: {ffl}, Optimize: {optimize_ffl}")

            if not terrain_data:
                return jsonify({'success': False, 'error': 'Terrain data required'}), 400
            if not platform_coords:
                return jsonify({'success': False, 'error': 'Platform coordinates required'}), 400


            # Calculate earthworks
            result = earthworks_service.calculate_earthworks(
                terrain_data=terrain_data,
                platform_coords=platform_coords,
                ffl=ffl,
                optimize_ffl=optimize_ffl
            )

            if result.get('success'):
                app_logger.info(f"Earthworks calculated - Cut: {result.get('cut_volume_m3', 0):.1f}m³, Fill: {result.get('fill_volume_m3', 0):.1f}m³")
            else:
                app_logger.error(f"Earthworks calculation failed: {result.get('error')}")

            return jsonify(result)

        except Exception as e:
            app_logger.error(f"Earthworks calculation error: {e}")
            return jsonify({
                'success': False,
                'error': f'Server error: {str(e)}'
            }), 500

    def handle_optimize_ffl(self):
        """Handle FFL optimization endpoint"""
        try:
            if not EARTHWORKS_AVAILABLE:
                return jsonify({
                    'success': False,
                    'error': 'Earthworks service unavailable'
                }), 503

            data = request.get_json()
            if not data or 'terrain_data' not in data or 'platform_coords' not in data:
                return jsonify({'success': False, 'error': 'Terrain data and platform coordinates required'}), 400

            # Calculate optimal FFL only
            result = earthworks_service.calculate_earthworks(
                terrain_data=data['terrain_data'],
                platform_coords=data['platform_coords'],
                ffl=None,
                optimize_ffl=True
            )

            if result.get('success'):
                return jsonify({
                    'success': True,
                    'optimal_ffl': result['optimal_ffl'],
                    'ffl_relative_to_base': result['ffl_relative_to_base']
                })
            else:
                return jsonify(result)

        except Exception as e:
            app_logger.error(f"FFL optimization error: {e}")
            return jsonify({
                'success': False,
                'error': f'Server error: {str(e)}'
            }), 500

    def define_platform(self):
        """Define a platform with user-specified dimensions and rotation"""
        try:
            data = request.get_json()

            # Extract platform parameters
            length = float(data.get('length', 30))  # Default 30m
            width = float(data.get('width', 15))    # Default 15m
            rotation = float(data.get('rotation', 0))  # Default 0 degrees
            center_x = data.get('center_x')  # Optional
            center_y = data.get('center_y')  # Optional

            # Get terrain data from session if available
            terrain_data = session.get('terrain_data')

            # Initialize earthworks service
            # earthworks_service = EarthworksService() # Use this if importing the actual service
            # Using the already instantiated service instance
            
            # Define the platform
            platform_definition = earthworks_service.define_platform(
                length=length,
                width=width,
                rotation=rotation,
                center_x=center_x,
                center_y=center_y,
                terrain_data=terrain_data
            )

            # Store platform definition in session for earthworks calculation
            session['platform_definition'] = platform_definition

            return jsonify({
                'success': True,
                'platform': platform_definition,
                'message': f'Platform defined: {length}m x {width}m at {rotation}° rotation'
            })

        except Exception as e:
            app_logger.error(f"Platform definition error: {e}")
            return jsonify({'success': False, 'error': str(e)}), 400

    def register_routes(self, app):
        """Register routes with Flask app"""
        self.app = app

        with app.app_context():
            # Main earthworks calculation API
            # self.app.add_url_rule('/api/calculate-earthworks', 'calculate_earthworks',
            #                      self.handle_calculate_earthworks, methods=['POST'])
            # app_logger.info(f"✅ Successfully registered: /api/calculate-earthworks")

            # FFL optimization endpoint
            # self.app.add_url_rule('/api/optimize-ffl', 'optimize_ffl',
            #                      self.handle_optimize_ffl, methods=['POST'])
            # app_logger.info(f"✅ Successfully registered: /api/optimize-ffl")

            # Register the new platform definition route using the mock blueprint
            self.app.add_url_rule('/api/define-platform', 'define_platform',
                                 self.define_platform, methods=['POST'])
            app_logger.info(f"✅ Successfully registered: /api/define-platform")

            # Re-register the earthworks calculation route using the mock blueprint if needed for context
            # In a real app, you'd use the blueprint directly. Here we simulate adding rules.
            self.app.add_url_rule('/api/calculate-earthworks', 'calculate_earthworks',
                                 self.handle_calculate_earthworks, methods=['POST'])
            app_logger.info(f"✅ Successfully registered: /api/calculate-earthworks")

            self.app.add_url_rule('/api/optimize-ffl', 'optimize_ffl',
                                 self.handle_optimize_ffl, methods=['POST'])
            app_logger.info(f"✅ Successfully registered: /api/optimize-ffl")