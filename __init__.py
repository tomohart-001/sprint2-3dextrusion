
"""
EngineRoom - Engineering Design and Analysis Platform

A comprehensive platform for structural engineering design, site development,
and AI-powered engineering analysis.
"""

__version__ = "0.1.0"
__author__ = "EngineRoom Team"

# Import main components for easy access
from .agent_definitions import (
    standards_agent,
    zoning_agent,
    calculation_agent,
    sitedeveloper_agent,
    orchestrator_agent
)

from .tools import (
    calculate_area_load,
    calculate_line_load,
    combine_line_loads,
    calculate_max_moment,
    calculate_max_shear,
    list_calculation_tools,
    list_accessible_standards,
    define_platform,
    generate_building_layout,
    preview_layout,
    snap_to_platform,
    suggest_design_alternatives
)

__all__ = [
    "standards_agent",
    "zoning_agent", 
    "calculation_agent",
    "sitedeveloper_agent",
    "orchestrator_agent",
    "calculate_area_load",
    "calculate_line_load",
    "combine_line_loads",
    "calculate_max_moment",
    "calculate_max_shear",
    "list_calculation_tools",
    "list_accessible_standards",
    "define_platform",
    "generate_building_layout",
    "preview_layout",
    "snap_to_platform",
    "suggest_design_alternatives",
]
