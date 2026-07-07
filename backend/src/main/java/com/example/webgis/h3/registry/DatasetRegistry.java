package com.example.webgis.h3.registry;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;





@Service
@Slf4j
public class DatasetRegistry {



    private final Map<String, DatasetDescriptor> registry = new ConcurrentHashMap<>();

    public DatasetRegistry() {
        
        register(DatasetDescriptor.builder()
                .datasetId("elevation")
                .name("Terrain Elevation")
                .source("Local Digital Elevation Model")
                .geometryType(GeometryType.RASTER)
                .aggregationStrategyName("MEAN")
                .priority(1)
                .ttlSeconds(86400) 
                .build());

        register(DatasetDescriptor.builder()
                .datasetId("slope")
                .name("Terrain Slope")
                .source("Local Slope Calculations")
                .geometryType(GeometryType.RASTER)
                .aggregationStrategyName("MEAN")
                .priority(1)
                .ttlSeconds(86400)
                .build());

        register(DatasetDescriptor.builder()
                .datasetId("lulc_class")
                .name("Land Use / Land Cover Class")
                .source("Sentinel-2 Land Cover Model")
                .geometryType(GeometryType.POLYGON)
                .aggregationStrategyName("DOMINANT_CLASS")
                .priority(2)
                .ttlSeconds(86400 * 7) 
                .build());

        register(DatasetDescriptor.builder()
                .datasetId("roads_count")
                .name("Road Count")
                .source("OpenStreetMap Roads")
                .geometryType(GeometryType.LINE)
                .aggregationStrategyName("COUNT")
                .priority(2)
                .ttlSeconds(86400 * 3) 
                .build());

        register(DatasetDescriptor.builder()
                .datasetId("hospitals_count")
                .name("Hospital Density")
                .source("OpenStreetMap POI")
                .geometryType(GeometryType.POINT)
                .aggregationStrategyName("COUNT")
                .priority(3)
                .ttlSeconds(86400 * 5) 
                .build());

        register(DatasetDescriptor.builder()
                .datasetId("schools_count")
                .name("School Density")
                .source("OpenStreetMap POI")
                .geometryType(GeometryType.POINT)
                .aggregationStrategyName("COUNT")
                .priority(3)
                .ttlSeconds(86400 * 5)
                .build());

        log.info("Initialized DatasetRegistry with {} standard datasets.", registry.size());
    }

    


    public void register(DatasetDescriptor descriptor) {
        if (descriptor == null || descriptor.getDatasetId() == null) {
            return;
        }
        registry.put(descriptor.getDatasetId().toLowerCase(), descriptor);
        log.info("Registered dataset: {} ({})", descriptor.getDatasetId(), descriptor.getName());
    }

    


    public Optional<DatasetDescriptor> getDataset(String datasetId) {
        if (datasetId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(registry.get(datasetId.toLowerCase()));
    }

    


    public Collection<DatasetDescriptor> getAllDatasets() {
        return Collections.unmodifiableCollection(registry.values());
    }
}
