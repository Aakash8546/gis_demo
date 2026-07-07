package com.example.webgis.h3.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Common internal data model representing a normalized dataset collected from GIS providers.
 * Contains raw spatial features before they are processed by the Aggregation Engine.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GISDatasetObject {
    private String datasetId;
    private String name;
    
    @Builder.Default
    private List<GISFeature> features = new ArrayList<>();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GISFeature {
        private Object value; // raw value (e.g. elevation height, POI name, road class)
        private Double latitude; // optional coordinates of the point/vertex
        private Double longitude;
        private Map<String, Object> properties; // extra attributes
    }
}
