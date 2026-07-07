package com.example.webgis.h3.aggregation.strategies;

import com.example.webgis.h3.aggregation.AggregationStrategy;
import com.example.webgis.h3.model.GISDatasetObject.GISFeature;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Concrete aggregation strategy that sums up integer counts or counts feature occurrences.
 */
@Component("COUNT")
public class CountAggregationStrategy implements AggregationStrategy {



    @Override
    public Object aggregate(List<GISFeature> features) {
        if (features == null || features.isEmpty()) {
            return 0;
        }

        int totalCount = 0;
        boolean hasSpecificCounts = false;

        for (GISFeature feature : features) {
            if (feature != null && feature.getValue() instanceof Number) {
                totalCount += ((Number) feature.getValue()).intValue();
                hasSpecificCounts = true;
            }
        }

        // If elements had no embedded count value, default to counting list size
        return hasSpecificCounts ? totalCount : features.size();
    }

    @Override
    public String getStrategyName() {
        return "COUNT";
    }
}
