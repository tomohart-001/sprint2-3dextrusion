"""
Page Rendering Routes Module
"""
from flask import render_template, session, flash, redirect, url_for
from utils.logger import app_logger
from functools import wraps  # Import wraps
# Assuming get_user_by_id is defined elsewhere
# from your_module import get_user_by_id
from flask import Blueprint, render_template, redirect, url_for, flash, request, jsonify, session
from utils.logger import app_logger
import json


# Dummy implementations for demonstration only - Replace with actual implementations
def get_user_by_id(user_id):
    """Dummy function to simulate getting a user by ID."""
    # Replace this with your actual user retrieval logic from your database
    class User:
        def __init__(self, id, username, email, first_name, last_name, profile_picture, account_type):
            self.id = id
            self.username = username
            self.email = email
            self.first_name = first_name
            self.last_name = last_name
            self.profile_picture = profile_picture
            self.account_type = account_type

    if user_id == 1:
        return User(id=1, username='testuser', email='test@example.com', first_name='Test', last_name='User',
                    profile_picture='/static/uploads/profile_pictures/4_3d492b1e1b644ec2996066e1cf27c562.jpg',
                    account_type='admin')
    return None


def login_required(f):
    """Dummy login required decorator"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Replace this with your actual login check logic
        user = session.get('user')
        if user is None:
            flash('Login required', 'error')
            return redirect(url_for('login'))  # Assuming you have a login route
        return f(*args, **kwargs)

    return decorated_function


class PageRoutes:
    """Page rendering route handlers"""

    def register_routes(self, app):
        """Register page rendering routes"""
        app.route('/', endpoint='index')(self.handle_index)
        app.route('/blueprints', methods=['GET'])(self.handle_blueprints)
        app.route('/toolshop', methods=['GET'])(self.handle_toolshop)
        app.route('/dashboard')(self.dashboard)  # Add dashboard route
        @app.route('/site-developer')
        def site_developer():
            """FormLab page route"""
            try:
                app_logger.info("Accessing FormLab page")

                # Get project information from URL parameters
                project_id = request.args.get('project') or request.args.get('project_id')

                # Clear cached data if project has changed
                if project_id and session.get('current_project_id') != str(project_id):
                    app_logger.info(f"Site Developer: Project changed from {session.get('current_project_id')} to {project_id}, clearing cached data")
                    session.pop('site_data', None)
                    session.pop('terrain_data', None)
                    session.pop('floorplan_data', None)
                    session['current_project_id'] = str(project_id)

                project_data = {}
                site_data = {}
                terrain_data = {}

                if project_id:
                    try:
                        from database import DatabaseManager
                        db_manager = DatabaseManager()
                        user_id = session.get('user', {}).get('id')

                        if user_id:
                            with db_manager.db.get_cursor() as cursor:
                                # Get project data
                                cursor.execute('''
                                    SELECT name, address, location_lat, location_lng
                                    FROM projects 
                                    WHERE id = ? AND user_id = ?
                                ''', (project_id, user_id))

                                project_row = cursor.fetchone()
                                if project_row:
                                    project_data = {
                                        'id': project_id,
                                        'name': project_row[0],
                                        'address': project_row[1],
                                        'location_lat': project_row[2],
                                        'location_lng': project_row[3]
                                    }
                                    app_logger.info(f"Loaded FormLab data for project {project_id}")

                                # Load latest buildable area snapshot (contains site boundary + buildable area)
                                cursor.execute('''
                                    SELECT snapshot_data 
                                    FROM project_snapshots 
                                    WHERE project_id = ? AND snapshot_type = 'buildable_area'
                                    ORDER BY created_at DESC 
                                    LIMIT 1
                                ''', (project_id,))

                                buildable_snapshot = cursor.fetchone()
                                if buildable_snapshot:
                                    buildable_data = json.loads(buildable_snapshot[0])

                                    # Reconstruct site data with buildable area
                                    if buildable_data.get('site_coords'):
                                        site_data = {
                                            'coordinates': buildable_data['site_coords'],
                                            'area_m2': buildable_data.get('site_area_calculated', 0),
                                            'buildable_area': {
                                                'coordinates': buildable_data.get('buildable_coords', []),
                                                'area_m2': buildable_data.get('buildable_area_m2', 0),
                                                'setbacks': {
                                                    'front': buildable_data.get('front_setback', 3),
                                                    'back': buildable_data.get('rear_setback', 3),
                                                    'side': buildable_data.get('side_setback', 3)
                                                }
                                            },
                                            'address': project_data.get('address', ''),
                                            'terrainBounds': buildable_data.get('terrain_bounds'),
                                            'project_id': project_id,
                                            'project_name': project_data.get('name', '')
                                        }

                                    # Calculate center from coordinates
                                    if site_data.get('coordinates'):
                                        coords = site_data['coordinates']
                                        if coords and len(coords) > 0:
                                            total_lng = sum(coord[0] for coord in coords)
                                            total_lat = sum(coord[1] for coord in coords)
                                            site_data['center_lng'] = total_lng / len(coords)
                                            site_data['center_lat'] = total_lat / len(coords)

                                    app_logger.info(f"Loaded buildable area data for project {project_id}")

                                # Fallback: Load site boundary snapshot if no buildable area
                                if not site_data:
                                    cursor.execute('''
                                        SELECT snapshot_data 
                                        FROM project_snapshots 
                                        WHERE project_id = ? AND snapshot_type = 'site_boundary'
                                        ORDER BY created_at DESC 
                                        LIMIT 1
                                    ''', (project_id,))

                                    site_snapshot = cursor.fetchone()
                                    if site_snapshot:
                                        site_data = json.loads(site_snapshot[0])
                                        site_data['address'] = project_data.get('address', '')
                                        site_data['project_id'] = project_id
                                        site_data['project_name'] = project_data.get('name', '')
                                        app_logger.info(f"Loaded site boundary data for project {project_id}")

                                # Load terrain data snapshot
                                cursor.execute('''
                                    SELECT snapshot_data 
                                    FROM project_snapshots 
                                    WHERE project_id = ? AND snapshot_type = 'terrain_data'
                                    ORDER BY created_at DESC 
                                    LIMIT 1
                                ''', (project_id,))

                                terrain_snapshot = cursor.fetchone()
                                if terrain_snapshot:
                                    terrain_data = json.loads(terrain_snapshot[0])
                                    app_logger.info(f"Loaded terrain data snapshot for project {project_id}")

                    except Exception as e:
                        app_logger.error(f"Error loading FormLab data: {e}")

                # Load terrain data from session or project snapshots
                terrain_data = session.get('terrain_data', {})
                
                # If no terrain data in session, try loading from project snapshots
                if not terrain_data and project_id:
                    try:
                        from database import DatabaseManager
                        
                        db_manager = DatabaseManager()
                        user_id = session.get('user', {}).get('id')
                        
                        if user_id:
                            with db_manager.db.get_cursor() as cursor:
                                # Try terrain_analysis first
                                cursor.execute("""
                                    SELECT snapshot_data
                                    FROM project_snapshots 
                                    WHERE project_id = ? AND user_id = ? AND snapshot_type = 'terrain_analysis'
                                    ORDER BY updated_at DESC
                                    LIMIT 1
                                """, (project_id, user_id))
                                
                                terrain_row = cursor.fetchone()
                                if terrain_row:
                                    terrain_snapshot = json.loads(terrain_row[0])
                                    # Extract the actual terrain data from the nested structure
                                    if 'terrain_data' in terrain_snapshot:
                                        terrain_data = terrain_snapshot['terrain_data']
                                    elif 'elevation_data' in terrain_snapshot:
                                        # Direct terrain data in snapshot
                                        terrain_data = terrain_snapshot
                                    else:
                                        # Look for nested terrain data structure
                                        terrain_data = terrain_snapshot
                                    
                                    # Validate we have elevation data
                                    if terrain_data and 'elevation_data' in terrain_data:
                                        app_logger.info(f"Loaded terrain data from project {project_id} terrain_analysis snapshots with {len(terrain_data.get('elevation_data', []))} elevation points")
                                        # Store in session for future use
                                        session['terrain_data'] = terrain_data
                                    else:
                                        app_logger.warning(f"Terrain snapshot found but no elevation data: {list(terrain_data.keys()) if terrain_data else 'None'}")
                                        terrain_data = {}
                                else:
                                    # Fallback: try terrain_data snapshot type
                                    cursor.execute("""
                                        SELECT snapshot_data
                                        FROM project_snapshots 
                                        WHERE project_id = ? AND user_id = ? AND snapshot_type = 'terrain_data'
                                        ORDER BY updated_at DESC
                                        LIMIT 1
                                    """, (project_id, user_id))
                                    
                                    fallback_row = cursor.fetchone()
                                    if fallback_row:
                                        terrain_data = json.loads(fallback_row[0])
                                        if terrain_data and 'elevation_data' in terrain_data:
                                            app_logger.info(f"Loaded terrain data from project {project_id} terrain_data snapshots")
                                            session['terrain_data'] = terrain_data
                                        else:
                                            app_logger.warning(f"Terrain fallback found but no elevation data")
                                            terrain_data = {}
                    except Exception as e:
                        app_logger.error(f"Failed to load terrain data from project snapshots: {e}")
                        terrain_data = {}
                
                # Always try to load terrain data, even if site_data is empty
                # This allows viewing terrain analysis results independently
                if terrain_data and any(key in terrain_data for key in ['elevation_data', 'terrain_points', 'polygon_overlays']):
                    app_logger.info(f"Terrain data available for Site Developer: {list(terrain_data.keys())}")
                    
                    # Ensure terrain data has the expected structure for frontend
                    if 'terrain_data' in terrain_data and 'elevation_data' not in terrain_data:
                        # Extract nested terrain data
                        nested_terrain = terrain_data['terrain_data']
                        if isinstance(nested_terrain, dict) and 'elevation_data' in nested_terrain:
                            terrain_data = nested_terrain
                            app_logger.info("Extracted nested terrain data structure")
                else:
                    app_logger.info("No terrain data available for FormLab")
                    terrain_data = {}

                # If no site data loaded, create default structure
                if not site_data and project_data:
                    site_data = {
                        'coordinates': [],
                        'area_m2': 0,
                        'address': project_data.get('address', ''),
                        'project_id': project_id,
                        'project_name': project_data.get('name', ''),
                        'center_lng': project_data.get('location_lng'),
                        'center_lat': project_data.get('location_lat')
                    }

                # Add polygon overlays from terrain data to site data if missing
                if terrain_data and terrain_data.get('polygon_overlays') and not site_data.get('coordinates'):
                    polygons = terrain_data['polygon_overlays']
                    if 'site_boundary' in polygons:
                        site_boundary = polygons['site_boundary']
                        site_data['coordinates'] = site_boundary.get('coordinates', [])
                        site_data['area_m2'] = site_boundary.get('area_m2', 0)
                        app_logger.info("Added site boundary from terrain polygon overlays")

                return render_template('site_developer.html', 
                                     project_data=project_data,
                                     project_id=project_id,
                                     site_data=site_data,
                                     site_data_json=json.dumps(site_data),
                                     terrain_data=terrain_data,
                                     terrain_data_json=json.dumps(terrain_data))

            except Exception as e:
                app_logger.error(f"FormLab page error: {e}")
                return render_template('error.html', error="FormLab page unavailable"), 500

        @app.route('/structure-designer')
        def structure_designer():
            """Structure Designer page route"""
            try:
                app_logger.info("Accessing structure designer page")
                return render_template('structure_designer.html')
            except Exception as e:
                app_logger.error(f"Structure designer page error: {e}")
                return render_template('error.html', error="Structure designer page unavailable"), 500


    def handle_index(self):
        """Main landing page"""
        user = session.get('user')
        if user:
            # Get complete user profile including profile picture
            from routes.auth_routes import AuthRoutes
            auth_handler = AuthRoutes()
            user_profile = auth_handler.get_user_profile(user['id'])
            if user_profile:
                user.update(user_profile)
        return render_template('index.html', user=user)

    def handle_blueprints(self):
        """Blueprints page"""
        user = session.get('user')
        if user:
            # Get complete user profile including profile picture
            from routes.auth_routes import AuthRoutes
            auth_handler = AuthRoutes()
            user_profile = auth_handler.get_user_profile(user['id'])
            if user_profile:
                user.update(user_profile)
        return render_template('blueprints.html', user=user)

    def handle_toolshop(self):
        """Tool shop page"""
        user = session.get('user')
        if user:
            # Get complete user profile including profile picture
            from routes.auth_routes import AuthRoutes
            auth_handler = AuthRoutes()
            user_profile = auth_handler.get_user_profile(user['id'])
            if user_profile:
                user.update(user_profile)
        return render_template('toolshop.html', user=user)

    @login_required
    def dashboard(self):
        """Dashboard page - main application interface"""
        user_id = session.get('user')['id']
        username = session.get('user')['username']
        app_logger.info(f"Dashboard accessed by user: {username}")

        # Get complete user profile including profile picture
        from routes.auth_routes import AuthRoutes
        auth_handler = AuthRoutes()
        user_profile = auth_handler.get_user_profile(user_id)

        if not user_profile:
            flash('User session invalid. Please log in again.', 'error')
            return redirect(url_for('login'))

        # Start with session user data and update with profile data
        user_info = session.get('user').copy()
        user_info.update(user_profile)

        # Ensure all required fields are present
        if not user_info.get('username'):
            user_info['username'] = username
        if not user_info.get('first_name'):
            user_info['first_name'] = username

        # Debug log the user info to check profile picture
        app_logger.info(f"Dashboard user profile data: {user_info}")
        if user_info.get('profile_picture'):
            app_logger.info(f"Profile picture URL: {user_info['profile_picture']}")
        else:
            app_logger.info("No profile picture found in user data")

        # Ensure profile picture is properly formatted for template
        if user_info.get('profile_picture') and user_info['profile_picture'] != 'None':
            # Make sure the profile picture URL is properly formatted
            profile_pic = user_info['profile_picture']
            if not profile_pic.startswith('/') and not profile_pic.startswith('http'):
                user_info['profile_picture'] = f"/static/uploads/profile_pictures/{profile_pic}"
        else:
            user_info['profile_picture'] = None

        return render_template('dashboard.html', user=user_info)