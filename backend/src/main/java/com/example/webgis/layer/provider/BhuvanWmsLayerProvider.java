package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class BhuvanWmsLayerProvider implements GisLayerProvider {

    @Override
    public String getLayerId() {
        return "isro-bhuvan-wms";
    }

    @Override
    public String getLayerName() {
        return "ISRO Bhuvan Thematic WMS Layers";
    }

    @Override
    public boolean isRaster() {
        return true;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "success");
        result.put("wmsBaseUrl", "https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms");
        result.put("lulcLayerName", "lulc:UP_LULC50K_1516");
        result.put("geomorphologyLayerName", "geomorphology:UP_GM50K_0506");
        result.put("wastelandLayerName", "wasteland:UP_WL50K_0809");
        result.put("coordinateFormat", "EPSG:4326");
        result.put("providerAuthority", "National Remote Sensing Centre (NRSC), ISRO");
        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        return queryPoint(0, 0);
    }
}
