package com.example.webgis.dto;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LulcResponse {
    private double totalArea;
    private List<LulcClassStat> classes;
    /**
     * GeoJSON FeatureCollection serialized as a raw JSON node (not a string),
     * so it is embedded directly in the response as a JSON object — not double-encoded.
     */
    private JsonNode geojson;
}
