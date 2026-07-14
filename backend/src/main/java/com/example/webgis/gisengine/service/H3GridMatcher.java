package com.example.webgis.gisengine.service;

import com.example.webgis.gisengine.model.GisFeature;
import com.example.webgis.gisengine.model.GisLayer;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class H3GridMatcher {

    /**
     * Matches multiple H3-projected layers by their cell IDs.
     * Merges features belonging to the same H3 cell into a single feature containing attributes from all input layers.
     */
    public GisLayer matchLayers(List<GisLayer> layers, String outputLayerName) {
        if (layers == null || layers.isEmpty()) {
            return GisLayer.builder().name(outputLayerName).build();
        }

        // Map containing cellId -> merged properties map
        Map<String, Map<String, Object>> mergedCells = new HashMap<>();
        // Keep track of one feature per cell to retain its JTS Geometry
        Map<String, GisFeature> cellGeoms = new HashMap<>();

        for (GisLayer layer : layers) {
            for (GisFeature feature : layer.getFeatures()) {
                String cellId = (String) feature.getProperties().get("h3Index");
                if (cellId == null) {
                    Object h3CellMeta = feature.getMetadata().get("h3Cell");
                    if (h3CellMeta != null) {
                        cellId = h3CellMeta.toString();
                    }
                }
                if (cellId == null) continue;

                Map<String, Object> props = mergedCells.computeIfAbsent(cellId, k -> new HashMap<>());
                // Add all properties of this feature
                for (Map.Entry<String, Object> entry : feature.getProperties().entrySet()) {
                    props.put(entry.getKey(), entry.getValue());
                }
                // Save geometry reference
                cellGeoms.putIfAbsent(cellId, feature);
            }
        }

        List<GisFeature> matchedFeatures = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : mergedCells.entrySet()) {
            String cellId = entry.getKey();
            Map<String, Object> props = entry.getValue();
            GisFeature originalFeature = cellGeoms.get(cellId);

            GisFeature matchedFeature = GisFeature.builder()
                    .id(UUID.randomUUID().toString())
                    .geometry(originalFeature.getGeometry())
                    .properties(props)
                    .metadata(new HashMap<>(originalFeature.getMetadata()))
                    .build();
            matchedFeature.initialize();
            matchedFeatures.add(matchedFeature);
        }

        GisLayer matchedLayer = GisLayer.builder()
                .id(UUID.randomUUID().toString())
                .name(outputLayerName)
                .crs("EPSG:4326")
                .geometryType("Polygon")
                .features(matchedFeatures)
                .metadata(Map.of("matchedLayersCount", layers.size()))
                .build();
        matchedLayer.initialize();
        return matchedLayer;
    }
}
