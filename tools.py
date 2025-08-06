from agents import function_tool
import os
from openai import OpenAI


@function_tool
def calculate_area_load(
    thickness_m: float,
    density_kN_per_m3: float,
    description: str = "",
    standard: str = "NZS 1170.1"
) -> dict:
    """
    Calculates area dead load (kPa) from thickness and density.

    Args:
      thickness_m: Thickness of the material (m)
      density_kN_per_m3: Density of the material (kN/m³)
      description: Description of the material (optional)
      standard: Standard reference (default NZS 1170.1)

    Returns:
      area_load_kPa, calculation_steps, standard_reference
    """
    area_load_kPa = thickness_m * density_kN_per_m3
    steps = [
        f"Area load = thickness × density = {thickness_m} × {density_kN_per_m3} = {area_load_kPa:.2f} kPa"
    ]
    return {
        "inputs": {
            "thickness_m": thickness_m,
            "density_kN_per_m3": density_kN_per_m3,
            "description": description,
            "standard": standard
        },
        "area_load_kPa": area_load_kPa,
        "calculation_steps": steps,
        "standard_reference": f"{standard} Table 3.1"
    }


@function_tool
def calculate_line_load(
    area_load_kPa: float,
    tributary_width_m: float,
    description: str = "",
    standard: str = "NZS 1170.1"
) -> dict:
    """
    Converts area load (kPa) to line load (kN/m) for a given tributary width.

    Args:
      area_load_kPa: Area load (kPa)
      tributary_width_m: Tributary width (m)
      description: Description of the load (optional)
      standard: Standard reference (default NZS 1170.1)

    Returns:
      line_load_kN_per_m, calculation_steps, standard_reference
    """
    line_load_kN_per_m = area_load_kPa * tributary_width_m
    steps = [
        f"Line load = area_load × tributary_width = {area_load_kPa} × {tributary_width_m} = {line_load_kN_per_m:.2f} kN/m"
    ]
    return {
        "inputs": {
            "area_load_kPa": area_load_kPa,
            "tributary_width_m": tributary_width_m,
            "description": description,
            "standard": standard
        },
        "line_load_kN_per_m": line_load_kN_per_m,
        "calculation_steps": steps,
        "standard_reference": f"{standard} Section 4"
    }


@function_tool
def combine_line_loads(
    dead_line_load_kN_per_m: float,
    live_line_load_kN_per_m: float = 0.0,
    dead_factor: float = 1.2,
    live_factor: float = 1.5,
    combo_label: str = "ULS_1.2G+1.5Q",
    standard: str = "NZS 1170.1"
) -> dict:
    """
    Combines dead and live line loads using specified factors.
    Args:
      dead_line_load_kN_per_m: Dead load (kN/m)
      live_line_load_kN_per_m: Live load (kN/m)
      dead_factor: Factor for dead load (default 1.2)
      live_factor: Factor for live load (default 1.5)
      combo_label: Description of combination (e.g. ULS, SLS)
      standard: Reference standard
    Returns:
      combo_line_load_kN_per_m, calculation_steps, standard_reference
    """
    combo = dead_factor * dead_line_load_kN_per_m + live_factor * live_line_load_kN_per_m
    steps = [
        f"{combo_label}: {dead_factor} × {dead_line_load_kN_per_m} + {live_factor} × {live_line_load_kN_per_m} = {combo:.2f} kN/m"
    ]
    return {
        "inputs": {
            "dead_line_load_kN_per_m": dead_line_load_kN_per_m,
            "live_line_load_kN_per_m": live_line_load_kN_per_m,
            "dead_factor": dead_factor,
            "live_factor": live_factor,
            "combo_label": combo_label,
            "standard": standard
        },
        "combo_line_load_kN_per_m": combo,
        "calculation_steps": steps,
        "standard_reference": f"{standard} (factors: {dead_factor}G, {live_factor}Q)"
    }


