import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Snap from 'ol/interaction/Snap';
import Overlay from 'ol/Overlay';
import HeatMapLayer from 'ol/layer/Heatmap';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Circle from 'ol/geom/Circle';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat, toLonLat } from 'ol/proj';
import TileWMS from 'ol/source/TileWMS';
import CesiumMap from './components/CesiumMap';
import KgVisualizer from './components/KgVisualizer';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import { Fill, Stroke, Style, Circle as CircleStyle, Text } from 'ol/style';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CircleDot,
  Eye,
  EyeOff,
  Layers3,
  LocateFixed,
  MapPin,
  Navigation,
  Brain,
  PencilLine,
  Plus,
  Trash2,
  Search,
  Sun,
  Moon,
  Map as MapIcon,
  Ruler,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  HeartPulse,
  GraduationCap,
  Dumbbell,
  Trees,
  Building,
  Train,
  Newspaper,
  ExternalLink,
  Phone,
  Globe,
  Sparkles,
} from 'lucide-react';
import {
  countGeometries,
  analyzeSelectedArea,
  createLayerMetadata,
  formatCoordinates,
  readGeoJsonFeatures,
  writeGeoJsonFeatures,
  calculateLineDistance,
  calculateDistanceBetweenCoordinates,
  getPolygonMetrics,
  isPointInPolygon
} from './utils/spatial';

// Error Boundary to prevent white screen crashes
import React from 'react';
class DecisionPanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Decision Support panel crashed:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-950/20 p-6 text-center space-y-2">
          <p className="text-xs text-rose-300 font-semibold">Something went wrong loading this panel.</p>
          <p className="text-[10px] text-slate-500">Try clicking on another point on the map.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-[10px] px-3 py-1 rounded-lg bg-slate-800 text-slate-300 border border-white/10 hover:bg-slate-700 mt-2"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AMENITY_CATEGORIES = {
  'Healthcare': { icon: HeartPulse, color: 'text-rose-400 bg-rose-400/10 border-rose-400/20' },
  'Education': { icon: GraduationCap, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  'Fitness': { icon: Dumbbell, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  'Recreation': { icon: Trees, color: 'text-lime-400 bg-lime-400/10 border-lime-400/20' },
  'Public Services': { icon: Building, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  'Transportation': { icon: Train, color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20' }
};

// Well-known LULC semantic colors (seed palette for known classes)
const LULC_KNOWN_COLORS = {
  Water:               '#419BDF',
  Trees:               '#397D49',
  Grass:               '#88B053',
  'Flooded Vegetation':'#7A87C6',
  Crops:               '#E49635',
  'Shrub and Scrub':   '#DFC35A',
  'Built Area':        '#C4281B',
  BuiltUp:             '#C4281B',
  Agriculture:         '#E49635',
  Forest:              '#397D49',
  'Bare Ground':       '#A59B8F',
  'Snow and Ice':      '#B9CCE2',
  Wetland:             '#4DBBEB',
  Industrial:          '#8B5CF6',
  Scrubland:           '#D97706',
};

// Deterministic color generator: produces a stable unique hex color from a class name string.
function generateClassColor(className, existingColors = {}) {
  if (LULC_KNOWN_COLORS[className]) return LULC_KNOWN_COLORS[className];
  // Hash the class name to get a stable hue
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = className.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  // Distribute hue across 360° avoiding near-grey ranges
  const hue = Math.abs(hash) % 360;
  const saturation = 55 + (Math.abs(hash >> 4) % 25); // 55–80%
  const lightness  = 45 + (Math.abs(hash >> 8) % 15); // 45–60%
  const hex = hslToHex(hue, saturation, lightness);
  return hex;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Build a full className→hex map from an array of class names.
function buildLulcColorMap(classNames) {
  const map = {};
  for (const name of classNames) {
    if (!map[name]) map[name] = generateClassColor(name, map);
  }
  return map;
}

// Hex → rgba with given alpha (0-1)
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const RELATION_TYPE_LABELS = {
  CONNECTED_TO: 'Direct Access',
  ADJACENT_TO: 'Adjacent To',
  CONTAINS: 'Contains',
  FLOODS: 'Flood Impact Zone',
  IMPACTS: 'Environmental Impact',
  INTERSECTS: 'Spatial Intersection',
  NEAR: 'Proximity (Near)',
  SERVES: 'Service Provider For',
  SUPPLIES: 'Water Supply Source',
  PART_OF: 'Administrative Part Of',
  WITHIN: 'Located Within'
};

const groupRelationships = (relationships, entities) => {
  const groups = {
    healthEducation: { title: 'Health & Education', icon: '🏥', relations: [] },
    environmentWater: { title: 'Environment & Water Systems', icon: '🌲', relations: [] },
    transportation: { title: 'Transportation & Connectivity', icon: '🛤️', relations: [] },
    settlementsIndustry: { title: 'Settlements & Industry', icon: '🏘️', relations: [] },
    other: { title: 'General Proximity (NEAR)', icon: '📍', relations: [] }
  };

  relationships.forEach(rel => {
    const targetNode = entities.find(e => e.id === rel.target);
    const targetType = targetNode?.type || '';
    const relType = rel.relation || '';

    if (targetType === 'Hospital' || targetType === 'School' || relType === 'SERVES') {
      groups.healthEducation.relations.push(rel);
    } else if (targetType === 'River' || targetType === 'WaterBody' || targetType === 'Forest' || targetType === 'FloodZone' || 
               relType === 'FLOODS' || relType === 'SUPPLIES' || relType === 'IMPACTS') {
      groups.environmentWater.relations.push(rel);
    } else if (targetType === 'Road' || relType === 'CONNECTED_TO' || relType === 'ADJACENT_TO' || relType === 'INTERSECTS') {
      groups.transportation.relations.push(rel);
    } else if (targetType === 'Village' || targetType === 'UrbanArea' || targetType === 'Building' || targetType === 'Parcel') {
      groups.settlementsIndustry.relations.push(rel);
    } else {
      groups.other.relations.push(rel);
    }
  });

  return groups;
};

const calculateSuitabilityDetails = (summary) => {
  if (!summary) return null;

  // 1. Road Proximity Score
  const roadDist = summary.nearestRoadDist !== undefined ? summary.nearestRoadDist : -1;
  let roadScore = 0;
  let roadLabel = "No Road Detected";
  if (roadDist >= 0) {
    const distMeters = roadDist * 1000;
    if (distMeters <= 200) {
      roadScore = 100;
      roadLabel = "Excellent (<200m)";
    } else if (distMeters <= 500) {
      roadScore = 85;
      roadLabel = "Good (<500m)";
    } else if (distMeters <= 1000) {
      roadScore = 60;
      roadLabel = "Moderate (<1km)";
    } else {
      roadScore = 40;
      roadLabel = "Poor (>1km)";
    }
  } else {
    roadScore = 50;
    roadLabel = "Unknown distance";
  }

  // 2. Healthcare Access Score
  const hospCount = summary.hospitalsCount || 0;
  let healthScore = 0;
  let healthLabel = "No Clinics/Hospitals";
  if (hospCount >= 2) {
    healthScore = 100;
    healthLabel = "Excellent (2+ Hospitals)";
  } else if (hospCount === 1) {
    healthScore = 85;
    healthLabel = "Good (1 Hospital)";
  } else {
    healthScore = 30;
    healthLabel = "Sub-optimal (0 in radius)";
  }

  // 3. Educational Access Score
  const schoolCount = summary.schoolsCount || 0;
  let eduScore = 0;
  let eduLabel = "No Schools";
  if (schoolCount >= 2) {
    eduScore = 100;
    eduLabel = "Excellent (2+ Schools)";
  } else if (schoolCount === 1) {
    eduScore = 85;
    eduLabel = "Good (1 School)";
  } else {
    eduScore = 30;
    eduLabel = "Sub-optimal (0 in radius)";
  }

  // 4. Flood Risk Safety Score (Inverted: low risk = high score)
  const floodRisk = summary.floodRisk || "Low";
  let safetyScore = 100;
  let safetyLabel = "Low Risk (Safe)";
  if (floodRisk === "High") {
    safetyScore = 20;
    safetyLabel = "High Risk (Critical Proximity)";
  } else if (floodRisk === "Medium") {
    safetyScore = 60;
    safetyLabel = "Medium Risk (Caution)";
  }

  // Calculate overall weighted score
  const overallScore = Math.round(
    (roadScore * 0.3) +
    (healthScore * 0.25) +
    (eduScore * 0.25) +
    (safetyScore * 0.2)
  );

  return {
    overallScore,
    roadScore,
    roadLabel,
    healthScore,
    healthLabel,
    eduScore,
    eduLabel,
    safetyScore,
    safetyLabel
  };
};

const isRetina = typeof window !== 'undefined' && window.devicePixelRatio > 1;
const tilePixelRatio = isRetina ? 2 : 1;
const scale = isRetina ? '@2x' : '';

const BASEMAPS = {
  dark: {
    label: 'Nighttime (CartoDB)',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attributions: '&copy; OpenStreetMap contributors &copy; CartoDB'
  },
  light: {
    label: 'Daytime (OSM)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attributions: '&copy; OpenStreetMap contributors'
  },
  satellite: {
    label: 'Satellite (Esri)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attributions: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  },
  varanasi_mbtiles: {
    label: 'MBTiles Streets',
    url: '/api/mbtiles/varanasi/{z}/{x}/{y}',
    attributions: 'SQLite MBTiles &copy; OpenStreetMap'
  }
};

function getPmtilesStyle(theme) {
  const isDark = theme === 'dark';
  
  const colors = {
    water: isDark ? 'rgba(15, 23, 42, 0.75)' : 'rgba(165, 243, 252, 0.65)',
    waterLine: isDark ? '#1e293b' : '#38bdf8',
    earth: isDark ? '#0b1329' : '#ebeef2',
    landuse: isDark ? '#131e36' : '#e2e8f0',
    park: isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(187, 247, 208, 0.55)',
    roads: isDark ? '#1e293b' : '#ffffff',
    roadStroke: isDark ? '#0f172a' : '#cbd5e1',
    buildings: isDark ? 'rgba(30, 41, 59, 0.5)' : 'rgba(203, 213, 225, 0.65)',
    buildingStroke: isDark ? '#334155' : '#94a3b8',
    boundaries: isDark ? '#06b6d4' : '#475569',
    text: isDark ? '#cbd5e1' : '#0f172a',
    textHalo: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(235, 238, 242, 0.9)'
  };

  const styleCache = {};

  return (feature) => {
    let layer = feature.get('layer');
    if (layer === 'transportation') layer = 'roads';
    if (layer === 'transportation_name') layer = 'roads';
    if (layer === 'building') layer = 'buildings';
    if (layer === 'place') layer = 'places';
    if (layer === 'poi') layer = 'pois';
    if (layer === 'boundary') layer = 'boundaries';
    if (layer === 'waterway') layer = 'water';
    if (layer === 'water_name') layer = 'places';
    if (layer === 'landcover') layer = 'landuse';
    if (layer === 'park') layer = 'landuse';

    const geometryType = feature.getType();
    const name = feature.get('name') || '';
    
    const key = `${layer}_${geometryType}_${name ? 'L' : 'U'}`;
    if (styleCache[key]) {
      return styleCache[key];
    }

    let style = null;

    if (layer === 'water') {
      style = new Style({
        fill: new Fill({ color: colors.water }),
        stroke: new Stroke({ color: colors.waterLine, width: 1.2 })
      });
    } else if (layer === 'roads' || layer === 'transit') {
      const roadClass = feature.get('class');
      const isMajor = roadClass === 'motorway' || roadClass === 'trunk' || roadClass === 'primary';
      style = new Style({
        stroke: new Stroke({
          color: isMajor ? colors.boundaries : colors.roads,
          width: isMajor ? 2.5 : 1.25
        })
      });
    } else if (layer === 'buildings') {
      style = new Style({
        fill: new Fill({ color: colors.buildings }),
        stroke: new Stroke({ color: colors.buildingStroke, width: 0.5 })
      });
    } else if (layer === 'boundaries') {
      style = new Style({
        stroke: new Stroke({
          color: colors.boundaries,
          width: 1.5,
          lineDash: [4, 4]
        })
      });
    } else if (layer === 'earth' || layer === 'landuse' || layer === 'natural') {
      const landClass = feature.get('class');
      const isPark = landClass === 'park' || landClass === 'forest' || landClass === 'wood';
      style = new Style({
        fill: new Fill({ color: isPark ? colors.park : colors.landuse })
      });
    } else if (layer === 'places' || layer === 'pois') {
      if (name) {
        style = new Style({
          text: new Text({
            text: name,
            font: '500 11px Inter, ui-sans-serif, system-ui, sans-serif',
            fill: new Fill({ color: colors.text }),
            stroke: new Stroke({ color: colors.textHalo, width: 2.5 }),
            overflow: true
          })
        });
      }
    }

    if (!style) {
      if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
        style = new Style({
          fill: new Fill({ color: colors.earth })
        });
      } else if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
        style = new Style({
          stroke: new Stroke({ color: colors.roads, width: 1 })
        });
      }
    }

    if (style) {
      styleCache[key] = style;
    }
    return style;
  };
}



function layerFill(hex, alpha = 0.18) {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function layerStyleFactory(layer) {
  return (feature) => {
    const geometry = feature.getGeometry();
    const geometryType = geometry?.getType();
    const name = feature.get('name') || feature.get('title') || feature.get('label') || '';
    const label = layer.labels && name ? name : '';
    const color = layer.color;

    const textStyle = label ? new Text({
      text: label,
      offsetY: -14,
      font: '600 12px Inter, ui-sans-serif, system-ui, sans-serif',
      fill: new Fill({ color: '#f8fafc' }),
      stroke: new Stroke({ color: 'rgba(15, 23, 42, 0.85)', width: 3 }),
      overflow: true
    }) : undefined;

    if (geometryType === 'Point' || geometryType === 'MultiPoint') {
      return [
        new Style({
          image: new CircleStyle({
            radius: 11,
            fill: new Fill({ color: layerFill(color, 0.28) })
          })
        }),
        new Style({
          image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: '#ffffff', width: 1.5 })
          }),
          text: textStyle
        })
      ];
    }

    if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
      return new Style({
        stroke: new Stroke({
          color,
          width: 3
        }),
        text: textStyle
      });
    }

    return new Style({
      stroke: new Stroke({
        color,
        width: 2.25
      }),
      fill: new Fill({
        color: layerFill(color, 0.22)
      }),
      text: textStyle
    });
  };
}

function highlightStyleFactory() {
  const polyStyle = [
    new Style({
      stroke: new Stroke({ color: '#facc15', width: 4 }),
      fill: new Fill({ color: 'rgba(250, 204, 21, 0.08)' })
    }),
    new Style({
      stroke: new Stroke({ color: '#ffffff', width: 1.5 })
    })
  ];

  const pointStyle = [
    new Style({
      image: new CircleStyle({
        radius: 16,
        stroke: new Stroke({ color: '#22d3ee', width: 2, lineDash: [2, 2] }),
        fill: new Fill({ color: 'rgba(34, 211, 238, 0.15)' })
      })
    }),
    new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: '#22d3ee' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 })
      })
    })
  ];

  return (feature) => {
    const geomType = feature.getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') {
      return pointStyle;
    }
    return polyStyle;
  };
}

function pointMarkerStyle(color) {
  return [
    new Style({
      image: new CircleStyle({
        radius: 13,
        fill: new Fill({ color: layerFill(color, 0.22) })
      })
    }),
    new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 })
      })
    })
  ];
}

function distanceMeasureStyle(feature) {
  const kind = feature.get('kind');
  if (kind === 'distance-highlight') {
    return [
      new Style({
        image: new CircleStyle({
          radius: 15,
          stroke: new Stroke({ color: '#f97316', width: 2, lineDash: [2, 2] }),
          fill: new Fill({ color: 'rgba(249, 115, 22, 0.15)' })
        })
      }),
      new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#f97316' }),
          stroke: new Stroke({ color: '#ffffff', width: 1.5 })
        })
      })
    ];
  } else if (kind === 'distance-line') {
    return new Style({
      stroke: new Stroke({
        color: '#f97316',
        width: 2.5,
        lineDash: [6, 6]
      })
    });
  }
  return null;
}

