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
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
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
} from 'lucide-react';
import {
  countGeometries,
  analyzeSelectedArea,
  createLayerMetadata,
  formatCoordinates,
  readGeoJsonFeatures,
  writeGeoJsonFeatures
} from './utils/spatial';


const BASEMAPS = {
  dark: {
    label: 'Dark Streets',
    source: new XYZ({
      url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attributions: '&copy; OpenStreetMap &copy; CARTO'
    })
  },
  light: {
    label: 'Street Light',
    source: new XYZ({
      url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attributions: '&copy; OpenStreetMap &copy; CARTO'
    })
  }
};



function layerFill(color, alpha = 0.18) {
  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

function layerStyleFactory(layer) {
  return (feature) => {
    const geometry = feature.getGeometry();
    const geometryType = geometry?.getType();
    const name = feature.get('name') || feature.get('title') || feature.get('label') || '';
    const label = layer.labels && name ? name : '';
    const color = layer.color;

    const commonText = new Text({
      text: label,
      offsetY: -14,
      font: '600 12px Inter, ui-sans-serif, system-ui, sans-serif',
      fill: new Fill({ color: '#f8fafc' }),
      stroke: new Stroke({ color: 'rgba(15, 23, 42, 0.85)', width: 3 }),
      overflow: true
    });

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
          text: commonText
        })
      ];
    }

    if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
      return new Style({
        stroke: new Stroke({
          color,
          width: 3
        }),
        text: commonText
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
      text: commonText
    });
  };
}

