package com.example.webgis.gisengine.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.locationtech.jts.index.strtree.STRtree;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GisLayer {
    private String id;
    private String name;
    private String crs;
    private String geometryType;
    private List<GisFeature> features;
    private Map<String, Object> metadata;

    @Builder.Default
    private transient STRtree spatialIndex = new STRtree();

    public void initialize() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
        if (features == null) {
            features = new ArrayList<>();
        }
        if (metadata == null) {
            metadata = new HashMap<>();
        }
        if (crs == null) {
            crs = "EPSG:4326";
        }
        
        spatialIndex = new STRtree();
        for (GisFeature feature : features) {
            feature.setSourceLayerId(id);
            feature.initialize();
            if (feature.getGeometry() != null) {
                spatialIndex.insert(feature.getGeometry().getEnvelopeInternal(), feature);
            }
        }
        spatialIndex.build();
    }

    @SuppressWarnings("unchecked")
    public List<GisFeature> querySpatial(org.locationtech.jts.geom.Envelope envelope) {
        if (spatialIndex == null) {
            initialize();
        }
        return spatialIndex.query(envelope);
    }
}
