package com.example.webgis.service;

import com.example.webgis.dto.LulcClassStat;
import com.example.webgis.dto.LulcRequest;
import com.example.webgis.dto.LulcResponse;
import com.example.webgis.exception.LulcAnalysisException;
import com.example.webgis.repository.LulcGeometryRepository;
import com.example.webgis.repository.projection.LulcClassStatProjection;
import com.example.webgis.repository.projection.LulcGeomProjection;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class LulcAnalysisService {

    private final LulcGeometryRepository repository;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public LulcResponse analyzeLulc(LulcRequest request) {
        log.info("Starting LULC analysis request");
        String wkt = convertToWkt(request.getCoordinates());
        log.debug("Converted request coordinates to WKT: {}", wkt);

        List<LulcClassStatProjection> projections;
        try {
            projections = repository.findLulcStatsForWkt(wkt);
        } catch (Exception e) {
            log.error("Failed to execute LULC spatial intersection query in database", e);
            throw new LulcAnalysisException("Spatial query execution failed: " + e.getMessage(), e);
        }

        List<LulcGeomProjection> intersectedGeoms;
        try {
            intersectedGeoms = repository.findIntersectedGeometries(wkt);
            log.info("Fetched {} intersected geometry features from database", intersectedGeoms.size());
        } catch (Exception e) {
            log.error("Failed to execute LULC spatial intersection geometries query in database", e);
            throw new LulcAnalysisException("Spatial geometries query execution failed: " + e.getMessage(), e);
        }

        double totalArea = 0.0;
        List<LulcClassStat> stats = new ArrayList<>();

        for (LulcClassStatProjection proj : projections) {
            if (proj.getClassName() == null || proj.getAreaM2() == null) {
                continue;
            }
            totalArea += proj.getAreaM2();
        }

        // Round total area to 2 decimal places
        totalArea = round(totalArea, 2);

        for (LulcClassStatProjection proj : projections) {
            if (proj.getClassName() == null || proj.getAreaM2() == null) {
                continue;
            }
            double area = proj.getAreaM2();
            double percentage = 0.0;
            if (totalArea > 0) {
                percentage = round((area / totalArea) * 100.0, 2);
            }
            stats.add(new LulcClassStat(proj.getClassName(), area, percentage));
        }

        // Build GeoJSON FeatureCollection from typed projection results
        StringBuilder geojsonBuilder = new StringBuilder();
        geojsonBuilder.append("{\"type\":\"FeatureCollection\",\"features\":[");
        boolean first = true;
        for (LulcGeomProjection row : intersectedGeoms) {
            String className = row.getClassName();
            String geomJson  = row.getGeojson();
            if (className != null && geomJson != null && !geomJson.isBlank()) {
                if (!first) geojsonBuilder.append(",");
                geojsonBuilder.append("{\"type\":\"Feature\",\"geometry\":")
                              .append(geomJson)
                              .append(",\"properties\":{\"className\":\"")
                              .append(className.replace("\"", "\\\""))  // escape class name
                              .append("\"}}");
                first = false;
            }
        }
        geojsonBuilder.append("]}");
        String geojsonStr = geojsonBuilder.toString();
        log.info("Built GeoJSON FeatureCollection with {} features", intersectedGeoms.size());

        // Parse the built string into a JsonNode so Jackson embeds it as a real JSON object
        // (not a double-encoded string) in the HTTP response.
        JsonNode geojsonNode;
        try {
            geojsonNode = objectMapper.readTree(geojsonStr);
        } catch (Exception e) {
            log.error("Failed to parse built GeoJSON string into JsonNode", e);
            throw new LulcAnalysisException("Failed to build GeoJSON response: " + e.getMessage(), e);
        }

        return new LulcResponse(totalArea, stats, geojsonNode);
    }

    private String convertToWkt(List<List<List<Double>>> coordinates) {
        if (coordinates == null || coordinates.isEmpty()) {
            throw new LulcAnalysisException("Coordinates must not be empty");
        }

        StringBuilder sb = new StringBuilder();
        sb.append("POLYGON(");

        for (int i = 0; i < coordinates.size(); i++) {
            List<List<Double>> ring = coordinates.get(i);
            if (ring == null || ring.isEmpty()) {
                throw new LulcAnalysisException("A polygon ring cannot be empty");
            }

            if (ring.size() < 3) {
                throw new LulcAnalysisException("A polygon ring must have at least 3 points");
            }

            sb.append("(");
            
            // Check if closed
            List<Double> first = ring.get(0);
            List<Double> last = ring.get(ring.size() - 1);
            boolean isClosed = first.size() >= 2 && last.size() >= 2 &&
                    Double.compare(first.get(0), last.get(0)) == 0 &&
                    Double.compare(first.get(1), last.get(1)) == 0;

            for (int j = 0; j < ring.size(); j++) {
                List<Double> coord = ring.get(j);
                if (coord == null || coord.size() < 2) {
                    throw new LulcAnalysisException("A coordinate must contain at least longitude and latitude");
                }
                sb.append(coord.get(0)).append(" ").append(coord.get(1));
                if (j < ring.size() - 1) {
                    sb.append(", ");
                }
            }

            if (!isClosed) {
                sb.append(", ").append(first.get(0)).append(" ").append(first.get(1));
            }

            sb.append(")");
            if (i < coordinates.size() - 1) {
                sb.append(", ");
            }
        }
        sb.append(")");
        return sb.toString();
    }

    private double round(double value, int places) {
        if (places < 0) throw new IllegalArgumentException();
        BigDecimal bd = BigDecimal.valueOf(value);
        bd = bd.setScale(places, RoundingMode.HALF_UP);
        return bd.doubleValue();
    }
}
