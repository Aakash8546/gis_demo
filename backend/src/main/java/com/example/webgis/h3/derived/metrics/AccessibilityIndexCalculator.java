package com.example.webgis.h3.derived.metrics;

import com.example.webgis.h3.derived.DerivedMetricCalculator;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Concrete metric calculator for Accessibility Index.
 * Accessibility is high if roads count is high and terrain is relatively flat.
 */
@Component
public class AccessibilityIndexCalculator implements DerivedMetricCalculator {

    @Override
    public String getMetricName() {
        return "accessibility_index";
    }

    @Override
    public String getDescription() {
        return "Measures ease of travel based on roads count and slope angles.";
    }

    @Override
    public double calculate(Map<String, Object> aggregatedData) {
        if (aggregatedData == null) {
            return 0.0;
        }

        // Get roads count (aggregate strategy: COUNT)
        double roads = 0.0;
        Object roadsVal = aggregatedData.get("roads_count");
        if (roadsVal instanceof Number) {
            roads = ((Number) roadsVal).doubleValue();
        }

        // Get slope angle (aggregate strategy: MEAN)
        double slope = 0.0;
        Object slopeVal = aggregatedData.get("slope");
        if (slopeVal instanceof Number) {
            slope = ((Number) slopeVal).doubleValue();
        }

        // Normalized road density component (capped at 50 roads inside radius)
        double roadsFactor = Math.min(1.0, roads / 50.0);

        // Slope penalty (steeper slopes decrease accessibility, cap at 30 degrees)
        double slopePenalty = Math.min(1.0, slope / 30.0);
        double slopeFactor = 1.0 - slopePenalty;

        // Composite accessibility score (weighted: 70% roads, 30% flat terrain)
        return (roadsFactor * 0.7) + (slopeFactor * 0.3);
    }
}