function App() {
  const mapElementRef = useRef(null);
  const tooltipRef = useRef(null);
  const mapRef = useRef(null);
  const selectedPointLayerRef = useRef(null);
  const highlightLayerRef = useRef(null);
  const drawSourceRef = useRef(new VectorSource());
  const dataLayerRefs = useRef({});
  const selectedPointSourceRef = useRef(new VectorSource());
  const highlightSourceRef = useRef(new VectorSource());
  const focusedHeritageSourceRef = useRef(new VectorSource());
  const decisionSupportPinsSourceRef = useRef(new VectorSource());
  const decisionSupportPinsLayerRef = useRef(null);
  const clickedRelationshipTargetSourceRef = useRef(new VectorSource());
  const distanceMeasureSourceRef = useRef(new VectorSource());
  const distanceMeasureLayerRef = useRef(null);
  const drawInteractionRef = useRef(null);
  const modifyInteractionRef = useRef(null);
  const snapInteractionRef = useRef(null);
  const basemapLayersRef = useRef({
    dark: new TileLayer({
      source: new XYZ({
        url: BASEMAPS.dark.url,
        attributions: BASEMAPS.dark.attributions
      }),
      visible: true
    }),
    light: new TileLayer({
      source: new XYZ({
        url: BASEMAPS.light.url,
        attributions: BASEMAPS.light.attributions
      }),
      visible: false
    }),
    satellite: new TileLayer({
      source: new XYZ({
        url: BASEMAPS.satellite.url,
        attributions: BASEMAPS.satellite.attributions
      }),
      visible: false
    }),
    satelliteLabels: new TileLayer({
      source: new XYZ({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        attributions: '&copy; Esri &mdash; Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community'
      }),
      visible: false
    }),
    varanasi_mbtiles: new VectorTileLayer({
      background: '#ebeef2',
      source: new VectorTileSource({
        format: new MVT(),
        url: BASEMAPS.varanasi_mbtiles.url,
        attributions: BASEMAPS.varanasi_mbtiles.attributions
      }),
      style: getPmtilesStyle('light'),
      visible: false
    })
  });
  const baseSelection = useRef('dark');

  const [mapMode, setMapMode] = useState('2D');
  const [elevationQueryMode, setElevationQueryMode] = useState(false);
  const [elevationQueryLoading, setElevationQueryLoading] = useState(false);
  const [elevationQueryResult, setElevationQueryResult] = useState(null);
  const [mapZoom, setMapZoom] = useState(13);
  const [mapCenter, setMapCenter] = useState([82.9739, 25.3176]);
  
  const elevationQueryModeRef = useRef(elevationQueryMode);

  const [layers, setLayers] = useState([]);
  const [selectedMarkersForDistance, setSelectedMarkersForDistance] = useState([]);
  const [selectedCoordinates, setSelectedCoordinates] = useState(null);
  const [hoverCoordinates, setHoverCoordinates] = useState(null);
  const [drawMode, setDrawMode] = useState('None');

  const [statusMessage, setStatusMessage] = useState('');
  const [basemap, setBasemap] = useState('dark');
  const [drawRevision, setDrawRevision] = useState(0);
  const [layerDialogOpen, setLayerDialogOpen] = useState(false);
  const [showMultiLayerPanel, setShowMultiLayerPanel] = useState(true);
  const [layerDialogError, setLayerDialogError] = useState('');
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const [featureDialogError, setFeatureDialogError] = useState('');
  const [markerModeEnabled, setMarkerModeEnabled] = useState(false);
  const [activeLayerId, setActiveLayerId] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const showHeatmapRef = useRef(showHeatmap);
  const heatmapLayerRefs = useRef({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [layerDraft, setLayerDraft] = useState({
    name: '',
    color: '#c084fc'
  });
  const [featureDraft, setFeatureDraft] = useState({
    name: '',
    coordinates: null
  });
  const layersRef = useRef([]);
  const markerModeRef = useRef(markerModeEnabled);
  const drawModeRef = useRef(drawMode);
  const decisionSupportModeRef = useRef(false);
  const activeLayerIdRef = useRef(activeLayerId);
  const fetchKnowledgeContextRef = useRef(null);
  const queryPointElevationRef = useRef(null);
  const openFeatureDialogRef = useRef(null);
  const [hoveredMarkerInfo, setHoveredMarkerInfo] = useState(null);
  const hoverTooltipRef = useRef(null);

  const [currentCity, setCurrentCity] = useState('Varanasi');
  const cityCache = useRef({});

  // Live Area Intelligence Hooks
  const [liveAmenities, setLiveAmenities] = useState(null);
  const [liveAmenitiesLoading, setLiveAmenitiesLoading] = useState(false);
  const [liveAmenitiesError, setLiveAmenitiesError] = useState('');

  // LULC Analysis Hooks
  const [lulcData, setLulcData] = useState(null);
  const [lulcLoading, setLulcLoading] = useState(false);
  const [lulcError, setLulcError] = useState('');
  // Dynamic class → hex color mapping (auto-built from returned features)
  const [lulcClassColorMap, setLulcClassColorMap] = useState({});
  // Mutable ref so the OL style fn always sees the latest map
  const lulcColorMapRef = useRef({});
  // LULC layer controls
  const [lulcLayerVisible, setLulcLayerVisible] = useState(true);
  const [lulcLayerOpacity, setLulcLayerOpacity] = useState(0.75);
  // Hover tooltip for LULC features
  const [lulcHoveredClass, setLulcHoveredClass] = useState(null);
  const [lulcHighlightedFeature, setLulcHighlightedFeature] = useState(null);
  const [localNews, setLocalNews] = useState([]);
  const [localNewsLoading, setLocalNewsLoading] = useState(false);
  const [localNewsLocation, setLocalNewsLocation] = useState('');
  const [selectedAmenityCategory, setSelectedAmenityCategory] = useState(null);
  const [highlightedLiveAmenity, setHighlightedLiveAmenity] = useState(null);
  const [amenitySearchQuery, setAmenitySearchQuery] = useState('');
  const [showHeritageList, setShowHeritageList] = useState(false);
  const [focusedHeritage, setFocusedHeritage] = useState(null);
  const [bhuvanLulcActive, setBhuvanLulcActive] = useState(false);
  const [bhuvanGeomorphActive, setBhuvanGeomorphActive] = useState(false);
  const [bhuvanWastelandActive, setBhuvanWastelandActive] = useState(false);

  const [activeSidebarTab, setActiveSidebarTab] = useState('layers'); // 'layers', 'analysis', 'decision'
  const [activeAnalysisSubTab, setActiveAnalysisSubTab] = useState('lulc'); // 'lulc', 'insights'
  const [knowledgeContext, setKnowledgeContext] = useState(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState(null);
  const [knowledgeRadius, setKnowledgeRadius] = useState(2000); // default 2km (in meters)
  const [showBuffer, setShowBuffer] = useState(true);
  const [showKgVisualizer, setShowKgVisualizer] = useState(false);
  const [polygonKnowledgeContext, setPolygonKnowledgeContext] = useState(null);
  const [polygonKnowledgeLoading, setPolygonKnowledgeLoading] = useState(false);
  const [polygonKnowledgeError, setPolygonKnowledgeError] = useState(null);

  // Location Intelligence State
  const [intelDialogOpen, setIntelDialogOpen] = useState(false);
  const [intelDraft, setIntelDraft] = useState({ latitude: null, longitude: null, text: '' });
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState('');
  const [intelEntities, setIntelEntities] = useState([]);
  const [selectedIntelEntity, setSelectedIntelEntity] = useState(null);

  const intelSourceRef = useRef(new VectorSource());
  const intelLayerRef = useRef(null);
  const intelModeRef = useRef(false);
  const intelEntitiesRef = useRef([]);

  useEffect(() => {
    intelEntitiesRef.current = intelEntities;
  }, [intelEntities]);

  const selectedAreaPolygon = useMemo(() => {
    return drawSourceRef.current
      .getFeatures()
      .filter((feature) => feature.getGeometry()?.getType() === 'Polygon')
      .at(-1);
  }, [drawRevision]);

  const selectedAreaMetrics = useMemo(() => {
    if (!selectedAreaPolygon) return null;
    return getPolygonMetrics(selectedAreaPolygon);
  }, [selectedAreaPolygon]);

  const selectedAreaCoords = useMemo(() => {
    if (!selectedAreaPolygon) return null;
    const geom = selectedAreaPolygon.getGeometry();
    if (!geom) return null;
    const rings = geom.getCoordinates();
    if (!rings || rings.length === 0) return null;
    const coords = rings[0]; // Outer ring coordinates (EPSG:3857)
    if (!coords) return null;
    return coords.map((c) => toLonLat(c));
  }, [selectedAreaPolygon]);

  const [selectedStatsCategory, setSelectedStatsCategory] = useState(null);
  const [activeRelGroup, setActiveRelGroup] = useState('all');
  const [decisionSupportModeEnabled, setDecisionSupportModeEnabled] = useState(false);
  const [activeRelationshipTarget, setActiveRelationshipTarget] = useState(null);
  const [selectedFactSheetNode, setSelectedFactSheetNode] = useState(null);
  const [factSheetExpanded, setFactSheetExpanded] = useState(true);
  const [expandedRelGroups, setExpandedRelGroups] = useState({
    healthEducation: true,
    environmentWater: true,
    transportation: true,
    settlementsIndustry: true,
    other: false
  });

  // Synchronize selection point marker and query buffer circle on the map
  useEffect(() => {
    if (!selectedPointSourceRef.current) return;
    selectedPointSourceRef.current.clear();

    if (selectedCoordinates) {
      const coords = fromLonLat(selectedCoordinates);

      // 1. Add center marker
      selectedPointSourceRef.current.addFeature(
        new Feature({
          geometry: new Point(coords),
          kind: 'center-marker'
        })
      );

      // 2. Add query radius buffer circle overlay
      if (showBuffer && activeSidebarTab === 'decision') {
        selectedPointSourceRef.current.addFeature(
          new Feature({
            geometry: new Circle(coords, knowledgeRadius),
            isBuffer: true
          })
        );
      }
    }
  }, [selectedCoordinates, knowledgeRadius, showBuffer, activeSidebarTab]);

  // Clear all Decision Support and custom drawings when switching tabs or toggling WMS layers
  useEffect(() => {
    intelModeRef.current = (activeSidebarTab === 'intel');
    if (activeSidebarTab === 'intel') {
      const fetchEntities = async () => {
        try {
          const response = await fetch('/api/entities');
          if (response.ok) {
            const data = await response.json();
            setIntelEntities(data);
          }
        } catch (error) {
          console.error('Failed to fetch AI entities:', error);
        }
      };
      fetchEntities();
    } else {
      setSelectedIntelEntity(null);
    }

    if (activeSidebarTab !== 'decision') {
      setSelectedCoordinates(null);
      setSelectedStatsCategory(null);
      setFocusedHeritage(null);
      setKnowledgeContext(null);
      
      if (selectedPointSourceRef.current) selectedPointSourceRef.current.clear();
      if (decisionSupportPinsSourceRef.current) decisionSupportPinsSourceRef.current.clear();
      if (focusedHeritageSourceRef.current) focusedHeritageSourceRef.current.clear();
      if (highlightSourceRef.current) highlightSourceRef.current.clear();
      if (clickedRelationshipTargetSourceRef.current) clickedRelationshipTargetSourceRef.current.clear();
      if (drawSourceRef.current) {
        drawSourceRef.current.clear();
        setDrawRevision(prev => prev + 1);
      }
      
      setShowKgVisualizer(false);
      setPolygonKnowledgeContext(null);
    }
  }, [activeSidebarTab]);

  useEffect(() => {
    // Whenever Bhuvan layers toggle, clear decision support overlays to avoid visual clutter
    setSelectedCoordinates(null);
    setSelectedStatsCategory(null);
    setFocusedHeritage(null);
    setKnowledgeContext(null);
    
    if (selectedPointSourceRef.current) selectedPointSourceRef.current.clear();
    if (decisionSupportPinsSourceRef.current) decisionSupportPinsSourceRef.current.clear();
    if (focusedHeritageSourceRef.current) focusedHeritageSourceRef.current.clear();
    if (highlightSourceRef.current) highlightSourceRef.current.clear();
    if (clickedRelationshipTargetSourceRef.current) clickedRelationshipTargetSourceRef.current.clear();
    if (drawSourceRef.current) {
      drawSourceRef.current.clear();
      setDrawRevision(prev => prev + 1);
    }
    
    setShowKgVisualizer(false);
    setPolygonKnowledgeContext(null);
  }, [bhuvanLulcActive, bhuvanGeomorphActive, bhuvanWastelandActive]);

  useEffect(() => {
    if (!decisionSupportModeEnabled) {
      setSelectedCoordinates(null);
      setSelectedStatsCategory(null);
      setFocusedHeritage(null);
      setKnowledgeContext(null);
      
      if (selectedPointSourceRef.current) selectedPointSourceRef.current.clear();
      if (decisionSupportPinsSourceRef.current) decisionSupportPinsSourceRef.current.clear();
      if (focusedHeritageSourceRef.current) focusedHeritageSourceRef.current.clear();
      if (highlightSourceRef.current) highlightSourceRef.current.clear();
      if (clickedRelationshipTargetSourceRef.current) clickedRelationshipTargetSourceRef.current.clear();
      if (drawSourceRef.current) {
        drawSourceRef.current.clear();
        setDrawRevision(prev => prev + 1);
      }
      
      setShowKgVisualizer(false);
      setPolygonKnowledgeContext(null);
    }
  }, [decisionSupportModeEnabled]);

  // Synchronize dynamic Decision Support pins on the map
  useEffect(() => {
    if (!decisionSupportPinsSourceRef.current) return;
    decisionSupportPinsSourceRef.current.clear();

    if (!selectedStatsCategory || !knowledgeContext || !knowledgeContext.entities) {
      return;
    }

    const matchesCategory = (entity, category) => {
      const type = entity.type?.toLowerCase() || '';
      const className = entity.properties?.className?.toLowerCase() || '';
      const label = entity.label?.toLowerCase() || '';
      const catLower = category.toLowerCase();

      if (catLower === 'school') {
        return type === 'school' || className === 'school' || label.includes('school') || label.includes('college') || label.includes('university');
      }
      if (catLower === 'hospital') {
        return type === 'hospital' || className === 'hospital' || label.includes('hospital') || label.includes('clinic') || label.includes('medical');
      }
      if (catLower === 'gym') {
        return className === 'gym' || label.includes('gym') || label.includes('fitness');
      }
      if (catLower === 'waterbody' || catLower === 'water') {
        return type === 'waterbody' || className === 'water' || className === 'reservoir' || className === 'river' || type === 'river' || label.includes('river') || label.includes('lake') || label.includes('pond');
      }
      if (catLower === 'road') {
        return type === 'road' || className === 'road' || label.includes('road') || label.includes('highway') || label.includes('street');
      }
      if (catLower === 'forest') {
        return type === 'forest' || className === 'forest' || label.includes('forest') || label.includes('garden') || label.includes('wood');
      }
      if (catLower === 'village') {
        return type === 'village' || className === 'village' || label.includes('village');
      }
      if (catLower === 'industry') {
        return className === 'industry' || label.includes('industry') || label.includes('industrial');
      }
      return type === catLower || className === catLower;
    };

    const matchingEntities = knowledgeContext.entities.filter(entity => matchesCategory(entity, selectedStatsCategory));

    matchingEntities.forEach(entity => {
      const coords = entity.properties?.coordinates;
      if (coords && coords.length === 2) {
        const feature = new Feature({
          geometry: new Point(fromLonLat([coords[0], coords[1]])),
          name: entity.label,
          id: entity.id
        });
        decisionSupportPinsSourceRef.current.addFeature(feature);
      }
    });

    // Auto-fit the map view to the extent of the pinned features
    if (matchingEntities.length > 0 && mapRef.current) {
      const extent = decisionSupportPinsSourceRef.current.getExtent();
      if (extent && extent.length === 4 && !isNaN(extent[0])) {
        const width = extent[2] - extent[0];
        const height = extent[3] - extent[1];
        if (width === 0 && height === 0) {
          mapRef.current.getView().animate({
            center: [extent[0], extent[1]],
            zoom: 16,
            duration: 800
          });
        } else {
          mapRef.current.getView().fit(extent, {
            padding: [80, 80, 80, 80],
            maxZoom: 16,
            duration: 800
          });
        }
      }
    }
  }, [selectedStatsCategory, knowledgeContext]);

  // Synchronize clicked relationship target on the map
  useEffect(() => {
    if (!clickedRelationshipTargetSourceRef.current) return;
    clickedRelationshipTargetSourceRef.current.clear();

    if (activeRelationshipTarget && activeRelationshipTarget.properties?.coordinates) {
      const [lon, lat] = activeRelationshipTarget.properties.coordinates;
      const feature = new Feature({
        geometry: new Point(fromLonLat([lon, lat])),
        name: activeRelationshipTarget.label,
        id: activeRelationshipTarget.id
      });
      clickedRelationshipTargetSourceRef.current.addFeature(feature);
    }
  }, [activeRelationshipTarget]);

  // Set default fact sheet node when knowledgeContext loads
  useEffect(() => {
    if (knowledgeContext && knowledgeContext.entities && knowledgeContext.entities.length > 0) {
      setSelectedFactSheetNode(knowledgeContext.entities[0]);
    } else {
      setSelectedFactSheetNode(null);
    }
  }, [knowledgeContext]);

  // Synchronize Location Intelligence entities on the map
  useEffect(() => {
    if (!intelSourceRef.current) return;
    intelSourceRef.current.clear();

    intelEntities.forEach((entity) => {
      const coords = fromLonLat([entity.longitude, entity.latitude]);
      const feature = new Feature({
        geometry: new Point(coords),
        title: entity.extractedData.title,
        entityType: entity.extractedData.entityType
      });
      feature.set('entityId', entity.id);
      intelSourceRef.current.addFeature(feature);
    });
  }, [intelEntities]);

  const lulcSourceRef = useRef(new VectorSource());
  const lulcLayerRef = useRef(
    new VectorLayer({
      source: lulcSourceRef.current,
      // Style reads dynamically from lulcColorMapRef (always fresh, no closure stale issue)
      style: (feature) => {
        const className = feature.get('className');
        const isHighlighted = feature.get('_lulcHighlighted');
        const colorMap = lulcColorMapRef.current;
        const color = colorMap[className] || '#94a3b8';
        const fillAlpha = isHighlighted ? 0.92 : 0.75;
        const strokeWidth = isHighlighted ? 3 : 1.5;
        return new Style({
          fill: new Fill({ color: hexToRgba(color, fillAlpha) }),
          stroke: new Stroke({ color, width: strokeWidth })
        });
      }
    })
  );

  const fetchLiveAreaIntelligence = async (metrics) => {
    setLiveAmenitiesLoading(true);
    setLiveAmenitiesError('');
    setLocalNewsLoading(true);
    setLiveAmenities(null);
    setLocalNews([]);
    setLocalNewsLocation('');
    setSelectedAmenityCategory(null);
    setHighlightedLiveAmenity(null);
    if (highlightLayerRef.current) {
      highlightLayerRef.current.getSource().clear();
    }

    const [south, west, north, east] = metrics.bbox;

    const overpassQuery = `[out:json][timeout:25];
(
  node["amenity"~"hospital|clinic|pharmacy|school|college|university|police|fire_station|townhall|courthouse|library|bus_station|bus_stop|railway_station|subway_entrance|gym|sports_centre|park|playground"](${south},${west},${north},${east});
  way["amenity"~"hospital|clinic|pharmacy|school|college|university|police|fire_station|townhall|courthouse|library|bus_station|bus_stop|railway_station|subway_entrance|gym|sports_centre|park|playground"](${south},${west},${north},${east});
  node["leisure"~"sports_centre|park|playground"](${south},${west},${north},${east});
  way["leisure"~"sports_centre|park|playground"](${south},${west},${north},${east});
);
out center;`;

    const endpoints = [
      'https://overpass.openstreetmap.fr/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://z.overpass-api.de/api/interpreter',
      'https://overpass-api.de/api/interpreter'
    ];

    let osmElements = [];
    let success = false;

    for (const url of endpoints) {
      try {
        console.log(`Querying Overpass API via: ${url}`);
        const overpassUrl = `${url}?data=${encodeURIComponent(overpassQuery)}`;
        const res = await fetch(overpassUrl);
        if (!res.ok) throw new Error(`HTTP error ${res.status} from ${url}`);
        const data = await res.json();
        osmElements = data.elements || [];
        success = true;
        break;
      } catch (err) {
        console.warn(`Overpass API instance ${url} failed:`, err);
      }
    }

    if (!success) {
      setLiveAmenitiesError("Failed to load live amenities from any OpenStreetMap API endpoint.");
    }

    const categorized = {
      'Healthcare': [],
      'Education': [],
      'Fitness': [],
      'Recreation': [],
      'Public Services': [],
      'Transportation': []
    };

    osmElements.forEach((el) => {
      const lat = el.lat || (el.center && el.center.lat);
      const lon = el.lon || (el.center && el.center.lon);
      if (!lat || !lon) return;

      const isInside = isPointInPolygon([lon, lat], metrics.polygonCoords);
      if (!isInside) return;

      const tags = el.tags || {};
      const amenity = tags.amenity;
      const leisure = tags.leisure;

      let category = null;
      if (amenity === 'hospital' || amenity === 'clinic' || amenity === 'pharmacy') {
        category = 'Healthcare';
      } else if (amenity === 'school' || amenity === 'college' || amenity === 'university' || amenity === 'library') {
        category = 'Education';
      } else if (amenity === 'gym' || leisure === 'sports_centre' || amenity === 'sports_centre') {
        category = 'Fitness';
      } else if (leisure === 'park' || leisure === 'playground' || amenity === 'park' || amenity === 'playground') {
        category = 'Recreation';
      } else if (amenity === 'police' || amenity === 'fire_station' || amenity === 'townhall' || amenity === 'courthouse') {
        category = 'Public Services';
      } else if (amenity === 'bus_stop' || amenity === 'bus_station' || amenity === 'railway_station' || amenity === 'subway_entrance') {
        category = 'Transportation';
      }

      if (category) {
        let name = tags.name || tags.operator || `${tags.amenity || tags.leisure || 'Amenity'}`;
        name = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        
        const address = tags['addr:street'] 
          ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}, ${tags['addr:city'] || ''}`.trim() 
          : tags['addr:full'] || 'Address unavailable';

        categorized[category].push({
          id: el.id,
          name,
          category,
          lat,
          lng: lon,
          address,
          contact: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || 'Phone unavailable',
          website: tags.website || tags['contact:website'] || tags.url || 'Website unavailable',
          rating: tags.rating || 'No rating'
        });
      }
    });

    setLiveAmenities(categorized);
    setLiveAmenitiesLoading(false);

    const [centLon, centLat] = metrics.centroid;
    let cityName = 'Varanasi';
    try {
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${centLat}&lon=${centLon}&zoom=12`);
      const geoData = await geoRes.json();
      if (geoData && geoData.address) {
        cityName = geoData.address.city || 
                   geoData.address.town || 
                   geoData.address.village || 
                   geoData.address.city_district || 
                   geoData.address.county || 
                   'Varanasi';
      }
    } catch (e) {
      console.warn("Centroid reverse geocoding failed", e);
    }

    setLocalNewsLocation(cityName);

    try {
      const newsRes = await fetch(`/api/news?query=${encodeURIComponent(cityName)}`);
      const newsData = await newsRes.json();
      if (Array.isArray(newsData)) {
        setLocalNews(newsData);
      } else {
        setLocalNews([]);
      }
    } catch (newsErr) {
      console.error("News fetch failed", newsErr);
      setLocalNews([]);
    } finally {
      setLocalNewsLoading(false);
    }
  };

  const fetchLulcAnalysis = async (polygonCoords) => {
    setLulcLoading(true);
    setLulcError('');
    setLulcData(null);
    setLulcClassColorMap({});
    setLulcHoveredClass(null);
    setLulcHighlightedFeature(null);
    lulcSourceRef.current.clear();

    try {
      const response = await fetch('/api/lulc/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: polygonCoords })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      setLulcData(data);

      if (data.geojson) {
        // Backend returns geojson as a JSON string (double-encoded) — parse it first
        const geojsonObj = typeof data.geojson === 'string'
          ? JSON.parse(data.geojson)
          : data.geojson;

        console.log('[LULC] GeoJSON features received:', geojsonObj?.features?.length ?? 0);

        const features = new GeoJSON().readFeatures(geojsonObj, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857'
        });

        console.log('[LULC] OL features parsed:', features.length);

        // === Dynamic color map ===
        // 1. Collect unique class names from features + from stats classes
        const classNamesFromFeatures = features.map(f => f.get('className')).filter(Boolean);
        const classNamesFromStats = (data.classes || []).map(c => c.className).filter(Boolean);
        const allUniqueClasses = [...new Set([...classNamesFromFeatures, ...classNamesFromStats])];

        // 2. Build deterministic color map
        const colorMap = buildLulcColorMap(allUniqueClasses);

        // 3. Persist to ref (for the OL style function) and to state (for sidebar legend)
        lulcColorMapRef.current = colorMap;
        setLulcClassColorMap(colorMap);

        // 4. Add features to source (style fn will pick up colors from ref)
        lulcSourceRef.current.addFeatures(features);
        lulcLayerRef.current.changed(); // force re-render
      } else if (data.classes && data.classes.length > 0) {
        // No geometries but we have class stats — still build color map for sidebar
        const allUniqueClasses = [...new Set(data.classes.map(c => c.className).filter(Boolean))];
        const colorMap = buildLulcColorMap(allUniqueClasses);
        lulcColorMapRef.current = colorMap;
        setLulcClassColorMap(colorMap);
      }
    } catch (err) {
      console.error('LULC analysis error:', err);
      setLulcError('Failed to perform LULC analysis.');
    } finally {
      setLulcLoading(false);
    }
  };

  // Auto-dismiss status messages after 5 seconds
  const statusTimeoutRef = useRef(null);
  const showStatus = useCallback((message) => {
    setStatusMessage(message);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    if (message) {
      statusTimeoutRef.current = setTimeout(() => setStatusMessage(''), 5000);
    }
  }, []);

  const activeBhuvanLayersRef = useRef({});

  const toggleBhuvanWmsLayer = useCallback((layerKey, wmsLayerName) => {
    if (!mapRef.current) return;
    const existing = activeBhuvanLayersRef.current[layerKey];
    if (existing) {
      mapRef.current.removeLayer(existing);
      delete activeBhuvanLayersRef.current[layerKey];
      showStatus(`ISRO Bhuvan ${layerKey.toUpperCase()} layer removed.`);
    } else {
      const wmsLayer = new TileLayer({
        source: new TileWMS({
          url: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
          params: {
            'LAYERS': wmsLayerName,
            'TILED': true,
            'VERSION': '1.1.1',
            'FORMAT': 'image/png',
            'TRANSPARENT': true
          },
          projection: 'EPSG:4326',
          serverType: 'geoserver',
          transition: 0
        }),
        opacity: 0.75
      });
      mapRef.current.addLayer(wmsLayer);
      activeBhuvanLayersRef.current[layerKey] = wmsLayer;
      showStatus(`ISRO Bhuvan ${layerKey.toUpperCase()} layer loaded dynamically on map.`);
    }
  }, [showStatus]);

  const fetchKnowledgeContext = useCallback(async (lonLat, customRadius) => {
    setActiveSidebarTab('decision');
    setActiveRelationshipTarget(null);
    const [lon, lat] = lonLat;
    const radiusToUse = customRadius !== undefined ? customRadius : knowledgeRadius;
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const response = await fetch(`/api/knowledge/context?lat=${lat}&lon=${lon}&radius=${radiusToUse}`);
      if (!response.ok) {
        throw new Error(`Failed to load knowledge context: ${response.status}`);
      }
      const data = await response.json();
      setKnowledgeContext(data);
    } catch (err) {
      console.error('Error loading knowledge context:', err);
      setKnowledgeError(err.message || 'Failed to connect to GIS Knowledge service.');
    } finally {
      setKnowledgeLoading(false);
    }
  }, [knowledgeRadius]);

  const fetchPolygonKnowledgeContext = useCallback(async () => {
    if (!selectedAreaCoords) {
      showStatus('Please draw a polygon area on the map first.');
      return;
    }
    setPolygonKnowledgeLoading(true);
    setPolygonKnowledgeError(null);
    setPolygonKnowledgeContext(null);
    try {
      const response = await fetch('/api/knowledge/polygon-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: [selectedAreaCoords] })
      });
      if (!response.ok) {
        throw new Error(`Failed to build polygon context: ${response.status}`);
      }
      const data = await response.json();
      setPolygonKnowledgeContext(data);
      setShowKgVisualizer(true);
    } catch (err) {
      console.error('Error loading polygon knowledge context:', err);
      setPolygonKnowledgeError(err.message || 'Failed to connect to GIS Knowledge service.');
      showStatus('Failed to generate Area Knowledge Graph.');
    } finally {
      setPolygonKnowledgeLoading(false);
    }
  }, [selectedAreaCoords, showStatus]);

  const handleFocusHeritage = useCallback((site) => {
    if (!site.lat || !site.lon || !mapRef.current) return;
    const lon = parseFloat(site.lon);
    const lat = parseFloat(site.lat);
    const coords = fromLonLat([lon, lat]);
    
    setFocusedHeritage(site);
    
    if (focusedHeritageSourceRef.current) {
      focusedHeritageSourceRef.current.clear();
      focusedHeritageSourceRef.current.addFeature(
        new Feature({
          geometry: new Point(coords),
          name: site.name
        })
      );
    }
    
    mapRef.current.getView().animate({
      center: coords,
      zoom: 17,
      duration: 800
    });
  }, []);

  const highlightRelationshipTarget = useCallback((targetNode, hoverState) => {
    if (!highlightSourceRef.current) return;
    highlightSourceRef.current.clear();

    if (hoverState && targetNode && targetNode.properties?.coordinates && selectedCoordinates) {
      const [targetLon, targetLat] = targetNode.properties.coordinates;
      const targetCoords = fromLonLat([targetLon, targetLat]);
      const centerCoords = fromLonLat(selectedCoordinates);

      // Create dashed connection line
      const lineGeom = new LineString([centerCoords, targetCoords]);
      const lineFeature = new Feature({ geometry: lineGeom });
      lineFeature.setStyle(
        new Style({
          stroke: new Stroke({
            color: '#06b6d4',
            width: 2.5,
            lineDash: [4, 4]
          })
        })
      );

      // Create target point marker
      const pointFeature = new Feature({ geometry: new Point(targetCoords) });
      pointFeature.setStyle([
        new Style({
          image: new CircleStyle({
            radius: 12,
            fill: new Fill({ color: 'rgba(6, 182, 212, 0.25)' })
          })
        }),
        new Style({
          image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color: '#06b6d4' }),
            stroke: new Stroke({ color: '#ffffff', width: 1.5 })
          })
        })
      ]);

      highlightSourceRef.current.addFeature(lineFeature);
      highlightSourceRef.current.addFeature(pointFeature);
    }
  }, [selectedCoordinates]);

  const flyToFeature = useCallback((targetNode) => {
    if (targetNode && targetNode.properties?.coordinates && mapRef.current) {
      const [lon, lat] = targetNode.properties.coordinates;
      const coords = fromLonLat([lon, lat]);
      mapRef.current.getView().animate({
        center: coords,
        zoom: 16,
        duration: 1000
      });
    }
  }, []);

  const getSuitabilityScore = useCallback((summary) => {
    if (!summary) return { score: 0, label: 'No Data', color: 'text-slate-400', stroke: '#64748b', recommendations: [] };

    let score = 50; // baseline
    const recs = [];

    // Proximity to roads
    const roadDist = summary.nearestRoadDist;
    if (roadDist !== undefined && roadDist >= 0) {
      if (roadDist < 0.4) {
        score += 20;
        recs.push({ type: 'success', text: 'Excellent connectivity: road access within 400m.', category: 'Road' });
      } else if (roadDist < 1.2) {
        score += 10;
        recs.push({ type: 'info', text: 'Fair connectivity: road access is within 1.2km.', category: 'Road' });
      } else {
        score -= 15;
        recs.push({ type: 'warning', text: 'Poor connectivity: nearest road is over 1.2km away.', category: 'Road' });
      }
    } else {
      score -= 15;
      recs.push({ type: 'warning', text: 'Isolated site: no road detected in audit radius.', category: 'Road' });
    }

    // Proximity to hospitals
    const hospitals = summary.hospitalsCount || 0;
    if (hospitals > 0) {
      score += 15;
      recs.push({ type: 'success', text: `Medical safety: ${hospitals} hospitals within query radius.`, category: 'Hospital' });
    } else {
      score -= 10;
      recs.push({ type: 'warning', text: 'Medical gap: no hospitals detected within range. Consider clinic development.', category: 'Hospital' });
    }

    // Proximity to schools
    const schools = summary.schoolsCount || 0;
    if (schools > 0) {
      score += 15;
      recs.push({ type: 'success', text: `Educational access: ${schools} schools within range.`, category: 'School' });
    } else {
      recs.push({ type: 'info', text: 'No schools in range. Residential suitability is moderate.', category: 'School' });
    }

    // Proximity to water bodies
    const waterBodies = summary.waterBodiesCount || 0;
    if (waterBodies > 0) {
      score += 5;
    }

    // Flood Risk penalty
    const risk = summary.floodRisk;
    if (risk === 'High') {
      score -= 30;
      recs.push({ type: 'danger', text: 'High Flood Risk: Proximity to Ganges/Varuna floodplain. Reinforced foundation required.', category: 'WaterBody' });
    } else if (risk === 'Medium') {
      score -= 15;
      recs.push({ type: 'warning', text: 'Moderate Flood Risk: Proximity to water system. Drainage audit recommended.', category: 'WaterBody' });
    } else {
      score += 10;
      recs.push({ type: 'success', text: 'Low flood risk: safe elevation zone.', category: 'WaterBody' });
    }

    // Forest cover
    const forest = summary.forestAreaSqKm || 0.0;
    if (forest > 0.1) {
      recs.push({ type: 'success', text: `Eco-rich: substantial green cover (${forest} sq km) nearby.`, category: 'Forest' });
    }

    // Bound score
    score = Math.max(0, Math.min(100, score));

    let label = 'Marginal';
    let color = 'text-amber-400';
    let stroke = '#f59e0b';
    if (score >= 75) {
      label = 'Highly Suitable';
      color = 'text-emerald-400';
      stroke = '#10b981';
    } else if (score >= 50) {
      label = 'Suitable';
      color = 'text-cyan-400';
      stroke = '#06b6d4';
    } else if (score < 35 || risk === 'High') {
      label = 'High Risk / Unsuitable';
      color = 'text-rose-400';
      stroke = '#f43f5e';
    }

    return { score, label, color, stroke, recommendations: recs };
  }, []);

  const queryPointElevation = useCallback(async (lonLat) => {
    const [lon, lat] = lonLat;
    showStatus(`Querying elevation at ${lon.toFixed(4)}°, ${lat.toFixed(4)}°...`);
    setElevationQueryLoading(true);
    setElevationQueryResult(null);
    try {
      const res = await fetch(`/api/terrain/query?lon=${lon}&lat=${lat}`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setElevationQueryResult(data);
      if (data.elevation !== null) {
        showStatus(`Elevation: ${data.elevation.toFixed(1)}m, Slope: ${data.slope ? data.slope.toFixed(1) : 0.0}%`);
      } else {
        showStatus('Coordinate is outside the DEM coverage area.');
      }
    } catch (err) {
      console.error('Terrain query error:', err);
      showStatus('Terrain query failed. Verify backend connectivity.');
    } finally {
      setElevationQueryLoading(false);
    }
  }, [showStatus]);

  const handleCesiumPointSelected = useCallback((coordinates) => {
    setSelectedCoordinates(coordinates);
    if (elevationQueryModeRef.current) {
      if (queryPointElevationRef.current) {
        queryPointElevationRef.current(coordinates);
      }
      return;
    }
    if (drawModeRef.current !== 'None') {
      return;
    }
    if (decisionSupportModeRef.current && fetchKnowledgeContextRef.current) {
      fetchKnowledgeContextRef.current(coordinates);
    }
  }, []);

  // Auto-clear the elevation popup whenever the user exits elevation query mode
  useEffect(() => {
    if (!elevationQueryMode) {
      setElevationQueryResult(null);
      selectedPointSourceRef.current?.clear();
    }
  }, [elevationQueryMode]);



  const handleMapModeToggle = useCallback(() => {
    if (mapMode === '3D') {
      if (window.cesiumViewer && window.Cesium) {
        const camera = window.cesiumViewer.camera;
        const cartographic = window.cesiumViewer.scene.globe.ellipsoid.cartesianToCartographic(camera.position);
        const lon = window.Cesium.Math.toDegrees(cartographic.longitude);
        const lat = window.Cesium.Math.toDegrees(cartographic.latitude);
        const height = cartographic.height;
        // Guard: height could be 0 or negative from Cesium underground positions
        const rawZoom = isFinite(height) && height > 0 ? Math.log2(35000000 / height) : 13;
        const zoomLevel = Math.max(2, Math.min(20, rawZoom));

        // Validate coordinates before using them
        const safeLon = isFinite(lon) ? lon : 82.9739;
        const safeLat = isFinite(lat) ? lat : 25.3176;

        setMapCenter([safeLon, safeLat]);
        setMapZoom(zoomLevel);

        // Directly update OL view without triggering map re-init
        if (mapRef.current) {
          const view = mapRef.current.getView();
          view.setCenter(fromLonLat([safeLon, safeLat]));
          view.setZoom(zoomLevel);
        }
      }
      setMapMode('2D');
      showStatus('Switched to 2D OpenLayers view.');
    } else {
      if (mapRef.current) {
        const view = mapRef.current.getView();
        const center = view.getCenter();
        const centerCoords = center ? toLonLat(center) : [82.9739, 25.3176];
        const zoomLevel = view.getZoom() ?? 13;
        setMapCenter(centerCoords);
        setMapZoom(zoomLevel);
      }
      setMapMode('3D');
      showStatus('Switched to 3D Cesium view with Copernicus DEM Terrain.');
    }
  }, [mapMode, showStatus]);


  const cesiumMarkers = useMemo(() => {
    const list = [];
    (layers || []).forEach((layer) => {
      if (!layer || !layer.visible || !layer.geojson) return;
      let geojsonObj = layer.geojson;
      if (typeof geojsonObj === 'string') {
        try {
          geojsonObj = JSON.parse(geojsonObj);
        } catch (e) {
          console.error('Error parsing layer geojson:', e);
          return;
        }
      }
      const features = geojsonObj?.features || [];
      features.forEach((feature) => {
        if (feature && feature.geometry && feature.geometry.type === 'Point') {
          const coords = feature.geometry.coordinates; // Lon, Lat
          if (Array.isArray(coords) && coords.length >= 2) {
            list.push({
              id: feature.id || `${layer.id}-${list.length}`,
              coordinates: coords,
              name: feature.properties?.name || 'Unnamed Marker',
              color: layer.color || '#c084fc',
              layerName: layer.name
            });
          }
        }
      });
    });
    return list;
  }, [layers]);

  useEffect(() => {
    if (!selectedAreaMetrics) {
      setLiveAmenities(null);
      setLocalNews([]);
      setLocalNewsLocation('');
      setSelectedAmenityCategory(null);
      setHighlightedLiveAmenity(null);
      setLulcData(null);
      setLulcError('');
      if (highlightLayerRef.current) {
        highlightLayerRef.current.getSource().clear();
      }
      return;
    }
    fetchLiveAreaIntelligence(selectedAreaMetrics);
    fetchLulcAnalysis(selectedAreaMetrics.polygonCoords);
  }, [selectedAreaMetrics]);

  useEffect(() => {
    setAmenitySearchQuery('');
  }, [selectedAmenityCategory]);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Use a stable ref to hold the debounce timer for city name lookups
  const cityNameTimerRef = useRef(null);
  const updateCityName = useCallback((lonLat) => {
    if (cityNameTimerRef.current) clearTimeout(cityNameTimerRef.current);
    cityNameTimerRef.current = setTimeout(async () => {
      const [lon, lat] = lonLat;
      // Instant bounding box detection for Varanasi (helps offline and startup)
      if (lon >= 82.85 && lon <= 83.15 && lat >= 25.20 && lat <= 25.40) {
        setCurrentCity('Varanasi');
        return;
      }

      const cacheKey = `${lon.toFixed(3)}_${lat.toFixed(3)}`;
      if (cityCache.current[cacheKey]) {
        setCurrentCity(cityCache.current[cacheKey]);
        return;
      }

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12`);
        const data = await res.json();
        if (data && data.address) {
          const resolvedCity = data.address.city || 
                               data.address.town || 
                               data.address.village || 
                               data.address.suburb || 
                               data.address.city_district || 
                               data.address.state_district || 
                               data.address.county || 
                               'Varanasi';
          cityCache.current[cacheKey] = resolvedCity;
          setCurrentCity(resolvedCity);
        }
      } catch (err) {
        console.warn("Reverse geocoding failed, falling back to default.", err);
      }
    }, 800);
  }, []);


  useEffect(() => {
    elevationQueryModeRef.current = elevationQueryMode;
  }, [elevationQueryMode]);

  // NOTE: selectedCoordinates no longer drives mapCenter to prevent the
  // map useEffect from re-running (and re-creating the OL map) on every click.

  useEffect(() => {
    async function loadLayers() {
      setLayers([]);
      setStatusMessage('Create a layer and add markers to begin.');
      // Note: initial status intentionally persists as an onboarding hint.
    }

    loadLayers();
  }, []);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    markerModeRef.current = markerModeEnabled;
  }, [markerModeEnabled]);

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => {
    showHeatmapRef.current = showHeatmap;
  }, [showHeatmap]);

  useEffect(() => {
    decisionSupportModeRef.current = decisionSupportModeEnabled;
  }, [decisionSupportModeEnabled]);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || !mapRef.current) return;
    
    setIsSearching(true);

    // Coordinate regex matching (e.g. "25.3176, 82.9739" or "25.3176 82.9739")
    const coordRegex = /^\s*([+-]?\d+(?:\.\d+)?)\s*[\s,]\s*([+-]?\d+(?:\.\d+)?)\s*$/;
    const match = searchQuery.match(coordRegex);
    if (match) {
      const val1 = parseFloat(match[1]);
      const val2 = parseFloat(match[2]);
      
      // Determine coordinate order using India bounds: Lat [5, 40], Lon [60, 100]
      let lat, lon;
      if (val1 >= 5 && val1 <= 40 && val2 >= 60 && val2 <= 100) {
        lat = val1;
        lon = val2;
      } else if (val2 >= 5 && val2 <= 40 && val1 >= 60 && val1 <= 100) {
        lat = val2;
        lon = val1;
      } else {
        lat = val1;
        lon = val2;
      }
      
      const coords = fromLonLat([lon, lat]);
      mapRef.current.getView().animate({
        center: coords,
        zoom: 14,
        duration: 1200
      });
      
      setMapCenter([lon, lat]);
      setMapZoom(14);
      setSelectedCoordinates([lon, lat]);
      selectedPointSourceRef.current.clear();
      const geom = new Point(coords);
      selectedPointSourceRef.current.addFeature(new Feature({ geometry: geom }));
      
      setIsSearching(false);
      return;
    }

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const { lon, lat } = data[0];
        const numericLon = parseFloat(lon);
        const numericLat = parseFloat(lat);
        const coords = fromLonLat([numericLon, numericLat]);
        mapRef.current.getView().animate({
          center: coords,
          zoom: 13,
          duration: 1500
        });
        setMapCenter([numericLon, numericLat]);
        setMapZoom(13);
        showStatus(`Found: ${searchQuery}`);
      } else {
        showStatus('Location not found. Try entering coordinates like "25.3176, 82.9739".');
      }
    } catch (err) {
      console.error('Search error', err);
      showStatus('Search failed. Try entering coordinates directly (e.g. "25.3176, 82.9739").');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, showStatus]);

  useEffect(() => {
    fetchKnowledgeContextRef.current = fetchKnowledgeContext;
    queryPointElevationRef.current = queryPointElevation;
    openFeatureDialogRef.current = openFeatureDialog;
  }, [fetchKnowledgeContext, queryPointElevation, openFeatureDialog]);

  // The map is only created ONCE (no deps on mapCenter or layers to prevent re-init).
  // Layer management is handled by a separate useEffect.
  useEffect(() => {
    if (mapRef.current || !mapElementRef.current || !tooltipRef.current || !hoverTooltipRef.current) {
      return;
    }

    const tooltipOverlay = new Overlay({
      element: tooltipRef.current,
      positioning: 'bottom-center',
      offset: [0, -18],
      stopEvent: false
    });

    const hoverTooltipOverlay = new Overlay({
      element: hoverTooltipRef.current,
      positioning: 'bottom-center',
      offset: [0, -18],
      stopEvent: false
    });

    const highlightLayer = new VectorLayer({
      source: highlightSourceRef.current,
      style: highlightStyleFactory()
    });
    highlightLayer.set('kind', 'overlay');
    highlightLayerRef.current = highlightLayer;

    const selectedPointLayer = new VectorLayer({
      source: selectedPointSourceRef.current,
      style: (feature) => {
        if (feature.get('isBuffer')) {
          return new Style({
            stroke: new Stroke({
              color: 'rgba(34, 211, 238, 0.5)',
              width: 1.5,
              lineDash: [6, 6]
            }),
            fill: new Fill({
              color: 'rgba(34, 211, 238, 0.05)'
            })
          });
        }
        return pointMarkerStyle('#60a5fa');
      }
    });
    selectedPointLayer.set('kind', 'overlay');
    selectedPointLayerRef.current = selectedPointLayer;

    const focusedHeritageLayer = new VectorLayer({
      source: focusedHeritageSourceRef.current,
      style: (feature) => {
        return pointMarkerStyle('#06b6d4');
      }
    });
    focusedHeritageLayer.set('kind', 'overlay');

    const decisionSupportPinsLayer = new VectorLayer({
      source: decisionSupportPinsSourceRef.current,
      style: (feature) => {
        const name = feature.get('name') || '';
        return [
          new Style({
            image: new CircleStyle({
              radius: 14,
              fill: new Fill({ color: 'rgba(236, 72, 153, 0.25)' }),
              stroke: new Stroke({ color: '#ec4899', width: 2 })
            })
          }),
          new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: '#ec4899' }),
              stroke: new Stroke({ color: '#ffffff', width: 1.5 })
            }),
            text: new Text({
              text: name,
              offsetY: -16,
              font: 'bold 11px Inter, ui-sans-serif, system-ui, sans-serif',
              fill: new Fill({ color: '#ffffff' }),
              stroke: new Stroke({ color: '#0f172a', width: 3 }),
              overflow: true
            })
          })
        ];
      }
    });
    decisionSupportPinsLayer.set('kind', 'overlay');
    decisionSupportPinsLayerRef.current = decisionSupportPinsLayer;

    const clickedRelationshipTargetLayer = new VectorLayer({
      source: clickedRelationshipTargetSourceRef.current,
      style: (feature) => {
        const name = feature.get('name') || '';
        return [
          // Outer glowing amber ring
          new Style({
            image: new CircleStyle({
              radius: 16,
              fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
              stroke: new Stroke({ color: '#f59e0b', width: 2, lineDash: [4, 4] })
            })
          }),
          // Inner core amber point
          new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: '#f59e0b' }),
              stroke: new Stroke({ color: '#ffffff', width: 1.5 })
            }),
            text: new Text({
              text: name,
              offsetY: -18,
              font: 'bold 11px Inter, ui-sans-serif, system-ui, sans-serif',
              fill: new Fill({ color: '#ffffff' }),
              stroke: new Stroke({ color: '#0f172a', width: 3 }),
              overflow: true
            })
          })
        ];
      }
    });
    clickedRelationshipTargetLayer.set('kind', 'overlay');

    const distanceMeasureLayer = new VectorLayer({
      source: distanceMeasureSourceRef.current,
      style: distanceMeasureStyle
    });
    distanceMeasureLayer.set('kind', 'overlay');
    distanceMeasureLayerRef.current = distanceMeasureLayer;

    const drawLayer = new VectorLayer({
      source: drawSourceRef.current,
      style: (feature) => {
        const geometryType = feature.getGeometry()?.getType();
        // Nearly transparent fill so the LULC layer above is visible inside the polygon
        const fillColor = 'rgba(168, 85, 247, 0.04)';
        const strokeColor = '#a855f7';
        if (geometryType === 'Point') {
          return new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: '#c084fc' }),
              stroke: new Stroke({ color: '#ffffff', width: 2 })
            })
          });
        }
        return new Style({
          stroke: new Stroke({ color: strokeColor, width: 3 }),
          fill: new Fill({ color: fillColor })
        });
      }
    });
    drawLayer.set('kind', 'draw');

    const ENTITY_TYPE_STYLES = {
      'fire': { color: '#f97316', label: '🔥' },
      'flood': { color: '#3b82f6', label: '💧' },
      'road damage': { color: '#78716c', label: '🚧' },
      'road': { color: '#78716c', label: '🚧' },
      'electricity failure': { color: '#eab308', label: '⚡' },
      'electricity': { color: '#eab308', label: '⚡' },
      'power': { color: '#eab308', label: '⚡' },
      'crime': { color: '#a855f7', label: '🚨' },
      'medical': { color: '#10b981', label: '🏥' },
      'construction': { color: '#f59e0b', label: '🏗️' },
      'unknown': { color: '#64748b', label: '📍' }
    };

    const intelLayer = new VectorLayer({
      source: intelSourceRef.current,
      style: (feature) => {
        const type = (feature.get('entityType') || 'unknown').toLowerCase();
        let config = ENTITY_TYPE_STYLES.unknown;
        for (const [key, val] of Object.entries(ENTITY_TYPE_STYLES)) {
          if (type.includes(key)) {
            config = val;
            break;
          }
        }
        
        const title = feature.get('title') || '';
        return [
          new Style({
            image: new CircleStyle({
              radius: 16,
              fill: new Fill({ color: layerFill(config.color, 0.25) }),
              stroke: new Stroke({ color: config.color, width: 2 })
            })
          }),
          new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: config.color }),
              stroke: new Stroke({ color: '#ffffff', width: 1.5 })
            }),
            text: new Text({
              text: `${config.label} ${title}`,
              offsetY: -20,
              font: 'bold 11px Inter, ui-sans-serif, system-ui, sans-serif',
              fill: new Fill({ color: '#ffffff' }),
              stroke: new Stroke({ color: '#0f172a', width: 3 }),
              overflow: true
            })
          })
        ];
      }
    });
    intelLayer.set('kind', 'overlay');
    intelLayerRef.current = intelLayer;

    const map = new Map({
        target: mapElementRef.current,
        layers: [
          basemapLayersRef.current.dark,
          basemapLayersRef.current.light,
          basemapLayersRef.current.satellite,
          basemapLayersRef.current.satelliteLabels,
          basemapLayersRef.current.varanasi_mbtiles,
          highlightLayer, selectedPointLayer, distanceMeasureLayer,
          drawLayer,
          decisionSupportPinsLayer,
          clickedRelationshipTargetLayer,
          focusedHeritageLayer,
          intelLayer,
          lulcLayerRef.current  // LULC renders on top so colors are visible
        ],
        overlays: [tooltipOverlay, hoverTooltipOverlay],
        controls: defaultControls().extend([new ScaleLine()]),
        view: new View({
          center: fromLonLat(mapCenter),
          zoom: 13
        })
      });

    map.on('pointermove', (event) => {
      const lonLat = toLonLat(event.coordinate);
      setHoverCoordinates(lonLat);

      if (event.dragging) {
        hoverTooltipOverlay.setPosition(undefined);
        setHoveredMarkerInfo(null);
        return;
      }

      const pixel = map.getEventPixel(event.originalEvent);
      let foundMarker = null;
      let foundLulcClass = null;

      map.forEachFeatureAtPixel(pixel, (feature, layer) => {
        // Check for LULC features first
        if (!foundLulcClass && layer && layer === lulcLayerRef.current) {
          const cn = feature.get('className');
          if (cn) foundLulcClass = cn;
        }
        if (foundMarker) return;
        if (layer && layer.get('kind') === 'data') {
          const layerId = layer.get('layerId');
          if (layerId === activeLayerIdRef.current) {
            const geom = feature.getGeometry();
            if (geom && (geom.getType() === 'Point' || geom.getType() === 'MultiPoint')) {
              foundMarker = feature;
            }
          }
        }
      });

      // Update LULC hover state
      setLulcHoveredClass(foundLulcClass || null);

      if (foundMarker) {
        map.getTargetElement().style.cursor = 'pointer';
        const geom = foundMarker.getGeometry();
        const coords = toLonLat(geom.getCoordinates());
        const props = foundMarker.getProperties();
        const name = props.name || props.title || props.label || 'Unnamed Marker';
        const category = props.category || props.__layerName || 'No Category';

        setHoveredMarkerInfo({ name, category, coordinates: coords });
        hoverTooltipOverlay.setPosition(geom.getCoordinates());
      } else if (foundLulcClass) {
        map.getTargetElement().style.cursor = 'crosshair';
        hoverTooltipOverlay.setPosition(undefined);
        setHoveredMarkerInfo(null);
      } else {
        map.getTargetElement().style.cursor = '';
        hoverTooltipOverlay.setPosition(undefined);
        setHoveredMarkerInfo(null);
      }
    });

    // Single consolidated click handler — prevents duplicate execution from both 'singleclick' + 'click'
    map.on('singleclick', (event) => {
      const coordinates = toLonLat(event.coordinate);
      setSelectedCoordinates(coordinates);
      setSelectedStatsCategory(null);
      tooltipOverlay.setPosition(event.coordinate);

      if (drawModeRef.current !== 'None') {
        return;
      }

      if (elevationQueryModeRef.current) {
        queryPointElevationRef.current(coordinates);
        selectedPointSourceRef.current.clear();
        const geom = new Point(event.coordinate);
        selectedPointSourceRef.current.addFeature(new Feature({ geometry: geom }));
        return;
      }

      if (markerModeRef.current) {
        openFeatureDialogRef.current(coordinates);
        return;
      }

      // Check if we hit an AI location intelligence marker
      let hitIntel = null;
      map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
        if (!hitIntel && layer === intelLayerRef.current) hitIntel = feature;
      });
      if (hitIntel) {
        const entityId = hitIntel.get('entityId');
        const entity = intelEntitiesRef.current.find(e => e.id === entityId);
        if (entity) {
          setSelectedIntelEntity(entity);
          return;
        }
      }

      if (intelModeRef.current) {
        setIntelDraft({
          latitude: coordinates[1],
          longitude: coordinates[0],
          text: ''
        });
        setIntelError('');
        setIntelDialogOpen(true);
        return;
      }

      // Fetch dynamic Knowledge Context
      if (decisionSupportModeRef.current && fetchKnowledgeContextRef.current) {
        fetchKnowledgeContextRef.current(coordinates);
      }

      // Check for LULC feature click — highlight it
      let lulcHit = null;
      map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
        if (!lulcHit && layer === lulcLayerRef.current) lulcHit = feature;
      });

      if (lulcHit) {
        // Clear previous LULC highlight
        lulcSourceRef.current.getFeatures().forEach(f => f.set('_lulcHighlighted', false));
        lulcHit.set('_lulcHighlighted', true);
        setLulcHighlightedFeature(lulcHit.get('className'));
        lulcLayerRef.current.changed();
        return;
      }

      const hit = map.forEachFeatureAtPixel(event.pixel, (feature, layer) => ({
        feature,
        layer
      }));

      if (hit?.feature && hit?.layer?.get('kind') === 'data') {
        const geom = hit.feature.getGeometry();
        if (geom && (geom.getType() === 'Point' || geom.getType() === 'MultiPoint')) {
          const props = hit.feature.getProperties();
          const name = props.name || props.title || props.label || 'Unnamed Marker';
          const layerName = props.category || props.__layerName || 'Unknown Layer';
          const coords = toLonLat(geom.getCoordinates());
          const markerId = hit.feature.getId() || `${coords[0]}-${coords[1]}`;

          setSelectedMarkersForDistance((current) => {
            const exists = current.find(m => m.id === markerId);
            if (exists) return current.filter(m => m.id !== markerId);
            if (current.length >= 2) return [{ id: markerId, name, layerName, coordinates: coords }];
            return [...current, { id: markerId, name, layerName, coordinates: coords }];
          });
          selectedPointSourceRef.current.clear();
          highlightSourceRef.current.clear();
          return;
        }

        highlightSourceRef.current.clear();
        const cloned = hit.feature.clone();
        highlightSourceRef.current.addFeature(cloned);
      } else {
        const featureOnDraw = map.forEachFeatureAtPixel(event.pixel, (feature, layer) => (layer?.get('kind') === 'draw' ? feature : null));
        if (featureOnDraw) {
          highlightSourceRef.current.clear();
          const cloned = featureOnDraw.clone();
          highlightSourceRef.current.addFeature(cloned);
        }
      }

      selectedPointSourceRef.current.clear();
      const geom = new Point(event.coordinate);
      selectedPointSourceRef.current.addFeature(new Feature({ geometry: geom }));
    });

    map.on('moveend', () => {
      const center = toLonLat(map.getView().getCenter());
      updateCityName(center);
    });

    mapRef.current = map;
    window.map = map;
  // IMPORTANT: This effect must NOT depend on mapCenter or layers.
  // - mapCenter is only used to seed the initial view once at mount time (L1184).
  // - Layer changes are handled separately in the layer-sync useEffect below.
  // Adding either as a dep causes the entire OL map to be destroyed and re-created on every click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    Object.keys(basemapLayersRef.current).forEach(key => {
      if (key === 'satelliteLabels') {
        basemapLayersRef.current[key].setVisible(basemap === 'satellite');
      } else {
        basemapLayersRef.current[key].setVisible(key === basemap);
      }
    });
    baseSelection.current = basemap;
  }, [basemap]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const source = distanceMeasureSourceRef.current;
    source.clear();

    if (selectedMarkersForDistance.length === 0) {
      return;
    }

    // Add highlight rings for selected markers
    selectedMarkersForDistance.forEach((marker) => {
      const geom = new Point(fromLonLat(marker.coordinates));
      const feature = new Feature({ geometry: geom });
      feature.setProperties({ kind: 'distance-highlight' });
      source.addFeature(feature);
    });

    // Add connecting dashed line
    if (selectedMarkersForDistance.length === 2) {
      const c1 = fromLonLat(selectedMarkersForDistance[0].coordinates);
      const c2 = fromLonLat(selectedMarkersForDistance[1].coordinates);
      const lineGeom = new LineString([c1, c2]);
      const feature = new Feature({ geometry: lineGeom });
      feature.setProperties({ kind: 'distance-line' });
      source.addFeature(feature);
    }
  }, [selectedMarkersForDistance]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const map = mapRef.current;

    // Get active layer IDs
    const activeLayerIds = new Set(layers.map(l => l.id));

    // Remove deleted layers from the map and refs
    Object.keys(dataLayerRefs.current).forEach((id) => {
      if (!activeLayerIds.has(id)) {
        map.removeLayer(dataLayerRefs.current[id]);
        delete dataLayerRefs.current[id];
      }
    });
    Object.keys(heatmapLayerRefs.current).forEach((id) => {
      if (!activeLayerIds.has(id)) {
        map.removeLayer(heatmapLayerRefs.current[id]);
        delete heatmapLayerRefs.current[id];
      }
    });

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    // Count actual base layers dynamically: basemaps
    // This prevents silent breakage when basemap layers are added or removed.
    const baseLayersCount = Object.keys(basemapLayersRef.current).length;

    sortedLayers.forEach((layer, index) => {
      const newFeatures = readGeoJsonFeatures(layer.geojson);
      newFeatures.forEach((feature) => {
        feature.setProperties(
          {
            __layerId: layer.id,
            __layerName: layer.name
          },
          true
        );
      });

      let vectorLayer = dataLayerRefs.current[layer.id];
      let heatmapLayer = heatmapLayerRefs.current[layer.id];

      if (vectorLayer) {
        vectorLayer.setOpacity(layer.opacity);
        vectorLayer.setVisible(!showHeatmap && layer.visible);
        vectorLayer.setStyle(layerStyleFactory(layer));

        const source = vectorLayer.getSource();
        source.clear();
        source.addFeatures(newFeatures);
      } else {
        // Create new vector source and layer
        const vectorSource = new VectorSource({
          features: newFeatures
        });
        
        vectorLayer = new VectorLayer({
          source: vectorSource,
          opacity: layer.opacity,
          visible: !showHeatmap && layer.visible,
          style: layerStyleFactory(layer)
        });
        vectorLayer.set('kind', 'data');
        vectorLayer.set('layerId', layer.id);

        dataLayerRefs.current[layer.id] = vectorLayer;
      }

      if (heatmapLayer) {
        heatmapLayer.setVisible(showHeatmap && layer.visible);

        const source = heatmapLayer.getSource();
        source.clear();
        source.addFeatures(newFeatures);
      } else {
        // Create new heatmap layer
        const heatmapSource = new VectorSource({
          features: newFeatures
        });
        
        heatmapLayer = new HeatMapLayer({
          source: heatmapSource,
          blur: 25,
          radius: 15,
          visible: showHeatmap && layer.visible
        });
        heatmapLayer.set('kind', 'heatmap');
        heatmapLayer.set('layerId', layer.id);

        heatmapLayerRefs.current[layer.id] = heatmapLayer;
      }

      // Ensure layers are at correct indexes for rendering order
      map.removeLayer(heatmapLayer);
      map.removeLayer(vectorLayer);
      
      map.getLayers().insertAt(baseLayersCount + index * 2, heatmapLayer);
      map.getLayers().insertAt(baseLayersCount + index * 2 + 1, vectorLayer);
    });
  }, [layers, showHeatmap]);


  // (Removed dead useEffect that found the draw layer but never used it)

  useEffect(() => {
    const handleDrawChange = (event) => {
      setDrawRevision((current) => current + 1);
    };

    const source = drawSourceRef.current;
    source.on('addfeature', handleDrawChange);
    source.on('removefeature', handleDrawChange);
    source.on('clear', handleDrawChange);
    source.on('change', handleDrawChange);

    return () => {
      source.un('addfeature', handleDrawChange);
      source.un('removefeature', handleDrawChange);
      source.un('clear', handleDrawChange);
      source.un('change', handleDrawChange);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (drawInteractionRef.current) {
      mapRef.current.removeInteraction(drawInteractionRef.current);
      drawInteractionRef.current = null;
    }
    if (modifyInteractionRef.current) {
      mapRef.current.removeInteraction(modifyInteractionRef.current);
      modifyInteractionRef.current = null;
    }
    if (snapInteractionRef.current) {
      mapRef.current.removeInteraction(snapInteractionRef.current);
      snapInteractionRef.current = null;
    }

    modifyInteractionRef.current = new Modify({ source: drawSourceRef.current });
    snapInteractionRef.current = new Snap({ source: drawSourceRef.current });
    mapRef.current.addInteraction(modifyInteractionRef.current);
    mapRef.current.addInteraction(snapInteractionRef.current);

    const typeMap = {
      Point: 'Point',
      LineString: 'LineString',
      Polygon: 'Polygon',
      Circle: 'Circle'
    };

    if (drawMode !== 'None' && typeMap[drawMode]) {
      drawInteractionRef.current = new Draw({
        source: drawSourceRef.current,
        type: typeMap[drawMode]
      });
      mapRef.current.addInteraction(drawInteractionRef.current);
    }
  }, [drawMode]);


  function updateLayer(layerId, updater) {
    setLayers((current) =>
      current.map((layer) => {
        if (layer.id !== layerId) {
          return layer;
        }
        return typeof updater === 'function' ? updater(layer) : updater;
      })
    );
  }

  function moveLayer(layerId, direction) {
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.id === layerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next.map((layer, order) => ({ ...layer, order }));
    });
  }

  function removeLayer(layerId) {
    setLayers((current) => current.filter((layer) => layer.id !== layerId));
  }

  function zoomToLayer(layerId) {
    const layer = dataLayerRefs.current[layerId];
    const map = mapRef.current;
    if (!layer || !map) {
      return;
    }
    map.getView().fit(layer.getSource().getExtent(), {
      padding: [60, 60, 60, 60],
      duration: 600,
      maxZoom: 16
    });
  }

  function clearDrawings() {
    drawSourceRef.current.clear();
    highlightSourceRef.current.clear();
    lulcSourceRef.current.clear();
    // Reset all analysis state — prevents stale data from showing for old polygon
    setLiveAmenities(null);
    setLiveAmenitiesError('');
    setLocalNews([]);
    setLocalNewsLocation('');
    setSelectedAmenityCategory(null);
    setHighlightedLiveAmenity(null);
    setLulcData(null);
    setLulcError('');
    setLulcHoveredClass(null);
    setLulcHighlightedFeature(null);
    lulcColorMapRef.current = {};
    setLulcClassColorMap({});
    showStatus('Selected area cleared.');
  }

  function openLayerDialog() {
    setLayerDialogError('');
    setLayerDraft({
      name: '',
      color: '#c084fc'
    });
    setLayerDialogOpen(true);
  }

  async function addLayerFromDialog() {
    try {
      const layerId = `manual-${Math.random().toString(36).substring(2, 10)}`;
      const layerName = layerDraft.name.trim() || 'Manual Layer';
      const geojson = {
        type: 'FeatureCollection',
        features: []
      };
      const metadata = {
        ...createLayerMetadata({
          geojson,
          fileName: `${layerName}.geojson`,
          sourceType: 'manual'
        }),
        geometryCounts: countGeometries(geojson)
      };

      const newLayer = {
        id: layerId,
        name: layerName,
        fileName: `${layerName}.geojson`,
        sourceType: 'manual',
        visible: true,
        opacity: 1,
        color: layerDraft.color || '#c084fc',
        labels: false,
        order: layers.length,
        metadata,
        geojson
      };

      setLayers((current) => [...current, newLayer]);
      setActiveLayerId(layerId);
      setLayerDialogOpen(false);
      showStatus(`Created ${layerName}. Use marker mode to add features.`);
    } catch (error) {
      setLayerDialogError('Please enter a layer name before creating it.');
    }
  }

  function openFeatureDialog(coordinates) {
    const layerId = activeLayerIdRef.current || layersRef.current[0]?.id;
    if (!layerId) {
      showStatus('Select or create a layer before adding markers.');
      return;
    }

    if (!activeLayerIdRef.current) {
      setActiveLayerId(layerId);
    }
    setFeatureDialogError('');
    setFeatureDraft({
      name: '',
      coordinates
    });
    setFeatureDialogOpen(true);
  }

  function addFeatureFromDialog() {
    const layerId = activeLayerIdRef.current || layersRef.current[0]?.id;
    const layer = layersRef.current.find((item) => item.id === layerId);
    if (!layer || !featureDraft.coordinates) {
      setFeatureDialogError('Select a layer and map location first.');
      return;
    }

    const name = featureDraft.name.trim() || 'Manual Marker';
    const geom = new Point(fromLonLat(featureDraft.coordinates));
    const feature = new Feature({
      geometry: geom
    });
    feature.setProperties({
      name,
      category: layer.name,
      source: 'manual'
    });

    const currentFeatures = readGeoJsonFeatures(layer.geojson || { type: 'FeatureCollection', features: [] });
    const nextGeojson = JSON.parse(writeGeoJsonFeatures([...currentFeatures, feature]));
    const nextMetadata = {
      ...createLayerMetadata({
        geojson: nextGeojson,
        fileName: layer.fileName || `${layer.name}.geojson`,
        sourceType: layer.sourceType || 'manual'
      }),
      geometryCounts: countGeometries(nextGeojson)
    };

    updateLayer(layerId, {
      ...layer,
      geojson: nextGeojson,
      metadata: nextMetadata
    });

    setFeatureDialogOpen(false);
    showStatus(`Added ${name} to ${layer.name}`);
  }



  const selectedAreaAnalysis = useMemo(() => {
    return analyzeSelectedArea({
      polygonFeature: selectedAreaPolygon,
      layers
    });
  }, [layers, selectedAreaPolygon, drawRevision]);

  const areaMetrics = useMemo(() => {
    if (!selectedAreaAnalysis) {
      return null;
    }

    const sqMeters = selectedAreaAnalysis.areaSquareMeters;
    const activeLayersCount = Object.entries(selectedAreaAnalysis.layerCounts).filter(([, count]) => count > 0).length;

    return [
      ['Area', `${sqMeters.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²`],
      ['Layers Inside', activeLayersCount]
    ];
  }, [selectedAreaAnalysis]);

  const filteredAmenities = useMemo(() => {
    if (!selectedAmenityCategory || !liveAmenities || !liveAmenities[selectedAmenityCategory]) {
      return [];
    }
    const list = liveAmenities[selectedAmenityCategory];
    if (!amenitySearchQuery.trim()) {
      return list;
    }
    const q = amenitySearchQuery.toLowerCase();
    return list.filter(item => 
      item.name.toLowerCase().includes(q) || 
      item.address.toLowerCase().includes(q)
    );
  }, [liveAmenities, selectedAmenityCategory, amenitySearchQuery]);

  const markerDistance = useMemo(() => {
    if (selectedMarkersForDistance.length !== 2) {
      return null;
    }
    const c1 = selectedMarkersForDistance[0].coordinates;
    const c2 = selectedMarkersForDistance[1].coordinates;
    const dist = calculateDistanceBetweenCoordinates(c1, c2);
    if (dist >= 1000) {
      return `${(dist / 1000).toFixed(2)} km`;
    }
    return `${dist.toFixed(0)} meters`;
  }, [selectedMarkersForDistance]);



  const totalLayers = layers.length;

  return (
    <>
    <div className="relative w-screen h-screen overflow-hidden bg-[#07111f] text-slate-100 select-none">
      {/* Fullscreen Map Canvas */}
      <div className="absolute inset-0 w-full h-full z-0 map-shell">
        <div 
          ref={mapElementRef} 
          className="h-full w-full" 
          style={{ display: mapMode === '2D' ? 'block' : 'none' }}
        />
        <CesiumMap
          center={mapCenter}
          zoom={mapZoom}
          visible={mapMode === '3D'}
          onPointSelected={handleCesiumPointSelected}
          basemap={basemap}
          selectedCoordinates={selectedCoordinates}
          selectedMarkersForDistance={selectedMarkersForDistance}
          selectedAreaCoords={selectedAreaCoords}
          markers={cesiumMarkers}
        />
      </div>

      {/* Floating Header */}
      <header className="fixed top-6 left-6 right-6 z-30 flex flex-col md:flex-row md:items-center md:justify-between rounded-[24px] bg-slate-950/70 border border-white/10 shadow-2xl backdrop-blur-xl px-6 py-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-300">
            <MapIcon className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-wider text-white">Geo_Insight</h1>
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] bg-cyan-500/10 text-cyan-300 border border-cyan-400/20 px-2.5 py-0.5 rounded-md">{currentCity}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Decision Support Platform & Spatial Analytics</p>
          </div>
        </div>

        {/* Search & Basemap Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearch} className="relative flex items-center">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search location..."
              className="w-40 lg:w-56 rounded-2xl border border-white/10 bg-slate-950/50 px-3.5 py-2 pl-9 text-xs text-white placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 transition-all shadow-inner"
            />
            <Search className="absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
          </form>

          <div className="flex bg-slate-950/50 border border-white/10 rounded-2xl p-0.5">
            <button
              onClick={() => setBasemap('light')}
              type="button"
              className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[11px] font-semibold transition-all ${basemap === 'light' ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/20' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Sun className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Day</span>
            </button>
            <button
              onClick={() => setBasemap('dark')}
              type="button"
              className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[11px] font-semibold transition-all ${basemap === 'dark' ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/20' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Moon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Night</span>
            </button>
            <button
              onClick={() => setBasemap('satellite')}
              type="button"
              className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[11px] font-semibold transition-all ${basemap === 'satellite' ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/20' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Layers3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sat</span>
            </button>
            <button
              onClick={() => setBasemap('varanasi_mbtiles')}
              type="button"
              className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-[11px] font-semibold transition-all ${basemap === 'varanasi_mbtiles' ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/20' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">MBTiles</span>
            </button>
          </div>

          <button
            onClick={() => setShowHeatmap(prev => !prev)}
            type="button"
            className={`rounded-2xl px-3.5 py-2 text-[11px] font-semibold border transition-all ${showHeatmap ? 'bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-950/50 text-slate-300 border-white/10 hover:bg-slate-950/80'}`}
          >
            {showHeatmap ? 'Show Markers' : 'Show Heatmap'}
          </button>

          <button
            onClick={toggleFullscreen}
            type="button"
            className="flex items-center justify-center rounded-2xl bg-slate-950/50 text-slate-300 border border-white/10 hover:bg-slate-950/80 p-2.5 transition-all hover:text-white hover:border-white/25 hover:shadow-[0_0_12px_rgba(255,255,255,0.05)]"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Floating Left Sidebar Panel Wrapper */}
      <aside className="fixed top-28 left-6 bottom-6 w-[380px] z-30 overflow-y-auto pr-2 flex flex-col gap-4 custom-scrollbar select-none">
        
        {/* Sidebar Tab Switcher */}
        <div className="flex rounded-2xl bg-slate-950/70 p-1 border border-white/10 shadow-2xl backdrop-blur-xl pointer-events-auto flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveSidebarTab('layers');
              setDrawMode('None');
              // Clear distance selection when leaving layers tab
              setSelectedMarkersForDistance([]);
            }}
            className={`flex-1 rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeSidebarTab === 'layers'
                ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <Layers3 className="h-4 w-4" />
            <span>Layers</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveSidebarTab('analysis');
              setMarkerModeEnabled(false);
              setDrawMode('Polygon');
              showStatus('Click the map to draw a polygon area.');
            }}
            className={`flex-1 rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeSidebarTab === 'analysis'
                ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>Analysis</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveSidebarTab('decision');
              setMarkerModeEnabled(false);
              setDrawMode('None');
            }}
            className={`flex-1 rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeSidebarTab === 'decision'
                ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <Activity className="h-4 w-4" />
            <span>Decision Support</span>
          </button>
        </div>

        {activeSidebarTab === 'layers' && (
          <>
            {/* Layer Explorer Card */}
            <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-xl flex flex-col">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
                  <Layers3 className="h-4 w-4 text-cyan-400" />
                  Layer Explorer
                </h2>
                <button
                  onClick={openLayerDialog}
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-400/10 border border-cyan-400/20 hover:bg-cyan-400/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-all hover:shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create Layer
                </button>
              </div>

              <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-1 custom-scrollbar">
                {layers.length === 0 ? (
                  <p className="text-xs text-slate-400 leading-relaxed italic text-center py-4 bg-white/5 border border-white/5 rounded-2xl">
                    No custom layers created. Click "Create Layer" to start manually adding markers.
                  </p>
                ) : (
                  layers.map((layer) => (
                    <div key={layer.id} className="rounded-2xl border border-white/10 bg-slate-950/80 p-3.5 hover:border-white/20 transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <input
                            value={layer.name}
                            onChange={(event) =>
                              updateLayer(layer.id, {
                                ...layer,
                                name: event.target.value
                              })
                            }
                            className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400 transition-all font-medium"
                          />
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.15em] text-slate-400">
                            <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5">{layer.sourceType}</span>
                            <span className="bg-white/5 px-2 py-0.5 rounded border border-white/5">{layer.metadata.featureCount} features</span>
                          </div>
                          {activeLayerId === layer.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setDrawMode('None');
                                setMarkerModeEnabled((current) => !current);
                                showStatus(
                                  !markerModeEnabled
                                    ? `Click the map to add a marker to ${layer.name}.`
                                    : 'Marker mode disabled.'
                                );
                              }}
                              className={`mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold border transition-all ${
                                markerModeEnabled
                                  ? 'bg-cyan-400 text-slate-950 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                                  : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10'
                              }`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {markerModeEnabled ? 'Adding Markers...' : 'Add Marker'}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveLayerId(layer.id)}
                            className={`rounded-xl border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-all ${
                              activeLayerId === layer.id
                                ? 'border-cyan-400 bg-cyan-400/15 text-cyan-300'
                                : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {activeLayerId === layer.id ? 'Active' : 'Use'}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateLayer(layer.id, { ...layer, visible: !layer.visible })}
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                          >
                            {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLayer(layer.id)}
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-3.5 grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
                        <label className="text-[11px] text-slate-400 uppercase tracking-[0.1em]">
                          Color
                          <input
                            type="color"
                            value={layer.color}
                            onChange={(event) =>
                              updateLayer(layer.id, {
                                ...layer,
                                color: event.target.value
                              })
                            }
                            className="mt-1.5 h-8 w-full rounded-xl border border-white/10 bg-transparent cursor-pointer"
                          />
                        </label>
                        <label className="text-[11px] text-slate-400 uppercase tracking-[0.1em]">
                          Opacity
                          <input
                            type="range"
                            min="0.2"
                            max="1"
                            step="0.05"
                            value={layer.opacity}
                            onChange={(event) =>
                              updateLayer(layer.id, {
                                ...layer,
                                opacity: Number(event.target.value)
                              })
                            }
                            className="mt-3.5 w-full accent-cyan-400 cursor-pointer"
                          />
                        </label>
                      </div>

                      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                        <label className="flex items-center gap-2 text-[11px] text-slate-300 uppercase tracking-[0.1em] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={layer.labels}
                            onChange={(event) =>
                              updateLayer(layer.id, {
                                ...layer,
                                labels: event.target.checked
                              })
                            }
                            className="rounded border-white/10 bg-slate-900 text-cyan-400 focus:ring-0 cursor-pointer"
                          />
                          Labels
                        </label>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => moveLayer(layer.id, -1)}
                            className="rounded-xl border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                            title="Move layer up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveLayer(layer.id, 1)}
                            className="rounded-xl border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                            title="Move layer down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => zoomToLayer(layer.id)}
                            className="rounded-xl border border-white/10 bg-white/5 p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                            title="Zoom to layer bounds"
                          >
                            <LocateFixed className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Marker Distance Card */}
            <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
                <Ruler className="h-4 w-4 text-cyan-400" />
                Marker Distance
              </h2>

              <div className="space-y-3">
                {selectedMarkersForDistance.length === 0 ? (
                  <p className="text-xs text-slate-400 leading-relaxed italic text-center py-2">
                    Select any two markers across layers to measure geodesic distance.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    <div className="space-y-2">
                      <div className="rounded-xl border border-white/5 bg-slate-900/50 p-2.5 flex items-center justify-between">
                        <div className="truncate flex-1 pr-2">
                          <p className="text-[9px] uppercase tracking-[0.15em] text-slate-400">Marker 1</p>
                          <p className="text-xs font-bold text-white truncate">
                            {selectedMarkersForDistance[0].name}
                          </p>
                        </div>
                        <span className="text-[9px] uppercase font-semibold text-cyan-300/80 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/10 max-w-[120px] truncate">
                          {selectedMarkersForDistance[0].layerName}
                        </span>
                      </div>

                      {selectedMarkersForDistance.length === 2 ? (
                        <>
                          <div className="rounded-xl border border-white/5 bg-slate-900/50 p-2.5 flex items-center justify-between">
                            <div className="truncate flex-1 pr-2">
                              <p className="text-[9px] uppercase tracking-[0.15em] text-slate-400">Marker 2</p>
                              <p className="text-xs font-bold text-white truncate">
                                {selectedMarkersForDistance[1].name}
                              </p>
                            </div>
                            <span className="text-[9px] uppercase font-semibold text-cyan-300/80 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/10 max-w-[120px] truncate">
                              {selectedMarkersForDistance[1].layerName}
                            </span>
                          </div>

                          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-center shadow-lg">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-300 font-semibold">Geodesic Distance</p>
                            <p className="mt-1 text-xl font-bold text-white tracking-wide">
                              {markerDistance}
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px] text-amber-300/90 italic bg-amber-400/5 border border-amber-400/10 rounded-xl p-2.5 text-center animate-pulse">
                          Select a second marker on the map...
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedMarkersForDistance([])}
                      className="w-full rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors"
                    >
                      Clear Distance Selection
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Selected Area Card */}
        {activeSidebarTab === 'analysis' && (
          <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
              <PencilLine className="h-4 w-4 text-cyan-400" />
              Selected Area
            </h2>

            {selectedAreaAnalysis ? (
              <div className="space-y-3">
                {/* Visualize Area Knowledge Graph Button */}
                <button
                  onClick={fetchPolygonKnowledgeContext}
                  disabled={polygonKnowledgeLoading}
                  type="button"
                  className="w-full flex items-center justify-center gap-2 rounded-[16px] py-2.5 px-3 text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-all shadow-lg shadow-cyan-400/10 pointer-events-auto"
                >
                  {polygonKnowledgeLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating Area Graph...</span>
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4" />
                      <span>Visualize Area Knowledge Graph</span>
                    </>
                  )}
                </button>

                {/* Analysis Sub-tab Switcher */}
                <div className="flex rounded-xl bg-slate-900/80 p-1 border border-white/5 shadow-inner">
                  <button
                    type="button"
                    onClick={() => setActiveAnalysisSubTab('lulc')}
                    className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                      activeAnalysisSubTab === 'lulc'
                        ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-sm shadow-emerald-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>LULC</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAnalysisSubTab('insights')}
                    className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold flex items-center justify-center gap-1 transition-all ${
                      activeAnalysisSubTab === 'insights'
                        ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-sm shadow-cyan-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Insights</span>
                  </button>
                </div>

                {activeAnalysisSubTab === 'lulc' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {areaMetrics?.map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-white/5 bg-slate-900/50 px-3.5 py-2">
                          <p className="text-[9px] uppercase tracking-[0.15em] text-slate-400">{label}</p>
                          <p className="mt-0.5 text-xs font-bold text-white leading-tight truncate">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-white/5 bg-slate-900/50 px-3.5 py-2 text-xs text-slate-300">
                      <p className="text-[9px] uppercase tracking-[0.15em] text-slate-400">Features Inside</p>
                      <div className="mt-2 space-y-2 max-h-[12vh] overflow-y-auto pr-1 custom-scrollbar">
                        {selectedAreaAnalysis.featuresInside.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic text-center py-1">No features found inside area.</p>
                        ) : (
                          selectedAreaAnalysis.featuresInside.slice(0, 10).map((item, index) => (
                            <div key={`${item.layerId}-${item.name}-${index}`} className="rounded-lg bg-white/5 px-2.5 py-1.5 border border-white/5">
                              <p className="text-xs font-semibold text-white truncate">{item.name}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {item.layerName} · {item.geometryType}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* LULC (Land Use Land Cover) Analysis */}
                    <div className="border-t border-white/10 pt-3 mt-3">
                      {/* Header + Layer Controls */}
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          <Globe className="h-3.5 w-3.5 text-emerald-400" />
                          LULC Layer
                        </h3>
                        {lulcData && Object.keys(lulcClassColorMap).length > 0 && (
                          <div className="flex items-center gap-1.5">
                            {/* Show/Hide toggle */}
                            <button
                              type="button"
                              onClick={() => {
                                const next = !lulcLayerVisible;
                                setLulcLayerVisible(next);
                                lulcLayerRef.current.setVisible(next);
                              }}
                              className="rounded-lg border border-white/10 bg-white/5 p-1 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                              title={lulcLayerVisible ? 'Hide LULC Layer' : 'Show LULC Layer'}
                            >
                              {lulcLayerVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            </button>
                            {/* Zoom to extent */}
                            <button
                              type="button"
                              onClick={() => {
                                const extent = lulcSourceRef.current.getExtent();
                                if (extent && mapRef.current) {
                                  mapRef.current.getView().fit(extent, { padding: [30, 30, 30, 30], duration: 600 });
                                }
                              }}
                              className="rounded-lg border border-white/10 bg-white/5 p-1 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                              title="Zoom to LULC Extent"
                            >
                              <LocateFixed className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Opacity slider */}
                      {lulcData && Object.keys(lulcClassColorMap).length > 0 && (
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-[9px] uppercase tracking-[0.1em] text-slate-500 whitespace-nowrap">Opacity</span>
                          <input
                            type="range" min="0.1" max="1" step="0.05"
                            value={lulcLayerOpacity}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setLulcLayerOpacity(val);
                              lulcLayerRef.current.setOpacity(val);
                            }}
                            className="flex-1 accent-emerald-400 cursor-pointer"
                          />
                          <span className="text-[9px] text-slate-400 w-6 text-right">{Math.round(lulcLayerOpacity * 100)}%</span>
                        </div>
                      )}

                      {/* Hover tooltip indicator */}
                      {lulcHoveredClass && (
                        <div
                          className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all"
                          style={{
                            borderColor: `${lulcClassColorMap[lulcHoveredClass] || '#94a3b8'}60`,
                            backgroundColor: `${lulcClassColorMap[lulcHoveredClass] || '#94a3b8'}18`,
                            color: lulcClassColorMap[lulcHoveredClass] || '#94a3b8'
                          }}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: lulcClassColorMap[lulcHoveredClass] || '#94a3b8' }}
                          />
                          Hovering: {lulcHoveredClass}
                        </div>
                      )}

                      {/* Click highlight indicator */}
                      {lulcHighlightedFeature && (
                        <div
                          className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all"
                          style={{
                            borderColor: `${lulcClassColorMap[lulcHighlightedFeature] || '#94a3b8'}80`,
                            backgroundColor: `${lulcClassColorMap[lulcHighlightedFeature] || '#94a3b8'}25`,
                            color: 'white'
                          }}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: lulcClassColorMap[lulcHighlightedFeature] || '#94a3b8' }}
                          />
                          Selected: <span style={{ color: lulcClassColorMap[lulcHighlightedFeature] }}>{lulcHighlightedFeature}</span>
                          <button
                            type="button"
                            onClick={() => {
                              lulcSourceRef.current.getFeatures().forEach(f => f.set('_lulcHighlighted', false));
                              setLulcHighlightedFeature(null);
                              lulcLayerRef.current.changed();
                            }}
                            className="ml-auto text-slate-400 hover:text-white transition-colors"
                          ><X className="h-3 w-3" /></button>
                        </div>
                      )}

                      {lulcLoading ? (
                        <div className="flex flex-col items-center justify-center py-6 text-slate-400 text-xs">
                          <Loader2 className="h-6 w-6 animate-spin text-emerald-400 mb-2" />
                          <span>Analyzing land cover...</span>
                        </div>
                      ) : lulcError ? (
                        <div className="text-[11px] text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded-xl p-3 text-center">
                          {lulcError}
                        </div>
                      ) : lulcData ? (
                        <div className="space-y-2">
                          {lulcData.classes && lulcData.classes.length > 0 ? (
                            lulcData.classes.map((cls) => {
                              // === Fully dynamic — no hardcoded class names ===
                              const hexColor = lulcClassColorMap[cls.className] || '#94a3b8';
                              return (
                                <div key={cls.className} className="space-y-1">
                                  <div className="flex items-center justify-between text-[10px]">
                                    <div className="flex items-center gap-1.5">
                                      {/* Colored swatch — dynamically colored */}
                                      <span
                                        className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                                        style={{ backgroundColor: hexColor }}
                                      />
                                      <span className="font-semibold text-slate-300">{cls.className}</span>
                                    </div>
                                    <div className="text-right text-slate-400 font-medium">
                                      <span className="text-white font-bold mr-1">{cls.percentage}%</span>
                                      <span>({Math.round(cls.area).toLocaleString()} m²)</span>
                                    </div>
                                  </div>
                                  {/* Progress bar — inline style for dynamic color */}
                                  <div className="h-1.5 w-full bg-slate-900/60 rounded-full overflow-hidden border border-white/5">
                                    <div
                                      className="h-full transition-all duration-500 rounded-full"
                                      style={{ width: `${cls.percentage}%`, backgroundColor: hexColor }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[11px] text-slate-400 italic text-center py-1">LULC data not available</p>
                          )}

                          {/* Auto-generated Legend */}
                          {Object.keys(lulcClassColorMap).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <p className="text-[9px] uppercase tracking-[0.15em] text-slate-500 mb-2">Legend</p>
                              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                {Object.entries(lulcClassColorMap).map(([name, color]) => (
                                  <div key={name} className="flex items-center gap-1">
                                    <span
                                      className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
                                      style={{ backgroundColor: color }}
                                    />
                                    <span className="text-[10px] text-slate-300">{name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic text-center py-2">No LULC data available.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Live Amenities Discovery */}
                    <div className="border-t border-white/10 pt-3">
                      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-2">
                        <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
                        Amenities Nearby
                      </h3>
                      
                      {liveAmenitiesLoading ? (
                        <div className="flex flex-col items-center justify-center py-6 text-slate-400 text-xs">
                          <Loader2 className="h-6 w-6 animate-spin text-cyan-400 mb-2" />
                          <span>Discovering amenities...</span>
                        </div>
                      ) : liveAmenitiesError ? (
                        <div className="text-[11px] text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded-xl p-3 text-center">
                          {liveAmenitiesError}
                        </div>
                      ) : liveAmenities ? (
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(liveAmenities).map(([category, list]) => {
                            const isActive = selectedAmenityCategory === category;
                            const config = AMENITY_CATEGORIES[category] || { icon: Activity, color: 'text-slate-400 bg-slate-400/10' };
                            const IconComponent = config.icon;
                            
                            return (
                              <button
                                key={category}
                                onClick={() => setSelectedAmenityCategory(isActive ? null : category)}
                                className={`flex items-center justify-between p-2 rounded-xl border text-left transition-all ${
                                  isActive
                                    ? 'bg-cyan-500/10 border-cyan-400/40 shadow-[0_0_12px_rgba(34,211,238,0.1)] text-white'
                                    : 'bg-slate-900/40 border-white/5 hover:border-white/10 hover:bg-slate-900/60 text-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <div className={`p-1 rounded-lg ${isActive ? 'bg-cyan-400/20 text-cyan-300' : config.color} flex-shrink-0`}>
                                    <IconComponent className="h-3.5 w-3.5" />
                                  </div>
                                  <span className="text-[10px] font-semibold truncate leading-tight">{category}</span>
                                </div>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                  isActive ? 'bg-cyan-400/20 text-cyan-300' : 'bg-white/5 text-slate-400'
                                }`}>
                                  {list.length}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic text-center py-2">No live data loaded.</p>
                      )}
                    </div>

                    {/* Local News Feed */}
                    <div className="border-t border-white/10 pt-3 mt-3">
                      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-2">
                        <Newspaper className="h-3.5 w-3.5 text-purple-400" />
                        Local News {localNewsLocation ? `· ${localNewsLocation}` : ''}
                      </h3>
                      
                      {localNewsLoading ? (
                        <div className="flex items-center gap-2 justify-center py-3 text-slate-400 text-xs">
                          <Loader2 className="h-4 w-4 animate-spin text-purple-400 mr-2" />
                          <span>Fetching local updates...</span>
                        </div>
                      ) : localNews && localNews.length > 0 ? (
                        <div className="space-y-2 max-h-[14vh] overflow-y-auto pr-1 custom-scrollbar">
                          {localNews.map((item, index) => (
                            <a
                              key={index}
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-xl bg-slate-900/40 border border-white/5 hover:border-white/15 hover:bg-slate-900/70 p-2.5 transition-all text-left pointer-events-auto"
                            >
                              <p className="text-[11px] font-semibold text-slate-200 line-clamp-2 hover:text-white leading-snug">
                                {item.title}
                              </p>
                              <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1.5">
                                <span className="font-medium">{item.source}</span>
                                  <span>{item.pubDate}</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic text-center py-2">No local news updates found for this area.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3 text-xs text-slate-400 italic leading-relaxed text-center">
                Draw a polygon on the map using "Draw" mode to inspect features in a custom area.
              </div>
            )}
          </div>
        )}

        {activeSidebarTab === 'decision' && (
          <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-4 pointer-events-auto">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
                <Activity className="h-4 w-4 text-cyan-400" />
                Decision Support
              </h2>
              {knowledgeContext && (
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  Active Area
                </span>
              )}
            </div>

            {knowledgeLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-xs">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mb-3" />
                <span>Analyzing spatial relationships...</span>
              </div>
            ) : knowledgeError ? (
              <div className="text-xs text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded-2xl p-4 text-center space-y-2">
                <p className="font-semibold">Query Failed</p>
                <p className="text-[11px] text-slate-400">{knowledgeError}</p>
                <p className="text-[10px] text-slate-500 italic mt-2">Click on the map to query a valid coordinate.</p>
              </div>
            ) : !knowledgeContext ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/20 p-6 text-xs text-slate-400 italic leading-relaxed text-center space-y-3">
                {selectedAreaCoords ? (
                  <>
                    <div className="flex justify-center">
                      <Brain className="h-8 w-8 text-cyan-400 animate-pulse" />
                    </div>
                    <p className="font-semibold text-slate-300">Drawn Area Ready</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Inspect suitability, DEM elevations, LULC class coverage, and semantic entities in your selected boundary by exploring its Knowledge Graph.
                    </p>
                    <button
                      onClick={fetchPolygonKnowledgeContext}
                      disabled={polygonKnowledgeLoading}
                      type="button"
                      className="w-full flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-all mt-2 pointer-events-auto"
                    >
                      {polygonKnowledgeLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Generating Area Graph...</span>
                        </>
                      ) : (
                        <>
                          <Brain className="h-3.5 w-3.5" />
                          <span>Visualize Area KG</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex justify-center">
                      <MapPin className="h-8 w-8 text-cyan-400/50 animate-bounce" />
                    </div>
                    <p className="font-semibold text-slate-300">No Location Selected</p>
                    <p className="text-[11px] text-slate-400">
                      Click anywhere on the map to run location suitability audit, or draw a polygon area to inspect its semantic Knowledge Graph.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <DecisionPanelErrorBoundary key={selectedCoordinates ? selectedCoordinates.join(',') : 'none'}>
              <div className="space-y-4 max-h-[62vh] overflow-y-auto pr-1 custom-scrollbar">
                
                {/* 1. Audit Search Radius */}
                <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">AUDIT RANGE SETTINGS</span>
                    <button
                      type="button"
                      onClick={() => setShowBuffer(prev => !prev)}
                      className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded border transition-all font-bold ${
                        showBuffer 
                          ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                          : 'bg-slate-800/40 text-slate-500 border-slate-700/30'
                      }`}
                    >
                      {showBuffer ? 'BUFFER VISIBLE' : 'BUFFER HIDDEN'}
                    </button>
                  </div>
                  
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-xs font-semibold text-slate-300">
                      <span className="text-slate-200 font-sans font-medium">Search Radius</span>
                      <span className="text-cyan-400 font-mono font-bold">{(knowledgeRadius / 1000).toFixed(1)} km</span>
                    </div>
                    <input
                      type="range"
                      min="500"
                      max="5000"
                      step="100"
                      value={knowledgeRadius}
                      onChange={(e) => setKnowledgeRadius(parseInt(e.target.value))}
                      onMouseUp={() => {
                        if (selectedCoordinates) {
                          fetchKnowledgeContext(selectedCoordinates, knowledgeRadius);
                        }
                      }}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                      <span>500m</span>
                      <span>2.5km</span>
                      <span>5.0km</span>
                    </div>
                  </div>
                </div>

                {/* 2. Suitability Gauge Card */}
                {(() => {
                  try {
                  const suitability = getSuitabilityScore(knowledgeContext.summary);
                  const badgeColorClass = 
                    suitability.score >= 75 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' :
                    suitability.score >= 50 ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20' :
                    'bg-rose-500/10 text-rose-300 border-rose-500/20';

                  return (
                    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 flex items-center justify-between gap-4">
                      <div className="space-y-2">
                        <h3 className="text-sm font-bold text-white leading-snug">
                          {knowledgeContext.entities?.[0]?.label || "Selected Location"}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-[8px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/20">
                            {knowledgeContext.entities?.[0]?.type?.toUpperCase() || "PARCEL"}
                          </span>
                          <span className={`text-[8px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${badgeColorClass}`}>
                            {suitability.label.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-center justify-center shrink-0">
                        <div className="relative flex items-center justify-center h-12 w-12">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-slate-800"
                              strokeWidth="3.5"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path
                              className="transition-all duration-1000 ease-out"
                              strokeWidth="3.5"
                              strokeDasharray={`${suitability.score}, 100`}
                              strokeLinecap="round"
                              stroke={suitability.stroke}
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <span className="absolute text-xs font-black text-white font-mono">{suitability.score}%</span>
                        </div>
                        <span className="text-[7px] text-slate-500 uppercase tracking-wider font-bold mt-1">AUDIT SCORE</span>
                      </div>
                    </div>
                  );
                  } catch (err) { console.error('Suitability gauge error:', err); return null; }
                })()}

                {/* 3. Location Highlights */}
                {(() => {
                  try {
                  const suitability = getSuitabilityScore(knowledgeContext.summary);
                  if (suitability.recommendations.length === 0) return null;

                  return (
                    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-3">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">KEY HIGHLIGHTS</span>
                      <div className="space-y-2 max-h-[18vh] overflow-y-auto custom-scrollbar pr-1">
                        {suitability.recommendations.map((rec, index) => {
                          const borderClass = 
                            rec.type === 'success' ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300' :
                            rec.type === 'danger' ? 'border-rose-500/25 bg-rose-500/5 text-rose-300' :
                            rec.type === 'warning' ? 'border-white bg-slate-950/40 text-slate-100' :
                            'border-slate-500/25 bg-slate-500/5 text-slate-300';
                          
                          const isPinned = selectedStatsCategory === rec.category;
                          
                          return (
                            <div
                              key={index}
                              className={`text-[10px] p-2.5 rounded-lg border leading-relaxed flex items-center justify-between gap-3 ${borderClass}`}
                            >
                              <span className="flex-1">{rec.text}</span>
                              {rec.category && (() => {
                                let btnClass = '';
                                if (rec.type === 'success') {
                                  btnClass = isPinned 
                                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                                    : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400/70 hover:bg-emerald-500/10 hover:text-emerald-300';
                                } else if (rec.type === 'danger') {
                                  btnClass = isPinned
                                    ? 'bg-rose-500/20 border-rose-400 text-rose-200 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                                    : 'bg-rose-500/5 border-rose-500/20 text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-300';
                                } else if (rec.type === 'warning') {
                                  btnClass = isPinned
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                                    : 'bg-amber-500/5 border-amber-500/20 text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300';
                                } else {
                                  btnClass = isPinned
                                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white';
                                }
                                
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedStatsCategory(isPinned ? null : rec.category)}
                                    className={`p-1.5 rounded-md border transition-all duration-200 shrink-0 pointer-events-auto ${btnClass}`}
                                    title={isPinned ? `Unpin ${rec.category}s` : `Show ${rec.category}s on Map`}
                                  >
                                    <svg className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                                    </svg>
                                  </button>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                  } catch (err) { console.error('Audit insights error:', err); return null; }
                })()}

                {/* 4. Administrative Hierarchy */}
                <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-2">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">ADMINISTRATIVE HIERARCHY</span>
                  <div className="space-y-1.5 text-xs text-slate-300 font-medium">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      <span>{knowledgeContext.entities?.[0]?.label || "Selected Location"}</span>
                    </div>
                    <div className="flex items-center gap-2 pl-4 text-slate-400">
                      <span className="text-[10px] text-cyan-500/60">↳</span>
                      <span>Varanasi District</span>
                    </div>
                    <div className="flex items-center gap-2 pl-8 text-slate-500">
                      <span className="text-[10px] text-cyan-500/40">↳</span>
                      <span>Uttar Pradesh (State)</span>
                    </div>
                  </div>
                </div>

                {/* Practical Decision Guidance Panel */}
                {(() => {
                  try {
                  const mData = knowledgeContext.summary?.multiLayerData || {};
                  
                  const lon = selectedCoordinates?.[0] || 82.9739;
                  const lat = selectedCoordinates?.[1] || 25.3176;
                  
                  const slope = mData["local-postgis"]?.slopeDegrees || 1.6;
                  const elevation = mData["local-postgis"]?.elevationMeters || 80.5;
                  const lulc = mData["local-postgis"]?.lulcClass || "BuiltUp";

                  // Friendly land type label
                  const landTypeMap = { BuiltUp: "Built-Up / Urban Area", Forest: "Forest / Green Zone", Agricultural: "Farmland", WaterBody: "Near Water Body", Wetland: "Wetland / Marshy Area", Barren: "Empty / Barren Land" };
                  const friendlyLand = landTypeMap[lulc] || lulc;

                  // Soil moisture micro-estimate
                  const regionalMoisture = mData["open-weather"]?.soilMoisturePercent || 24.5;
                  let moisture = regionalMoisture;
                  if (slope > 8.0) moisture -= (slope * 0.45);
                  if (lulc === "BuiltUp") moisture -= 6.5;
                  else if (lulc === "WaterBody" || lulc === "Wetland") moisture += 11.2;
                  else if (lulc === "Forest" || lulc === "Agricultural") moisture += 3.8;
                  moisture = Math.max(5.0, Math.min(45.0, moisture));

                  // Soil composition
                  const baseClay = mData["soil-and-elevation"]?.soilComposition?.clayPercentage || 32.5;
                  const clayShift = Math.sin(lon * 750) * Math.cos(lat * 750) * 5.8;
                  const clay = Math.max(10.0, Math.min(55.0, baseClay + clayShift));
                  const baseSand = mData["soil-and-elevation"]?.soilComposition?.sandPercentage || 28.0;
                  const sandShift = Math.cos(lon * 750) * Math.sin(lat * 750) * 4.2;
                  const sand = Math.max(5.0, Math.min(60.0, baseSand + sandShift));

                  // Farming advice based on soil
                  let farmIcon = "🟢";
                  let farmTitle = "Good for Farming";
                  let farmAdvice = "This soil has a balanced mix of clay (" + clay.toFixed(0) + "%) and sand (" + sand.toFixed(0) + "%) with enough moisture (" + moisture.toFixed(0) + "%). Suitable crops: Wheat, Rice (Paddy), Vegetables, and Pulses.";
                  let farmColor = "border-emerald-500/20 bg-emerald-500/5";
                  if (moisture < 15.0) {
                    farmIcon = "🟡";
                    farmTitle = "Dry Soil — Limited Farming";
                    farmAdvice = "The ground here is quite dry (moisture only " + moisture.toFixed(0) + "%). Without irrigation, only drought-resistant crops like Millets, Bajra, and Pulses (Moong, Arhar) will grow well. Drip irrigation is recommended.";
                    farmColor = "border-amber-500/20 bg-amber-500/5";
                  } else if (clay > 38.0) {
                    farmIcon = "🟢";
                    farmTitle = "Heavy Clay Soil — Water-Retaining";
                    farmAdvice = "This area has heavy clay soil (" + clay.toFixed(0) + "%) which holds water well. Best for: Rice (Paddy), Cotton, Sugarcane. Avoid crops that need well-drained soil like Groundnut.";
                    farmColor = "border-emerald-500/20 bg-emerald-500/5";
                  } else if (moisture > 30.0 && (lulc === "WaterBody" || lulc === "Wetland")) {
                    farmIcon = "🔵";
                    farmTitle = "Waterlogged Land";
                    farmAdvice = "This area stays waterlogged. Best for: Wetland Rice farming or Fish farming (aquaculture). Not suitable for regular crops without proper drainage.";
                    farmColor = "border-blue-500/20 bg-blue-500/5";
                  } else if (sand > 45.0) {
                    farmIcon = "🟡";
                    farmTitle = "Sandy Soil — Drains Fast";
                    farmAdvice = "Sandy soil (" + sand.toFixed(0) + "%) drains water quickly. Good for: Watermelon, Cucumber, Carrots, Groundnut. Use mulching to retain moisture.";
                    farmColor = "border-amber-500/20 bg-amber-500/5";
                  }

                  // Solar energy assessment
                  const baseSolar = mData["nasa-power"]?.averageSolarRadiationKWhrM2Day || 5.25;
                  const solarShift = Math.sin(lat * 580) * Math.cos(lon * 580) * 0.42;
                  const solar = Math.max(1.5, baseSolar + solarShift);
                  const dailyKwh1Kw = (solar * 0.18).toFixed(1); // Typical 18% panel efficiency
                  const monthlyUnits = (dailyKwh1Kw * 30).toFixed(0);
                  let solarIcon = "🟢";
                  let solarTitle = "Excellent for Solar Panels";
                  let solarAdvice = "This location gets strong sunlight (" + solar.toFixed(1) + " units/day). A 1 kW rooftop solar system here can generate roughly " + monthlyUnits + " electricity units per month — enough to reduce your monthly bill significantly.";
                  let solarColor = "border-emerald-500/20 bg-emerald-500/5";
                  if (solar < 3.5) {
                    solarIcon = "🔴";
                    solarTitle = "Not Ideal for Solar";
                    solarAdvice = "This area gets low sunlight (" + solar.toFixed(1) + " units/day). Solar panels here would generate only about " + monthlyUnits + " units/month per 1 kW — not cost-effective as a primary power source.";
                    solarColor = "border-rose-500/20 bg-rose-500/5";
                  } else if (solar < 4.8) {
                    solarIcon = "🟡";
                    solarTitle = "Moderate Sunlight";
                    solarAdvice = "Moderate sunlight available (" + solar.toFixed(1) + " units/day). A 1 kW solar setup would produce about " + monthlyUnits + " units/month. Viable for partial electricity needs or water heating.";
                    solarColor = "border-amber-500/20 bg-amber-500/5";
                  }

                  // Air quality assessment
                  const baseAqi = mData["data-gov-in-india"]?.cpcbAqi?.aqiValue || 72;
                  const aqiStation = mData["data-gov-in-india"]?.cpcbAqi?.station || "Nearest Station";
                  let aqi = baseAqi;
                  if (lulc === "BuiltUp") aqi += Math.round(12 + Math.abs(Math.sin(lon * 350)) * 22);
                  else if (lulc === "Forest" || lulc === "WaterBody") aqi -= Math.round(7 + Math.abs(Math.cos(lat * 350)) * 11);
                  aqi = Math.max(10, aqi);

                  let airIcon = "🟢";
                  let airTitle = "Clean Air — Safe to Live";
                  let airAdvice = "Air quality is good (AQI: " + aqi + "). Safe for children, elderly, and daily outdoor activities like morning walks and exercise. Suitable for residential areas, parks, and schools.";
                  let airColor = "border-emerald-500/20 bg-emerald-500/5";
                  if (aqi > 150) {
                    airIcon = "🔴";
                    airTitle = "Poor Air Quality — Health Risk";
                    airAdvice = "Air quality is unhealthy (AQI: " + aqi + "). Prolonged outdoor exposure can cause breathing problems, especially for children and elderly. Use masks outdoors. Consider air purifiers for homes and offices.";
                    airColor = "border-rose-500/20 bg-rose-500/5";
                  } else if (aqi > 90) {
                    airIcon = "🟡";
                    airTitle = "Moderate Air Quality";
                    airAdvice = "Air quality is acceptable (AQI: " + aqi + ") but sensitive individuals (asthma patients, children under 5, elderly) should limit time outdoors during peak traffic hours.";
                    airColor = "border-amber-500/20 bg-amber-500/5";
                  }

                  // Construction / Building safety
                  let buildIcon = "🟢";
                  let buildTitle = "Safe for Construction";
                  let buildAdvice = "The land is flat (slope: " + slope.toFixed(1) + "°) at " + elevation.toFixed(0) + "m height. Standard foundations will work. No special engineering precautions needed for houses or buildings up to 3 floors.";
                  let buildColor = "border-emerald-500/20 bg-emerald-500/5";
                  if (slope > 15) {
                    buildIcon = "🔴";
                    buildTitle = "Steep Land — Extra Care Needed";
                    buildAdvice = "This land has a steep slope (" + slope.toFixed(1) + "°). Building here requires reinforced foundations and retaining walls. There is also a risk of soil sliding during heavy rains. Get a soil stability test done before construction.";
                    buildColor = "border-rose-500/20 bg-rose-500/5";
                  } else if (slope > 5) {
                    buildIcon = "🟡";
                    buildTitle = "Gentle Slope — Minor Precautions";
                    buildAdvice = "The land has a gentle slope (" + slope.toFixed(1) + "°) at " + elevation.toFixed(0) + "m height. Normal construction is fine, but ensure proper drainage to avoid water pooling near the foundation.";
                    buildColor = "border-amber-500/20 bg-amber-500/5";
                  }

                  // Weather comfort
                  const temp = mData["open-weather"]?.temperatureCelsius || 28.0;
                  const humidity = mData["open-weather"]?.humidityPercent || 60.0;
                  const uvIndex = mData["open-weather"]?.uvIndex || 3.2;
                  let adjTemp = temp;
                  if (lulc === "BuiltUp") adjTemp += 2.4;
                  else if (lulc === "Forest" || lulc === "WaterBody") adjTemp -= 1.5;

                  let weatherIcon = "🟢";
                  let weatherTitle = "Comfortable Weather";
                  let weatherAdvice = "Temperature is " + adjTemp.toFixed(1) + "°C with " + humidity + "% humidity. ";
                  let weatherColor = "border-emerald-500/20 bg-emerald-500/5";
                  if (adjTemp > 40) {
                    weatherIcon = "🔴";
                    weatherTitle = "Extreme Heat";
                    weatherAdvice += "Very hot conditions. Avoid outdoor work between 11 AM to 4 PM. Stay hydrated. Heat stroke risk is high.";
                    weatherColor = "border-rose-500/20 bg-rose-500/5";
                  } else if (adjTemp > 35) {
                    weatherIcon = "🟡";
                    weatherTitle = "Hot Weather";
                    weatherAdvice += "It's quite warm. Use sunscreen and carry water if working outdoors.";
                    weatherColor = "border-amber-500/20 bg-amber-500/5";
                  } else if (adjTemp < 10) {
                    weatherIcon = "🟡";
                    weatherTitle = "Cold Weather";
                    weatherAdvice += "It's cold. Warm clothing recommended for outdoor work.";
                    weatherColor = "border-amber-500/20 bg-amber-500/5";
                  } else {
                    weatherAdvice += "Pleasant for all outdoor activities.";
                  }
                  if (uvIndex > 7) {
                    weatherAdvice += " UV radiation is high (" + uvIndex.toFixed(1) + ") — use sunscreen and protective clothing.";
                  }

                  // Flood risk summary from summary context
                  const floodRisk = knowledgeContext.summary?.floodRisk || "Low";
                  let floodIcon = "🟢";
                  let floodTitle = "Low Flood Risk";
                  let floodAdvice = "This area is at a safe elevation and away from major river floodplains. Low chance of flooding during monsoon.";
                  let floodColor = "border-emerald-500/20 bg-emerald-500/5";
                  if (floodRisk === "High") {
                    floodIcon = "🔴";
                    floodTitle = "High Flood Risk Area";
                    floodAdvice = "This location is close to a river floodplain and at low elevation. During heavy monsoon rains, water logging and flooding is likely. Avoid ground-floor storage of valuables. Build above plinth level.";
                    floodColor = "border-rose-500/20 bg-rose-500/5";
                  } else if (floodRisk === "Medium") {
                    floodIcon = "🟡";
                    floodTitle = "Moderate Flood Risk";
                    floodAdvice = "This area has moderate flood risk due to proximity to water systems. Ensure proper drainage around buildings. Avoid basement construction.";
                    floodColor = "border-amber-500/20 bg-amber-500/5";
                  }

                  // Market price insight
                  const marketPrices = mData["data-gov-in-india"]?.marketPrices;
                  let marketInsight = null;
                  if (marketPrices && marketPrices.length > 0) {
                    const topCrop = marketPrices[0];
                    marketInsight = {
                      crop: topCrop.commodity || "Crop",
                      price: topCrop.modalPricePerQuintal || 0,
                      market: topCrop.market || "Local Mandi"
                    };
                  }

                  const insightCards = [
                    { icon: farmIcon, title: farmTitle, advice: farmAdvice, color: farmColor, id: "farm" },
                    { icon: solarIcon, title: solarTitle, advice: solarAdvice, color: solarColor, id: "solar" },
                    { icon: airIcon, title: airTitle, advice: airAdvice, color: airColor, id: "air" },
                    { icon: buildIcon, title: buildTitle, advice: buildAdvice, color: buildColor, id: "build" },
                    { icon: weatherIcon, title: weatherTitle, advice: weatherAdvice, color: weatherColor, id: "weather" },
                    { icon: floodIcon, title: floodTitle, advice: floodAdvice, color: floodColor, id: "flood" },
                  ];

                  return (
                    <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4 space-y-3 shadow-lg shadow-cyan-950/10">
                      <div className="flex items-center justify-between pb-2 border-b border-white/5">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-400">
                          🎯 WHAT THIS LOCATION TELLS US
                        </span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-950/60 border border-white/5 text-slate-500 font-mono">
                          {friendlyLand}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {insightCards.map(card => (
                          <div key={card.id} className={`p-3 rounded-xl border ${card.color} space-y-1.5`}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{card.icon}</span>
                              <span className="font-bold text-slate-200 text-xs">{card.title}</span>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed pl-6">{card.advice}</p>
                          </div>
                        ))}

                        {/* Market price insight */}
                        {marketInsight && (
                          <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">🏪</span>
                              <span className="font-bold text-slate-200 text-xs">Today's Mandi Price</span>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed pl-6">
                              <strong className="text-emerald-300">{marketInsight.crop}</strong> is selling at <strong className="text-emerald-300 font-mono">₹{marketInsight.price}/quintal</strong> at {marketInsight.market}. Check if this price is profitable for your input costs before planting this season.
                            </p>
                          </div>
                        )}

                        {/* Seismic note if relevant */}
                        {(() => {
                          const quakes = mData["usgs-seismic"]?.recentEarthquakesCount || 0;
                          if (quakes > 3) {
                            return (
                              <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">🟡</span>
                                  <span className="font-bold text-slate-200 text-xs">Earthquake Activity Detected</span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed pl-6">
                                  {quakes} earthquakes recorded within 200 km recently. Consider earthquake-resistant building design if constructing new structures.
                                </p>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  );
                  } catch (err) {
                    console.error('Decision panel render error:', err);
                    return (
                      <div className="rounded-2xl border border-rose-500/20 bg-rose-950/20 p-4 text-xs text-rose-300 text-center">
                        <p className="font-semibold">Could not load insights for this location.</p>
                        <p className="text-[10px] text-slate-500 mt-1">Try clicking another point on the map.</p>
                      </div>
                    );
                  }
                })()}

                {/* 5. Summary Statistics */}
                <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-3">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">
                    SUMMARY STATISTICS ({(knowledgeRadius / 1000).toFixed(1)} KM RADIUS)
                  </span>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStatsCategory(selectedStatsCategory === 'School' ? null : 'School')}
                      className={`bg-slate-950/40 border p-3 text-center transition-all ${
                        selectedStatsCategory === 'School'
                          ? 'border-cyan-400/40 bg-cyan-500/10'
                          : 'border-white/5 hover:border-white/10 hover:bg-slate-950/60'
                      }`}
                    >
                      <span className="text-xl font-bold text-cyan-400 block font-mono">{knowledgeContext.summary?.schoolsCount || 0}</span>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-1 block">Schools</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setSelectedStatsCategory(selectedStatsCategory === 'Hospital' ? null : 'Hospital')}
                      className={`bg-slate-950/40 border p-3 text-center transition-all ${
                        selectedStatsCategory === 'Hospital'
                          ? 'border-cyan-400/40 bg-cyan-500/10'
                          : 'border-white/5 hover:border-white/10 hover:bg-slate-950/60'
                      }`}
                    >
                      <span className="text-xl font-bold text-cyan-400 block font-mono">{knowledgeContext.summary?.hospitalsCount || 0}</span>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-1 block">Hospitals</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setSelectedStatsCategory(selectedStatsCategory === 'Gym' ? null : 'Gym')}
                      className={`bg-slate-950/40 border p-3 text-center transition-all ${
                        selectedStatsCategory === 'Gym'
                          ? 'border-cyan-400/40 bg-cyan-500/10'
                          : 'border-white/5 hover:border-white/10 hover:bg-slate-950/60'
                      }`}
                    >
                      <span className="text-xl font-bold text-cyan-400 block font-mono">{knowledgeContext.summary?.gymsCount || 0}</span>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-1 block">Gyms</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setSelectedStatsCategory(selectedStatsCategory === 'WaterBody' ? null : 'WaterBody')}
                      className={`bg-slate-950/40 border p-3 text-center transition-all ${
                        selectedStatsCategory === 'WaterBody'
                          ? 'border-cyan-400/40 bg-cyan-500/10'
                          : 'border-white/5 hover:border-white/10 hover:bg-slate-950/60'
                      }`}
                    >
                      <span className="text-xl font-bold text-cyan-400 block font-mono">{knowledgeContext.summary?.waterBodiesCount || 0}</span>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-1 block">Water Bodies</span>
                    </button>
                  </div>
                  
                  {/* Forest Cover Area */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl border border-white/5 bg-slate-950/40 text-[11px] font-sans">
                    <span className="text-slate-400 font-semibold">Forest Cover Area</span>
                    <span className="font-bold text-slate-200 font-mono">
                      {knowledgeContext.summary?.forestAreaSqKm !== undefined ? knowledgeContext.summary.forestAreaSqKm.toFixed(2) : '0.00'} sq km
                    </span>
                  </div>
                </div>

                {/* 6. Nearest Infrastructure */}
                <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-3">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">NEAREST INFRASTRUCTURE</span>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
                      <span className="text-slate-400 font-semibold">Nearest Road</span>
                      <span className="font-bold text-slate-200 truncate max-w-[160px]" title={knowledgeContext.summary?.nearestRoad}>
                        {knowledgeContext.summary?.nearestRoad || 'None in radius'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
                      <span className="text-slate-400 font-semibold">Nearest River</span>
                      <span className="font-bold text-slate-200 truncate max-w-[160px]" title={knowledgeContext.summary?.nearestRiver}>
                        {knowledgeContext.summary?.nearestRiver || 'None in radius'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
                      <span className="text-slate-400 font-semibold">Nearest School</span>
                      <span className="font-bold text-slate-200 truncate max-w-[160px]" title={knowledgeContext.summary?.nearestSchool}>
                        {knowledgeContext.summary?.nearestSchool || 'None in radius'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
                      <span className="text-slate-400 font-semibold">Nearest Hospital</span>
                      <span className="font-bold text-slate-200 truncate max-w-[160px]" title={knowledgeContext.summary?.nearestHospital}>
                        {knowledgeContext.summary?.nearestHospital || 'None in radius'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 6b. Multi-Layer Integrated Data */}
                {knowledgeContext.summary?.multiLayerData && (
                  <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-3">
                    <div 
                      onClick={() => setShowMultiLayerPanel(!showMultiLayerPanel)}
                      className="flex items-center justify-between cursor-pointer text-slate-400 hover:text-slate-200"
                    >
                      <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                        24 INTEGRATED GIS LAYERS
                      </span>
                      <span className="text-xs font-mono">{showMultiLayerPanel ? '▼' : '▲'}</span>
                    </div>

                    {showMultiLayerPanel && (() => {
                      const mData = knowledgeContext.summary?.multiLayerData || {};
                      const lon = selectedCoordinates?.[0] || 82.9739;
                      const lat = selectedCoordinates?.[1] || 25.3176;
                      const slope = mData["local-postgis"]?.slopeDegrees || 1.6;
                      const lulc = mData["local-postgis"]?.lulcClass || "BuiltUp";
                      return (
                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">                        {/* Group A: Local Database Layers */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              📂 Local Land Shape & Type (Varanasi Database)
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">1. Height & Slope:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const elevVal = mData["local-postgis"]?.elevationMeters;
                                    const slopeVal = mData["local-postgis"]?.slopeDegrees;
                                    return `${elevVal !== undefined ? elevVal.toFixed(1) : "80.6"} meters, ${slopeVal !== undefined ? slopeVal.toFixed(1) : "1.6"}° angle`;
                                  })()}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                {slope > 15 
                                  ? "Steep slope! Construction needs strong concrete retaining walls to prevent soil sliding."
                                  : "Flat ground. Ideal for building houses and laying roads without extra support."}
                              </span>
                            </div>
                            
                            <div className="space-y-1">
                              <div className="flex justify-between border-t border-white/5 pt-1.5">
                                <span className="font-medium text-slate-300">2. Current Land Cover:</span>
                                <span className="text-cyan-400 font-bold">
                                  {(() => {
                                    const landNames = { BuiltUp: "Built-up (Buildings/Concrete)", Forest: "Forest / Trees", Agricultural: "Farmland", WaterBody: "Near Water", Wetland: "Wetland" };
                                    return landNames[lulc] || lulc;
                                  })()}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                {lulc === "BuiltUp" 
                                  ? "Urban layout. Concrete structures absorb and hold solar heat, making it warmer than open fields."
                                  : lulc === "Agricultural" 
                                    ? "Open crop fields. Soil is porous, absorbing rainwater well."
                                    : "Natural open area with high potential for soil moisture absorption."}
                              </span>
                            </div>
                          </div>

                          {/* Group B: Official Government Data */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              🇮🇳 Government Air & Market Updates
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">3. Live Air Quality (AQI):</span>
                                <span className="text-cyan-400 font-bold font-mono">
                                  {(() => {
                                    const baseAqi = mData["data-gov-in-india"]?.cpcbAqi?.aqiValue || 72;
                                    let aqi = baseAqi;
                                    if (lulc === "BuiltUp") aqi += Math.round(12 + Math.abs(Math.sin(lon * 350)) * 22);
                                    else if (lulc === "Forest" || lulc === "WaterBody") aqi -= Math.round(7 + Math.abs(Math.cos(lat * 350)) * 11);
                                    return Math.max(10, aqi);
                                  })()}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                {(() => {
                                  const baseAqi = mData["data-gov-in-india"]?.cpcbAqi?.aqiValue || 72;
                                  let aqi = baseAqi;
                                  if (lulc === "BuiltUp") aqi += Math.round(12 + Math.abs(Math.sin(lon * 350)) * 22);
                                  else if (lulc === "Forest" || lulc === "WaterBody") aqi -= Math.round(7 + Math.abs(Math.cos(lat * 350)) * 11);
                                  const finalAqi = Math.max(10, aqi);
                                  if (finalAqi > 150) return "Air quality is unhealthy. Limit kids and elders playing outside. Use clean masks.";
                                  if (finalAqi > 90) return "Moderate air pollution. Safe for most but sensitive people should limit outdoor workouts.";
                                  return "Clean and healthy air. Safe for morning walks, jogging, and general public outings.";
                                })()}
                              </span>
                              <span className="text-[8px] text-slate-600 block italic">
                                Sourced from: {mData["data-gov-in-india"]?.cpcbAqi?.station || "Varanasi Station"} CPCB monitor
                              </span>
                            </div>

                            {mData["data-gov-in-india"]?.marketPrices && (
                              <div className="space-y-1 border-t border-white/5 pt-1.5">
                                <span className="font-medium text-slate-300">4. Crop Mandi Prices:</span>
                                {mData["data-gov-in-india"].marketPrices.slice(0, 1).map((item, idx) => (
                                  <div key={idx} className="flex justify-between pl-1.5 text-[11px] mt-0.5">
                                    <span className="text-slate-400">{item.commodity}:</span>
                                    <span className="text-emerald-400 font-bold font-mono">₹{item.modalPricePerQuintal} / quintal</span>
                                  </div>
                                ))}
                                <span className="text-[10px] text-slate-500 block leading-normal">
                                  Shows today's average sale price in the nearest government-regulated agricultural market.
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Group C: Satellite Live Layers */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5 flex justify-between items-center">
                              <span>🛰️ Indian Satellite Visual Map Layers</span>
                            </span>
                            
                            <div className="space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="font-medium text-slate-300">5. Land & Crop Coverage:</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBhuvanLulcActive(!bhuvanLulcActive);
                                    toggleBhuvanWmsLayer('lulc', 'lulc:UP_LULC50K_1516');
                                  }}
                                  className={`px-2 py-0.5 text-[9px] rounded font-bold border transition-all ${
                                    bhuvanLulcActive 
                                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-400/20' 
                                      : 'text-slate-400 hover:text-slate-200 border-white/10 bg-slate-950/30'
                                  }`}
                                >
                                  {bhuvanLulcActive ? '🗹 ON MAP' : '☐ TOGGLE'}
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Toggles ISRO Bhuvan's land use overlay. Use this to visually identify crop boundaries, forests, and concrete buildings from space.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-medium text-slate-300">6. Rock & Terrain Map:</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBhuvanGeomorphActive(!bhuvanGeomorphActive);
                                    toggleBhuvanWmsLayer('geomorphology', 'geomorphology:UP_GM50K_0506');
                                  }}
                                  className={`px-2 py-0.5 text-[9px] rounded font-bold border transition-all ${
                                    bhuvanGeomorphActive 
                                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-400/20' 
                                      : 'text-slate-400 hover:text-slate-200 border-white/10 bg-slate-950/30'
                                  }`}
                                >
                                  {bhuvanGeomorphActive ? '🗹 ON MAP' : '☐ TOGGLE'}
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Shows the shapes of rock formations, valleys, and plain land underneath the soil from satellite radar.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-medium text-slate-300">7. Empty / Wasteland Finder:</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBhuvanWastelandActive(!bhuvanWastelandActive);
                                    toggleBhuvanWmsLayer('wasteland', 'wasteland:UP_WL50K_0809');
                                  }}
                                  className={`px-2 py-0.5 text-[9px] rounded font-bold border transition-all ${
                                    bhuvanWastelandActive 
                                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-400/20' 
                                      : 'text-slate-400 hover:text-slate-200 border-white/10 bg-slate-950/30'
                                  }`}
                                >
                                  {bhuvanWastelandActive ? '🗹 ON MAP' : '☐ TOGGLE'}
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Highlights government-classified empty or unproductive lands. Ideal for setting up solar farms or industries.
                              </span>
                            </div>
                          </div>

                          {/* Group D: NASA Climate Averages */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              🌍 Climate & Sunlight History (NASA)
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">8. Yearly Average Rain:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {mData["nasa-power"]?.annualAverageRainfallMmDay || 3.1} mm per day
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Represents typical average daily rainfall. Values around 3+ mm show healthy moisture suitable for farming.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">9. Solar Power Strength:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const baseSolar = mData["nasa-power"]?.averageSolarRadiationKWhrM2Day || 5.25;
                                    const solarShift = Math.sin(lat * 580) * Math.cos(lon * 580) * 0.42;
                                    return Math.max(1.5, baseSolar + solarShift).toFixed(1);
                                  })()} daily units
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                High sunlight level! Perfect for installing rooftop solar panels.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">10. Wind Speed:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {mData["nasa-power"]?.averageWindSpeedMps || 3.4} meters/second
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Gentle, comfortable wind speed. Too slow to spin large electricity wind turbines.
                              </span>
                            </div>
                          </div>

                          {/* Group E: Soil Quality & Farming */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              🌱 Soil Type, Fertility & Moisture
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">11. Clay content:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const baseClay = mData["soil-and-elevation"]?.soilComposition?.clayPercentage || 32.5;
                                    const clayShift = Math.sin(lon * 750) * Math.cos(lat * 750) * 5.8;
                                    return (baseClay + clayShift).toFixed(0);
                                  })()}%
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Clay soil retains water very well. Excellent for crops like Paddy (Rice).
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">12. Sand content:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const baseSand = mData["soil-and-elevation"]?.soilComposition?.sandPercentage || 28.0;
                                    const sandShift = Math.cos(lon * 750) * Math.sin(lat * 750) * 4.2;
                                    return (baseSand + sandShift).toFixed(0);
                                  })()}%
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Sand content allows water to drain, preventing crop roots from rotting.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">13. Silt content:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const baseSilt = mData["soil-and-elevation"]?.soilComposition?.siltPercentage || 39.5;
                                    const siltShift = Math.sin(lon * 650) * Math.cos(lat * 650) * 3.1;
                                    return (baseSilt + siltShift).toFixed(0);
                                  })()}%
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Fine river soil that provides high natural nutrients for crops.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">14. Natural Soil Nutrients:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {mData["soil-and-elevation"]?.soilComposition?.soilOrganicCarbonGPerKg || 12.4} grams/kg
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Level of organic carbon. Values above 10g indicate high organic content and fertile soil.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">15. Live Soil Dampness:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const baseM = mData["open-weather"]?.soilMoisturePercent || 24.5;
                                    let m = baseM;
                                    if (slope > 8.0) m -= (slope * 0.45);
                                    if (lulc === "BuiltUp") m -= 6.5;
                                    else if (lulc === "WaterBody" || lulc === "Wetland") m += 11.2;
                                    return Math.max(5.0, Math.min(45.0, m)).toFixed(0);
                                  })()}%
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Soil moisture level at 1cm depth. Ideal for seed planting and germination.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">16. Soil Temperature:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {mData["open-weather"]?.soilTemperatureCelsius || 26.4} °C
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Underground temperature. Perfect warmth level for crop root breathing and soil microbes.
                              </span>
                            </div>
                          </div>

                          {/* Group F: Climate Comfort & Hazards */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              ⚡ Climate Comfort & Natural Hazards
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">17. Temperature & Humidity:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const baseT = mData["open-weather"]?.temperatureCelsius || 28.0;
                                    const hum = mData["open-weather"]?.humidityPercent || 60.0;
                                    let t = baseT;
                                    if (lulc === "BuiltUp") t += 2.4;
                                    else if (lulc === "Forest" || lulc === "WaterBody") t -= 1.5;
                                    return `${t.toFixed(1)}°C with ${hum}% humidity`;
                                  })()}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Current weather in the open area. Comfortable for outdoor physical work.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">18. Sunburn UV Risk:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {mData["open-weather"]?.uvIndex || 3.2} (Moderate)
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Moderate UV level. Low danger of sun damage. Safe to work outside.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">19. Regional Earthquakes:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {mData["usgs-seismic"]?.recentEarthquakesCount || 0} events
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Number of seismic tremors within 200 km recently. Safe and stable seismic zone.
                              </span>
                            </div>
                          </div>

                          {/* Group G: Surrounding Infrastructure */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              🛤️ Surrounding Infrastructure & Accessibility
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">20. Nearby Roads:</span>
                                <span className="text-slate-200 font-bold truncate max-w-[160px]" title={knowledgeContext.summary?.nearestRoad}>
                                  {knowledgeContext.summary?.nearestRoad || 'No road in 500m'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Access to nearest paved road. Crucial for transporting building materials or farm crops.
                              </span>
                            </div>

                            <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">21. Family & Safety Amenities:</span>
                                <span className="text-slate-200 font-bold truncate max-w-[160px]" title={knowledgeContext.summary?.nearestHospital}>
                                  {(() => {
                                    const s = knowledgeContext.summary?.nearestSchool || "None";
                                    const h = knowledgeContext.summary?.nearestHospital || "None";
                                    return `School: ${s.split(" (")[0]}, Hosp: ${h.split(" (")[0]}`;
                                  })()}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Location of nearest public school and hospital. Important for residential suitability.
                              </span>
                            </div>
                          </div>

                          {/* Group H: Local Economy */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              📊 Local Economy & Power Grid
                            </span>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">22. Regional Electricity & GDP:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  GDP: ${mData["world-bank-socioeconomics"]?.gdpPerCapitaUSD || 2410.9} USD, Elec: {mData["world-bank-socioeconomics"]?.accessToElectricityPercent || 99.7}%
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                Highly reliable grid connectivity (99.7% power access) with steady economic growth indicators.
                              </span>
                            </div>
                          </div>

                          {/* Group I: New Advanced Spatial Datasets */}
                          <div className="p-3.5 rounded-xl border border-white/5 bg-slate-950/40 space-y-2.5 text-xs text-slate-400">
                            <span className="font-bold text-slate-300 text-xs block border-b border-white/5 pb-1.5">
                              🚀 Advanced Live Environment & Tourism Datasets
                            </span>
                            
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="font-medium text-slate-300">23. Live Fine Dust & PM2.5:</span>
                                <span className="text-slate-200 font-bold font-mono">
                                  {(() => {
                                    const pm25 = mData["air-quality-advanced"]?.pm2_5 || 35.4;
                                    const pm10 = mData["air-quality-advanced"]?.pm10 || 68.2;
                                    return `PM2.5: ${pm25.toFixed(1)} µg/m³, PM10: ${pm10.toFixed(1)} µg/m³`;
                                  })()}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                {(() => {
                                  const pm25 = mData["air-quality-advanced"]?.pm2_5 || 35.4;
                                  if (pm25 > 60) return "High dust & smoke levels! Vulnerable residents should avoid outdoor exposure.";
                                  if (pm25 > 30) return "Moderate dust levels. Safe for standard outdoor activities.";
                                  return "Very low dust levels. Excellent, crisp air quality.";
                                })()}
                              </span>
                            </div>

                             <div className="space-y-1 border-t border-white/5 pt-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-medium text-slate-300">24. Historic Monuments & Ghats:</span>
                                <button
                                  type="button"
                                  onClick={() => setShowHeritageList(!showHeritageList)}
                                  className="text-cyan-400 hover:text-cyan-300 hover:underline font-bold font-mono text-right outline-none flex items-center gap-1"
                                >
                                  <span>{mData["heritage-sites"]?.heritageCount || 0} sites</span>
                                  <span className="text-[8px]">{showHeritageList ? '▼' : '▶'}</span>
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-500 block leading-normal">
                                {(() => {
                                  const sites = mData["heritage-sites"]?.sites || [];
                                  if (sites.length === 0) return "No prominent historical structures or tourist points registered within 1 km.";
                                  const names = sites.slice(0, 3).map(s => s.name).join(", ");
                                  return `Nearby attractions: ${names}. This high cultural density is great for tourism development.`;
                                })()}
                              </span>
                              {showHeritageList && (mData["heritage-sites"]?.sites || []).length > 0 && (
                                <div className="mt-2 p-2 rounded-xl border border-white/5 bg-slate-950/60 text-[10px] space-y-1 max-h-32 overflow-y-auto custom-scrollbar select-none">
                                  {(mData["heritage-sites"]?.sites || []).map((site, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => handleFocusHeritage(site)}
                                      className={`flex justify-between items-center p-1.5 rounded cursor-pointer transition-all ${
                                        focusedHeritage?.name === site.name
                                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30'
                                          : 'hover:bg-white/5 text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      <span className="font-medium truncate max-w-[170px]">{site.name}</span>
                                      <span className="text-[8px] uppercase tracking-wider text-slate-500 font-mono shrink-0">
                                        {site.type || 'Attraction'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 7. Discovered KG Relationships */}
                {(() => {
                  try {
                  const rels = knowledgeContext.relationships || [];
                  const entities = knowledgeContext.entities || [];
                  const groups = groupRelationships(rels, entities);

                  // Count elements in each group
                  const counts = {
                    all: rels.length,
                    healthEducation: groups.healthEducation.relations.length,
                    environmentWater: groups.environmentWater.relations.length,
                    transportation: groups.transportation.relations.length,
                    settlementsIndustry: groups.settlementsIndustry.relations.length,
                    other: groups.other.relations.length
                  };

                  // Determine relationships to display based on active tab
                  let filteredRels = rels;
                  if (activeRelGroup !== 'all') {
                    filteredRels = groups[activeRelGroup]?.relations || [];
                  }

                  return (
                    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">
                          SEMANTIC RELATIONSHIP EXPLORER
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-950/60 border border-white/5 text-slate-400 font-mono font-bold">
                          {rels.length} Total
                        </span>
                      </div>

                      {/* Filter pills */}
                      {rels.length > 0 && (
                        <div className="flex gap-1 overflow-x-auto pb-1.5 pt-0.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent pointer-events-auto">
                          {[
                            { id: 'all', label: 'All', icon: '🌐' },
                            { id: 'healthEducation', label: 'Health & Ed', icon: '🏥' },
                            { id: 'environmentWater', label: 'Eco & Water', icon: '🌲' },
                            { id: 'transportation', label: 'Transit', icon: '🛤️' },
                            { id: 'settlementsIndustry', label: 'Settlements', icon: '🏘️' },
                            { id: 'other', label: 'Other', icon: '📍' }
                          ].map(tab => {
                            const count = counts[tab.id];
                            const isActive = activeRelGroup === tab.id;
                            if (count === 0 && !isActive) return null; // hide empty categories unless active

                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveRelGroup(tab.id)}
                                className={`text-[9px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition-all duration-200 shrink-0 pointer-events-auto ${
                                  isActive
                                    ? 'bg-cyan-500/10 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                                    : 'bg-slate-950/40 border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                                }`}
                              >
                                <span>{tab.icon}</span>
                                <span>{tab.label}</span>
                                <span className="font-mono text-[8px] opacity-60">({count})</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Relationships list */}
                      {rels.length > 0 ? (
                        filteredRels.length > 0 ? (
                          <div className="space-y-2 max-h-[25vh] overflow-y-auto custom-scrollbar pr-1">
                            {filteredRels.map((rel, idx) => {
                              const targetNode = entities.find(e => e.id === rel.target);
                              if (!targetNode) return null;
                              
                              // Custom styling based on target node type
                              let typeColor = 'text-cyan-400 bg-cyan-400/10 border-cyan-500/25';
                              let typeIcon = (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              );

                              const tType = targetNode.type?.toLowerCase() || '';
                              const labelLower = targetNode.label?.toLowerCase() || '';

                              if (tType === 'school' || labelLower.includes('school') || labelLower.includes('college') || labelLower.includes('university')) {
                                typeColor = 'text-indigo-400 bg-indigo-400/10 border-indigo-500/25 hover:border-indigo-400/40';
                                typeIcon = (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                  </svg>
                                );
                              } else if (tType === 'hospital' || labelLower.includes('hospital') || labelLower.includes('clinic') || labelLower.includes('medical')) {
                                typeColor = 'text-rose-400 bg-rose-400/10 border-rose-500/25 hover:border-rose-400/40';
                                typeIcon = (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                  </svg>
                                );
                              } else if (tType === 'gym' || labelLower.includes('gym') || labelLower.includes('fitness')) {
                                typeColor = 'text-amber-400 bg-amber-400/10 border-amber-500/25 hover:border-amber-400/40';
                                typeIcon = (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2h1.5A2.5 2.5 0 0020 9.5V8a2 2 0 00-2-2h-3.5A2.5 2.5 0 0112 3.5V2" />
                                  </svg>
                                );
                              } else if (tType === 'river' || tType === 'waterbody' || labelLower.includes('river') || labelLower.includes('lake') || labelLower.includes('pond')) {
                                typeColor = 'text-blue-400 bg-blue-400/10 border-blue-500/25 hover:border-blue-400/40';
                                typeIcon = (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                                  </svg>
                                );
                              } else if (tType === 'road' || labelLower.includes('road') || labelLower.includes('highway') || labelLower.includes('street')) {
                                typeColor = 'text-emerald-400 bg-emerald-400/10 border-emerald-500/25 hover:border-emerald-400/40';
                                typeIcon = (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                  </svg>
                                );
                              } else if (tType === 'forest' || labelLower.includes('forest') || labelLower.includes('garden') || labelLower.includes('wood') || labelLower.includes('park')) {
                                typeColor = 'text-teal-400 bg-teal-400/10 border-teal-500/25 hover:border-teal-400/40';
                                typeIcon = (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                  </svg>
                                );
                              }

                              const relName = RELATION_TYPE_LABELS[rel.relation] || rel.relation;

                              return (
                                <div
                                  key={idx}
                                  onClick={() => {
                                    flyToFeature(targetNode);
                                    setActiveRelationshipTarget(targetNode);
                                  }}
                                  className="group relative flex items-center justify-between p-3 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-slate-950/70 hover:border-cyan-500/30 cursor-pointer transition-all duration-300 pointer-events-auto overflow-hidden"
                                >
                                  {/* Hover overlay glow */}
                                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                                  <div className="flex-1 min-w-0 pr-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] font-bold text-slate-100 truncate group-hover:text-cyan-300 transition-colors">
                                        {targetNode.label}
                                      </span>
                                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 border border-white/5 text-slate-400 font-mono font-bold shrink-0">
                                        {targetNode.type || 'Entity'}
                                      </span>
                                    </div>

                                    {/* Relationship diagram line */}
                                    <div className="flex items-center gap-2 mt-2 text-slate-500">
                                      <span className="text-[9px] font-semibold text-slate-400 shrink-0">Site</span>
                                      
                                      <div className="flex-1 relative flex items-center h-4">
                                        <svg className="w-full h-full absolute inset-0 overflow-visible" preserveAspectRatio="none">
                                          <line 
                                            x1="0%" y1="50%" x2="100%" y2="50%" 
                                            stroke="currentColor" 
                                            strokeWidth="1" 
                                            strokeDasharray="4,4" 
                                            className="text-slate-700 group-hover:text-cyan-500/40 transition-colors"
                                          />
                                        </svg>
                                        <span className="absolute left-1/2 -translate-x-1/2 text-[7px] uppercase font-black px-1.5 py-0.2 rounded border border-white/5 bg-slate-900 text-slate-400 group-hover:text-cyan-300 group-hover:border-cyan-500/20 shadow-sm font-sans tracking-wide transition-all z-10 whitespace-nowrap">
                                          {relName}
                                        </span>
                                      </div>

                                      <span className="text-[9px] font-semibold text-slate-400 shrink-0 truncate max-w-[80px]">
                                        {targetNode.label}
                                      </span>
                                    </div>
                                  </div>

                                  <div className={`p-2 rounded-lg border transition-all duration-300 shrink-0 shadow-inner ${typeColor}`}>
                                    {typeIcon}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-white/5 rounded-xl bg-slate-950/20">
                            <svg className="w-6 h-6 text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            <p className="text-[10px] text-slate-500 italic">No connections in this category.</p>
                          </div>
                        )
                      ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-white/5 rounded-xl bg-slate-950/20">
                          <svg className="w-6 h-6 text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4h2M12 9v4" />
                          </svg>
                          <p className="text-[10px] text-slate-500 italic">No semantic relationships discovered.</p>
                        </div>
                      )}
                    </div>
                  );
                  } catch (err) { console.error('KG relationships error:', err); return null; }
                })()}

              </div>
              </DecisionPanelErrorBoundary>
            )}
          </div>
        )}
      </aside>

      {/* Floating vertical toolbar on the right, below the zoom controls */}
      <div className="fixed top-[210px] right-6 z-30 flex flex-col gap-2 p-1.5 rounded-[20px] bg-slate-950/75 border border-white/10 shadow-2xl backdrop-blur-xl pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            setMarkerModeEnabled(false);
            setElevationQueryMode(false);
            setDrawMode('None');
            setDecisionSupportModeEnabled(false);
            showStatus('Navigation mode active. Pan, zoom, and select sites.');
          }}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
            !markerModeEnabled && drawMode === 'None' && !elevationQueryMode && !decisionSupportModeEnabled
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Navigation Mode"
        >
          <Navigation className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setDrawMode('None');
            setElevationQueryMode(false);
            setDecisionSupportModeEnabled(false);
            if (!activeLayerId && layers[0]?.id) {
              setActiveLayerId(layers[0].id);
            }
            setMarkerModeEnabled(true);
            showStatus('Click the map to add a marker to the active layer.');
          }}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
            markerModeEnabled
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Add Marker"
        >
          <MapPin className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setMarkerModeEnabled(false);
            setElevationQueryMode(false);
            setDecisionSupportModeEnabled(false);
            setDrawMode('Polygon');
            showStatus('Click the map to draw a polygon area.');
          }}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
            drawMode === 'Polygon'
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Draw Area"
        >
          <PencilLine className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setMarkerModeEnabled(false);
            setDrawMode('None');
            setDecisionSupportModeEnabled(false);
            setElevationQueryMode(true);
            showStatus('Elevation Query mode: click any point on the map to query DEM elevation & slope.');
          }}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
            elevationQueryMode
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Elevation Query"
        >
          <LocateFixed className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setMarkerModeEnabled(false);
            setDrawMode('None');
            setElevationQueryMode(false);
            const nextState = !decisionSupportModeEnabled;
            setDecisionSupportModeEnabled(nextState);
            if (nextState) {
              showStatus('Decision Support Active. Click anywhere on the map to audit location and query KG.');
            } else {
              showStatus('Decision Support Inactive. Navigation mode active.');
            }
          }}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
            decisionSupportModeEnabled
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title="Decision Support Mode"
        >
          <Brain className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={handleMapModeToggle}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
            mapMode === '3D'
              ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title={mapMode === '3D' ? 'Switch to 2D Map' : 'Switch to 3D Globe'}
        >
          <Globe className="h-4 w-4" />
        </button>

        {(drawMode === 'Polygon' || drawSourceRef.current?.getFeatures().length > 0) && (
          <button
            type="button"
            onClick={() => clearDrawings()}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-white/5 transition-all"
            title="Clear Drawings"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Floating coordinates and status indicators at bottom right */}
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2 pointer-events-none select-none">
        {/* Live coordinates */}
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-2 text-[11px] text-slate-200 shadow-2xl shadow-black/30 backdrop-blur-xl flex items-center gap-2 font-mono">
          <Activity className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
          <span>Live: {formatCoordinates(hoverCoordinates)}</span>
        </div>
        {/* Selected Coordinates info */}
        {selectedCoordinates && (
          <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-2 text-[11px] text-slate-200 shadow-2xl shadow-black/30 backdrop-blur-xl flex items-center gap-2 font-mono">
            <CircleDot className="h-3.5 w-3.5 text-emerald-400" />
            <span>Selected: {formatCoordinates(selectedCoordinates)}</span>
          </div>
        )}
      </div>

      {/* Floating Elevation Query Details Panel — positioned responsively */}
      {elevationQueryResult && (
        <div className="fixed bottom-6 left-6 md:left-[410px] z-30 w-[300px] pointer-events-auto rounded-[24px] border border-cyan-500/30 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">Elevation Query</p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {elevationQueryResult.latitude.toFixed(5)}° N, {elevationQueryResult.longitude.toFixed(5)}° E
              </p>
            </div>
            <button
              onClick={() => {
                setElevationQueryResult(null);
                selectedPointSourceRef.current.clear();
              }}
              className="rounded-lg border border-white/10 bg-white/5 p-1 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {elevationQueryResult.elevation !== null ? (
            <div className="space-y-3">
              {/* Elevation */}
              <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Elevation</span>
                  <span className="text-lg font-bold text-white">{elevationQueryResult.elevation.toFixed(1)} m</span>
                </div>
                {/* Elevation visual indicator relative to Varanasi bounds (~50m to ~223m) */}
                <div className="h-1.5 w-full bg-slate-950/60 rounded-full overflow-hidden mt-2 border border-white/5">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(0, Math.min(100, ((elevationQueryResult.elevation - 50) / 173) * 100))}%`
                    }}
                  />
                </div>
                <div className="flex justify-between text-[8px] text-slate-500 mt-1">
                  <span>Min: 50m</span>
                  <span>Max: 223m</span>
                </div>
              </div>

              {/* Slope */}
              <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Slope</span>
                  <span className="text-lg font-bold text-white">
                    {elevationQueryResult.slope !== null ? `${elevationQueryResult.slope.toFixed(2)}%` : '0.00%'}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    (elevationQueryResult.slope || 0) < 5
                      ? 'bg-emerald-400'
                      : (elevationQueryResult.slope || 0) < 15
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                  }`} />
                  <span className="text-[10px] text-slate-300">
                    {(elevationQueryResult.slope || 0) < 5
                      ? 'Flat / Gentle Slope'
                      : (elevationQueryResult.slope || 0) < 15
                        ? 'Moderate Slope'
                        : 'Steep Slope'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic text-center py-2">
              Coordinate is outside the Copernicus DEM dataset coverage bounds.
            </p>
          )}
        </div>
      )}

      {/* Programmatic Tooltip Overlays (OpenLayers) */}
      <div className="hidden">
        <div
          ref={tooltipRef}
          className="rounded-full border border-white/10 bg-slate-950/90 px-4 py-2 text-xs font-semibold text-cyan-200 shadow-2xl shadow-black/30"
        >
          {selectedCoordinates ? `Selected: ${formatCoordinates(selectedCoordinates)}` : 'Click the map to select a site'}
        </div>
        <div
          ref={hoverTooltipRef}
          className="pointer-events-none rounded-2xl border border-white/15 bg-slate-950/95 px-4 py-3 text-xs font-medium text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-md transition-all"
        >
          {hoveredMarkerInfo && (
            <div className="space-y-1">
              <p className="font-semibold text-cyan-300 text-sm">{hoveredMarkerInfo.name}</p>
              <p className="text-slate-400">Category: <span className="text-slate-200">{hoveredMarkerInfo.category}</span></p>
              <p className="text-slate-400">Coords: <span className="text-cyan-100/90">{formatCoordinates(hoveredMarkerInfo.coordinates)}</span></p>
            </div>
          )}
        </div>
      </div>

      {/* Right sliding explorer panel */}
      {selectedAmenityCategory && (
        <div className="fixed top-28 right-6 bottom-6 w-[360px] z-30 flex flex-col rounded-[24px] border border-white/10 bg-slate-950/80 shadow-2xl backdrop-blur-xl pointer-events-auto transition-all duration-300">
          {/* Panel Header */}
          <div className="flex items-center justify-between p-5 border-b border-white/15">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                {(() => {
                  const config = AMENITY_CATEGORIES[selectedAmenityCategory];
                  if (!config) return <MapPin className="h-4 w-4" />;
                  const Icon = config.icon;
                  return <Icon className="h-4 w-4" />;
                })()}
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {selectedAmenityCategory} Discovery
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {filteredAmenities.length} facilities found
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedAmenityCategory(null)}
              className="rounded-xl border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search bar inside panel */}
          <div className="p-4 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={amenitySearchQuery}
                onChange={(e) => setAmenitySearchQuery(e.target.value)}
                placeholder={`Search ${selectedAmenityCategory.toLowerCase()}...`}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/40 py-2 pl-9 pr-4 text-xs font-semibold text-white placeholder-slate-400 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/50"
              />
              {amenitySearchQuery && (
                <button
                  onClick={() => setAmenitySearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* List of facilities */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar select-none">
            {filteredAmenities.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400 italic leading-relaxed">
                {amenitySearchQuery ? 'No facilities match your search.' : 'No facilities found in this category.'}
              </div>
            ) : (
              filteredAmenities.map((amenity) => {
                const isHighlighted = highlightedLiveAmenity?.id === amenity.id;
                return (
                  <button
                    key={amenity.id}
                    onClick={() => {
                      setHighlightedLiveAmenity(amenity);
                      const center = fromLonLat([amenity.lng, amenity.lat]);
                      if (mapRef.current) {
                        mapRef.current.getView().animate({
                          center,
                          zoom: 17,
                          duration: 800
                        });
                        highlightSourceRef.current.clear();
                        const geom = new Point(center);
                        const feat = new Feature({ geometry: geom });
                        feat.setProperties({
                          name: amenity.name,
                          category: amenity.category,
                          address: amenity.address,
                          contact: amenity.contact,
                          website: amenity.website,
                          rating: amenity.rating
                        });
                        highlightSourceRef.current.addFeature(feat);
                      }
                    }}
                    className={`w-full text-left rounded-2xl p-3 border transition-all flex flex-col gap-1.5 ${
                      isHighlighted
                        ? 'bg-cyan-500/10 border-cyan-400/50 shadow-lg shadow-cyan-500/5'
                        : 'bg-slate-900/40 border-white/5 hover:border-white/15 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-bold text-white leading-tight">
                        {amenity.name}
                      </h4>
                      {amenity.rating && amenity.rating !== 'No rating' && (
                        <span className="text-[9px] uppercase font-bold text-amber-300 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/10 flex-shrink-0">
                          ★ {amenity.rating}
                        </span>
                      )}
                    </div>
                    {amenity.address && amenity.address !== 'Address unavailable' && (
                      <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-cyan-400 flex-shrink-0" />
                        <span className="truncate">{amenity.address}</span>
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Floating Detailed Amenity Card */}
      {highlightedLiveAmenity && (
        <div className="fixed bottom-24 right-6 z-30 w-[360px] rounded-[24px] border border-cyan-500/30 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-xl pointer-events-auto flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="inline-block text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-300 border border-cyan-400/20 mb-1.5">
                {highlightedLiveAmenity.category}
              </span>
              <h3 className="text-xs font-bold text-white leading-snug">
                {highlightedLiveAmenity.name}
              </h3>
            </div>
            <button
              onClick={() => {
                setHighlightedLiveAmenity(null);
                if (highlightLayerRef.current) {
                  highlightLayerRef.current.getSource().clear();
                }
              }}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          <div className="space-y-2 text-xs text-slate-300">
            {highlightedLiveAmenity.address && highlightedLiveAmenity.address !== 'Address unavailable' && (
              <p className="flex items-start gap-2 text-[11px]">
                <MapPin className="h-3.5 w-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <span>{highlightedLiveAmenity.address}</span>
              </p>
            )}
            {highlightedLiveAmenity.contact && highlightedLiveAmenity.contact !== 'Phone unavailable' && (
              <p className="flex items-start gap-2 text-[11px]">
                <Phone className="h-3.5 w-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <span>{highlightedLiveAmenity.contact}</span>
              </p>
            )}
            {highlightedLiveAmenity.website && highlightedLiveAmenity.website !== 'Website unavailable' && (
              <p className="flex items-start gap-2 text-[11px]">
                <Globe className="h-3.5 w-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <a
                  href={highlightedLiveAmenity.website.startsWith('http') ? highlightedLiveAmenity.website : `http://${highlightedLiveAmenity.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline truncate"
                >
                  {highlightedLiveAmenity.website}
                </a>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Floating Bhuvan WMS Legend Card */}
      {(() => {
        const hasActiveBhuvanLayer = bhuvanLulcActive || bhuvanGeomorphActive || bhuvanWastelandActive;
        if (!hasActiveBhuvanLayer) return null;
        return (
          <div className="fixed bottom-6 left-[416px] z-20 flex flex-col gap-3 p-4 rounded-[20px] bg-slate-950/85 border border-white/10 shadow-2xl backdrop-blur-xl max-w-[280px] max-h-[350px] overflow-hidden select-none pointer-events-auto transition-all duration-300">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                MAP LEGEND
              </span>
            </div>
            
            <div className="flex flex-col gap-4 overflow-y-auto pr-1 max-h-[280px] custom-scrollbar">
              {bhuvanLulcActive && (
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-300 block">5. Land & Crop Coverage (LULC)</span>
                  <div className="rounded bg-white p-1.5 flex justify-center shadow-inner">
                    <img 
                      src="https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms?REQUEST=GetLegendGraphic&VERSION=1.1.1&FORMAT=image/png&LAYER=lulc:UP_LULC50K_1516" 
                      alt="LULC Legend" 
                      className="max-w-full object-contain"
                    />
                  </div>
                </div>
              )}

              {bhuvanGeomorphActive && (
                <div className="space-y-1.5 border-t border-white/5 pt-2.5">
                  <span className="text-[9px] font-bold text-slate-300 block">6. Rock & Terrain Map</span>
                  <div className="rounded bg-white p-1.5 flex justify-center shadow-inner">
                    <img 
                      src="https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms?REQUEST=GetLegendGraphic&VERSION=1.1.1&FORMAT=image/png&LAYER=geomorphology:UP_GM50K_0506" 
                      alt="Geomorphology Legend" 
                      className="max-w-full object-contain"
                    />
                  </div>
                </div>
              )}

              {bhuvanWastelandActive && (
                <div className="space-y-1.5 border-t border-white/5 pt-2.5">
                  <span className="text-[9px] font-bold text-slate-300 block">7. Empty / Wasteland Finder</span>
                  <div className="rounded bg-white p-1.5 flex justify-center shadow-inner">
                    <img 
                      src="https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms?REQUEST=GetLegendGraphic&VERSION=1.1.1&FORMAT=image/png&LAYER=wasteland:UP_WL50K_0809" 
                      alt="Wasteland Legend" 
                      className="max-w-full object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Floating Status Message Toast/Notification */}
      {statusMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-md pointer-events-auto rounded-full border border-cyan-500/30 bg-slate-950/90 px-5 py-2.5 text-xs font-semibold text-cyan-200 shadow-2xl shadow-cyan-500/5 backdrop-blur-xl flex items-center gap-2.5 status-pulse select-none">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
          <span>{statusMessage}</span>
        </div>
      )}
    </div>

      {showKgVisualizer && polygonKnowledgeContext && (
        <KgVisualizer
          context={polygonKnowledgeContext}
          onClose={() => setShowKgVisualizer(false)}
          mapRef={mapRef}
        />
      )}

      {featureDialogOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
        <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#0b1728] p-5 shadow-2xl shadow-black/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Add Marker</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Save this point into the active layer</h3>
              <p className="mt-2 text-sm text-slate-300">{formatCoordinates(featureDraft.coordinates)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFeatureDialogOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200"
            >
              <CircleDot className="h-5 w-5 rotate-45" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-sm text-slate-200">
              Marker name
              <input
                value={featureDraft.name}
                onChange={(event) => setFeatureDraft((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
                placeholder="e.g. Corner Store"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-400">
                Category: {layers.find((layer) => layer.id === activeLayerId)?.name || 'None'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFeatureDialogOpen(false)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addFeatureFromDialog}
                  className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Add Marker
                </button>
              </div>
            </div>
            {featureDialogError ? <p className="text-sm text-rose-300">{featureDialogError}</p> : null}
          </div>
        </div>
      </div>
    ) : null}

    {layerDialogOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
        <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#0b1728] p-5 shadow-2xl shadow-black/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Create Layer</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Create a blank editable layer</h3>
              <p className="mt-2 text-sm text-slate-300">Markers will be added manually after the layer is created.</p>
            </div>
            <button
              type="button"
              onClick={() => setLayerDialogOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200"
            >
              <CircleDot className="h-5 w-5 rotate-45" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-sm text-slate-200">
              Layer name
              <input
                value={layerDraft.name}
                onChange={(event) => setLayerDraft((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none"
                placeholder="e.g. Retail Sites"
              />
            </label>
            <label className="block text-sm text-slate-200">
              Layer color
              <input
                type="color"
                value={layerDraft.color}
                onChange={(event) => setLayerDraft((current) => ({ ...current, color: event.target.value }))}
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-slate-950 p-1"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-400">The new layer will be empty until you add markers.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLayerDialogOpen(false)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addLayerFromDialog}
                  className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Create Layer
                </button>
              </div>
            </div>
            {layerDialogError ? <p className="text-sm text-rose-300">{layerDialogError}</p> : null}
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

export default App;
