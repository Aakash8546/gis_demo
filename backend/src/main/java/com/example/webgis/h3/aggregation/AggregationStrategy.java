package com.example.webgis.h3.aggregation;

import com.example.webgis.h3.model.GISDatasetObject.GISFeature;

import java.util.List;

/**
 * Interface representing a strategy to aggregate raw features inside a cell boundary.
 */
public interface AggregationStrategy {
    
    /**
     * Aggregates a list of raw features to a single processed value.
     *
     * @param features list of features
     * @return aggregated object
     */
    Object aggregate(List<GISFeature> features);
    
    String getStrategyName();
}
