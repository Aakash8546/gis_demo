package com.example.webgis.knowledge.service;

import com.example.webgis.knowledge.model.KnowledgeContext;
import com.example.webgis.knowledge.model.KnowledgeNode;
import com.example.webgis.knowledge.model.KnowledgeRelationship;
import com.example.webgis.knowledge.ontology.EntityType;
import com.example.webgis.knowledge.ontology.RelationshipType;
import com.example.webgis.service.TerrainService;
import com.example.webgis.dto.TerrainQueryResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class KnowledgeContextService {

    private final JdbcTemplate jdbcTemplate;
    private final TerrainService terrainService;

    @Transactional
    public Map<String, Object> saveCustomMarker(String name, String layerName, double lon, double lat) {
        log.info("Saving custom marker '{}' of layer '{}' at ({}, {})", name, layerName, lon, lat);

        // 1. Insert into raw_landuse to store name and category (amenity)
        String insertRawSql = 
            "INSERT INTO public.raw_landuse (name, amenity, wkb_geometry) " +
            "VALUES (?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))";
        jdbcTemplate.update(insertRawSql, name, layerName, lon, lat);

        // 2. Insert into lulc_geometries as a small buffer MultiPolygon to satisfy MultiPolygon type restriction
        String insertLulcSql = 
            "INSERT INTO public.lulc_geometries (class_name, geom) " +
            "VALUES (?, ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(?, ?), 4326), 0.0001)))";
        jdbcTemplate.update(insertLulcSql, layerName, lon, lat);

        return Map.of("status", "success", "name", name, "layerName", layerName);
    }

    @Transactional(readOnly = true)
    public KnowledgeContext buildKnowledgeContext(double lat, double lon, Double radiusMeters) {
        double radius = (radiusMeters != null) ? radiusMeters : 2000.0;
        long startTime = System.currentTimeMillis();
        log.info("Building Knowledge Graph Context for coordinate lat={}, lon={}, radius={}", lat, lon, radius);

        // Query DEM elevation and slope
        TerrainQueryResponse terrain = terrainService.queryTerrain(lon, lat);

        // 1. Discover or build Focus Node
        Map<String, Object> focusData = queryFocusFeature(lon, lat);
        KnowledgeNode focusNode;
        boolean hasFocus = focusData != null;

        if (hasFocus) {
            String id = "node-lulc-" + focusData.get("id");
            String className = (String) focusData.get("class_name");
            String osmName = (String) focusData.get("osm_name");
            String kgName = (String) focusData.get("kg_entity_name");
            String kgId = (String) focusData.get("kg_entity_id");
            EntityType type = mapToEntityType(className);
            String label = (kgName != null && !kgName.isBlank()) ? kgName : (osmName != null && !osmName.isBlank()) ? osmName : className + " #" + focusData.get("id");

            Map<String, Object> props = new LinkedHashMap<>();
            props.put("className", className);
            props.put("areaSqKm", focusData.get("area_sq_km"));
            props.put("perimeterKm", focusData.get("perimeter_km"));
            props.put("coordinates", List.of(focusData.get("centroid_lon"), focusData.get("centroid_lat")));
            props.put("isVirtual", false);
            props.put("elevation", terrain.getElevation());
            props.put("slope", terrain.getSlope());
            if (kgId != null) {
                props.put("kgEntityId", kgId);
            }

            focusNode = new KnowledgeNode(id, type, label, props);
        } else {
            // Fallback virtual parcel
            Map<String, Object> props = new LinkedHashMap<>();
            props.put("className", "Parcel");
            props.put("areaSqKm", 0.0);
            props.put("perimeterKm", 0.0);
            props.put("coordinates", List.of(lon, lat));
            props.put("isVirtual", true);
            props.put("elevation", terrain.getElevation());
            props.put("slope", terrain.getSlope());

            focusNode = new KnowledgeNode("node-virtual-parcel", EntityType.Parcel, "Clicked Location", props);
        }

        // 2. Discover all nearby entities within search radius
        List<Map<String, Object>> nearbyData = queryNearbyFeatures(lon, lat, radius);
        
        List<KnowledgeNode> entities = new ArrayList<>();
        List<KnowledgeRelationship> relationships = new ArrayList<>();

        // Add focus node
        entities.add(focusNode);

        // Add static administrative nodes
        KnowledgeNode districtNode = new KnowledgeNode(
            "node-dist-varanasi", 
            EntityType.District, 
            "Varanasi District", 
            Map.of("level", "Administrative Level 2", "className", "District")
        );
        KnowledgeNode stateNode = new KnowledgeNode(
            "node-state-up", 
            EntityType.State, 
            "Uttar Pradesh", 
            Map.of("level", "Administrative Level 1", "className", "State")
        );
        entities.add(districtNode);
        entities.add(stateNode);

        // Focus node within Varanasi District, District part of UP
        relationships.add(new KnowledgeRelationship(focusNode.getId(), districtNode.getId(), RelationshipType.WITHIN, Map.of()));
        relationships.add(new KnowledgeRelationship(districtNode.getId(), stateNode.getId(), RelationshipType.PART_OF, Map.of()));

        // Add virtual FloodZone node if nearby river/water body is close
        KnowledgeNode floodZoneNode = new KnowledgeNode(
            "node-flood-ganges", 
            EntityType.FloodZone, 
            "Ganges Flood Plain", 
            Map.of("riskAssessment", "Riverine Flooding Zone", "className", "FloodZone")
        );
        boolean isFloodZoneAdded = false;

        // Statistics helper variables
        String nearestRoadName = "None detected";
        double nearestRoadDist = Double.MAX_VALUE;
        String nearestRiverName = "None detected";
        double nearestRiverDist = Double.MAX_VALUE;
        String nearestVillageName = "None detected";
        double nearestVillageDist = Double.MAX_VALUE;
        String nearestIndustryName = "None detected";
        double nearestIndustryDist = Double.MAX_VALUE;
        String nearestForestName = "None detected";
        double nearestForestDist = Double.MAX_VALUE;
        String nearestWaterBodyName = "None detected";
        double nearestWaterBodyDist = Double.MAX_VALUE;
        String nearestSchoolName = "None detected";
        double nearestSchoolDist = Double.MAX_VALUE;
        String nearestHospitalName = "None detected";
        double nearestHospitalDist = Double.MAX_VALUE;

        int schoolsCount = 0;
        int hospitalsCount = 0;
        int gymsCount = 0;
        int waterBodiesCount = 0;
        double forestAreaSqKm = 0.0;

        // Keep track of all matching KG entities discovered in the search range
        Map<String, String> kgIdToNodeIdMap = new HashMap<>();
        if (focusNode.getProperties().containsKey("kgEntityId")) {
            kgIdToNodeIdMap.put((String) focusNode.getProperties().get("kgEntityId"), focusNode.getId());
        }

        for (Map<String, Object> row : nearbyData) {
            String rowId = "node-lulc-" + row.get("id");
            // Skip focus node
            if (rowId.equals(focusNode.getId())) {
                continue;
            }

            String className = (String) row.get("class_name");
            String osmName = (String) row.get("osm_name");
            String kgName = (String) row.get("kg_entity_name");
            String kgId = (String) row.get("kg_entity_id");

            double distMeters = ((Number) row.get("distance_m")).doubleValue();
            double distKm = distMeters / 1000.0;
            double areaSqKm = row.get("area_sq_km") != null ? ((Number) row.get("area_sq_km")).doubleValue() : 0.0;

            EntityType type = mapToEntityType(className);
            String label = (kgName != null && !kgName.isBlank()) ? kgName : (osmName != null && !osmName.isBlank()) ? osmName : className + " #" + row.get("id");

            Map<String, Object> props = new LinkedHashMap<>();
            props.put("className", className);
            props.put("distanceMeters", distMeters);
            props.put("coordinates", List.of(row.get("centroid_lon"), row.get("centroid_lat")));
            if (kgId != null) {
                props.put("kgEntityId", kgId);
                kgIdToNodeIdMap.put(kgId, rowId);
            }
            
            KnowledgeNode node = new KnowledgeNode(rowId, type, label, props);
            entities.add(node);

            // Determine semantic relationship
            RelationshipType relType = RelationshipType.NEAR;
            Map<String, Object> relProps = new LinkedHashMap<>();
            relProps.put("distanceMeters", distMeters);

            if (type == EntityType.Road) {
                if (distMeters < 100.0) {
                    relType = RelationshipType.CONNECTED_TO;
                }
                if (distKm < nearestRoadDist) {
                    nearestRoadDist = distKm;
                    nearestRoadName = label;
                }
            } else if (type == EntityType.River) {
                if (distKm < nearestRiverDist) {
                    nearestRiverDist = distKm;
                    nearestRiverName = label;
                }
                // Flood hazard trigger
                if (distMeters < 500.0) {
                    if (!isFloodZoneAdded) {
                        entities.add(floodZoneNode);
                        isFloodZoneAdded = true;
                    }
                    relationships.add(new KnowledgeRelationship(focusNode.getId(), floodZoneNode.getId(), RelationshipType.AFFECTED_BY, Map.of("triggerDistanceMeters", distMeters)));
                }
            } else if (type == EntityType.Village) {
                if (distKm < nearestVillageDist) {
                    nearestVillageDist = distKm;
                    nearestVillageName = label;
                }
            } else if ("Industry".equalsIgnoreCase(className)) {
                if (distKm < nearestIndustryDist) {
                    nearestIndustryDist = distKm;
                    nearestIndustryName = label;
                }
            } else if (type == EntityType.Forest) {
                if (distKm < nearestForestDist) {
                    nearestForestDist = distKm;
                    nearestForestName = label;
                }
            } else if (type == EntityType.WaterBody) {
                if (distKm < nearestWaterBodyDist) {
                    nearestWaterBodyDist = distKm;
                    nearestWaterBodyName = label;
                }
            }

            // Group counters
            if (type == EntityType.School) {
                schoolsCount++;
                if (distKm < nearestSchoolDist) {
                    nearestSchoolDist = distKm;
                    nearestSchoolName = label;
                }
            } else if (type == EntityType.Hospital) {
                hospitalsCount++;
                if (distKm < nearestHospitalDist) {
                    nearestHospitalDist = distKm;
                    nearestHospitalName = label;
                }
            } else if (type == EntityType.Building && "Gym".equalsIgnoreCase(className)) {
                gymsCount++;
            } else if (type == EntityType.WaterBody) {
                waterBodiesCount++;
            } else if (type == EntityType.Forest) {
                forestAreaSqKm += areaSqKm;
            }

            relationships.add(new KnowledgeRelationship(focusNode.getId(), rowId, relType, relProps));
        }

        // 3. Dynamic Load Entity Properties for discovered KG nodes
        if (!kgIdToNodeIdMap.isEmpty()) {
            try {
                String inSql = String.join(",", Collections.nCopies(kgIdToNodeIdMap.size(), "?"));
                String propSql = "SELECT entity_id, property_key, property_value FROM public.entity_properties WHERE entity_id IN (" + inSql + ")";
                List<Map<String, Object>> propRows = jdbcTemplate.queryForList(propSql, kgIdToNodeIdMap.keySet().toArray());
                
                // Group by entity_id
                Map<String, Map<String, Object>> entityPropsMap = new HashMap<>();
                for (Map<String, Object> pRow : propRows) {
                    String entId = (String) pRow.get("entity_id");
                    String key = (String) pRow.get("property_key");
                    String val = (String) pRow.get("property_value");
                    entityPropsMap.computeIfAbsent(entId, k -> new LinkedHashMap<>()).put(key, val);
                }

                // Inject properties into nodes
                for (KnowledgeNode node : entities) {
                    String kgId = (String) node.getProperties().get("kgEntityId");
                    if (kgId != null && entityPropsMap.containsKey(kgId)) {
                        node.getProperties().put("semanticProperties", entityPropsMap.get(kgId));
                    }
                }
            } catch (Exception e) {
                log.error("Failed to batch query entity properties: {}", e.getMessage());
            }
        }

        // 4. Dynamic Load Semantic KG Relationships between discovered nodes
        if (kgIdToNodeIdMap.size() > 1) {
            try {
                String inSql = String.join(",", Collections.nCopies(kgIdToNodeIdMap.size(), "?"));
                String relSql = 
                    "SELECT r.id, r.source_id, r.target_id, r.relation_type, p.property_key, p.property_value " +
                    "FROM public.kg_relations r " +
                    "LEFT JOIN public.relationship_properties p ON r.id = p.relation_id " +
                    "WHERE r.source_id IN (" + inSql + ") AND r.target_id IN (" + inSql + ")";
                
                Object[] params = new Object[kgIdToNodeIdMap.size() * 2];
                Object[] idArray = kgIdToNodeIdMap.keySet().toArray();
                System.arraycopy(idArray, 0, params, 0, idArray.length);
                System.arraycopy(idArray, 0, params, idArray.length, idArray.length);

                List<Map<String, Object>> relRows = jdbcTemplate.queryForList(relSql, params);

                // Group properties by relation ID
                Map<String, Map<String, Object>> relPropsMap = new LinkedHashMap<>();
                Map<String, Map<String, Object>> relMetadata = new LinkedHashMap<>(); // keys: source, target, relation_type

                for (Map<String, Object> rRow : relRows) {
                    String relId = (String) rRow.get("id");
                    String src = (String) rRow.get("source_id");
                    String tgt = (String) rRow.get("target_id");
                    String type = (String) rRow.get("relation_type");
                    String pKey = (String) rRow.get("property_key");
                    String pVal = (String) rRow.get("property_value");

                    relMetadata.putIfAbsent(relId, Map.of("source", src, "target", tgt, "type", type));
                    if (pKey != null) {
                        relPropsMap.computeIfAbsent(relId, k -> new LinkedHashMap<>()).put(pKey, pVal);
                    }
                }

                // Add enriched relationships
                for (Map.Entry<String, Map<String, Object>> entry : relMetadata.entrySet()) {
                    String relId = entry.getKey();
                    Map<String, Object> meta = entry.getValue();
                    String srcKgId = (String) meta.get("source");
                    String tgtKgId = (String) meta.get("target");
                    String relTypeStr = (String) meta.get("type");

                    String srcNodeId = kgIdToNodeIdMap.get(srcKgId);
                    String tgtNodeId = kgIdToNodeIdMap.get(tgtKgId);
                    
                    if (srcNodeId != null && tgtNodeId != null) {
                        RelationshipType rType;
                        try {
                            rType = RelationshipType.valueOf(relTypeStr.toUpperCase());
                        } catch (Exception ex) {
                            rType = RelationshipType.NEAR;
                        }

                        Map<String, Object> relProps = new LinkedHashMap<>();
                        relProps.put("isSemantic", true);
                        if (relPropsMap.containsKey(relId)) {
                            relProps.put("properties", relPropsMap.get(relId));
                        }

                        relationships.add(new KnowledgeRelationship(srcNodeId, tgtNodeId, rType, relProps));
                    }
                }
            } catch (Exception e) {
                log.error("Failed to query semantic relationships: {}", e.getMessage());
            }
        }

        // 5. Compile Summary stats
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("nearestRoad", nearestRoadDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestRoadName, nearestRoadDist));
        summary.put("nearestRiver", nearestRiverDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestRiverName, nearestRiverDist));
        summary.put("nearestVillage", nearestVillageDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestVillageName, nearestVillageDist));
        summary.put("nearestIndustry", nearestIndustryDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestIndustryName, nearestIndustryDist));
        summary.put("nearestForest", nearestForestDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestForestName, nearestForestDist));
        summary.put("nearestWaterBody", nearestWaterBodyDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestWaterBodyName, nearestWaterBodyDist));
        summary.put("nearestSchool", nearestSchoolDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestSchoolName, nearestSchoolDist));
        summary.put("nearestHospital", nearestHospitalDist == Double.MAX_VALUE ? "None in radius" : String.format(Locale.US, "%s (%.2f km)", nearestHospitalName, nearestHospitalDist));

        summary.put("nearestRoadDist", nearestRoadDist == Double.MAX_VALUE ? -1.0 : nearestRoadDist);
        summary.put("nearestRiverDist", nearestRiverDist == Double.MAX_VALUE ? -1.0 : nearestRiverDist);
        summary.put("nearestVillageDist", nearestVillageDist == Double.MAX_VALUE ? -1.0 : nearestVillageDist);
        summary.put("nearestIndustryDist", nearestIndustryDist == Double.MAX_VALUE ? -1.0 : nearestIndustryDist);
        summary.put("nearestForestDist", nearestForestDist == Double.MAX_VALUE ? -1.0 : nearestForestDist);
        summary.put("nearestWaterBodyDist", nearestWaterBodyDist == Double.MAX_VALUE ? -1.0 : nearestWaterBodyDist);
        summary.put("nearestSchoolDist", nearestSchoolDist == Double.MAX_VALUE ? -1.0 : nearestSchoolDist);
        summary.put("nearestHospitalDist", nearestHospitalDist == Double.MAX_VALUE ? -1.0 : nearestHospitalDist);

        summary.put("schoolsCount", schoolsCount);
        summary.put("hospitalsCount", hospitalsCount);
        summary.put("gymsCount", gymsCount);
        summary.put("waterBodiesCount", waterBodiesCount);
        summary.put("forestAreaSqKm", Math.round(forestAreaSqKm * 100.0) / 100.0);

        String floodRisk = "Low";
        if (nearestRiverDist < 0.3 || nearestRiverName.toLowerCase().contains("ganges") && nearestRiverDist < 0.5) {
            floodRisk = "High";
        } else if (nearestRiverDist < 0.8) {
            floodRisk = "Medium";
        }
        summary.put("floodRisk", floodRisk);

        // 6. Compile Metadata
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("queryLon", lon);
        metadata.put("queryLat", lat);
        metadata.put("radiusMeters", radius);
        metadata.put("totalEntitiesDiscovered", entities.size());
        metadata.put("totalRelationshipsDiscovered", relationships.size());
        metadata.put("responseTimeMs", System.currentTimeMillis() - startTime);

        return new KnowledgeContext(
            Map.of("lat", lat, "lon", lon),
            entities,
            relationships,
            summary,
            metadata
        );
    }

    private EntityType mapToEntityType(String className) {
        if (className == null) return EntityType.Parcel;
        switch (className) {
            case "Hospital": return EntityType.Hospital;
            case "School": return EntityType.School;
            case "Road": return EntityType.Road;
            case "River": return EntityType.River;
            case "Village": return EntityType.Village;
            case "Forest": return EntityType.Forest;
            case "Agriculture": return EntityType.Agriculture;
            case "BuiltUp": return EntityType.UrbanArea;
            case "Industry": return EntityType.UrbanArea;
            case "Water": return EntityType.WaterBody;
            case "Reservoir": return EntityType.WaterBody;
            case "Wetland": return EntityType.ProtectedArea;
            case "Gym": return EntityType.Building;
            default: return EntityType.Parcel;
        }
    }

    private Map<String, Object> queryFocusFeature(double lon, double lat) {
        String sql = 
            "SELECT l.id, l.class_name, r.name as osm_name, " +
            "  k.id as kg_entity_id, k.entity_name as kg_entity_name, " +
            "  ST_Area(l.geom::geography) / 1000000.0 as area_sq_km, " +
            "  ST_Perimeter(l.geom::geography) / 1000.0 as perimeter_km, " +
            "  ST_X(ST_Centroid(l.geom)) as centroid_lon, " +
            "  ST_Y(ST_Centroid(l.geom)) as centroid_lat " +
            "FROM public.lulc_geometries l " +
            "LEFT JOIN public.kg_entities k ON CAST(l.id as varchar) = k.geometry_ref_id " +
            "LEFT JOIN public.raw_landuse r ON l.geom && r.wkb_geometry AND ST_Intersects(l.geom, r.wkb_geometry) " +
            "  AND r.name IS NOT NULL " +
            "  AND ( " +
            "    (l.class_name = 'River' AND (r.\"natural\" = 'water' OR r.water IS NOT NULL OR r.name ILIKE '%river%' OR r.name ILIKE '%ganga%' OR r.name ILIKE '%varuna%' OR r.name ILIKE '%assi%')) " +
            "    OR (l.class_name = 'Hospital' AND (r.amenity = 'hospital' OR r.building = 'hospital' OR r.name ILIKE '%hospital%' OR r.name ILIKE '%clinic%')) " +
            "    OR (l.class_name = 'School' AND (r.amenity = 'school' OR r.building = 'school' OR r.name ILIKE '%school%' OR r.name ILIKE '%college%')) " +
            "    OR (l.class_name = 'Gym' AND (r.amenity = 'gym' OR r.name ILIKE '%gym%')) " +
            "    OR (l.class_name NOT IN ('Road', 'River', 'Hospital', 'School', 'Gym')) " +
            "  ) " +
            "WHERE ST_Contains(l.geom, ST_SetSRID(ST_MakePoint(?, ?), 4326)) " +
            "ORDER BY ST_Area(l.geom) ASC " +
            "LIMIT 1";
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, lon, lat);
            if (!rows.isEmpty()) {
                return rows.get(0);
            }
        } catch (Exception e) {
            log.warn("ST_Contains query failed, attempting nearest geometry: {}", e.getMessage());
        }

        // Fallback: nearest feature within 100m
        String fallbackSql = 
            "SELECT l.id, l.class_name, r.name as osm_name, " +
            "  k.id as kg_entity_id, k.entity_name as kg_entity_name, " +
            "  ST_Area(l.geom::geography) / 1000000.0 as area_sq_km, " +
            "  ST_Perimeter(l.geom::geography) / 1000.0 as perimeter_km, " +
            "  ST_X(ST_Centroid(l.geom)) as centroid_lon, " +
            "  ST_Y(ST_Centroid(l.geom)) as centroid_lat, " +
            "  ST_Distance(l.geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) as dist " +
            "FROM public.lulc_geometries l " +
            "LEFT JOIN public.kg_entities k ON CAST(l.id as varchar) = k.geometry_ref_id " +
            "LEFT JOIN public.raw_landuse r ON l.geom && r.wkb_geometry AND ST_Intersects(l.geom, r.wkb_geometry) " +
            "  AND r.name IS NOT NULL " +
            "  AND ( " +
            "    (l.class_name = 'River' AND (r.\"natural\" = 'water' OR r.water IS NOT NULL OR r.name ILIKE '%river%' OR r.name ILIKE '%ganga%' OR r.name ILIKE '%varuna%' OR r.name ILIKE '%assi%')) " +
            "    OR (l.class_name = 'Hospital' AND (r.amenity = 'hospital' OR r.building = 'hospital' OR r.name ILIKE '%hospital%' OR r.name ILIKE '%clinic%')) " +
            "    OR (l.class_name = 'School' AND (r.amenity = 'school' OR r.building = 'school' OR r.name ILIKE '%school%' OR r.name ILIKE '%college%')) " +
            "    OR (l.class_name = 'Gym' AND (r.amenity = 'gym' OR r.name ILIKE '%gym%')) " +
            "    OR (l.class_name NOT IN ('Road', 'River', 'Hospital', 'School', 'Gym')) " +
            "  ) " +
            "WHERE ST_DWithin(l.geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 100.0) " +
            "ORDER BY dist ASC " +
            "LIMIT 1";
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(fallbackSql, lon, lat, lon, lat);
            if (!rows.isEmpty()) {
                return rows.get(0);
            }
        } catch (Exception e) {
            log.error("Fallback focus query failed: {}", e.getMessage());
        }

        return null;
    }

    private List<Map<String, Object>> queryNearbyFeatures(double lon, double lat, double radiusMeters) {
        String sql = 
            "SELECT id, class_name, osm_name, kg_entity_id, kg_entity_name, distance_m, centroid_lon, centroid_lat, area_sq_km FROM ( " +
            "  SELECT DISTINCT ON (l.id) l.id, l.class_name, r.name as osm_name, " +
            "         k.id as kg_entity_id, k.entity_name as kg_entity_name, " +
            "         ST_Distance(l.geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) as distance_m, " +
            "         ST_X(ST_Centroid(l.geom)) as centroid_lon, ST_Y(ST_Centroid(l.geom)) as centroid_lat, " +
            "         ST_Area(l.geom::geography) / 1000000.0 as area_sq_km " +
            "  FROM public.lulc_geometries l " +
            "  LEFT JOIN public.kg_entities k ON CAST(l.id as varchar) = k.geometry_ref_id " +
            "  LEFT JOIN public.raw_landuse r ON l.geom && r.wkb_geometry AND ST_Intersects(l.geom, r.wkb_geometry) " +
            "    AND r.name IS NOT NULL " +
            "    AND ( " +
            "      (l.class_name = 'River' AND (r.\"natural\" = 'water' OR r.water IS NOT NULL OR r.name ILIKE '%river%' OR r.name ILIKE '%ganga%' OR r.name ILIKE '%varuna%' OR r.name ILIKE '%assi%')) " +
            "      OR (l.class_name = 'Hospital' AND (r.amenity = 'hospital' OR r.building = 'hospital' OR r.name ILIKE '%hospital%' OR r.name ILIKE '%clinic%')) " +
            "      OR (l.class_name = 'School' AND (r.amenity = 'school' OR r.building = 'school' OR r.name ILIKE '%school%' OR r.name ILIKE '%college%')) " +
            "      OR (l.class_name = 'Gym' AND (r.amenity = 'gym' OR r.name ILIKE '%gym%')) " +
            "      OR (l.class_name NOT IN ('Road', 'River', 'Hospital', 'School', 'Gym')) " +
            "    ) " +
            "  WHERE ST_DWithin(l.geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?) " +
            "  ORDER BY l.id, distance_m ASC " +
            ") sub " +
            "ORDER BY distance_m ASC " +
            "LIMIT 100";
        try {
            return jdbcTemplate.queryForList(sql, lon, lat, lon, lat, radiusMeters);
        } catch (Exception e) {
            log.error("Query nearby features failed: {}", e.getMessage());
            return List.of();
        }
    }

    @Transactional(readOnly = true)
    public KnowledgeContext buildPolygonKnowledgeContext(List<List<List<Double>>> coords) {
        long startTime = System.currentTimeMillis();
        String wkt = convertToWkt(coords);
        log.info("Building Knowledge Graph Context for polygon WKT={}", wkt);

        // 1. Query Polygon Metrics (Centroid, Area, Perimeter)
        String metricsSql = 
            "SELECT " +
            "  ST_Area(ST_GeomFromText(?, 4326)::geography) / 1000000.0 as area_sq_km, " +
            "  ST_Perimeter(ST_GeomFromText(?, 4326)::geography) / 1000.0 as perimeter_km, " +
            "  ST_X(ST_Centroid(ST_GeomFromText(?, 4326))) as centroid_lon, " +
            "  ST_Y(ST_Centroid(ST_GeomFromText(?, 4326))) as centroid_lat";
        
        List<Map<String, Object>> metricsRows = jdbcTemplate.queryForList(metricsSql, wkt, wkt, wkt, wkt);
        if (metricsRows.isEmpty()) {
            throw new IllegalArgumentException("Invalid polygon geometry");
        }
        
        Map<String, Object> metrics = metricsRows.get(0);
        double areaSqKm = ((Number) metrics.get("area_sq_km")).doubleValue();
        double perimeterKm = ((Number) metrics.get("perimeter_km")).doubleValue();
        double centroidLon = ((Number) metrics.get("centroid_lon")).doubleValue();
        double centroidLat = ((Number) metrics.get("centroid_lat")).doubleValue();

        // Query DEM elevation and slope at centroid
        TerrainQueryResponse terrain = terrainService.queryTerrain(centroidLon, centroidLat);

        // 2. Focus Node
        Map<String, Object> focusProps = new LinkedHashMap<>();
        focusProps.put("className", "Parcel");
        focusProps.put("areaSqKm", Math.round(areaSqKm * 100.0) / 100.0);
        focusProps.put("perimeterKm", Math.round(perimeterKm * 100.0) / 100.0);
        focusProps.put("coordinates", List.of(centroidLon, centroidLat));
        focusProps.put("isVirtual", false);
        focusProps.put("elevation", terrain.getElevation());
        focusProps.put("slope", terrain.getSlope());

        KnowledgeNode focusNode = new KnowledgeNode("node-focus-polygon", EntityType.Parcel, "Selected Polygon Area", focusProps);

        // 3. Query all intersecting features in LULC and OSM
        List<Map<String, Object>> intersectingData = queryIntersectingFeatures(wkt);

        List<KnowledgeNode> entities = new ArrayList<>();
        List<KnowledgeRelationship> relationships = new ArrayList<>();

        entities.add(focusNode);

        // Add static administrative nodes
        KnowledgeNode districtNode = new KnowledgeNode(
            "node-dist-varanasi", 
            EntityType.District, 
            "Varanasi District", 
            Map.of("level", "Administrative Level 2", "className", "District")
        );
        KnowledgeNode stateNode = new KnowledgeNode(
            "node-state-up", 
            EntityType.State, 
            "Uttar Pradesh", 
            Map.of("level", "Administrative Level 1", "className", "State")
        );
        entities.add(districtNode);
        entities.add(stateNode);

        relationships.add(new KnowledgeRelationship(focusNode.getId(), districtNode.getId(), RelationshipType.WITHIN, Map.of()));
        relationships.add(new KnowledgeRelationship(districtNode.getId(), stateNode.getId(), RelationshipType.PART_OF, Map.of()));

        // Keep track of all matching KG entities discovered
        Map<String, String> kgIdToNodeIdMap = new HashMap<>();

        // Statistics helper variables
        String nearestRoadName = "None detected";
        double nearestRoadDist = Double.MAX_VALUE;
        String nearestRiverName = "None detected";
        double nearestRiverDist = Double.MAX_VALUE;
        String nearestVillageName = "None detected";
        double nearestVillageDist = Double.MAX_VALUE;
        String nearestIndustryName = "None detected";
        double nearestIndustryDist = Double.MAX_VALUE;
        String nearestForestName = "None detected";
        double nearestForestDist = Double.MAX_VALUE;
        String nearestWaterBodyName = "None detected";
        double nearestWaterBodyDist = Double.MAX_VALUE;
        String nearestSchoolName = "None detected";
        double nearestSchoolDist = Double.MAX_VALUE;
        String nearestHospitalName = "None detected";
        double nearestHospitalDist = Double.MAX_VALUE;

        int schoolsCount = 0;
        int hospitalsCount = 0;
        int gymsCount = 0;
        int waterBodiesCount = 0;
        double forestAreaSqKm = 0.0;

        for (Map<String, Object> row : intersectingData) {
            String rowId = "node-lulc-" + row.get("id");
            String className = (String) row.get("class_name");
            String osmName = (String) row.get("osm_name");
            String kgName = (String) row.get("kg_entity_name");
            String kgId = (String) row.get("kg_entity_id");

            double distMeters = ((Number) row.get("distance_to_centroid_m")).doubleValue();
            double distKm = distMeters / 1000.0;
            double featAreaSqKm = row.get("area_sq_km") != null ? ((Number) row.get("area_sq_km")).doubleValue() : 0.0;
            boolean isFullyContained = (Boolean) row.get("is_fully_contained");

            EntityType type = mapToEntityType(className);
            String label = (kgName != null && !kgName.isBlank()) ? kgName : (osmName != null && !osmName.isBlank()) ? osmName : className + " #" + row.get("id");

            Map<String, Object> props = new LinkedHashMap<>();
            props.put("className", className);
            props.put("distanceToCentroidMeters", distMeters);
            props.put("isFullyContained", isFullyContained);
            props.put("coordinates", List.of(row.get("centroid_lon"), row.get("centroid_lat")));
            if (kgId != null) {
                props.put("kgEntityId", kgId);
                kgIdToNodeIdMap.put(kgId, rowId);
            }

            KnowledgeNode node = new KnowledgeNode(rowId, type, label, props);
            entities.add(node);

            // Connect feature node to the polygon focus node
            RelationshipType relType = isFullyContained ? RelationshipType.WITHIN : RelationshipType.INTERSECTS;
            Map<String, Object> relProps = new LinkedHashMap<>();
            relProps.put("distanceToCentroidMeters", distMeters);
            relProps.put("isFocusConnection", true);
            relationships.add(new KnowledgeRelationship(rowId, focusNode.getId(), relType, relProps));

            // Stats computation
            if (type == EntityType.Road) {
                if (distKm < nearestRoadDist) {
                    nearestRoadDist = distKm;
                    nearestRoadName = label;
                }
            } else if (type == EntityType.River) {
                if (distKm < nearestRiverDist) {
                    nearestRiverDist = distKm;
                    nearestRiverName = label;
                }
            } else if (type == EntityType.Village) {
                if (distKm < nearestVillageDist) {
                    nearestVillageDist = distKm;
                    nearestVillageName = label;
                }
            } else if ("Industry".equalsIgnoreCase(className)) {
                if (distKm < nearestIndustryDist) {
                    nearestIndustryDist = distKm;
                    nearestIndustryName = label;
                }
            } else if (type == EntityType.Forest) {
                if (distKm < nearestForestDist) {
                    nearestForestDist = distKm;
                    nearestForestName = label;
                }
            } else if (type == EntityType.WaterBody) {
                if (distKm < nearestWaterBodyDist) {
                    nearestWaterBodyDist = distKm;
                    nearestWaterBodyName = label;
                }
            }

            if (type == EntityType.School) {
                schoolsCount++;
                if (distKm < nearestSchoolDist) {
                    nearestSchoolDist = distKm;
                    nearestSchoolName = label;
                }
            } else if (type == EntityType.Hospital) {
                hospitalsCount++;
                if (distKm < nearestHospitalDist) {
                    nearestHospitalDist = distKm;
                    nearestHospitalName = label;
                }
            } else if (type == EntityType.Building && "Gym".equalsIgnoreCase(className)) {
                gymsCount++;
            } else if (type == EntityType.WaterBody) {
                waterBodiesCount++;
            } else if (type == EntityType.Forest) {
                forestAreaSqKm += featAreaSqKm;
            }
        }

        // 4. Batch query entity properties for discovered nodes
        if (!kgIdToNodeIdMap.isEmpty()) {
            try {
                String inSql = String.join(",", Collections.nCopies(kgIdToNodeIdMap.size(), "?"));
                String propSql = "SELECT entity_id, property_key, property_value FROM public.entity_properties WHERE entity_id IN (" + inSql + ")";
                List<Map<String, Object>> propRows = jdbcTemplate.queryForList(propSql, kgIdToNodeIdMap.keySet().toArray());
                
                Map<String, Map<String, Object>> entityPropsMap = new HashMap<>();
                for (Map<String, Object> pRow : propRows) {
                    String entId = (String) pRow.get("entity_id");
                    String key = (String) pRow.get("property_key");
                    String val = (String) pRow.get("property_value");
                    entityPropsMap.computeIfAbsent(entId, k -> new LinkedHashMap<>()).put(key, val);
                }

                for (KnowledgeNode node : entities) {
                    String kgId = (String) node.getProperties().get("kgEntityId");
                    if (kgId != null && entityPropsMap.containsKey(kgId)) {
                        node.getProperties().put("semanticProperties", entityPropsMap.get(kgId));
                    }
                }
            } catch (Exception e) {
                log.error("Failed to batch query entity properties: {}", e.getMessage());
            }
        }

        // 5. Query semantic relations between nodes
        if (kgIdToNodeIdMap.size() > 1) {
            try {
                String inSql = String.join(",", Collections.nCopies(kgIdToNodeIdMap.size(), "?"));
                String relSql = 
                    "SELECT r.id, r.source_id, r.target_id, r.relation_type, p.property_key, p.property_value " +
                    "FROM public.kg_relations r " +
                    "LEFT JOIN public.relationship_properties p ON r.id = p.relation_id " +
                    "WHERE r.source_id IN (" + inSql + ") AND r.target_id IN (" + inSql + ")";
                
                Object[] params = new Object[kgIdToNodeIdMap.size() * 2];
                Object[] idArray = kgIdToNodeIdMap.keySet().toArray();
                System.arraycopy(idArray, 0, params, 0, idArray.length);
                System.arraycopy(idArray, 0, params, idArray.length, idArray.length);

                List<Map<String, Object>> relRows = jdbcTemplate.queryForList(relSql, params);

                Map<String, Map<String, Object>> relPropsMap = new LinkedHashMap<>();
                Map<String, Map<String, Object>> relMetadata = new LinkedHashMap<>();

                for (Map<String, Object> rRow : relRows) {
                    String relId = (String) rRow.get("id");
                    String src = (String) rRow.get("source_id");
                    String tgt = (String) rRow.get("target_id");
                    String type = (String) rRow.get("relation_type");
                    String pKey = (String) rRow.get("property_key");
                    String pVal = (String) rRow.get("property_value");

                    relMetadata.putIfAbsent(relId, Map.of("source", src, "target", tgt, "type", type));
                    if (pKey != null) {
                        relPropsMap.computeIfAbsent(relId, k -> new LinkedHashMap<>()).put(pKey, pVal);
                    }
                }

                for (Map.Entry<String, Map<String, Object>> entry : relMetadata.entrySet()) {
                    String relId = entry.getKey();
                    Map<String, Object> meta = entry.getValue();
                    String srcKgId = (String) meta.get("source");
                    String tgtKgId = (String) meta.get("target");
                    String relTypeStr = (String) meta.get("type");

                    String srcNodeId = kgIdToNodeIdMap.get(srcKgId);
                    String tgtNodeId = kgIdToNodeIdMap.get(tgtKgId);
                    
                    if (srcNodeId != null && tgtNodeId != null) {
                        RelationshipType rType;
                        try {
                            rType = RelationshipType.valueOf(relTypeStr.toUpperCase());
                        } catch (Exception ex) {
                            rType = RelationshipType.NEAR;
                        }

                        Map<String, Object> relProps = new LinkedHashMap<>();
                        relProps.put("isSemantic", true);
                        if (relPropsMap.containsKey(relId)) {
                            relProps.put("properties", relPropsMap.get(relId));
                        }

                        relationships.add(new KnowledgeRelationship(srcNodeId, tgtNodeId, rType, relProps));
                    }
                }
            } catch (Exception e) {
                log.error("Failed to query semantic relationships: {}", e.getMessage());
            }
        }

        // 6. Compile Summary
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("nearestRoad", nearestRoadDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestRoadName, nearestRoadDist));
        summary.put("nearestRiver", nearestRiverDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestRiverName, nearestRiverDist));
        summary.put("nearestVillage", nearestVillageDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestVillageName, nearestVillageDist));
        summary.put("nearestIndustry", nearestIndustryDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestIndustryName, nearestIndustryDist));
        summary.put("nearestForest", nearestForestDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestForestName, nearestForestDist));
        summary.put("nearestWaterBody", nearestWaterBodyDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestWaterBodyName, nearestWaterBodyDist));
        summary.put("nearestSchool", nearestSchoolDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestSchoolName, nearestSchoolDist));
        summary.put("nearestHospital", nearestHospitalDist == Double.MAX_VALUE ? "None in area" : String.format(Locale.US, "%s (%.2f km)", nearestHospitalName, nearestHospitalDist));

        summary.put("nearestRoadDist", nearestRoadDist == Double.MAX_VALUE ? -1.0 : nearestRoadDist);
        summary.put("nearestRiverDist", nearestRiverDist == Double.MAX_VALUE ? -1.0 : nearestRiverDist);
        summary.put("nearestVillageDist", nearestVillageDist == Double.MAX_VALUE ? -1.0 : nearestVillageDist);
        summary.put("nearestIndustryDist", nearestIndustryDist == Double.MAX_VALUE ? -1.0 : nearestIndustryDist);
        summary.put("nearestForestDist", nearestForestDist == Double.MAX_VALUE ? -1.0 : nearestForestDist);
        summary.put("nearestWaterBodyDist", nearestWaterBodyDist == Double.MAX_VALUE ? -1.0 : nearestWaterBodyDist);
        summary.put("nearestSchoolDist", nearestSchoolDist == Double.MAX_VALUE ? -1.0 : nearestSchoolDist);
        summary.put("nearestHospitalDist", nearestHospitalDist == Double.MAX_VALUE ? -1.0 : nearestHospitalDist);

        summary.put("schoolsCount", schoolsCount);
        summary.put("hospitalsCount", hospitalsCount);
        summary.put("gymsCount", gymsCount);
        summary.put("waterBodiesCount", waterBodiesCount);
        summary.put("forestAreaSqKm", Math.round(forestAreaSqKm * 100.0) / 100.0);

        String floodRisk = "Low";
        if (nearestRiverDist < 0.3 || nearestRiverName.toLowerCase().contains("ganges") && nearestRiverDist < 0.5) {
            floodRisk = "High";
        } else if (nearestRiverDist < 0.8) {
            floodRisk = "Medium";
        }
        summary.put("floodRisk", floodRisk);

        // Metadata
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("totalEntitiesDiscovered", entities.size());
        metadata.put("totalRelationshipsDiscovered", relationships.size());
        metadata.put("responseTimeMs", System.currentTimeMillis() - startTime);

        return new KnowledgeContext(
            Map.of("lat", centroidLat, "lon", centroidLon),
            entities,
            relationships,
            summary,
            metadata
        );
    }

    private List<Map<String, Object>> queryIntersectingFeatures(String wkt) {
        String sql = 
            "WITH user_drawn_polygon AS ( " +
            "  SELECT ST_GeomFromText(?, 4326) AS geom " +
            ") " +
            "SELECT id, class_name, osm_name, kg_entity_id, kg_entity_name, distance_to_centroid_m, centroid_lon, centroid_lat, area_sq_km, is_fully_contained FROM ( " +
            "  SELECT DISTINCT ON (l.id) l.id, l.class_name, r.name as osm_name, " +
            "         k.id as kg_entity_id, k.entity_name as kg_entity_name, " +
            "         ST_Distance(l.geom::geography, ST_Centroid(p.geom)::geography) as distance_to_centroid_m, " +
            "         ST_X(ST_Centroid(l.geom)) as centroid_lon, ST_Y(ST_Centroid(l.geom)) as centroid_lat, " +
            "         ST_Area(l.geom::geography) / 1000000.0 as area_sq_km, " +
            "         ST_Contains(p.geom, l.geom) as is_fully_contained " +
            "  FROM public.lulc_geometries l " +
            "  CROSS JOIN user_drawn_polygon p " +
            "  LEFT JOIN public.kg_entities k ON CAST(l.id as varchar) = k.geometry_ref_id " +
            "  LEFT JOIN public.raw_landuse r ON l.geom && r.wkb_geometry AND ST_Intersects(l.geom, r.wkb_geometry) " +
            "    AND r.name IS NOT NULL " +
            "    AND ( " +
            "      (l.class_name = 'River' AND (r.\"natural\" = 'water' OR r.water IS NOT NULL OR r.name ILIKE '%river%' OR r.name ILIKE '%ganga%' OR r.name ILIKE '%varuna%' OR r.name ILIKE '%assi%')) " +
            "      OR (l.class_name = 'Hospital' AND (r.amenity = 'hospital' OR r.building = 'hospital' OR r.name ILIKE '%hospital%' OR r.name ILIKE '%clinic%')) " +
            "      OR (l.class_name = 'School' AND (r.amenity = 'school' OR r.building = 'school' OR r.name ILIKE '%school%' OR r.name ILIKE '%college%')) " +
            "      OR (l.class_name = 'Gym' AND (r.amenity = 'gym' OR r.name ILIKE '%gym%')) " +
            "      OR (l.class_name NOT IN ('Road', 'River', 'Hospital', 'School', 'Gym')) " +
            "    ) " +
            "  WHERE ST_Intersects(l.geom, p.geom) " +
            "  ORDER BY l.id, distance_to_centroid_m ASC " +
            ") sub " +
            "ORDER BY distance_to_centroid_m ASC " +
            "LIMIT 100";
        try {
            return jdbcTemplate.queryForList(sql, wkt);
        } catch (Exception e) {
            log.error("Query intersecting features failed: {}", e.getMessage());
            return List.of();
        }
    }

    private String convertToWkt(List<List<List<Double>>> coordinates) {
        if (coordinates == null || coordinates.isEmpty()) {
            throw new IllegalArgumentException("Coordinates must not be empty");
        }

        StringBuilder sb = new StringBuilder();
        sb.append("POLYGON(");

        for (int i = 0; i < coordinates.size(); i++) {
            List<List<Double>> ring = coordinates.get(i);
            if (ring == null || ring.isEmpty()) {
                throw new IllegalArgumentException("A polygon ring cannot be empty");
            }

            if (ring.size() < 3) {
                throw new IllegalArgumentException("A polygon ring must have at least 3 points");
            }

            sb.append("(");
            
            // Check if closed
            List<Double> first = ring.get(0);
            List<Double> last = ring.get(ring.size() - 1);
            boolean isClosed = first.size() >= 2 && last.size() >= 2 &&
                    Double.compare(first.get(0), last.get(0)) == 0 &&
                    Double.compare(first.get(1), last.get(1)) == 0;

            for (int j = 0; j < ring.size(); j++) {
                List<Double> coord = ring.get(j);
                if (coord == null || coord.size() < 2) {
                    throw new IllegalArgumentException("A coordinate must contain at least longitude and latitude");
                }
                sb.append(coord.get(0)).append(" ").append(coord.get(1));
                if (j < ring.size() - 1) {
                    sb.append(", ");
                }
            }

            if (!isClosed) {
                sb.append(", ").append(first.get(0)).append(" ").append(first.get(1));
            }

            sb.append(")");
            if (i < coordinates.size() - 1) {
                sb.append(", ");
            }
        }
        sb.append(")");
        return sb.toString();
    }
}
