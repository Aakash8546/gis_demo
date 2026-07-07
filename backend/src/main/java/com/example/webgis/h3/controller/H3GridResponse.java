package com.example.webgis.h3.controller;

import java.util.List;
import java.util.Map;

/**
 * DTO representing H3 Grid response containing computed cells.
 */
public record H3GridResponse(
    String queryType, // "POINT" or "POLYGON"
    int resolution,
    int cellCount,
    List<CellInfo> cells,
    String timestamp
) {
    public record CellInfo(
        String h3Index,
        double centerLat,
        double centerLon,
        List<double[]> boundary, // Hexagon coordinate vertices [[lat, lon]...]
        Map<String, Object> aggregatedData,
        Map<String, Object> derivedMetrics
    ) {}
}
