package com.example.webgis.h3.derived;

import java.util.Map;

/**
 * Interface representing a dynamic derived spatial metric calculator (Plugin architecture).
 */
public interface DerivedMetricCalculator {

    /**
     * Unique identifier for the metric.
     */
    String getMetricName();

    /**
     * Description of what this metric calculates.
     */
    String getDescription();

    /**
     * Computes the derived score based on aggregated cell features.
     *
     * @param aggregatedData output map from Aggregation Engine
     * @return Double score usually normalized between 0.0 and 1.0
     */
    double calculate(Map<String, Object> aggregatedData);
}
