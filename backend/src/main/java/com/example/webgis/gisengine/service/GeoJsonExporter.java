package com.example.webgis.gisengine.service;

import com.example.webgis.gisengine.model.GisFeature;
import com.example.webgis.gisengine.model.GisLayer;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class GeoJsonExporter {

    public Map<String, Object> export(GisLayer layer) {
        Map<String, Object> featureCollection = new HashMap<>();
        featureCollection.put("type", "FeatureCollection");

        List<Map<String, Object>> featuresList = new ArrayList<>();
        for (GisFeature feature : layer.getFeatures()) {
            Map<String, Object> geoJsonFeature = new HashMap<>();
            geoJsonFeature.put("type", "Feature");
            geoJsonFeature.put("id", feature.getId());
            geoJsonFeature.put("geometry", feature.getGeometry());
            geoJsonFeature.put("properties", feature.getProperties());
            featuresList.add(geoJsonFeature);
        }

        featureCollection.put("features", featuresList);
        return featureCollection;
    }
}