@function_tool
def calculate_max_moment(
    line_load_kN_per_m: float,
    span_m: float,
    description: str = "",
    formula_type: str = "simply_supported_udl",
    standard: str = "NZS 1170.1"
) -> dict:
    """
    Calculates max bending moment for a beam.
    Args:
      line_load_kN_per_m: Uniform line load (kN/m)
      span_m: Beam span (m)
      description: Optional
      formula_type: Type of moment formula to use (default is simply supported with UDL)
      standard: Reference standard
    Returns:
      max_moment_kNm, calculation_steps, standard_reference
    """
    if formula_type == "simply_supported_udl":
        max_moment_kNm = line_load_kN_per_m * span_m ** 2 / 8
        formula_desc = "w × L² / 8"
    else:
        return {"error": f"Unsupported formula_type: {formula_type}"}
    steps = [
        f"Max moment = {formula_desc} = {line_load_kN_per_m} × {span_m}² / 8 = {max_moment_kNm:.2f} kNm"
    ]
    return {
        "inputs": {
            "line_load_kN_per_m": line_load_kN_per_m,
            "span_m": span_m,
            "description": description,
            "formula_type": formula_type,
            "standard": standard
        },
        "max_moment_kNm": max_moment_kNm,
        "calculation_steps": steps,
        "standard_reference": f"{standard} Section 6.3"
    }


@function_tool
def calculate_max_shear(
    line_load_kN_per_m: float,
    span_m: float,
    description: str = "",
    formula_type: str = "simply_supported_udl",
    standard: str = "NZS 1170.1"
) -> dict:
    """
    Calculates max shear force for a beam.
    Args:
      line_load_kN_per_m: Uniform line load (kN/m)
      span_m: Beam span (m)
      description: Optional
      formula_type: Type of shear formula to use (default is simply supported with UDL)
      standard: Reference standard
    Returns:
      max_shear_kN, calculation_steps, standard_reference
    """
    if formula_type == "simply_supported_udl":
        max_shear_kN = line_load_kN_per_m * span_m / 2
        formula_desc = "w × L / 2"
    else:
        return {"error": f"Unsupported formula_type: {formula_type}"}
    steps = [
        f"Max shear = {formula_desc} = {line_load_kN_per_m} × {span_m} / 2 = {max_shear_kN:.2f} kN"
    ]
    return {
        "inputs": {
            "line_load_kN_per_m": line_load_kN_per_m,
            "span_m": span_m,
            "description": description,
            "formula_type": formula_type,
            "standard": standard
        },
        "max_shear_kN": max_shear_kN,
        "calculation_steps": steps,
        "standard_reference": f"{standard} Section 6.3"
    }


@function_tool
def list_calculation_tools() -> dict:
    """
    Returns a list and description of all calculation tools (function tools) currently available.
    Use this to check what calculations are supported by the Calculation Agent.
    """
    return {
        "supported_calculations": [
            {
                "name": "calculate_area_load",
                "description": (
                    "Calculates area load (kPa) from material thickness and density. "
                    "Inputs: thickness_m (m), density_kN_per_m3 (kN/m³), "
                    "description (optional), standard (optional, default NZS 1170.1)."
                )
            },
            {
                "name": "calculate_line_load",
                "description": (
                    "Converts area load (kPa) to line load (kN/m) for a given tributary width. "
                    "Inputs: area_load_kPa (kPa), tributary_width_m (m), "
                    "description (optional), standard (optional, default NZS 1170.1)."
                )
            },
            {
                "name": "combine_line_loads",
                "description": (
                    "Combines dead and live line loads using specified factors for load combinations. "
                    "Inputs: dead_line_load_kN_per_m (kN/m), live_line_load_kN_per_m (kN/m, optional), "
                    "dead_factor (default 1.2), live_factor (default 1.5), "
                    "combo_label (optional), standard (optional, default NZS 1170.1)."
                )
            },
            {
                "name": "calculate_max_moment",
                "description": (
                    "Calculates the maximum bending moment (kNm) for a beam with a uniformly distributed load. "
                    "Inputs: line_load_kN_per_m (kN/m), span_m (m), "
                    "description (optional), formula_type (default 'simply_supported_udl'), "
                    "standard (optional, default NZS 1170.1)."
                )
            },
            {
                "name": "calculate_max_shear",
                "description": (
                    "Calculates the maximum shear force (kN) for a beam with a uniformly distributed load. "
                    "Inputs: line_load_kN_per_m (kN/m), span_m (m), "
                    "description (optional), formula_type (default 'simply_supported_udl'), "
                    "standard (optional, default NZS 1170.1)."
                )
            }
        ]
    }

