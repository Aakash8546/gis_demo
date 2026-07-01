package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class LocalPostgisLayerProvider implements GisLayerProvider {

    private final JdbcTemplate jdbcTemplate;

    public LocalPostgisLayerProvider(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public String getLayerId() {
        return "local-postgis";
    }

    @Override
    public String getLayerName() {
        return "Local PostGIS Vector & DEM Layers";
    }

    @Override
    public boolean isRaster() {
        return false; // Hybrid layer containing both raster and vector data
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();
        
        // 1. Get LULC Class
        try {
            String lulcSql = "SELECT class_name FROM public.lulc_geometries " +
                             "WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                             "LIMIT 1";
            List<String> classes = jdbcTemplate.query(lulcSql, (rs, rowNum) -> rs.getString(1), lon, lat);
            result.put("lulcClass", classes.isEmpty() ? "Unknown" : classes.get(0));
        } catch (Exception e) {
            log.warn("Failed to query local LULC point: {}", e.getMessage());
            result.put("lulcClass", "Error/Not Found");
        }

        // 2. Get Elevation & Slope
        try {
            if (tableExists("varanasi_dem")) {
                String demSql = "SELECT " +
                        "  ST_Value(d.rast, 1, ST_SetSRID(ST_MakePoint(?, ?), 4326)) AS elevation, " +
                        "  ST_Value(s.rast, 1, ST_SetSRID(ST_MakePoint(?, ?), 4326)) AS slope " +
                        "FROM public.varanasi_dem d " +
                        "LEFT JOIN public.varanasi_slope s ON " +
                        "  ST_Intersects(d.rast, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                        "  AND ST_Intersects(s.rast, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                        "WHERE ST_Intersects(d.rast, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                        "LIMIT 1";
                List<Map<String, Object>> rows = jdbcTemplate.queryForList(demSql,
                        lon, lat,
                        lon, lat,
                        lon, lat,
                        lon, lat,
                        lon, lat);
                if (!rows.isEmpty()) {
                    Map<String, Object> row = rows.get(0);
                    Number elev = (Number) row.get("elevation");
                    Number slp = (Number) row.get("slope");
                    result.put("elevationMeters", elev != null ? elev.doubleValue() : null);
                    result.put("slopeDegrees", slp != null ? slp.doubleValue() : null);
                } else {
                    result.put("elevationMeters", null);
                    result.put("slopeDegrees", null);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to query local DEM point: {}", e.getMessage());
            result.put("elevationMeters", null);
            result.put("slopeDegrees", null);
        }

        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        Map<String, Object> result = new LinkedHashMap<>();
        String wkt = convertToWkt(coordinates);

        // 1. Get LULC stats
        try {
            String lulcSql = "WITH user_polygon AS (" +
                             "  SELECT ST_MakeValid(ST_GeomFromText(?, 4326)) AS geom" +
                             ") " +
                             "SELECT " +
                             "  l.class_name AS className, " +
                             "  SUM(ST_Area(ST_Intersection(l.geom, p.geom)::geography)) AS areaM2 " +
                             "FROM lulc_geometries l, user_polygon p " +
                             "WHERE ST_Intersects(l.geom, p.geom) " +
                             "GROUP BY l.class_name";
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(lulcSql, wkt);
            double totalArea = 0.0;
            List<Map<String, Object>> lulcStats = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Number area = (Number) row.get("areaM2");
                if (area != null) totalArea += area.doubleValue();
            }

            for (Map<String, Object> row : rows) {
                String className = (String) row.get("className");
                Number area = (Number) row.get("areaM2");
                double areaVal = area != null ? area.doubleValue() : 0.0;
                double pct = totalArea > 0 ? (areaVal / totalArea) * 100.0 : 0.0;

                Map<String, Object> stat = new LinkedHashMap<>();
                stat.put("className", className);
                stat.put("areaSqMeters", Math.round(areaVal * 100.0) / 100.0);
                stat.put("percentage", Math.round(pct * 100.0) / 100.0);
                lulcStats.add(stat);
            }
            result.put("lulcBreakdown", lulcStats);
            result.put("totalAreaSqMeters", Math.round(totalArea * 100.0) / 100.0);
        } catch (Exception e) {
            log.error("Failed to query local LULC stats for polygon: {}", e.getMessage());
            result.put("lulcBreakdown", Collections.emptyList());
        }

        // 2. Get Zonal Stats for DEM (raster stats)
        try {
            if (tableExists("varanasi_dem")) {
                String demStatsSql = "WITH user_polygon AS (" +
                                     "  SELECT ST_MakeValid(ST_GeomFromText(?, 4326)) AS geom" +
                                     "), " +
                                     "clipped_dem AS (" +
                                     "  SELECT ST_Union(ST_Clip(d.rast, p.geom)) AS rast " +
                                     "  FROM varanasi_dem d, user_polygon p " +
                                     "  WHERE ST_Intersects(d.rast, p.geom)" +
                                     ") " +
                                     "SELECT (ST_SummaryStats(rast)).* FROM clipped_dem WHERE rast IS NOT NULL";
                List<Map<String, Object>> demRows = jdbcTemplate.queryForList(demStatsSql, wkt);
                if (!demRows.isEmpty()) {
                    Map<String, Object> row = demRows.get(0);
                    result.put("elevationMin", row.get("min"));
                    result.put("elevationMax", row.get("max"));
                    result.put("elevationMean", row.get("mean"));
                    result.put("elevationStdDev", row.get("stddev"));
                }
            }
        } catch (Exception e) {
            log.warn("Failed to calculate local DEM zonal stats: {}", e.getMessage());
        }

        return result;
    }

    private boolean tableExists(String tableName) {
        String sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?";
        Integer count = jdbcTemplate.queryForObject(sql, Integer.class, tableName);
        return count != null && count > 0;
    }

    private String convertToWkt(List<List<List<Double>>> coordinates) {
        StringBuilder sb = new StringBuilder("POLYGON(");
        for (int i = 0; i < coordinates.size(); i++) {
            List<List<Double>> ring = coordinates.get(i);
            sb.append("(");
            for (int j = 0; j < ring.size(); j++) {
                List<Double> pt = ring.get(j);
                sb.append(pt.get(0)).append(" ").append(pt.get(1));
                if (j < ring.size() - 1) sb.append(", ");
            }
            sb.append(")");
            if (i < coordinates.size() - 1) sb.append(", ");
        }
        sb.append(")");
        return sb.toString();
    }
}
