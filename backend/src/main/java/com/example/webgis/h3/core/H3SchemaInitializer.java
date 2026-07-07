package com.example.webgis.h3.core;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;





@Service
@Slf4j
public class H3SchemaInitializer {

    private final JdbcTemplate jdbcTemplate;

    public H3SchemaInitializer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void initializeSchema() {
        log.info("Starting database schema initialization for H3 Grid layer...");
        try {
            
            jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS postgis");

            
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS h3_cell_profiles (" +
                "    h3_index          VARCHAR(20) PRIMARY KEY," +
                "    resolution        INTEGER NOT NULL," +
                "    center_lat        DOUBLE PRECISION NOT NULL," +
                "    center_lon        DOUBLE PRECISION NOT NULL," +
                "    boundary_geom     GEOMETRY(Polygon, 4326)," +
                "    aggregated_data   JSONB NOT NULL," +
                "    statistical_data  JSONB," +
                "    derived_metrics   JSONB," +
                "    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()," +
                "    expires_at        TIMESTAMP WITH TIME ZONE" +
                ")"
            );
            log.info("Table 'h3_cell_profiles' verified/created successfully.");

            
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_h3_cell_profiles_geom ON h3_cell_profiles USING gist(boundary_geom)");

            
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS h3_cell_historical_snapshots (" +
                "    id                BIGSERIAL PRIMARY KEY," +
                "    h3_index          VARCHAR(20) NOT NULL," +
                "    snapshot_time     TIMESTAMP WITH TIME ZONE DEFAULT NOW()," +
                "    aggregated_data   JSONB NOT NULL," +
                "    derived_metrics   JSONB NOT NULL" +
                ")"
            );
            log.info("Table 'h3_cell_historical_snapshots' verified/created successfully.");
            log.info("Database schema initialization for H3 Grid completed successfully.");

        } catch (Exception e) {
            log.error("Failed to initialize database schema for H3 Grid", e);
        }
    }
}
