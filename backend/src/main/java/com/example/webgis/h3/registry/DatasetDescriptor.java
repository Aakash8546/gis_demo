package com.example.webgis.h3.registry;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Metadata descriptor for a registered geospatial dataset in the spatial registry.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DatasetDescriptor {
    private String datasetId;
    private String name;
    private String source;
    private GeometryType geometryType;
    private String aggregationStrategyName; // e.g., "MEAN", "COUNT", "DOMINANT_CLASS"
    private int priority; // higher runs first or gets preferred in visual overlays
    private long ttlSeconds; // time-to-live for cached cell profiles containing this dataset
}
