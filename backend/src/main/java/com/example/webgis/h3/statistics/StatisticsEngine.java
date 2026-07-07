package com.example.webgis.h3.statistics;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;





@Service
@Slf4j
public class StatisticsEngine {

    






    public double calculatePercentile(double value, List<Double> reference) {
        if (reference == null || reference.isEmpty()) {
            return 50.0; 
        }

        List<Double> sorted = new ArrayList<>(reference);
        Collections.sort(sorted);

        int count = 0;
        for (double refVal : sorted) {
            if (refVal < value) {
                count++;
            } else if (refVal == value) {
                count++; 
            }
        }

        return ((double) count / sorted.size()) * 100.0;
    }

    







    public double calculateZScore(double value, double mean, double stdDev) {
        if (stdDev <= 0.0) {
            return 0.0;
        }
        return (value - mean) / stdDev;
    }

    





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
