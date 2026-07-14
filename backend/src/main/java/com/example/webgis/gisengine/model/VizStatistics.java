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
public class VizStatistics {
    private double min;
    private double max;
    private double mean;
    private int count;
    private int noDataCount;
    private List<Double> equalIntervalBreaks;
    private List<Double> quantileBreaks;
}
