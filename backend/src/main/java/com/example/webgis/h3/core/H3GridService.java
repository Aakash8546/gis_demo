package com.example.webgis.h3.core;

import com.example.webgis.h3.aggregation.AggregationEngine;
import com.example.webgis.h3.derived.DerivedMetricsEngine;
import com.example.webgis.h3.model.GISDatasetObject;
import com.example.webgis.h3.model.H3CellProfile;
import com.example.webgis.h3.repository.H3CellProfileRepository;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Polygon;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;





@Service
@Slf4j
public class H3GridService {

    private final H3Service h3Service;
    private final SpatialDataCollector collector;
    private final AggregationEngine aggregationEngine;
    private final DerivedMetricsEngine derivedMetricsEngine;
    private final H3CellProfileRepository profileRepository;

    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory(new PrecisionModel(), 4326);

    public H3GridService(H3Service h3Service, SpatialDataCollector collector,
                         AggregationEngine aggregationEngine, DerivedMetricsEngine derivedMetricsEngine,
                         H3CellProfileRepository profileRepository) {
        this.h3Service = h3Service;
        this.collector = collector;
        this.aggregationEngine = aggregationEngine;
        this.derivedMetricsEngine = derivedMetricsEngine;
        this.profileRepository = profileRepository;
    }

    








    public H3CellProfile getOrCreateProfileAtCoordinate(double lat, double lon, int resolution) {
        
        String cellId = h3Service.latLonToH3(lat, lon, resolution);
        return getOrCreateProfile(cellId, lat, lon, resolution);
    }

    


    public H3CellProfile getOrCreateProfile(String cellId, Double fallbackLat, Double fallbackLon, int resolution) {
        
        Optional<H3CellProfile> cachedProfile = profileRepository.findById(cellId);
        if (cachedProfile.isPresent()) {
            H3CellProfile profile = cachedProfile.get();
            if (profile.getExpiresAt() == null || profile.getExpiresAt().isAfter(Instant.now())) {
                log.info("Cache hit for H3 Cell Profile: {}", cellId);
                return profile;
            }
            log.info("Cache expired for H3 Cell Profile: {}. Regenerating.", cellId);
        }

        
        double centerLat = fallbackLat != null ? fallbackLat : h3Service.h3ToLatLon(cellId)[0];
        double centerLon = fallbackLon != null ? fallbackLon : h3Service.h3ToLatLon(cellId)[1];

        log.info("Cache miss for H3 Cell Profile: {}. Processing spatial pipeline...", cellId);

        
        List<GISDatasetObject> collectedData = collector.collectAtCoordinate(centerLat, centerLon);

        
        Map<String, Object> aggregatedData = aggregationEngine.aggregate(collectedData);

        
        Map<String, Object> derivedMetrics = derivedMetricsEngine.calculateMetrics(aggregatedData);

        
        List<double[]> boundaryVertices = h3Service.cellBoundary(cellId);
        Coordinate[] jtsCoords = new Coordinate[boundaryVertices.size() + 1];
        for (int i = 0; i < boundaryVertices.size(); i++) {
            double[] vertex = boundaryVertices.get(i);
            jtsCoords[i] = new Coordinate(vertex[1], vertex[0]); 
        }
        
        jtsCoords[boundaryVertices.size()] = jtsCoords[0];
        Polygon boundaryGeom = GEOMETRY_FACTORY.createPolygon(jtsCoords);

        
        H3CellProfile newProfile = H3CellProfile.builder()
                .h3Index(cellId)
                .resolution(resolution)
                .centerLat(centerLat)
                .centerLon(centerLon)
                .boundaryGeom(boundaryGeom)
                .aggregatedData(aggregatedData)
                .statisticalData(new HashMap<>()) 
                .derivedMetrics(derivedMetrics)
                .expiresAt(Instant.now().plus(24, ChronoUnit.HOURS))
                .build();

        return profileRepository.save(newProfile);
    }

    






    public List<H3CellProfile> getProfilesForPolygon(List<List<Double>> polygonCoords, int resolution) {
        log.info("Generating H3 Grid for polygon with {} coordinates", polygonCoords.size());
        
        
        List<String> cells = h3Service.polyfill(polygonCoords, resolution);
        if (cells.size() > 200) {
            log.warn("Polyfill returned {} cells. Truncating to 200 for stability.", cells.size());
            cells = cells.subList(0, 200);
        }

        
        return cells.parallelStream()
                .map(cellId -> {
                    try {
                        return getOrCreateProfile(cellId, null, null, resolution);
                    } catch (Exception e) {
                        log.error("Failed to generate profile for cell '{}' inside polyfill: {}", cellId, e.getMessage());
                        return null;
                    }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
    }
}
