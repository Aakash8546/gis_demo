package com.example.webgis.h3.derived.metrics;

import com.example.webgis.h3.derived.DerivedMetricCalculator;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Concrete metric calculator for Commercial Suitability Score.
 * High schools density, flat terrain, and urban LULC increase suitability.
 */
@Component
public class CommercialSuitabilityCalculator implements DerivedMetricCalculator {

    @Override
    public String getMetricName() {
        return "suitability_score";
    }

    @Override
    public String getDescription() {
        return "Composite site suitability index for commercial planning.";
    }

    @Override
    public double calculate(Map<String, Object> aggregatedData) {
        if (aggregatedData == null) {
            return 0.0;
        }

        double slope = 0.0;
        Object slopeVal = aggregatedData.get("slope");
        if (slopeVal instanceof Number) {
            slope = ((Number) slopeVal).doubleValue();
        }

        double schools = 0.0;
        Object schoolsVal = aggregatedData.get("schools_count");
        if (schoolsVal instanceof Number) {
            schools = ((Number) schoolsVal).doubleValue();
        }

        double hospitals = 0.0;
        Object hospitalsVal = aggregatedData.get("hospitals_count");
        if (hospitalsVal instanceof Number) {
            hospitals = ((Number) hospitalsVal).doubleValue();
        }

        // Flat ground is highly preferred for development (slope under 5 degrees gets max score)
        double slopeFactor = Math.max(0.0, 1.0 - (slope / 15.0));

        // School and Hospital proximity factor (max 5 facilities)
        double facilitiesFactor = Math.min(1.0, (schools + hospitals) / 10.0);

        // Composite Commercial Suitability Score (50% flat terrain, 50% social infrastructure)
        return (slopeFactor * 0.5) + (facilitiesFactor * 0.5);
    }
}
