package com.example.webgis.h3.aggregation.strategies;

import com.example.webgis.h3.aggregation.AggregationStrategy;
import com.example.webgis.h3.model.GISDatasetObject.GISFeature;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Concrete aggregation strategy that computes the arithmetic mean of numerical values.
 */
@Component("MEAN")
public class MeanAggregationStrategy implements AggregationStrategy {

    @Override
    public Object aggregate(List<GISFeature> features) {
        if (features == null || features.isEmpty()) {
            return 0.0;
        }

        double sum = 0.0;
        int count = 0;

        for (GISFeature feature : features) {
            if (feature != null && feature.getValue() instanceof Number) {
                sum += ((Number) feature.getValue()).doubleValue();
                count++;
            }
        }

        return count > 0 ? (sum / count) : 0.0;
    }

    @Override
    public String getStrategyName() {
        return "MEAN";
    }
}
