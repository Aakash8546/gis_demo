package com.example.webgis.service;

import com.example.webgis.dto.TerrainQueryResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.sql.Array;
import java.util.List;
import java.util.Map;

@Service
public class TerrainService {

    private final JdbcTemplate jdbcTemplate;

    // Varanasi Bounding Box constraints
    private static final double VARANASI_MIN_LON = 82.50;
    private static final double VARANASI_MAX_LON = 83.35;
    private static final double VARANASI_MIN_LAT = 25.00;
    private static final double VARANASI_MAX_LAT = 25.60;

    public TerrainService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Queries both elevation and slope for a point (longitude, latitude) directly from PostGIS.
     */
    public TerrainQueryResponse queryTerrain(double longitude, double latitude) {
        // Strict boundary check: If outside Varanasi bounds, return null values.
        if (longitude < VARANASI_MIN_LON || longitude > VARANASI_MAX_LON ||
            latitude < VARANASI_MIN_LAT || latitude > VARANASI_MAX_LAT) {
            return new TerrainQueryResponse(longitude, latitude, null, null);
        }

        // Validate table existence
        if (!tableExists("varanasi_dem")) {
            throw new IllegalStateException("DEM dataset table 'varanasi_dem' does not exist.");
        }

        String sql = "SELECT " +
                "  ST_Value(d.rast, 1, ST_SetSRID(ST_MakePoint(?, ?), 4326)) AS elevation, " +
                "  ST_Value(s.rast, 1, ST_SetSRID(ST_MakePoint(?, ?), 4326)) AS slope " +
                "FROM public.varanasi_dem d " +
                "LEFT JOIN public.varanasi_slope s ON " +
                "  ST_Intersects(d.rast, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                "  AND ST_Intersects(s.rast, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                "WHERE ST_Intersects(d.rast, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
                "LIMIT 1";

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql,
                longitude, latitude,
                longitude, latitude,
                longitude, latitude,
                longitude, latitude,
                longitude, latitude);

        if (rows.isEmpty()) {
            return new TerrainQueryResponse(longitude, latitude, null, null);
        }

        Map<String, Object> row = rows.get(0);
        Number elevationNum = (Number) row.get("elevation");
        Number slopeNum = (Number) row.get("slope");

        Double elevation = (elevationNum != null) ? elevationNum.doubleValue() : null;
        Double slope = (slopeNum != null) ? slopeNum.doubleValue() : null;

        return new TerrainQueryResponse(longitude, latitude, elevation, slope);
    }

    /**
     * Generates a 33x33 height grid for CesiumJS terrain rendering from the Copernicus DEM GeoTIFF.
     * Returns a flat binary array of 32-bit little-endian floats.
     */
    public byte[] getTerrainTile(int level, int x, int y) {
        // Geographic Tiling Scheme coordinate bounds calculation
        double lonWidth = 360.0 / (1L << (level + 1));
        double latHeight = 180.0 / (1L << level);

        double xmin = -180.0 + x * lonWidth;
        double xmax = xmin + lonWidth;
        double ymax = 90.0 - y * latHeight;
        double ymin = ymax - latHeight;

        // Bounding box intersection check for Varanasi DEM area
        boolean intersects = !(xmin > VARANASI_MAX_LON || xmax < VARANASI_MIN_LON ||
                               ymin > VARANASI_MAX_LAT || ymax < VARANASI_MIN_LAT);

        if (!intersects) {
            // Outside our DEM dataset. Return 0.0 elevation.
            return new byte[33 * 33 * 4];
        }

        if (!tableExists("varanasi_dem")) {
            throw new IllegalStateException("DEM dataset table 'varanasi_dem' does not exist.");
        }

        String sql = "WITH tile_env AS ( " +
                "  SELECT ST_MakeEnvelope(?, ?, ?, ?, 4326) AS geom " +
                "), " +
                "merged_dem AS ( " +
                "  SELECT ST_Union(ST_Clip(d.rast, env.geom)) AS rast " +
                "  FROM public.varanasi_dem d, tile_env env " +
                "  WHERE ST_Intersects(d.rast, env.geom) " +
                ") " +
                "SELECT array_to_json((ST_DumpValues(ST_Resample(rast, 33, 33, algorithm := 'Bilinear'))).valarray) " +
                "FROM merged_dem " +
                "WHERE rast IS NOT NULL";

        byte[] result = new byte[33 * 33 * 4];
        ByteBuffer buffer = ByteBuffer.wrap(result);
        buffer.order(ByteOrder.LITTLE_ENDIAN);

        try {
            List<String> list = jdbcTemplate.query(sql, (rs, rowNum) -> rs.getString(1), xmin, ymin, xmax, ymax);
            
            Double[][] heightsGrid = null;
            if (!list.isEmpty() && list.get(0) != null) {
                String jsonStr = list.get(0);
                heightsGrid = new com.fasterxml.jackson.databind.ObjectMapper().readValue(jsonStr, Double[][].class);
            }

            for (int r = 0; r < 33; r++) {
                for (int c = 0; c < 33; c++) {
                    Double h = null;
                    if (heightsGrid != null && r < heightsGrid.length && heightsGrid[r] != null && c < heightsGrid[r].length) {
                        h = heightsGrid[r][c];
                    }
                    float val = (h != null) ? h.floatValue() : 0.0f;
                    buffer.putFloat(val);
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
            // Fill with zeroes on error (e.g. database connection issues or rendering exception)
            buffer.clear();
            for (int i = 0; i < 33 * 33; i++) {
                buffer.putFloat(0.0f);
            }
        }

        return result;
    }

    private boolean tableExists(String tableName) {
        String sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?";
        Integer count = jdbcTemplate.queryForObject(sql, Integer.class, tableName);
        return count != null && count > 0;
    }
}