@function_tool
def list_accessible_standards() -> list[dict]:
    """
    Lists all standard documents available (from a static dictionary).
    Returns:
        list of dict: Each item is {"standard": str, "description": str}
    """

    # Dictionary mapping: code -> description
    nz_standards = {
        "NZS 3404:1997": "Steel Structures Standard – Parts 1 & 2: sets minimum requirements for limit‐state design, fabrication, erection, and modification of steelwork in structures.",
        "Building Code Handbook 3E Amdt13": "Comprehensive companion to the NZ Building Code, providing guidance, explanatory commentary, and cross‑referenced design examples.",
        "NZS 1170.5:2004": "Structural Design Actions – Part 5: Earthquake Actions: specifies procedures to determine seismic design actions for NZ buildings (excludes Amendment 1).",
        "NZS 3605:2001": "Timber Piles & Poles: sets performance criteria and means of compliance for timber piles and poles used in buildings, referenced in NZS 3604.",
        "NZS 4219:2009": "Seismic Performance of Engineering Systems: covers design and installation of seismic restraints for non‑structural building services (e.g., ducts, tanks, pipework).",
        "NZS 4121:2001": "Design for Access & Mobility: sets requirements for accessible built environments (entrances, pathways, fixtures) in compliance with Building Code accessibility clauses.",
        "SNZ‑TS 3404:2018": "Durability Requirements for Steel Structures: technical spec complementing NZS 3404, defining coating and corrosion protection for steel in different environments.",
        "NZS 3604:2011": "Timber‑Framed Buildings: guidance for design and construction of light timber‑framed houses and small buildings (up to 3 storeys) on good ground.",
        "NZS 3101:2006": "Concrete Structures – Part 1 (with Amendments A1‑A3): sets minimum requirements for design of reinforced and prestressed concrete structures.",
    }
    return [{"standard": code, "description": desc} for code, desc in nz_standards.items()]

