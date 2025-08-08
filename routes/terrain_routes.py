"""The code changes focus on saving and loading structure placement data within the terrain routes module to ensure it's persisted during cut and fill analysis."""
import json
import math
from flask import request, jsonify, render_template, session
from utils.logger import app_logger
from typing import Dict, Any
from datetime import datetime

# Try to import terrain service with graceful fallback
try:
    from services.terrain_service import terrain_service
    TERRAIN_AVAILABLE = terrain_service.available if terrain_service else False
    app_logger.info(f"Terrain service import result: available={TERRAIN_AVAILABLE}")
except ImportError as e:
    app_logger.warning(f"Terrain service unavailable: {e}")
    terrain_service = None
    TERRAIN_AVAILABLE = False


class TerrainRoutes:
    """Terrain route handlers"""



    def handle_terrain_viewer(self):
        """Handle terrain viewer page"""
        try:
            from flask import request
            app_logger.info("Terrain viewer page requested")

            # Get project ID from query parameters with multiple parameter names
            project_id = request.args.get('project_id') or request.args.get('project')

            # Clean up malformed project IDs (remove any extra parameters)
            if project_id and ('?' in project_id or '&' in project_id):
                project_id = project_id.split('?')[0].split('&')[0]
                app_logger.info(f"Cleaned malformed project ID: {project_id}")

            # Validate project ID format
            if project_id:
                project_id = str(project_id).strip()
                if project_id.lower() == 'none' or not project_id.isdigit():
                    app_logger.warning(f"Invalid project ID format: {project_id}")
                    project_id = None
                else:
                    app_logger.info(f"Using project ID from URL: {project_id}")
                    # Clear any existing cached data for different projects
                    if session.get('current_project_id') != project_id:
                        app_logger.info(f"Project changed from {session.get('current_project_id')} to {project_id}, clearing cached data")
                        session.pop('site_data', None)
                        session.pop('terrain_data', None)
                        session.pop('floorplan_data', None)
                    # Store current project ID in session
                    session['current_project_id'] = project_id

            # If no valid project ID from URL, try session storage as fallback
            if not project_id:
                stored_project_id = session.get('current_project_id')
                if stored_project_id and str(stored_project_id).isdigit():
                    project_id = stored_project_id
                    app_logger.info(f"Using valid project ID from session: {project_id}")
                else:
                    app_logger.info(f"No valid project ID in session: {stored_project_id}")

            # If still no project ID, try to get the most recent project for the user
            if not project_id:
                try:
                    from database import DatabaseManager
                    db_manager = DatabaseManager()
                    user_id = session.get('user', {}).get('id')

                    if user_id:
                        with db_manager.db.get_cursor() as cursor:
                            cursor.execute("""
                                SELECT id, name, address 
                                FROM projects 
                                WHERE user_id = ? 
                                ORDER BY updated_at DESC 
                                LIMIT 1
                            """, (user_id,))

                            recent_project = cursor.fetchone()
                            if recent_project:
                                project_id = str(recent_project[0])
                                session['current_project_id'] = project_id
                                app_logger.info(f"Using most recent project: {project_id} ({recent_project[1]} at {recent_project[2]})")
                except Exception as e:
                    app_logger.error(f"Error getting recent project: {e}")

            if not project_id:
                app_logger.warning("No project ID available for terrain viewer")

            # Initialize empty site_data - we'll load fresh data for this project
            site_data = {}

            # Get project data if project_id is provided
            project_data = {}
            if project_id:
                try:
                    from database import DatabaseManager
                    db_manager = DatabaseManager()
                    user_id = session.get('user', {}).get('id')

                    if user_id:
                        with db_manager.db.get_cursor() as cursor:
                            cursor.execute("""
                                SELECT name, address, location_lat, location_lng, created_at 
                                FROM projects 
                                WHERE id = ? AND user_id = ?
                            """, (project_id, user_id))

                            project_row = cursor.fetchone()
                            if project_row:
                                project_data = {
                                    'id': project_id,
                                    'name': project_row[0],
                                    'address': project_row[1],
                                    'lat': project_row[2],
                                    'lng': project_row[3],
                                    'created_at': project_row[4]
                                }
                                app_logger.info(f"Project data loaded for terrain viewer: {project_data['name']} at {project_data['address']}")

                                # If we have no site data but we have a project address, add it to site_data for fallback
                                if not site_data and project_data.get('address'):
                                    site_data = {
                                        'address': project_data['address'],
                                        'project_address': project_data['address'],
                                        'project_name': project_data['name'],
                                        'project_id': project_id
                                    }
                                    app_logger.info(f"No site data found, but project has address: {project_data['address']}")
                            else:
                                app_logger.warning(f"No project found with ID {project_id} for user {user_id}")
                    else:
                        app_logger.warning("No user ID found in session for terrain viewer")
                except Exception as e:
                    app_logger.error(f"Error loading project data: {e}")
            else:
                app_logger.info("No project ID provided to terrain viewer")

            # Load site boundary and polygon data from project snapshots
            if project_id:
                project_site_data = self._load_site_data_from_project(project_id)
                if project_site_data:
                    app_logger.info(f"Loaded site data from project snapshots: {list(project_site_data.keys())}")
                    # Merge with existing site data, prioritizing project data
                    if site_data:
                        site_data.update(project_site_data)
                    else:
                        site_data = project_site_data
                    # Store in session for future use
                    session['site_data'] = site_data

            return render_template('terrain_viewer.html', 
                                 site_data=site_data,
                                 site_data_json=json.dumps(site_data) if site_data else '{}',
                                 project_data=project_data)

        except Exception as e:
            app_logger.error(f"Terrain viewer error: {e}")
            error_data = {'error': str(e)}
            return render_template('terrain_viewer.html', 
                                 site_data=error_data,
                                 site_data_json=json.dumps(error_data),
                                 project_data={})

    def _load_site_data_from_project(self, project_id):
        """Load site boundary, setbacks, and structure data from project snapshots"""
        try:
            from database import DatabaseManager
            import json

            db_manager = DatabaseManager()
            user_id = session.get('user', {}).get('id')

            if not user_id:
                app_logger.warning(f"No user ID in session for project {project_id}")
                return None

            site_data = {}

            with db_manager.db.get_cursor() as cursor:
                # Load all snapshots for this project
                cursor.execute("""
                    SELECT snapshot_type, snapshot_data, updated_at
                    FROM project_snapshots 
                    WHERE project_id = ? AND user_id = ?
                    ORDER BY updated_at DESC
                """, (project_id, user_id))

                snapshots = cursor.fetchall()
                app_logger.info(f"Found {len(snapshots)} snapshots for project {project_id}")

                # Debug: Log all available snapshot types
                snapshot_types = [snapshot[0] for snapshot in snapshots]
                app_logger.info(f"Available snapshot types: {snapshot_types}")

                for snapshot_type, snapshot_data, updated_at in snapshots:
                    try:
                        # Parse snapshot data
                        if isinstance(snapshot_data, str):
                            data = json.loads(snapshot_data)
                        else:
                            data = snapshot_data

                        app_logger.info(f"Processing snapshot type: {snapshot_type}")
                        app_logger.info(f"Snapshot data keys: {list(data.keys()) if isinstance(data, dict) else 'not a dict'}")

                        if snapshot_type == 'site_boundary':
                            # Load site boundary data
                            coordinates = data.get('coordinates', [])

                            # Debug coordinate structure
                            if coordinates:
                                first_coord = coordinates[0]
                                app_logger.info(f"First coordinate type: {type(first_coord)}, value: {first_coord}")
                                if isinstance(first_coord, (list, tuple)) and len(first_coord) >= 2:
                                    app_logger.info(f"First coord elements: [{type(first_coord[0])}: {first_coord[0]}, {type(first_coord[1])}: {first_coord[1]}]")

                            app_logger.info(f"Loaded site boundary with {len(coordinates)} coordinates")

                            # Store the coordinates in site_data
                            if coordinates:
                                site_data['coordinates'] = coordinates

                                # Ensure coordinates are in the correct format and we have enough points
                                if len(coordinates) >= 3:
                                    # Calculate area using shoelace formula
                                    area = 0
                                    n = len(coordinates)
                                    for i in range(n):
                                        j = (i + 1) % n
                                        if isinstance(coordinates[i], (list, tuple)) and isinstance(coordinates[j], (list, tuple)):
                                            area += coordinates[i][0] * coordinates[j][1]
                                            area -= coordinates[j][0] * coordinates[i][1]
                                    area = abs(area) / 2
                                    # Convert from degree-based area to approximate square meters
                                    area_m2 = area * 12365778903  # Rough conversion factor

                                    site_data['area'] = area_m2
                                    site_data['area_m2'] = area_m2

                        elif snapshot_type == 'buildable_area':
                            # Load setback polygon data
                            buildable_coords = data.get('buildable_coords', [])
                            site_data['buildable_area'] = {
                                'coordinates': buildable_coords,
                                'area_m2': data.get('buildable_area_m2', 0),
                                'setbacks': {
                                    'front': data.get('front_setback', 4.5),
                                    'back': data.get('rear_setback', 3.5),
                                    'side': data.get('side_setback', 1.5)
                                }
                            }

                            # Include terrain bounds if available from buildable area snapshot
                            terrain_bounds = data.get('terrain_bounds')
                            if terrain_bounds:
                                site_data['terrainBounds'] = terrain_bounds
                                app_logger.info(f"Loaded terrain bounds from buildable area snapshot")

                            app_logger.info(f"Loaded buildable area with {len(buildable_coords)} coordinates")

                        elif snapshot_type == 'structure_placement':
                            # Load structure/floorplan data
                            structure_coords = data.get('coordinates', data.get('boundaries', []))
                            structure_data = {
                                'success': True,
                                'boundaries': structure_coords,
                                'coordinates': structure_coords,
                                'dimensions': data.get('dimensions', {}),
                                'area_m2': data.get('area_m2', 0),
                                'placement': data.get('placement', {}),
                                'structure_type': data.get('structure_type', 'floorplan'),
                                'rooms': data.get('rooms', []),
                                'walls': data.get('walls', [])
                            }

                            # Store structure placement in site_data for terrain visualization
                            site_data['structure_placement'] = {
                                'coordinates': structure_coords,
                                'area_m2': data.get('area_m2', 0),
                                'structure_type': data.get('structure_type', 'floorplan')
                            }

                            # Store in session for current use
                            session['floorplan_data'] = structure_data
                            site_data['floorplan_data'] = structure_data

                            app_logger.info(f"Loaded structure placement with {len(structure_coords)} boundary points")

                    except json.JSONDecodeError as e:
                        app_logger.error(f"Failed to parse snapshot data for type {snapshot_type}: {e}")
                        continue

                # Add project address and metadata for terrain service
                if site_data:
                    cursor.execute("""
                        SELECT address, location_lat, location_lng, name 
                        FROM projects 
                        WHERE id = ? AND user_id = ?
                    """, (project_id, user_id))

                    project_row = cursor.fetchone()
                    if project_row:
                        site_data['address'] = project_row[0]
                        site_data['project_name'] = project_row[3]
                        site_data['project_id'] = project_id

                        if project_row[1] and project_row[2]:
                            site_data['center_lat'] = project_row[1]
                            site_data['center_lng'] = project_row[2]
                            app_logger.info(f"Added project metadata: {project_row[3]} at {project_row[0]}")
                        else:
                            app_logger.warning(f"Project {project_id} missing lat/lng coordinates")

                            # Calculate center from site boundary coordinates if available
                            if site_data.get('coordinates'):
                                try:
                                    coords = site_data['coordinates']
                                    total_lng = sum(coord[0] for coord in coords if len(coord) >= 2)
                                    total_lat = sum(coord[1] for coord in coords if len(coord) >= 2)
                                    valid_coords = len([coord for coord in coords if len(coord) >= 2])

                                    if valid_coords > 0:
                                        site_data['center_lat'] = total_lat / valid_coords
                                        site_data['center_lng'] = total_lng / valid_coords
                                        app_logger.info(f"Calculated center from site boundary: lat={site_data['center_lat']}, lng={site_data['center_lng']}")
                                except Exception as e:
                                    app_logger.error(f"Error calculating center from site boundary: {e}")

                # Generate terrain bounds if not already present
                if site_data and 'coordinates' in site_data and 'terrainBounds' not in site_data:
                    app_logger.info("Generating terrain bounds from site boundary")
                    coordinates = site_data['coordinates']

                    # Calculate bounding box with 50m buffer
                    min_lng = min(coord[0] for coord in coordinates)
                    max_lng = max(coord[0] for coord in coordinates)
                    min_lat = min(coord[1] for coord in coordinates)
                    max_lat = max(coord[1] for coord in coordinates)

                    # Convert 50m buffer to degrees
                    lat_buffer = 50 / 111320  # ~0.00045 degrees
                    lng_buffer = 50 / (111320 * math.cos((min_lat + max_lat) / 2 * math.pi / 180))

                    site_data['terrainBounds'] = {
                        'southwest': [min_lng - lng_buffer, min_lat - lat_buffer],
                        'northeast': [max_lng + lng_buffer, max_lat + lat_buffer],
                        'center': [(min_lng + max_lng) / 2, (min_lat + max_lat) / 2],
                        'width': max_lng - min_lng + (2 * lng_buffer),
                        'height': max_lat - min_lat + (2 * lat_buffer)
                    }
                    app_logger.info(f"Generated terrain bounds with 50m buffer")

                # If we have site boundary but no buildable area, create a default one with 3m setbacks
                if site_data and 'coordinates' in site_data and 'buildable_area' not in site_data:
                    app_logger.info("Creating default buildable area from site boundary")
                    site_coords = site_data['coordinates']

                    # Create a simple inset polygon (this is a simplified approach)
                    # In a real scenario, you'd use proper polygon offset algorithms
                    buildable_coords = []
                    for coord in site_coords[:-1]:  # Exclude last coordinate if it duplicates first
                        if isinstance(coord, (list, tuple)):
                            # Offset each point slightly inward (simplified approach)
                            lng, lat = coord[0], coord[1]
                            offset = 0.00003  # Approximate 3m offset in degrees
                            buildable_coords.append([lng + offset, lat + offset])

                    if buildable_coords:
                        site_data['buildable_area'] = {
                            'coordinates': buildable_coords,
                            'area_m2': site_data.get('area_m2', 0) * 0.8,  # Estimate 80% of site area
                            'setbacks': {
                                'front': 3.0,
                                'back': 3.0,
                                'side': 3.0
                            }
                        }
                        app_logger.info(f"Created default buildable area with {len(buildable_coords)} coordinates")

                return site_data if site_data else None

        except Exception as e:
            app_logger.error(f"Error loading site data from project {project_id}: {e}")
            return None


            return render_template('terrain_viewer.html', 
                                 site_data=site_data,
                                 site_data_json=json.dumps(site_data) if site_data else '{}',
                                 project_data=project_data)

        except Exception as e:
            app_logger.error(f"Terrain viewer error: {e}")
            error_data = {'error': str(e)}
            return render_template('terrain_viewer.html', 
                                 site_data=error_data,
                                 site_data_json=json.dumps(error_data),
                                 project_data={})

    def handle_terrain_cache_stats(self):
        """Get terrain service cache statistics"""


    def handle_load_site_data(self):
        """Load site data from project snapshots for terrain analysis"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400

            project_id = data.get('project_id')

            if not project_id:
                return jsonify({
                    'success': False,
                    'error': 'Project ID is required'
                }), 400

            app_logger.info(f"Loading site data for project ID: {project_id}")

            # Clear any cached data for different projects
            if session.get('current_project_id') != str(project_id):
                app_logger.info(f"Clearing cached data - project changed to {project_id}")
                session.pop('site_data', None)
                session.pop('terrain_data', None)
                session.pop('floorplan_data', None)

            # Update current project ID
            session['current_project_id'] = str(project_id)

            site_data = self._load_site_data_from_project(project_id)

            if site_data:
                # Store in session for terrain generation
                session['site_data'] = site_data

                polygon_count = 0
                polygon_types = []

                if site_data.get('coordinates'):
                    polygon_count += 1
                    polygon_types.append('site boundary')
                if site_data.get('buildable_area', {}).get('coordinates'):
                    polygon_count += 1
                    polygon_types.append('buildable area')
                if site_data.get('structure_placement', {}).get('coordinates'):
                    polygon_count += 1
                    polygon_types.append('structure placement')

                app_logger.info(f"Successfully loaded site data with {polygon_count} polygons: {', '.join(polygon_types)}")

                return jsonify({
                    'success': True,
                    'message': f'Site data loaded successfully with {polygon_count} polygon(s): {", ".join(polygon_types)}',
                    'site_data': site_data,
                    'polygon_count': polygon_count,
                    'polygon_types': polygon_types
                })
            else:
                app_logger.warning(f"No site data found for project {project_id}")
                return jsonify({
                    'success': False,
                    'error': 'No site data found for this project. Make sure the project has site boundary data.'
                }), 404

        except Exception as e:
            app_logger.error(f"Error loading site data: {e}")
            return jsonify({
                'success': False,
                'error': f'Failed to load site data: {str(e)}'
            }), 500


        try:
            from services.terrain_service import terrain_service
            cache_stats = terrain_service.get_cache_stats()
            app_logger.info(f"Terrain cache stats requested: {cache_stats}")
            return jsonify({
                'success': True,
                'cache_stats': cache_stats
            })
        except Exception as e:
            app_logger.error(f"Error getting terrain cache stats: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    def handle_clear_terrain_cache(self):
        """Clear terrain service coordinate cache"""
        try:
            from services.terrain_service import terrain_service
            terrain_service.clear_coordinate_cache()
            app_logger.info("Terrain coordinate cache cleared")
            return jsonify({
                'success': True,
                'message': 'Terrain coordinate cache cleared successfully'
            })
        except Exception as e:
            app_logger.error(f"Error clearing terrain cache: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    def handle_generate_terrain(self):
        """Handle terrain generation API endpoint with progress tracking"""
        try:
            if not TERRAIN_AVAILABLE:
                app_logger.warning("Terrain generation requested but service unavailable")
                return jsonify({
                    'success': False,
                    'error': 'Terrain visualization service unavailable - missing geospatial dependencies'
                }), 503

            app_logger.info("Terrain generation request - Service available: True")

            # Early validation for New Zealand coordinates
            def validate_nz_location(site_data):
                """Quick validation to check if location is in New Zealand"""
                coordinates = site_data.get('coordinates', [])
                if not coordinates:
                    return False, "No coordinates found"

                # Get first coordinate for location check
                first_coord = coordinates[0]
                try:
                    if isinstance(first_coord, dict):
                        lat = float(first_coord.get('lat', 0))
                        lng = float(first_coord.get('lng', 0))
                    elif isinstance(first_coord, (list, tuple)) and len(first_coord) >= 2:
                        if isinstance(first_coord[0], (int, float)):
                            lng, lat = float(first_coord[0]), float(first_coord[1])
                        elif isinstance(first_coord[0], (list, tuple)):
                            lng, lat = float(first_coord[0][0]), float(first_coord[0][1])
                        else:
                            return False, "Invalid coordinate format"
                    else:
                        return False, "Unsupported coordinate format"

                    # Check if coordinates are in New Zealand bounds
                    if not (-47.0 <= lat <= -34.0) or not (166.0 <= lng <= 179.0):
                        return False, f"Location ({lat:.4f}, {lng:.4f}) is outside New Zealand"

                    return True, None

                except (ValueError, TypeError, IndexError) as e:
                    return False, f"Error parsing coordinates: {str(e)}"

            # Get request data
            data = request.get_json()
            app_logger.info(f"Terrain generation request: {list(data.keys()) if data else 'No data'}")

            if not data or 'site_data' not in data:
                return jsonify({'success': False, 'error': 'No site data provided'}), 400

            site_data = data['site_data']

            # Early validation for New Zealand location
            is_valid_location, location_error = validate_nz_location(site_data)
            if not is_valid_location:
                app_logger.warning(f"Terrain generation attempted for non-NZ location: {location_error}")
                return jsonify({
                    'success': False,
                    'error': 'Terrain visualization is currently only available for New Zealand locations.',
                    'error_type': 'location_not_supported',
                    'details': location_error,
                    'supported_region': 'New Zealand'
                })

            # Enhance site data with location information from session if available
            from flask import session
            if 'location_data' in session:
                location_data = session['location_data']
                if not site_data.get('address'):
                    site_data['address'] = location_data.get('name', location_data.get('display_name'))
                if not site_data.get('display_name'):
                    site_data['display_name'] = location_data.get('name', location_data.get('display_name'))
                if not site_data.get('formatted_address'):
                    site_data['formatted_address'] = location_data.get('name', location_data.get('display_name'))

            # If still no address, try to get from user_location in session
            if not site_data.get('address') and 'user_location' in session:
                site_data['address'] = session['user_location']

            address = site_data.get('address', 'Unknown location')

            # Log available polygon data for terrain visualization
            polygon_info = []
            if site_data.get('coordinates'):
                polygon_info.append(f"Site boundary ({len(site_data['coordinates'])} points)")
            if site_data.get('buildable_area', {}).get('coordinates'):
                polygon_info.append(f"Buildable area ({len(site_data['buildable_area']['coordinates'])} points)")
            if site_data.get('structure_placement', {}).get('coordinates'):
                polygon_info.append(f"Structure placement ({len(site_data['structure_placement']['coordinates'])} points)")

            if polygon_info:
                app_logger.info(f"Starting terrain generation for site: {address} with polygons: {', '.join(polygon_info)}")
            else:
                app_logger.info(f"Starting terrain generation for site: {address}")

            # Progress tracking storage
            progress_data = {
                'current_step': 1,
                'message': 'Starting...',
                'percentage': 0,
                'steps_completed': []
            }

            def progress_callback(step: int, message: str, percentage: int = None):
                """Progress callback to track generation status"""
                progress_data['current_step'] = step
                progress_data['message'] = message
                if percentage is not None:
                    progress_data['percentage'] = min(100, max(0, percentage))
                if step not in progress_data['steps_completed']:
                    progress_data['steps_completed'].append(step)
                app_logger.info(f"Progress Step {step}: {message} ({progress_data['percentage']}%)")

            # Generate terrain data with progress tracking
            result = terrain_service.generate_terrain_data(site_data, progress_callback)

            # Add final progress info to result
            if result.get('success'):
                result['progress'] = {
                    'completed': True,
                    'final_step': progress_data['current_step'],
                    'final_message': progress_data['message'],
                    'percentage': 100
                }
                app_logger.info(f"Terrain data generated successfully for {address}")

                # Store terrain data in session for Site Developer page
                session['terrain_data'] = result
                app_logger.info("Terrain data stored in session for Site Developer page")

                # Get project_id from request data first, then session as fallback
                request_project_id = data.get('project_id')
                session_project_id = session.get('current_project_id')

                # Use request project_id if available, otherwise use session
                project_id = request_project_id or session_project_id

                app_logger.info(f"Saving terrain data - request project_id: {request_project_id}, session project_id: {session_project_id}, using: {project_id}")

                if project_id:
                    try:
                        from database import DatabaseManager
                        import json

                        db_manager = DatabaseManager()
                        user_id = session.get('user', {}).get('id')

                        if user_id:
                            terrain_snapshot = {
                                'terrain_data': result,
                                'elevation_data': result.get('elevation_data', []),
                                'polygon_overlays': result.get('polygon_overlays', {}),
                                'mapbox_tile_url': result.get('mapbox_tile_url'),
                                'terrain_bounds': result.get('terrain_bounds'),
                                'coordinates': result.get('coordinates', {}),
                                'city': result.get('city', ''),
                                'address': result.get('address', ''),
                                'timestamp': datetime.now().isoformat()
                            }

                            with db_manager.db.get_cursor() as cursor:
                                cursor.execute("""
                                    INSERT OR REPLACE INTO project_snapshots 
                                    (project_id, user_id, snapshot_type, snapshot_data, description)
                                    VALUES (?, ?, ?, ?, ?)
                                """, (
                                    project_id, user_id, 'terrain_analysis',
                                    json.dumps(terrain_snapshot),
                                    f'Terrain analysis for {address}'
                                ))

                            app_logger.info(f"Terrain data saved to project {project_id} snapshots")
                    except Exception as e:
                        app_logger.error(f"Failed to save terrain data to project snapshots: {e}")

            else:
                result['progress'] = {
                    'completed': False,
                    'failed_at_step': progress_data['current_step'],
                    'error_message': progress_data['message'],
                    'percentage': progress_data['percentage']
                }
                app_logger.error(f"Terrain generation failed for {address}: {result.get('error')}")

            return jsonify(result)

        except Exception as e:
            app_logger.error(f"Terrain generation error: {e}")
            return jsonify({
                'success': False,
                'error': f'Server error: {str(e)}',
                'progress': {
                    'completed': False,
                    'failed_at_step': 1,
                    'error_message': 'Server error occurred',                    'percentage': 0
                }
            }), 500

    def register_routes(self, app):
        """Register routes with Flask app"""
        self.app = app
        self.total_routes = 0

        with app.app_context():
            self.app.add_url_rule('/terrain-viewer', 'terrain_viewer', 
                                 self.handle_terrain_viewer, methods=['GET'])

            app_logger.info(f"✅ Successfully registered: /terrain-viewer")

            # Main terrain generation API
            self.app.add_url_rule('/api/generate-terrain', 'generate_terrain',
                                 self.handle_generate_terrain, methods=['POST'])

            app_logger.info(f"✅ Successfully registered: /api/generate-terrain")

            # Terrain cache management routes
            self.app.add_url_rule('/api/terrain-cache-stats', 'terrain_cache_stats',
                                 self.handle_terrain_cache_stats, methods=['GET'])

            app_logger.info(f"✅ Successfully registered: /api/terrain-cache-stats")

            self.app.add_url_rule('/api/clear-terrain-cache', 'clear_terrain_cache',
                                 self.handle_clear_terrain_cache, methods=['POST'])

            app_logger.info(f"✅ Successfully registered: /api/clear-terrain-cache")

            # Site data loading for terrain analysis
            self.app.add_url_rule('/api/load-site-data', 'load_site_data',
                                 self.handle_load_site_data, methods=['POST'])

            app_logger.info(f"✅ Successfully registered: /api/load-site-data")

            # Add route to provide mapbox token
            self.app.add_url_rule('/api/mapbox-token', 'mapbox_token',
                                 self.handle_mapbox_token, methods=['GET'])

            app_logger.info(f"✅ Successfully registered: /api/mapbox-token")

            # Session data storage for terrain analysis
            self.app.add_url_rule('/api/store-session-data', 'store_session_data',
                                 self.handle_store_session_data, methods=['POST'])

            app_logger.info(f"✅ Successfully registered: /api/store-session-data")

            # Address-based terrain generation
            self.app.add_url_rule('/api/generate-terrain-from-address', 'generate_terrain_from_address',
                                 self.handle_generate_terrain_from_address, methods=['POST'])

            app_logger.info(f"✅ Successfully registered: /api/generate-terrain-from-address")

            self.total_routes += 1
            app_logger.info(f"Total routes registered: {self.total_routes}")

    def handle_mapbox_token(self):
        """API endpoint to get the mapbox token"""
        try:
            # Retrieve mapbox token from environment variables or configuration
            mapbox_token = self.app.config.get('MAPBOX_ACCESS_TOKEN')
            if not mapbox_token:
                app_logger.warning("Mapbox token not configured")
                return jsonify({
                    'success': False,
                    'error': 'Mapbox token not configured'
                }), 500

            return jsonify({
                'success': True,
                'mapbox_token': mapbox_token
            })

        except Exception as e:
            app_logger.error(f"Error getting mapbox token: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    def handle_generate_terrain_from_address(self):
        """Generate terrain bounds from project address"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400

            address = data.get('address')
            project_id = data.get('project_id')

            if not address:
                return jsonify({
                    'success': False,
                    'error': 'Address is required'
                }), 400

            app_logger.info(f"Generating terrain bounds from address: {address}")

            # Import geocoding service
            try:
                import requests
                import time

                # Use Nominatim (OpenStreetMap) for geocoding with proper headers
                geocode_url = "https://nominatim.openstreetmap.org/search"
                params = {
                    'q': address,
                    'format': 'json',
                    'limit': 1,
                    'bounded': 1,
                    'countrycodes': 'nz'  # Restrict to New Zealand
                }

                # Add proper headers to avoid 403 errors
                headers = {
                    'User-Agent': 'EngineRoom-Terrain-Service/1.0 (engineering@engineroom.nz)',
                    'Accept': 'application/json',
                    'Accept-Language': 'en'
                }

                # Add a small delay to respect rate limits
                time.sleep(1)

                response = requests.get(geocode_url, params=params, headers=headers, timeout=15)
                response.raise_for_status()

                results = response.json()

                if not results:
                    return jsonify({
                        'success': False,
                        'error': f'Could not find location for address: {address}'
                    }), 404

                result = results[0]
                lat = float(result['lat'])
                lng = float(result['lon'])

                # Create a small boundary around the geocoded point (approximately 50m x 50m)
                # Convert 50m to degrees (rough approximation)
                lat_offset = 50 / 111320  # ~0.00045 degrees
                lng_offset = 50 / (111320 * math.cos(lat * math.pi / 180))

                # Create a square boundary around the point
                coordinates = [
                    [lng - lng_offset, lat - lat_offset],  # Southwest
                    [lng + lng_offset, lat - lat_offset],  # Southeast  
                    [lng + lng_offset, lat + lat_offset],  # Northeast
                    [lng - lng_offset, lat + lat_offset],  # Northwest
                    [lng - lng_offset, lat - lat_offset]   # Close polygon
                ]

                # Calculate terrain bounds with buffer
                terrain_bounds = {
                    'southwest': [lng - lng_offset * 2, lat - lat_offset * 2],
                    'northeast': [lng + lng_offset * 2, lat + lat_offset * 2],
                    'center': [lng, lat],
                    'width': lng_offset * 4,
                    'height': lat_offset * 4
                }

                # Create site data for terrain generation
                site_data = {
                    'coordinates': coordinates,
                    'address': address,
                    'center_lat': lat,
                    'center_lng': lng,
                    'area_m2': 2500,  # 50m x 50m
                    'terrainBounds': terrain_bounds,
                    'geocoded_from_address': True,
                    'original_address': address
                }

                app_logger.info(f"Successfully geocoded {address} to {lat}, {lng}")

                return jsonify({
                    'success': True,
                    'site_data': site_data,
                    'coordinates': coordinates,
                    'center': [lng, lat],
                    'terrain_bounds': terrain_bounds
                })

            except requests.exceptions.RequestException as e:
                app_logger.error(f"Geocoding request failed: {e}")

                # Check if it's a 403 error (rate limited or blocked)
                if hasattr(e, 'response') and e.response and e.response.status_code == 403:
                    return jsonify({
                        'success': False,
                        'error': 'Geocoding service is temporarily unavailable due to rate limits. Please try again in a few moments.',
                        'error_type': 'rate_limited'
                    }), 429
                else:
                    return jsonify({
                        'success': False,
                        'error': 'Geocoding service unavailable. Please check your internet connection and try again.',
                        'error_type': 'service_unavailable'
                    }), 503

            except Exception as e:
                app_logger.error(f"Geocoding error: {e}")
                return jsonify({
                    'success': False,
                    'error': f'Geocoding failed: {str(e)}'
                }), 500

        except Exception as e:
            app_logger.error(f"Error generating terrain from address: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    def handle_store_session_data(self):
        """API endpoint to store data in session"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400

            # Store location data in session
            location_data = data.get('location_data')
            if location_data:
                session['location_data'] = location_data
                app_logger.info(f"Stored location data in session: {location_data.keys()}")

            # Store user location data in session
            user_location = data.get('user_location')
            if user_location:
                session['user_location'] = user_location
                app_logger.info(f"Stored user location in session: {user_location}")

            return jsonify({
                'success': True,
                'message': 'Session data stored successfully'
            })

        except Exception as e:
            app_logger.error(f"Error storing session data: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

# The code changes focus on fixing a potential syntax error in the database query used when loading site data from project snapshots, ensuring correct execution.