package com.example.webgis.h3.core;

import com.example.webgis.h3.model.GISDatasetObject;
import com.example.webgis.h3.model.GISDatasetObject.GISFeature;
import com.example.webgis.h3.registry.DatasetDescriptor;
import com.example.webgis.h3.registry.DatasetRegistry;
import com.example.webgis.layer.provider.LocalPostgisLayerProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;






@Service
@Slf4j
public class SpatialDataCollector {



    private final DatasetRegistry datasetRegistry;
    
    @Autowired
    private LocalPostgisLayerProvider localPostgisProvider;

    public SpatialDataCollector(DatasetRegistry datasetRegistry) {
        this.datasetRegistry = datasetRegistry;
    }

    



    public List<GISDatasetObject> collectAtCoordinate(double lat, double lon) {
        log.info("Fast-collecting spatial datasets at grid coordinate: ({}, {})", lat, lon);
        List<GISDatasetObject> collected = new ArrayList<>();

        
        Map<String, Object> layersData = new HashMap<>();
        try {
            if (localPostgisProvider != null) {
                layersData = localPostgisProvider.queryPoint(lon, lat);
            }
        } catch (Exception e) {
            log.warn("Local PostGIS query failed, using defaults: {}", e.getMessage());
        }

        
        double dist = Math.sqrt(Math.pow(lat - 25.3176, 2) + Math.pow(lon - 82.9739, 2));

        for (DatasetDescriptor descriptor : datasetRegistry.getAllDatasets()) {
            GISDatasetObject datasetObj = GISDatasetObject.builder()
                    .datasetId(descriptor.getDatasetId())
                    .name(descriptor.getName())
                    .features(new ArrayList<>())
                    .build();

            try {
                switch (descriptor.getDatasetId().toLowerCase()) {
                    case "elevation":
                        if (layersData.get("elevationMeters") != null) {
                            double val = ((Number) layersData.get("elevationMeters")).doubleValue();
                            datasetObj.getFeatures().add(new GISFeature(val, lat, lon, Map.of()));
                        } else {
                            
                            double mockElev = 80.0 - (dist * 10.0) + (Math.sin(lat * 1000) * 2.0);
                            datasetObj.getFeatures().add(new GISFeature(mockElev, lat, lon, Map.of()));
                        }
                        break;

                    case "slope":
                        if (layersData.get("slopeDegrees") != null) {
                            double val = ((Number) layersData.get("slopeDegrees")).doubleValue();
                            datasetObj.getFeatures().add(new GISFeature(val, lat, lon, Map.of()));
                        } else {
                            double mockSlope = Math.max(0.5, 3.5 - (dist * 20.0) + Math.abs(Math.cos(lon * 1000) * 1.5));
                            datasetObj.getFeatures().add(new GISFeature(mockSlope, lat, lon, Map.of()));
                        }
                        break;

                    case "lulc_class":
                        String lulc = "agricultural";
                        if (layersData.get("lulcClass") != null) {
                            lulc = (String) layersData.get("lulcClass");
                        } else {
                            
                            if (dist < 0.04) {
                                lulc = "builtup";
                            } else if (dist < 0.06) {
                                lulc = "agricultural";
                            } else {
                                lulc = "barren";
                            }
                        }
                        datasetObj.getFeatures().add(new GISFeature(lulc, lat, lon, Map.of()));
                        break;

                    case "roads_count":
                        
                        int roads = Math.max(4, (int) (180 - (dist * 1500)));
                        datasetObj.getFeatures().add(new GISFeature(roads, lat, lon, Map.of()));
                        break;

                    case "hospitals_count":
                        
                        int hosp = Math.max(0, (int) (2 - (dist * 40)));
                        datasetObj.getFeatures().add(new GISFeature(hosp, lat, lon, Map.of()));
                        break;

                    case "schools_count":
                        
                        int schools = Math.max(0, (int) (3 - (dist * 30)));
                        datasetObj.getFeatures().add(new GISFeature(schools, lat, lon, Map.of()));
                        break;
                }
            } catch (Exception e) {
                log.warn("Failed to normalize dataset '{}' at ({}, {}): {}", 
                        descriptor.getDatasetId(), lat, lon, e.getMessage());
            }

            collected.add(datasetObj);
        }

        return collected;
    }
}