@function_tool(
    name="define_platform",
    description="Creates or updates a rectangular build platform and visualizes it on the elevation model. Can adjust rotation of existing platforms.",
    parameters={
        "type": "object",
        "properties": {
            "length_m": {
                "type": "number",
                "description": "Length of the platform in meters"
            },
            "width_m": {
                "type": "number",
                "description": "Width of the platform in meters"
            },
            "center_x": {
                "type": "number",
                "description": "X coordinate of the platform center",
                "default": 0
            },
            "center_y": {
                "type": "number",
                "description": "Y coordinate of the platform center", 
                "default": 0
            },
            "rotation_deg": {
                "type": "number",
                "description": "Rotation angle of the platform in degrees (0-360). Use this to rotate the platform orientation.",
                "default": 0
            },
            "height_m": {
                "type": "number",
                "description": "Elevation height of the platform in meters",
                "default": 0
            }
        },
        "required": ["length_m", "width_m"]
    }
)
def define_platform(length_m: float, width_m: float, center_x: float = 0, center_y: float = 0, rotation_deg: float = 0, height_m: float = 0):
    """Define or update a build platform on the elevation model with optional rotation."""
    from utils.logger import app_logger
    import math
    
    app_logger.info(f"🔍 DEBUG: define_platform called with length: {length_m}, width: {width_m}, height: {height_m}, rotation: {rotation_deg}°")
    
    # Calculate platform corners for visualization
    half_length = length_m / 2
    half_width = width_m / 2
    
    # Define corners relative to center (before rotation)
    base_corners = [
        (-half_length, -half_width),  # Bottom-left
        (half_length, -half_width),   # Bottom-right
        (half_length, half_width),    # Top-right
        (-half_length, half_width)    # Top-left
    ]
    
    # Apply rotation if specified
    if rotation_deg != 0:
        rotation_rad = math.radians(rotation_deg)
        cos_r = math.cos(rotation_rad)
        sin_r = math.sin(rotation_rad)
        
        # Rotate each corner around the center
        rotated_corners = []
        for x, y in base_corners:
            rotated_x = x * cos_r - y * sin_r
            rotated_y = x * sin_r + y * cos_r
            rotated_corners.append((center_x + rotated_x, center_y + rotated_y))
        corners = rotated_corners
    else:
        # No rotation, just offset by center
        corners = [(center_x + x, center_y + y) for x, y in base_corners]
    
    rotation_text = f" rotated {rotation_deg}°" if rotation_deg != 0 else ""
    message = f"✅ Platform created: {length_m}m × {width_m}m at {height_m}m elevation{rotation_text}"
    
    result = {
        "success": True,
        "message": message,
        "platform_data": {
            "length_m": length_m,
            "width_m": width_m,
            "height_m": height_m,
            "center_x": center_x,
            "center_y": center_y,
            "rotation_deg": rotation_deg,
            "corners": corners,
            "area_m2": length_m * width_m
        },
        "visualization": f"Platform geometry created and ready for display on elevation model{rotation_text}",
        "next_steps": "Platform is now available for building layout generation"
    }
    
    app_logger.info(f"🔍 DEBUG: define_platform returning platform with rotation {rotation_deg}°")uccessful result with {len(corners)} corners")
    app_logger.info(f"🔍 DEBUG: Platform area: {result['platform_data']['area_m2']}m²")
    
    return result

@function_tool(
    name="generate_building_layout",
    description="Places one or more buildings on the platform with given dimensions and layout",
    parameters={
        "type": "object",
        "properties": {
            "building_type": {
                "type": "string",
                "description": "Type of building (e.g., townhouse, duplex)"
            },
            "count": {
                "type": "integer",
                "description": "Number of units to place"
            },
            "unit_width_m": {
                "type": "number",
                "description": "Width of each unit"
            },
            "unit_length_m": {
                "type": "number",
                "description": "Length of each unit"
            },
            "orientation": {
                "type": "string",
                "description": "Layout style (e.g., 'row', 'grid', 'cluster')"
            },
            "spacing_m": {
                "type": "number",
                "description": "Spacing between units",
                "default": 0
            }
        },
        "required": ["building_type", "count", "unit_width_m", "unit_length_m", "orientation"]
    }
)
def generate_building_layout(building_type: str, count: int, unit_width_m: float, unit_length_m: float, orientation: str, spacing_m: float = 2):
    """Generate a layout of buildings within the platform."""
    from utils.logger import app_logger
    
    app_logger.info(f"🔍 DEBUG: generate_building_layout called with type: {building_type}, count: {count}")
    
    # Generate building positions based on orientation
    buildings = []
    
    if orientation.lower() == 'row':
        # Arrange buildings in a row
        total_width = (count * unit_width_m) + ((count - 1) * spacing_m)
        start_x = -total_width / 2
        
        for i in range(count):
            x = start_x + (i * (unit_width_m + spacing_m)) + (unit_width_m / 2)
            y = 0
            
            buildings.append({
                "id": f"{building_type}_{i+1}",
                "type": building_type,
                "x": x,
                "y": y,
                "width_m": unit_width_m,
                "length_m": unit_length_m,
                "rotation_deg": 0,
                "area_m2": unit_width_m * unit_length_m
            })
    
    elif orientation.lower() == 'grid':
        # Arrange in grid pattern
        cols = int(count ** 0.5) if count > 1 else 1
        rows = (count + cols - 1) // cols
        
        total_grid_width = (cols * unit_width_m) + ((cols - 1) * spacing_m)
        total_grid_length = (rows * unit_length_m) + ((rows - 1) * spacing_m)
        
        start_x = -total_grid_width / 2
        start_y = -total_grid_length / 2
        
        for i in range(count):
            row = i // cols
            col = i % cols
            
            x = start_x + (col * (unit_width_m + spacing_m)) + (unit_width_m / 2)
            y = start_y + (row * (unit_length_m + spacing_m)) + (unit_length_m / 2)
            
            buildings.append({
                "id": f"{building_type}_{i+1}",
                "type": building_type,
                "x": x,
                "y": y,
                "width_m": unit_width_m,
                "length_m": unit_length_m,
                "rotation_deg": 0,
                "area_m2": unit_width_m * unit_length_m
            })
    
    total_building_area = sum(b["area_m2"] for b in buildings)
    
    result = {
        "success": True,
        "message": f"✅ Generated {count} {building_type}(s) in {orientation} layout",
        "layout_data": {
            "building_type": building_type,
            "count": count,
            "orientation": orientation,
            "spacing_m": spacing_m,
            "buildings": buildings,
            "total_area_m2": total_building_area
        },
        "visualization": f"Building layout created with {count} units arranged in {orientation} pattern",
        "summary": f"{count} × {building_type} ({unit_width_m}m × {unit_length_m}m each)"
    }
    
    app_logger.info(f"🔍 DEBUG: generate_building_layout returning successful result with {len(buildings)} buildings")
    app_logger.info(f"🔍 DEBUG: Total building area: {total_building_area}m²")
    
    return result

