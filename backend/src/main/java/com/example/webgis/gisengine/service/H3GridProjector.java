package com.example.webgis.gisengine.service;

import com.example.webgis.gisengine.model.GisFeature;
import com.example.webgis.gisengine.model.GisLayer;
import com.example.webgis.h3.core.H3Service;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.*;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class H3GridProjector {

    private final H3Service h3Service;
    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory(new PrecisionModel(), 4326);

    public H3GridProjector(H3Service h3Service) {
        this.h3Service = h3Service;
    }

    /**
     * Projects any arbitrary GisLayer (Points, Lines, Polygons) onto an H3 grid.
     */
    public GisLayer projectToH3(GisLayer sourceLayer, int resolution) {
        log.info("Projecting layer {} onto H3 grid at resolution {}", sourceLayer.getName(), resolution);
        Map<String, Map<String, Object>> cellPropertiesMap = new HashMap<>();

        for (GisFeature feature : sourceLayer.getFeatures()) {
            Geometry geom = feature.getGeometry();
            if (geom == null) continue;

            List<String> affectedCells = new ArrayList<>();

            if (geom instanceof Point) {
                Point p = (Point) geom;
                String cellId = h3Service.latLonToH3(p.getY(), p.getX(), resolution);
                affectedCells.add(cellId);
            } else if (geom instanceof Polygon) {
                Polygon poly = (Polygon) geom;
                List<List<Double>> coords = extractCoordinates(poly);
                try {
                    List<String> polyCells = h3Service.polyfill(coords, resolution);
                    affectedCells.addAll(polyCells);
                } catch (Exception e) {
                    log.warn("Polyfill failed for polygon feature: {}", e.getMessage());
                    // Fallback: use centroid
                    Point centroid = poly.getCentroid();
                    String cellId = h3Service.latLonToH3(centroid.getY(), centroid.getX(), resolution);
                    affectedCells.add(cellId);
                }
            } else if (geom instanceof LineString) {
                LineString line = (LineString) geom;
                Coordinate[] coords = line.getCoordinates();
                for (Coordinate coord : coords) {
                    String cellId = h3Service.latLonToH3(coord.y, coord.x, resolution);
                    affectedCells.add(cellId);
                }
            } else {
                // Fallback for multi-geometries or others: use centroid
                Point centroid = geom.getCentroid();
                String cellId = h3Service.latLonToH3(centroid.getY(), centroid.getX(), resolution);
                affectedCells.add(cellId);
            }

            // Assign attributes to all resolved cells
            for (String cellId : affectedCells) {
                Map<String, Object> cellProps = cellPropertiesMap.computeIfAbsent(cellId, k -> new HashMap<>());
                // Copy properties from original feature
                for (Map.Entry<String, Object> entry : feature.getProperties().entrySet()) {
                    // For demo simplicity, override or aggregate numeric fields by taking the maximum or average
                    Object newVal = entry.getValue();
                    if (cellProps.containsKey(entry.getKey())) {
                        Object oldVal = cellProps.get(entry.getKey());
                        if (newVal instanceof Number && oldVal instanceof Number) {
                            // Take max value or sum (e.g. population density or income)
                            double d1 = ((Number) oldVal).doubleValue();
                            double d2 = ((Number) newVal).doubleValue();
                            cellProps.put(entry.getKey(), Math.max(d1, d2));
                        }
                    } else {
                        cellProps.put(entry.getKey(), newVal);
                    }
                }
                cellProps.put("h3Index", cellId);
            }
        }

        // Reconstruct spatial features using H3 boundaries
        List<GisFeature> projectedFeatures = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : cellPropertiesMap.entrySet()) {
            String cellId = entry.getKey();
            Map<String, Object> props = entry.getValue();

            List<double[]> vertices = h3Service.cellBoundary(cellId);
            Coordinate[] jtsCoords = new Coordinate[vertices.size() + 1];
            for (int i = 0; i < vertices.size(); i++) {
                double[] pt = vertices.get(i);
                jtsCoords[i] = new Coordinate(pt[1], pt[0]); // lon, lat
            }
            jtsCoords[vertices.size()] = jtsCoords[0]; // Close polygon
            Polygon cellPolygon = GEOMETRY_FACTORY.createPolygon(jtsCoords);

            GisFeature cellFeature = GisFeature.builder()
                    .id(UUID.randomUUID().toString())
                    .geometry(cellPolygon)
                    .properties(props)
                    .metadata(Map.of("h3Cell", cellId))
                    .build();
            cellFeature.initialize();
            projectedFeatures.add(cellFeature);
        }

        GisLayer projectedLayer = GisLayer.builder()
                .id(UUID.randomUUID().toString())
                .name(sourceLayer.getName() + " (H3 Grid)")
                .crs("EPSG:4326")
                .geometryType("Polygon")
                .features(projectedFeatures)
                .metadata(new HashMap<>(sourceLayer.getMetadata()))
                .build();
        projectedLayer.initialize();
        return projectedLayer;
    }

    private List<List<Double>> extractCoordinates(Polygon polygon) {
        List<List<Double>> rings = new ArrayList<>();
        Coordinate[] outerCoords = polygon.getExteriorRing().getCoordinates();
        for (Coordinate c : outerCoords) {
            rings.add(Arrays.asList(c.x, c.y));
        }
        return rings;
    }
}
