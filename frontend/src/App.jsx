import { useEffect, useMemo, useRef, useState } from 'react';
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
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import { fromLonLat, toLonLat } from 'ol/proj';
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

const AMENITY_CATEGORIES = {
  'Healthcare': { icon: HeartPulse, color: 'text-rose-400 bg-rose-400/10 border-rose-400/20' },
  'Education': { icon: GraduationCap, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  'Fitness': { icon: Dumbbell, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  'Recreation': { icon: Trees, color: 'text-lime-400 bg-lime-400/10 border-lime-400/20' },
  'Public Services': { icon: Building, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  'Transportation': { icon: Train, color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20' }
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

  const [layers, setLayers] = useState([]);
  const [selectedMarkersForDistance, setSelectedMarkersForDistance] = useState([]);
  const [selectedCoordinates, setSelectedCoordinates] = useState(null);
  const [hoverCoordinates, setHoverCoordinates] = useState(null);
  const [drawMode, setDrawMode] = useState('None');

  const [statusMessage, setStatusMessage] = useState('');
  const [basemap, setBasemap] = useState('dark');
  const [drawRevision, setDrawRevision] = useState(0);
  const [layerDialogOpen, setLayerDialogOpen] = useState(false);
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
  const activeLayerIdRef = useRef(activeLayerId);
  const [hoveredMarkerInfo, setHoveredMarkerInfo] = useState(null);
  const hoverTooltipRef = useRef(null);

  const [currentCity, setCurrentCity] = useState('Varanasi');
  const cityCache = useRef({});

  // Live Area Intelligence Hooks
  const [liveAmenities, setLiveAmenities] = useState(null);
  const [liveAmenitiesLoading, setLiveAmenitiesLoading] = useState(false);
  const [liveAmenitiesError, setLiveAmenitiesError] = useState('');
  const [localNews, setLocalNews] = useState([]);
  const [localNewsLoading, setLocalNewsLoading] = useState(false);
  const [localNewsLocation, setLocalNewsLocation] = useState('');
  const [selectedAmenityCategory, setSelectedAmenityCategory] = useState(null);
  const [highlightedLiveAmenity, setHighlightedLiveAmenity] = useState(null);
  const [amenitySearchQuery, setAmenitySearchQuery] = useState('');

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
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cityName)}&hl=en-IN&gl=IN&ceid=IN:en`;
      const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
      const newsRes = await fetch(rss2jsonUrl);
      const newsData = await newsRes.json();
      if (newsData && newsData.items) {
        const parsedNews = newsData.items.slice(0, 5).map(item => ({
          title: item.title,
          link: item.link,
          source: item.source || 'News Update',
          pubDate: item.pubDate ? new Date(item.pubDate).toLocaleDateString() : 'Recent'
        }));
        setLocalNews(parsedNews);
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

  useEffect(() => {
    if (!selectedAreaMetrics) {
      setLiveAmenities(null);
      setLocalNews([]);
      setLocalNewsLocation('');
      setSelectedAmenityCategory(null);
      setHighlightedLiveAmenity(null);
      if (highlightLayerRef.current) {
        highlightLayerRef.current.getSource().clear();
      }
      return;
    }
    fetchLiveAreaIntelligence(selectedAreaMetrics);
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

  const updateCityName = useMemo(() => {
    let timeoutId = null;
    return (lonLat) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
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
    };
  }, []);


  const mapCenter = useMemo(() => {
    if (selectedCoordinates) {
      return selectedCoordinates;
    }
    return [82.9739, 25.3176];
  }, [selectedCoordinates]);

  useEffect(() => {
    async function loadLayers() {
      setLayers([]);
      setStatusMessage('Create a layer and add markers to begin.');
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
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => {
    showHeatmapRef.current = showHeatmap;
  }, [showHeatmap]);

  const handleSearch = async (e) => {
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
        const coords = fromLonLat([parseFloat(lon), parseFloat(lat)]);
        
        mapRef.current.getView().animate({
          center: coords,
          zoom: 13,
          duration: 1500
        });
      } else {
        alert("Location not found.");
      }
    } catch (err) {
      console.error("Search error", err);
      alert("Search failed. If you are offline, please enter coordinates directly (e.g. '25.3176, 82.9739').");
    } finally {
      setIsSearching(false);
    }
  };

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
      style: pointMarkerStyle('#60a5fa')
    });
    selectedPointLayer.set('kind', 'overlay');
    selectedPointLayerRef.current = selectedPointLayer;

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
        const fillColor = 'rgba(168, 85, 247, 0.18)';
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

    const map = new Map({
        target: mapElementRef.current,
        layers: [
          basemapLayersRef.current.dark,
          basemapLayersRef.current.light,
          basemapLayersRef.current.satellite,
          basemapLayersRef.current.satelliteLabels,
          basemapLayersRef.current.varanasi_mbtiles,
          highlightLayer, selectedPointLayer, distanceMeasureLayer, drawLayer
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

      map.forEachFeatureAtPixel(pixel, (feature, layer) => {
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

      if (foundMarker) {
        map.getTargetElement().style.cursor = 'pointer';
        const geom = foundMarker.getGeometry();
        const coords = toLonLat(geom.getCoordinates());
        const props = foundMarker.getProperties();
        const name = props.name || props.title || props.label || 'Unnamed Marker';
        const category = props.category || props.__layerName || 'No Category';

        setHoveredMarkerInfo({
          name,
          category,
          coordinates: coords
        });
        hoverTooltipOverlay.setPosition(geom.getCoordinates());
      } else {
        map.getTargetElement().style.cursor = '';
        hoverTooltipOverlay.setPosition(undefined);
        setHoveredMarkerInfo(null);
      }
    });

    map.on('singleclick', (event) => {
      const coordinates = toLonLat(event.coordinate);
      setSelectedCoordinates(coordinates);
      tooltipOverlay.setPosition(event.coordinate);

      if (markerModeRef.current) {
        openFeatureDialog(coordinates);
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
            if (exists) {
              return current.filter(m => m.id !== markerId);
            }
            if (current.length >= 2) {
              return [{ id: markerId, name, layerName, coordinates: coords }];
            }
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

    map.on('click', (event) => {
      const coordinate = toLonLat(event.coordinate);
      setSelectedCoordinates(coordinate);
      tooltipOverlay.setPosition(event.coordinate);
    });

    map.on('moveend', () => {
      const center = toLonLat(map.getView().getCenter());
      updateCityName(center);
    });

    mapRef.current = map;
    window.map = map;
    map.addInteraction(
      new Modify({
        source: drawSourceRef.current
      })
    );
    map.addInteraction(
      new Snap({
        source: drawSourceRef.current
      })
    );
  }, [layers, mapCenter]);

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
    const baseLayersCount = 6; // dark, light, satellite, satelliteLabels, varanasi_mbtiles, varanasi_pmtiles

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


  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const overlayLayer = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('kind') === 'draw');

    if (!overlayLayer) {
      return;
    }
  }, []);

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
    setLiveAmenities(null);
    setLocalNews([]);
    setLocalNewsLocation('');
    setSelectedAmenityCategory(null);
    setHighlightedLiveAmenity(null);
    setStatusMessage('Selected area cleared.');
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
      setStatusMessage(`Created ${layerName}. Use marker mode to add features.`);
    } catch (error) {
      setLayerDialogError('Please enter a layer name before creating it.');
    }
  }

  function openFeatureDialog(coordinates) {
    const layerId = activeLayerIdRef.current || layersRef.current[0]?.id;
    if (!layerId) {
      setStatusMessage('Select or create a layer before adding markers.');
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
    setStatusMessage(`Added ${name} to ${layer.name}.`);
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
        <div ref={mapElementRef} className="h-full w-full" />
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
                            setStatusMessage(
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

        {/* Manual Editing Card */}
        <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
            <PencilLine className="h-4 w-4 text-cyan-400" />
            Manual Editing
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Select a mode to interact with the map. Place point markers in custom layers or draw area polygons to calculate stats.
          </p>
          
          {/* Mode Selector */}
          <div className="flex rounded-2xl bg-slate-900/65 p-1 border border-white/5 shadow-inner mt-1">
            <button
              type="button"
              onClick={() => {
                setMarkerModeEnabled(false);
                setDrawMode('None');
                setStatusMessage('Navigation mode active. Pan, zoom, and select sites.');
              }}
              className={`flex-1 rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                !markerModeEnabled && drawMode === 'None'
                  ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Navigation className="h-3.5 w-3.5" />
              <span>Navigate</span>
            </button>
            
            <button
              type="button"
              onClick={() => {
                setDrawMode('None');
                if (!activeLayerId && layers[0]?.id) {
                  setActiveLayerId(layers[0].id);
                }
                setMarkerModeEnabled(true);
                setStatusMessage('Click the map to add a marker to the active layer.');
              }}
              className={`flex-1 rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                markerModeEnabled
                  ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>Marker</span>
            </button>
            
            <button
              type="button"
              onClick={() => {
                setMarkerModeEnabled(false);
                setDrawMode('Polygon');
                setStatusMessage('Click the map to draw a polygon area.');
              }}
              className={`flex-1 rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                drawMode === 'Polygon'
                  ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-400/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span>Draw</span>
            </button>
          </div>

          {/* Clear drawings button, only shown in Drawing Mode */}
          {drawMode === 'Polygon' && (
            <button
              type="button"
              onClick={clearDrawings}
              className="w-full rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors"
            >
              Clear Drawn Area
            </button>
          )}
        </div>

        {/* Selected Area Card */}
        <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
            <PencilLine className="h-4 w-4 text-cyan-400" />
            Selected Area
          </h2>

          {selectedAreaAnalysis ? (
            <div className="space-y-3">
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

              {/* Live Amenities Discovery */}
              <div className="border-t border-white/10 pt-3 mt-3">
                <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
                  Live Amenities Discovery
                </h3>
                
                {liveAmenitiesLoading ? (
                  <div className="flex flex-col items-center justify-center py-6 text-slate-400 text-xs">
                    <Loader2 className="h-6 w-6 animate-spin text-cyan-400 mb-2" />
                    <span>Discovering live amenities...</span>
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
            </div>
          ) : (
            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3 text-xs text-slate-400 italic leading-relaxed text-center">
              Draw a polygon on the map using "Draw" mode to inspect features in a custom area.
            </div>
          )}
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
      </aside>

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

      {/* Floating Status Message Toast/Notification */}
      {statusMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-md pointer-events-auto rounded-full border border-cyan-500/30 bg-slate-950/90 px-5 py-2.5 text-xs font-semibold text-cyan-200 shadow-2xl shadow-cyan-500/5 backdrop-blur-xl flex items-center gap-2.5 status-pulse select-none">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
          <span>{statusMessage}</span>
        </div>
      )}
    </div>

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