function highlightStyleFactory() {
  return [
    new Style({
      stroke: new Stroke({ color: '#facc15', width: 4 }),
      fill: new Fill({ color: 'rgba(250, 204, 21, 0.08)' })
    }),
    new Style({
      stroke: new Stroke({ color: '#ffffff', width: 1.5 })
    })
  ];
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

function App() {
  const mapElementRef = useRef(null);
  const tooltipRef = useRef(null);
  const mapRef = useRef(null);
  const drawSourceRef = useRef(new VectorSource());
  const dataLayerRefs = useRef({});
  const selectedPointSourceRef = useRef(new VectorSource());
  const highlightSourceRef = useRef(new VectorSource());
  const drawInteractionRef = useRef(null);
  const modifyInteractionRef = useRef(null);
  const snapInteractionRef = useRef(null);
  const basemapLayerRef = useRef(
    new TileLayer({
      source: BASEMAPS.dark.source
    })
  );
  const baseSelection = useRef('dark');

  const [layers, setLayers] = useState([]);
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

  const mapCenter = useMemo(() => {
    if (selectedCoordinates) {
      return selectedCoordinates;
    }
    return [77.5946, 12.9716];
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

    const selectedPointLayer = new VectorLayer({
      source: selectedPointSourceRef.current,
      style: pointMarkerStyle('#60a5fa')
    });
    selectedPointLayer.set('kind', 'overlay');

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
      layers: [basemapLayerRef.current, highlightLayer, selectedPointLayer, drawLayer],
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
        const layerId = hit.layer.get('layerId');
        const layer = layersRef.current.find((item) => item.id === layerId);
        highlightSourceRef.current.clear();
        const cloned = hit.feature.clone();
        highlightSourceRef.current.addFeature(cloned);
      } else {
        const featureOnDraw = map.forEachFeatureAtPixel(event.pixel, (feature, layer) => (layer?.get('kind') === 'draw' ? feature : null));

        if (featureOnDraw) {
          highlightSourceRef.current.clear();
          highlightSourceRef.current.addFeature(featureOnDraw.clone());
        }
      }

      selectedPointSourceRef.current.clear();
      selectedPointSourceRef.current.addFeature(new Feature({ geometry: new Point(event.coordinate) }));
    });

    map.on('click', (event) => {
      const coordinate = toLonLat(event.coordinate);
      setSelectedCoordinates(coordinate);
      tooltipOverlay.setPosition(event.coordinate);
    });

    mapRef.current = map;
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

    basemapLayerRef.current.setSource(basemap === 'dark' ? BASEMAPS.dark.source : BASEMAPS.light.source);
    baseSelection.current = basemap;
  }, [basemap]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const map = mapRef.current;
    const currentDataLayers = map
      .getLayers()
      .getArray()
      .filter((layer) => layer.get('kind') === 'data');
    currentDataLayers.forEach((layer) => map.removeLayer(layer));

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    sortedLayers.forEach((layer, index) => {
      const vectorSource = new VectorSource({
        features: readGeoJsonFeatures(layer.geojson)
      });

      vectorSource.getFeatures().forEach((feature) => {
        feature.setProperties(
          {
            __layerId: layer.id,
            __layerName: layer.name
          },
          true
        );
      });

      const vectorLayer = new VectorLayer({
        source: vectorSource,
        opacity: layer.opacity,
        visible: layer.visible,
        style: layerStyleFactory(layer)
      });
      vectorLayer.set('kind', 'data');
      vectorLayer.set('layerId', layer.id);
      dataLayerRefs.current[layer.id] = vectorLayer;
      map.getLayers().insertAt(1 + index, vectorLayer);
    });
  }, [layers]);

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
    const handleDrawChange = () => {
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
      const layerId = `manual-${crypto.randomUUID().slice(0, 8)}`;
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
    const feature = new Feature({
      geometry: new Point(fromLonLat(featureDraft.coordinates))
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

  const selectedAreaPolygon = useMemo(() => {
    return drawSourceRef.current
      .getFeatures()
      .filter((feature) => feature.getGeometry()?.getType() === 'Polygon')
      .at(-1);
  }, [drawRevision]);

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

    return [
      ['Area', `${selectedAreaAnalysis.areaSquareKilometers.toFixed(2)} km²`],
      ['Features Inside', selectedAreaAnalysis.totalFeatures],
      ['Intersecting Layers', Object.entries(selectedAreaAnalysis.layerCounts).filter(([, count]) => count > 0).length]
    ];
  }, [selectedAreaAnalysis]);



  const totalLayers = layers.length;

  return (
    <>
    <div className="min-h-screen bg-[#07111f] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.16),_transparent_26%),linear-gradient(180deg,_#08111d_0%,_#0b1728_55%,_#07111f_100%)]" />
      <div className="relative z-10 flex min-h-screen flex-col gap-4 p-4 lg:p-6">
        <header className="rounded-[28px] border border-white/10 bg-white/6 px-5 py-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.45em] text-cyan-300">AI-Powered WebGIS Decision Support</p>
              <h1 className="mt-2 text-2xl font-semibold text-white lg:text-3xl">Geo_Insight</h1>
              <p className="mt-2 max-w-4xl text-sm text-slate-300">
                Advanced Geospatial Intelligence for Planning, Analysis, and AI-Assisted Decision Support
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="uppercase tracking-[0.3em] text-slate-400">Selected</p>
                <p className="mt-1 text-sm text-white">{formatCoordinates(selectedCoordinates)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="uppercase tracking-[0.3em] text-slate-400">Active Layer</p>
                <p className="mt-1 text-sm text-white">{layers.find((layer) => layer.id === activeLayerId)?.name || 'None'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="uppercase tracking-[0.3em] text-slate-400">Layers</p>
                <p className="mt-1 text-sm text-white">{totalLayers}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4 overflow-hidden">
            <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.35em] text-slate-300">
                  <Layers3 className="h-4 w-4 text-cyan-300" />
                  Layer Explorer
                </h2>
                <button
                  onClick={openLayerDialog}
                  type="button"
                  className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200"
                >
                  <Plus className="h-4 w-4" />
                  Create Layer
                </button>
              </div>

              <div className="space-y-3">
                {layers.map((layer) => (
                  <div key={layer.id} className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
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
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        />
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                          <span>{layer.sourceType}</span>
                          <span>{layer.metadata.featureCount} features</span>
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
                            className={`mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-all ${
                              markerModeEnabled
                                ? 'bg-cyan-400 text-slate-950 border-cyan-400'
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
                          className={`rounded-xl border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                            activeLayerId === layer.id
                              ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                              : 'border-white/10 bg-white/5 text-slate-300'
                          }`}
                        >
                          {activeLayerId === layer.id ? 'Active' : 'Use'}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateLayer(layer.id, { ...layer, visible: !layer.visible })}
                          className="rounded-xl border border-white/10 bg-white/5 p-2"
                        >
                          {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLayer(layer.id)}
                          className="rounded-xl border border-white/10 bg-white/5 p-2 text-rose-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs text-slate-300">
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
                          className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-transparent"
                        />
                      </label>
                      <label className="text-xs text-slate-300">
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
                          className="mt-3 w-full accent-cyan-400"
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={layer.labels}
                          onChange={(event) =>
                            updateLayer(layer.id, {
                              ...layer,
                              labels: event.target.checked
                            })
                          }
                        />
                        Labels
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => moveLayer(layer.id, -1)}
                          className="rounded-xl border border-white/10 bg-white/5 p-2"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveLayer(layer.id, 1)}
                          className="rounded-xl border border-white/10 bg-white/5 p-2"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => zoomToLayer(layer.id)}
                          className="rounded-xl border border-white/10 bg-white/5 p-2"
                        >
                          <LocateFixed className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.35em] text-slate-300">
                <PencilLine className="h-4 w-4 text-cyan-300" />
                Manual Editing
              </h2>
              <div className="mt-4 space-y-3">
                <p className="text-sm text-slate-300">
                  Select a mode to navigate the map, place point markers, or draw area polygons.
                </p>
                
                {/* Mode Selector */}
                <div className="flex rounded-2xl bg-white/5 p-1 border border-white/5">
                  <button
                    type="button"
                    onClick={() => {
                      setMarkerModeEnabled(false);
                      setDrawMode('None');
                      setStatusMessage('Navigation mode active. Pan, zoom, and select sites.');
                    }}
                    className={`flex-1 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      !markerModeEnabled && drawMode === 'None'
                        ? 'bg-cyan-400 text-slate-950 shadow-md'
                        : 'text-slate-300 hover:text-slate-100 hover:bg-white/5'
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
                    className={`flex-1 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      markerModeEnabled
                        ? 'bg-cyan-400 text-slate-950 shadow-md'
                        : 'text-slate-300 hover:text-slate-100 hover:bg-white/5'
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
                    className={`flex-1 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      drawMode === 'Polygon'
                        ? 'bg-cyan-400 text-slate-950 shadow-md'
                        : 'text-slate-300 hover:text-slate-100 hover:bg-white/5'
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
                    className="w-full rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 px-3 py-2.5 text-xs font-semibold text-slate-200 transition-colors"
                  >
                    Clear Drawn Area
                  </button>
                )}

                <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-xs text-slate-300">
                  <p>Active layer: {layers.find((layer) => layer.id === activeLayerId)?.name || 'None selected'}</p>
                  <p className="mt-1">Tip: create a blank layer first, then add points one by one.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.35em] text-slate-300">
                <PencilLine className="h-4 w-4 text-cyan-300" />
                Selected Area
              </h2>

              {selectedAreaAnalysis ? (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {areaMetrics?.map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">{label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
                    <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Features Inside</p>
                    <div className="mt-2 space-y-2">
                      {selectedAreaAnalysis.featuresInside.slice(0, 5).map((item, index) => (
                        <div key={`${item.layerId}-${item.name}-${index}`} className="rounded-xl bg-white/5 px-3 py-2">
                          <p className="text-sm font-semibold text-white">{item.name}</p>
                          <p className="text-xs text-slate-400">
                            {item.layerName} · {item.geometryType}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
                  Draw a polygon on the map to see the selected area summary.
                </div>
              )}
            </div>
          </aside>

          <main className="overflow-hidden rounded-[32px] border border-white/10 bg-white/6 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">OpenLayers Map</p>
                <p className="mt-1 text-sm text-slate-200">Pan, zoom, place markers, and inspect your live workspace.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setBasemap('dark')} type="button" className={`rounded-2xl px-3 py-2 text-xs font-semibold ${basemap === 'dark' ? 'bg-cyan-400 text-slate-950' : 'bg-white/5 text-slate-100'}`}>
                  Dark
                </button>
                <button onClick={() => setBasemap('light')} type="button" className={`rounded-2xl px-3 py-2 text-xs font-semibold ${basemap === 'light' ? 'bg-cyan-400 text-slate-950' : 'bg-white/5 text-slate-100'}`}>
                  Light
                </button>
              </div>
            </div>

            <div className="relative h-[72vh] min-h-[660px] map-shell">
              <div ref={mapElementRef} className="h-full w-full" />
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
              <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-xs text-slate-200 shadow-2xl shadow-black/30">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-300" />
                  Live coordinates: {formatCoordinates(hoverCoordinates)}
                </div>
              </div>
            </div>
          </main>

        </div>
      </div>
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
