package com.example.webgis.h3.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.locationtech.jts.geom.Polygon;

import java.time.Instant;
import java.util.Map;




@Entity
@Table(name = "h3_cell_profiles")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class H3CellProfile {

    @Id
    @Column(name = "h3_index", length = 20)
    private String h3Index;

    @Column(nullable = false)
    private int resolution;

    @Column(name = "center_lat", nullable = false)
    private double centerLat;

    @Column(name = "center_lon", nullable = false)
    private double centerLon;

    @Column(name = "boundary_geom", columnDefinition = "geometry(Polygon,4326)")
    private Polygon boundaryGeom;

    @Column(name = "aggregated_data", columnDefinition = "jsonb", nullable = false)
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private Map<String, Object> aggregatedData;

    @Column(name = "statistical_data", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private Map<String, Object> statisticalData;

    @Column(name = "derived_metrics", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private Map<String, Object> derivedMetrics;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @PrePersist
    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
