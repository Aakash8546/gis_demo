package com.example.webgis.layer;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FeatureValue {
    private Object value;
    private Double normalized;
    private Map<String, Object> metadata;
}