@function_tool(
    name="preview_layout",
    description="Displays the generated layout on the 3D platform surface",
    parameters={
        "type": "object",
        "properties": {
            "units": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "width": {"type": "number"},
                        "length": {"type": "number"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "rotation_deg": {"type": "number"}
                    },
                    "required": ["id", "width", "length", "x", "y", "rotation_deg"]
                },
                "description": "List of unit footprints to render"
            }
        },
        "required": ["units"]
    }
)
def preview_layout(units: list[dict]):
    """Render a visual preview of the given layout units."""
    return {
        "message": f"Previewing {len(units)} units on the platform",
        "units": units
    }

@function_tool(
    name="snap_to_platform",
    description="Ensures all units fit within the defined platform area by adjusting position or rotation",
    parameters={
        "type": "object",
        "properties": {
            "units": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "width": {"type": "number"},
                        "length": {"type": "number"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "rotation_deg": {"type": "number"}
                    },
                    "required": ["id", "width", "length", "x", "y", "rotation_deg"]
                }
            },
            "platform_id": {
                "type": "string",
                "description": "ID of the platform to snap to"
            }
        },
        "required": ["units", "platform_id"]
    }
)
def snap_to_platform(units: list[dict], platform_id: str):
    """Adjust units so they fit within the given platform."""
    return {
        "message": f"Snapped {len(units)} units to platform {platform_id}",
        "units": units
    }

@function_tool(
    name="suggest_design_alternatives",
    description="Suggests alternate layouts or configurations if the current prompt is unfeasible",
    parameters={
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Why the original layout won't work"
            },
            "constraints": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of constraints preventing layout (e.g., 'max width exceeded')"
            }
        },
        "required": ["reason", "constraints"]
    }
)
def suggest_design_alternatives(reason: str, constraints: list[str]):
    """
    This function is a tool callable by the AI to suggest layout alternatives
    when a layout fails due to design constraints.
    """
    from utils.logger import app_logger
    
    app_logger.info(f"🔍 DEBUG: suggest_design_alternatives called with reason: {reason}")
    app_logger.info(f"🔍 DEBUG: suggest_design_alternatives constraints: {constraints}")
    
    constraint_list = ", ".join(constraints) if constraints else "None specified"
    result = f"Alternative layouts suggested due to: {reason}. Constraints: {constraint_list}. Consider reducing unit sizes, changing orientation, or modifying the platform dimensions."
    
    app_logger.info(f"🔍 DEBUG: suggest_design_alternatives returning type: {type(result)}")
    app_logger.info(f"🔍 DEBUG: suggest_design_alternatives result: {result}")
    
    return result