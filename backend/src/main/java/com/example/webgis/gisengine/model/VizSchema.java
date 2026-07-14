package com.example.webgis.gisengine.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VizSchema {
    @Builder.Default
    private int version = 1;
    
    private String field;
    private String labelField;
    private String palette;
    private String classification;
    private int numClasses;
    private String format;
    
    @Builder.Default
    private int zoomThreshold = 13;
    
    private VizStatistics statistics;
    private List<Double> breaks;
    private List<String> classColors;
    
    @Builder.Default
    private String noDataColor = "#9ca3af";
}
