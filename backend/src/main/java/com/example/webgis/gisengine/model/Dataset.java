package com.example.webgis.gisengine.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Dataset {
    private String id;
    private String name;
    private String sourceFilename;
    private String geometryType;
    private int featureCount;
    private List<String> attributes;
    private double[] boundingBox; // [minLon, minLat, maxLon, maxLat]
    private Instant uploadTimestamp;
    private String status; // "ACTIVE", "ERROR"
    private VizSchema vizSchema;
}
