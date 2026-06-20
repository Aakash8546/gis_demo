import { useEffect, useRef, useState } from 'react';
import { createVaranasiTerrainProvider } from '../utils/terrainProvider';
import { Globe } from 'lucide-react';

export default function CesiumMap({
  center,
  zoom,
  visible,
  onPointSelected,
  basemap,
  selectedCoordinates,
  selectedMarkersForDistance,
  selectedAreaCoords,
  markers
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [isCesiumLoaded, setIsCesiumLoaded] = useState(false);
  const [cesiumError, setCesiumError] = useState(null);

  // Poll for Cesium loading to handle CDN/race conditions
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Cesium) {
      setIsCesiumLoaded(true);
      return;
    }
    const interval = setInterval(() => {
      if (window.Cesium) {
        setIsCesiumLoaded(true);
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // 1. Initialize viewer on mount
  useEffect(() => {
    if (!isCesiumLoaded || !containerRef.current || typeof window === 'undefined' || !window.Cesium) {
      return;
    }

    const Cesium = window.Cesium;

    // Set default access token to empty to prevent console warnings
    Cesium.Ion.defaultAccessToken = '';

    let viewer;
    try {
      // Initialize viewer
      viewer = new Cesium.Viewer(containerRef.current, {
        terrainProvider: createVaranasiTerrainProvider(),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        baseLayer: new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          })
        )
      });
    } catch (err) {
      console.error('Failed to initialize Cesium Viewer:', err);
      setCesiumError(err.message || 'WebGL context not supported or crashed.');
      return;
    }

    // Force daylight noon time so Varanasi is always lit
    const noon = Cesium.JulianDate.fromIso8601('2026-06-20T12:00:00Z');
    viewer.clock.currentTime = noon;
    viewer.clock.shouldAnimate = false;

    // Enable realistic shading and depth test
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;

    // Set terrain vertical exaggeration for low elevation differences (Varanasi region is 50-223m)
    viewer.scene.globe.terrainExaggeration = 3.5;
    viewer.scene.globe.terrainExaggerationRelativeHeight = 100.0;

    // Enable advanced graphics options: shadows, HDR, and Screen Space Ambient Occlusion (SSAO)
    viewer.shadows = true;
    viewer.terrainShadows = Cesium.ShadowMode.ENABLED;
    viewer.scene.highDynamicRange = true;

    if (viewer.scene.postProcessStages.ambientOcclusion) {
      viewer.scene.postProcessStages.ambientOcclusion.enabled = true;
      viewer.scene.postProcessStages.ambientOcclusion.uniforms.ambientOcclusionOnly = false;
      viewer.scene.postProcessStages.ambientOcclusion.uniforms.intensity = 3.0;
      viewer.scene.postProcessStages.ambientOcclusion.uniforms.bias = 0.1;
    }

    // Configure beautiful atmospheric scattering, fog, and base color
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.00015;
    viewer.scene.fog.screenSpaceLinearDiskRatio = 1.0;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#020617'); // slate-950

    // Set up click handler for coordinate / elevation queries
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const ray = viewer.camera.getPickRay(click.position);
      const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (Cesium.defined(cartesian)) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        
        if (onPointSelected) {
          onPointSelected([lon, lat]);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;
    window.cesiumViewer = viewer;

    return () => {
      handler.destroy();
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      window.cesiumViewer = null;
    };
  }, [isCesiumLoaded]);

  // 2. Sync imagery basemap with OpenLayers selection
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const Cesium = window.Cesium;
    viewer.imageryLayers.removeAll();

    let baseProvider;
    let overlayProvider = null;

    if (basemap === 'satellite') {
      baseProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: '© Esri — Source: Esri, i-cubed, USDA, USGS'
      });
      // Add places and road names overlay
      overlayProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        credit: '© Esri — References'
      });
    } else if (basemap === 'light') {
      baseProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: '© OpenStreetMap contributors'
      });
    } else if (basemap === 'dark') {
      baseProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        credit: '© OpenStreetMap contributors © CartoDB'
      });
    } else {
      // Fallback for mbtiles and others
      baseProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: '© OpenStreetMap contributors'
      });
    }

    viewer.imageryLayers.addImageryProvider(baseProvider);
    if (overlayProvider) {
      viewer.imageryLayers.addImageryProvider(overlayProvider);
    }
  }, [basemap]);

  // 3. Draw a glowing marker at the selected coordinate
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const Cesium = window.Cesium;
    const selectedMarkerId = 'cesium-selected-coord-pin';

    // Remove existing
    const existing = viewer.entities.getById(selectedMarkerId);
    if (existing) {
      viewer.entities.remove(existing);
    }

    if (!selectedCoordinates || !Array.isArray(selectedCoordinates) || selectedCoordinates.length < 2) return;

    const [lon, lat] = selectedCoordinates;

    // Add glowing marker
    viewer.entities.add({
      id: selectedMarkerId,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#10b981'), // Emerald
        outlineColor: Cesium.Color.fromCssColorString('#ffffff'),
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: 'Selected Site',
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.fromCssColorString('#ffffff'),
        outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
  }, [selectedCoordinates]);

  // 4. Render LULC selection polygon on 3D globe
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const Cesium = window.Cesium;
    const lulcPolyId = 'cesium-lulc-polygon';

    const existing = viewer.entities.getById(lulcPolyId);
    if (existing) {
      viewer.entities.remove(existing);
    }

    if (!selectedAreaCoords || !Array.isArray(selectedAreaCoords) || selectedAreaCoords.length < 3) return;

    const degrees = selectedAreaCoords.flatMap(([lon, lat]) => [lon, lat]);

    viewer.entities.add({
      id: lulcPolyId,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(degrees),
        material: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.25), // Cyan
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#06b6d4'),
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });
  }, [selectedAreaCoords]);

  // 5. Render custom markers from active layers
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const Cesium = window.Cesium;

    // Clear previous custom markers
    const toRemove = [];
    viewer.entities.values.forEach((entity) => {
      if (entity.id && entity.id.startsWith('cesium-layer-marker-')) {
        toRemove.push(entity);
      }
    });
    toRemove.forEach((entity) => viewer.entities.remove(entity));

    if (!markers || !Array.isArray(markers)) return;

    markers.forEach((marker) => {
      if (!marker || !marker.coordinates || !Array.isArray(marker.coordinates) || marker.coordinates.length < 2) return;
      const [lon, lat] = marker.coordinates;
      if (typeof lon !== 'number' || typeof lat !== 'number' || isNaN(lon) || isNaN(lat)) return;

      viewer.entities.add({
        id: `cesium-layer-marker-${marker.id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(marker.color || '#c084fc'),
          outlineColor: Cesium.Color.fromCssColorString('#ffffff'),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: marker.name || 'Marker',
          font: '9px sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#ffffff'),
          outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    });
  }, [markers]);

  // 6. Draw distance measurement line
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const Cesium = window.Cesium;
    const lineId = 'cesium-distance-line';

    const existing = viewer.entities.getById(lineId);
    if (existing) {
      viewer.entities.remove(existing);
    }

    if (!selectedMarkersForDistance || !Array.isArray(selectedMarkersForDistance) || selectedMarkersForDistance.length !== 2) {
      return;
    }

    const [m1, m2] = selectedMarkersForDistance;
    if (!m1 || !m2 || !m1.coordinates || !m2.coordinates || !Array.isArray(m1.coordinates) || !Array.isArray(m2.coordinates)) {
      return;
    }
    const [lon1, lat1] = m1.coordinates;
    const [lon2, lat2] = m2.coordinates;
    if (typeof lon1 !== 'number' || typeof lat1 !== 'number' || typeof lon2 !== 'number' || typeof lat2 !== 'number') {
      return;
    }

    viewer.entities.add({
      id: lineId,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([lon1, lat1, lon2, lat2]),
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.fromCssColorString('#f59e0b') // Amber glow
        }),
        clampToGround: true
      }
    });
  }, [selectedMarkersForDistance]);

  // 7. Update camera view when container visibility changes or coordinates change
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !visible) return;

    const Cesium = window.Cesium;
    const safeZoom = (typeof zoom === 'number' && !isNaN(zoom)) ? zoom : 13;
    const safeCenter = (Array.isArray(center) && center.length === 2 && !isNaN(center[0]) && !isNaN(center[1])) ? center : [82.9739, 25.3176];
    const height = 35000000 / Math.pow(2, safeZoom);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(safeCenter[0], safeCenter[1], height),
      orientation: {
        heading: Cesium.Math.toRadians(25.0), // rotated angle for beautiful perspective
        pitch: Cesium.Math.toRadians(-25.0), // Tilted angle for beautiful horizon perspective
        roll: 0.0
      },
      duration: 1.5 // Smooth flyTo transition
    });
  }, [visible, center, zoom]);

  if (!isCesiumLoaded) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center bg-slate-950 border border-white/5 rounded-[24px] p-6 text-center text-slate-300"
        style={{ display: visible ? 'flex' : 'none' }}
      >
        <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
        <h3 className="text-sm font-bold text-white mb-1">Loading 3D Globe</h3>
        <p className="text-xs text-slate-400">Loading CesiumJS engine...</p>
      </div>
    );
  }

  if (cesiumError) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center bg-slate-950 border border-red-500/20 rounded-[24px] p-6 text-center text-slate-300"
        style={{ display: visible ? 'flex' : 'none' }}
      >
        <Globe className="h-10 w-10 text-rose-500 mb-3 animate-pulse" />
        <h3 className="text-sm font-bold text-white mb-1">3D Globe Initialization Failed</h3>
        <p className="text-xs text-slate-400 max-w-xs">{cesiumError}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ display: visible ? 'block' : 'none' }}
    />
  );
}
