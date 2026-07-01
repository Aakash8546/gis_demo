package com.example.webgis.layer;

import java.util.List;
import java.util.Map;

public interface GisLayerProvider {
    String getLayerId();
    String getLayerName();
    boolean isRaster();
    Map<String, Object> queryPoint(double lon, double lat);
    Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates);
}
