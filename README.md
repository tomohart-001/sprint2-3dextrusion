
# EngineRoom

A comprehensive engineering design and analysis platform with AI-powered agents for structural engineering, site development, and building design.

## Features

- **AI Agents**: Specialized agents for standards lookup, zoning analysis, calculations, and site development
- **Structural Analysis**: Tools for calculating loads, moments, and shear forces
- **Site Development**: Building layout generation and platform definition tools
- **Standards Integration**: Access to engineering standards and building codes
- **Zoning Analysis**: Residential zoning rules and requirements lookup

## Installation

```bash
pip install engineroom
```

## Quick Start

```python
from engineroom import orchestrator_agent, calculate_area_load

# Use the orchestrator agent for complex queries
response = orchestrator_agent.run("Design a 3-story residential building")

# Or use specific calculation tools
load = calculate_area_load(area=100, load_type="live", occupancy="residential")
```

## Components

### Agents
- `standards_agent`: Engineering standards and building code lookup
- `zoning_agent`: Zoning rules and residential requirements
- `calculation_agent`: Structural engineering calculations
- `sitedeveloper_agent`: Site development and building layout
- `orchestrator_agent`: Coordinates all other agents

### Tools
- Structural calculation functions
- Building layout generation
- Platform definition utilities
- Design alternatives suggestion

## License

MIT License
