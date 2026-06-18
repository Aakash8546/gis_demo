package com.example.webgis.repository;

import com.example.webgis.entity.LulcGeometry;
import com.example.webgis.repository.projection.LulcClassStatProjection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface LulcGeometryRepository extends JpaRepository<LulcGeometry, Long> {

    @Query(value = "WITH user_drawn_polygon AS (" +
                   "  SELECT ST_GeomFromText(:wkt, 4326) AS geom" +
                   ") " +
                   "SELECT " +
                   "  l.class_name AS className, " +
                   "  ROUND(SUM(ST_Area(ST_Intersection(l.geom, p.geom)::geography))::numeric, 2) AS areaM2 " +
                   "FROM lulc_geometries l, user_drawn_polygon p " +
                   "WHERE ST_Intersects(l.geom, p.geom) " +
                   "GROUP BY l.class_name", nativeQuery = true)
    List<LulcClassStatProjection> findLulcStatsForWkt(@Param("wkt") String wkt);
}
