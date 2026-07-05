package com.example.webgis.layer.provider;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Centralized, Single-Flight Overpass API query service.
 * Collapses concurrent requests for the same coordinates into a single HTTP request,
 * and rotates across 3 redundant mirrors on 429 Rate Limit or network errors.
 */
@Service
@Slf4j
public class OverpassQueryService {

    private static final String[] OVERPASS_MIRRORS = {
            "https://z.overpass-api.de/api/interpreter",
            "https://lz4.overpass-api.de/api/interpreter",
            "https://overpass-api.de/api/interpreter"
    };

    private final HttpClient httpClient;

    // Request collapsing: maps coordinate key to in-flight HTTP request future
    private final Map<String, CompletableFuture<String>> activeQueries = new ConcurrentHashMap<>();
    
    // Short-lived cache to store query results for 15 seconds
    private final Map<String, CacheEntry> queryCache = new ConcurrentHashMap<>();

    private static class CacheEntry {
        final String data;
        final long expiryTime;

        CacheEntry(String data, long ttlMs) {
            this.data = data;
            this.expiryTime = System.currentTimeMillis() + ttlMs;
        }

        boolean isExpired() {
            return System.currentTimeMillis() > expiryTime;
        }
    }

    public OverpassQueryService() {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(12))
                .build();
    }

    /**
     * Executes a unified query for point coordinates, deduplicating multiple layers into 1 request.
     */
    public String getUnifiedPointData(double lat, double lon) {
        String cacheKey = String.format(Locale.US, "point_%.5f_%.5f", lat, lon);

        // 1. Check cache first
        CacheEntry cached = queryCache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            log.info("Returning cached Overpass data for key: {}", cacheKey);
            return cached.data;
        }

        // 2. Request collapsing / Single-flight
        return activeQueries.computeIfAbsent(cacheKey, key -> CompletableFuture.supplyAsync(() -> {
            String query = buildUnifiedPointQuery(lat, lon);
            String result = executeOverpassHttpCall(query, "UnifiedPointQuery");
            if (result != null) {
                queryCache.put(cacheKey, new CacheEntry(result, 15000)); // 15s TTL
            }
            return result;
        })).thenApply(result -> {
            activeQueries.remove(cacheKey);
            return result;
        }).join();
    }

    /**
     * Executes a unified query for polygon coordinates, deduplicating requests.
     */
    public String getUnifiedPolygonData(String polyStr) {
        // Hash the polygon string to use as cache key
        String cacheKey = "poly_" + Integer.toHexString(polyStr.hashCode());

        CacheEntry cached = queryCache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            log.info("Returning cached Overpass data for polygon key: {}", cacheKey);
            return cached.data;
        }

        return activeQueries.computeIfAbsent(cacheKey, key -> CompletableFuture.supplyAsync(() -> {
            String query = buildUnifiedPolygonQuery(polyStr);
            String result = executeOverpassHttpCall(query, "UnifiedPolygonQuery");
            if (result != null) {
                queryCache.put(cacheKey, new CacheEntry(result, 20000)); // 20s TTL
            }
            return result;
        })).thenApply(result -> {
            activeQueries.remove(cacheKey);
            return result;
        }).join();
    }

    private String buildUnifiedPointQuery(double lat, double lon) {
        // Optimized query radii to prevent Overpass Gateway Timeout (504).
        // Heavy way queries are restricted to 2000m/3000m, while fast node queries
        // can scan larger distances (up to 5000m).
        // Excludes minor path highway tags (footway, path, steps, service) which cause
        // response size explosion in dense Indian cities.
        return String.format(Locale.US,
                "[out:json][timeout:35];\n" +
                "(\n" +
                "  // Commercial POIs (around 2000m)\n" +
                "  node(around:2000, %f, %f)[shop];\n" +
                "  node(around:2000, %f, %f)[office];\n" +
                "  node(around:2000, %f, %f)[industrial];\n" +
                "  node(around:2000, %f, %f)[building=warehouse];\n" +
                "  node(around:2000, %f, %f)[amenity=fuel];\n" +
                "  node(around:2000, %f, %f)[amenity=bank];\n" +
                "  node(around:2000, %f, %f)[amenity=marketplace];\n" +
                "  way(around:2000, %f, %f)[building=warehouse];\n" +
                "  way(around:2000, %f, %f)[landuse=industrial];\n" +
                "\n" +
                "  // Heritage (around 1000m)\n" +
                "  node(around:1000, %f, %f)[\"historic\"];\n" +
                "  way(around:1000, %f, %f)[\"historic\"];\n" +
                "  node(around:1000, %f, %f)[\"man_made\"=\"ghat\"];\n" +
                "  way(around:1000, %f, %f)[\"man_made\"=\"ghat\"];\n" +
                "  node(around:1000, %f, %f)[\"tourism\"=\"attraction\"];\n" +
                "  way(around:1000, %f, %f)[\"tourism\"=\"attraction\"];\n" +
                "  node(around:1000, %f, %f)[\"place\"=\"ghat\"];\n" +
                "  node(around:1000, %f, %f)[\"tourism\"=\"ghat\"];\n" +
                "\n" +
                "  // Infrastructure (around 2000m)\n" +
                "  node(around:2000, %f, %f)[power=substation];\n" +
                "  way(around:2000, %f, %f)[power=line];\n" +
                "  node(around:2000, %f, %f)[man_made=water_tower];\n" +
                "  node(around:2000, %f, %f)[amenity=water_point];\n" +
                "  node(around:2000, %f, %f)[amenity=drinking_water];\n" +
                "  node(around:2000, %f, %f)[man_made=water_well];\n" +
                "  node(around:2000, %f, %f)[man_made=water_works];\n" +
                "  node(around:2000, %f, %f)[man_made=tower];\n" +
                "  node(around:2000, %f, %f)[man_made=mast];\n" +
                "  node(around:2000, %f, %f)[telecom=mast];\n" +
                "  node(around:2000, %f, %f)[telecom=tower];\n" +
                "  node(around:2000, %f, %f)[amenity=post_office];\n" +
                "\n" +
                "  // Logistics & Market Proximity (around 3000m for ways, 5000m for fast nodes)\n" +
                "  way(around:3000, %f, %f)[highway=primary];\n" +
                "  way(around:2000, %f, %f)[highway=secondary];\n" +
                "  way(around:1500, %f, %f)[highway=tertiary];\n" +
                "  way(around:3000, %f, %f)[highway=trunk];\n" +
                "  way(around:3000, %f, %f)[highway=motorway];\n" +
                "  node(around:5000, %f, %f)[railway=station];\n" +
                "  node(around:3000, %f, %f)[amenity=fuel];\n" +
                "\n" +
                "  node(around:3000, %f, %f)[shop=wholesale];\n" +
                "  node(around:3000, %f, %f)[shop=beverages];\n" +
                "  node(around:2000, %f, %f)[shop=supermarket];\n" +
                "  node(around:2000, %f, %f)[shop=convenience];\n" +
                "  node(around:3000, %f, %f)[building=warehouse];\n" +
                "  way(around:3000, %f, %f)[building=warehouse];\n" +
                "  node(around:3000, %f, %f)[industrial=warehouse];\n" +
                "  node(around:3000, %f, %f)[amenity=cold_storage];\n" +
                "\n" +
                "  // OSM Vector Layer (around 500m for nodes, 300m for named highways)\n" +
                "  node(around:500, %f, %f)[\"amenity\"];\n" +
                "  way(around:500, %f, %f)[\"amenity\"];\n" +
                "  way(around:300, %f, %f)[highway][highway!=footway][highway!=path][highway!=steps][highway!=service];\n" +
                "  way(around:500, %f, %f)[\"waterway\"];\n" +
                ");\n" +
                "out center tags;",
                lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, // commercial
                lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, // heritage
                lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, // infrastructure
                lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, // logistics
                lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, // market
                lat, lon, lat, lon, lat, lon, lat, lon // osm vector
        );
    }

    private String buildUnifiedPolygonQuery(String polyStr) {
        return String.format(Locale.US,
                "[out:json][timeout:35];\n" +
                "(\n" +
                "  node(poly: \"%s\")[\"historic\"];\n" +
                "  way(poly: \"%s\")[\"historic\"];\n" +
                "  node(poly: \"%s\")[\"man_made\"=\"ghat\"];\n" +
                "  way(poly: \"%s\")[\"man_made\"=\"ghat\"];\n" +
                "  node(poly: \"%s\")[\"tourism\"=\"attraction\"];\n" +
                "  way(poly: \"%s\")[\"tourism\"=\"attraction\"];\n" +
                "  node(poly: \"%s\")[\"place\"=\"ghat\"];\n" +
                "  node(poly: \"%s\")[\"tourism\"=\"ghat\"];\n" +
                "\n" +
                "  node(poly: \"%s\")[\"amenity\"];\n" +
                "  way(poly: \"%s\")[\"amenity\"];\n" +
                "  way(poly: \"%s\")[\"highway\"];\n" +
                "  way(poly: \"%s\")[\"waterway\"];\n" +
                ");\n" +
                "out center tags;",
                polyStr, polyStr, polyStr, polyStr, polyStr, polyStr, polyStr, polyStr, // heritage
                polyStr, polyStr, polyStr, polyStr // osm vector
        );
    }

    private String executeOverpassHttpCall(String overpassQuery, String callerName) {
        String payload = "data=" + URLEncoder.encode(overpassQuery, StandardCharsets.UTF_8);
        
        for (String mirror : OVERPASS_MIRRORS) {
            try {
                log.info("[{}] Fetching Unified Overpass data from mirror: {}", callerName, mirror);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(mirror))
                        .timeout(Duration.ofSeconds(20))
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("User-Agent", "VaranasiUrbanPlannerApp/1.0 (Contact: aakashsrivastava2151@gmail.com)")
                        .POST(HttpRequest.BodyPublishers.ofString(payload))
                        .build();

                HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                if (response.statusCode() == 200) {
                    byte[] bytes = response.body();
                    String result = bytes != null ? new String(bytes, StandardCharsets.UTF_8) : null;
                    log.info("[{}] Overpass query successful on mirror {}, response size: {} bytes", 
                            callerName, mirror, bytes != null ? bytes.length : 0);
                    return result;
                } else {
                    log.warn("[{}] Overpass mirror {} returned status: {}", callerName, mirror, response.statusCode());
                }
            } catch (Exception e) {
                log.error("[{}] Overpass request failed for mirror {}: {}", callerName, mirror, e.getMessage());
            }
        }
        return null;
    }
}
