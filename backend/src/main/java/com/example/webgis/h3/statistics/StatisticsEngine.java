package com.example.webgis.h3.statistics;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Statistics Engine that performs statistical operations (percentiles, z-scores, variance)
 * on cell aggregates to compare cells relative to regional bounds.
 */
@Service
@Slf4j
public class StatisticsEngine {

    /**
     * Calculates the percentile rank of a value in a list of reference values.
     *
     * @param value     the value to evaluate
     * @param reference list of reference values
     * @return Percentile score between 0.0 and 100.0
     */
    public double calculatePercentile(double value, List<Double> reference) {
        if (reference == null || reference.isEmpty()) {
            return 50.0; // default middle percentile
        }

        List<Double> sorted = new ArrayList<>(reference);
        Collections.sort(sorted);

        int count = 0;
        for (double refVal : sorted) {
            if (refVal < value) {
                count++;
            } else if (refVal == value) {
                count++; // Include equality
            }
        }

        return ((double) count / sorted.size()) * 100.0;
    }

    /**
     * Calculates the Z-Score of a value relative to standard bounds.
     *
     * @param value  the value
     * @param mean   mean of the reference sample
     * @param stdDev standard deviation of the reference sample
     * @return Z-score value
     */
    public double calculateZScore(double value, double mean, double stdDev) {
        if (stdDev <= 0.0) {
            return 0.0;
        }
        return (value - mean) / stdDev;
    }

    /**
     * Computes the mean and standard deviation of a collection of values.
     *
     * @param values collection values
     * @return double array: [mean, standardDeviation]
     */
    public double[] computeSummaryStats(Collection<Double> values) {
        if (values == null || values.isEmpty()) {
            return new double[]{0.0, 0.0};
        }

        double sum = 0.0;
        for (double val : values) {
            sum += val;
        }
        double mean = sum / values.size();

        double sqDiffSum = 0.0;
        for (double val : values) {
            sqDiffSum += Math.pow(val - mean, 2);
        }
        double variance = sqDiffSum / values.size();
        double stdDev = Math.sqrt(variance);

        return new double[]{mean, stdDev};
    }
}
