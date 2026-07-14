package com.example.webgis.gisengine.service.derived;

import com.example.webgis.gisengine.model.GisLayer;
import java.util.List;

public interface DerivedLayerCalculator {
    String getMetricName();
    GisLayer calculate(List<GisLayer> inputs);
}
