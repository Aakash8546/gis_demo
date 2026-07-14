package com.example.webgis.gisengine.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.locationtech.jts.geom.Envelope;
import org.locationtech.jts.geom.Geometry;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GisFeature {
    private String id;
    private String sourceLayerId;
    private String datasetName;
    private String zoneId;
    private Geometry geometry;
    private Envelope envelope;
    private Map<String, Object> properties;
    private Map<String, Object> metadata;

    public void initialize() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
        if (properties == null) {
            properties = new HashMap<>();
        }
        if (metadata == null) {
            metadata = new HashMap<>();
        }
        if (geometry != null) {
            envelope = geometry.getEnvelopeInternal();
        }

        // Auto-resolve zoneId from properties
        if (zoneId == null || zoneId.trim().isEmpty()) {
            for (String key : properties.keySet()) {
                if (key.equalsIgnoreCase("zoneId") || key.equalsIgnoreCase("zone_id") || key.equalsIgnoreCase("id")) {
                    Object val = properties.get(key);
                    if (val != null) {
                        zoneId = val.toString().trim();
                        break;
                    }
                }
            }
        }
    }
}
