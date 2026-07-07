package com.example.webgis.h3.core;

import com.uber.h3core.H3Core;
import com.uber.h3core.util.LatLng;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Service wrapper for the Uber H3 spatial grid index system.
 * Keeps H3 library dependencies isolated from the rest of the application.
 */
@Service
@Slf4j
public class H3Service {

    private final H3Core h3;

    public H3Service() {
        try {
            this.h3 = H3Core.newInstance();
            log.info("Successfully initialized Uber H3Core Instance.");
        } catch (IOException e) {
            log.error("Failed to initialize H3Core library", e);
            throw new RuntimeException("Could not initialize Uber H3 library", e);
        }
    }

    /**
     * Converts a Latitude/Longitude coordinate pair to an H3 index.
     *
     * @param lat        latitude
     * @param lon        longitude
     * @param resolution H3 resolution (usually 8 or 9)
     * @return H3 cell index string
     */
    public String latLonToH3(double lat, double lon, int resolution) {
        long h3Address = h3.latLngToCell(lat, lon, resolution);
        return Long.toHexString(h3Address);
    }

    /**
     * Finds neighbor H3 cells within a ring size of k.
     *
     * @param h3Index cell index
     * @param k       ring size (0 = only the cell, 1 = immediate 7 cells, 2 = 19 cells)
     * @return List of neighboring H3 cell indices (including the target cell)
     */
    public List<String> kRing(String h3Index, int k) {
        long cell = Long.parseUnsignedLong(h3Index, 16);
        List<Long> cells = h3.gridDisk(cell, k);
        return cells.stream()
                .map(Long::toHexString)
                .collect(Collectors.toList());
    }

    /**
     * Converts an H3 index to a geographic coordinate center point.
     *
     * @param h3Index cell index
     * @return double array containing [latitude, longitude]
     */
    public double[] h3ToLatLon(String h3Index) {
        long cell = Long.parseUnsignedLong(h3Index, 16);
        LatLng latLng = h3.cellToLatLng(cell);
        return new double[]{latLng.lat, latLng.lng};
    }

    /**
     * Returns the 6 vertices forming the boundary of the H3 cell.
     *
     * @param h3Index cell index
     * @return List of coordinate pairs [[lat, lon], [lat, lon]...] representing the hexagon vertices
     */
    public List<double[]> cellBoundary(String h3Index) {
        long cell = Long.parseUnsignedLong(h3Index, 16);
        List<LatLng> boundary = h3.cellToBoundary(cell);
        List<double[]> coords = new ArrayList<>();
        for (LatLng latLng : boundary) {
            coords.add(new double[]{latLng.lat, latLng.lng});
        }
        return coords;
    }

    /**
     * Generates all H3 cells that intersect or are contained inside a polygon boundary.
     *
     * @param polygonCoords Outer ring vertices of the polygon [[lon, lat], [lon, lat]...] in EPSG:4326
     * @param resolution    Target H3 resolution
     * @return List of H3 indices covering the polygon area
     */
    public List<String> polyfill(List<List<Double>> polygonCoords, int resolution) {
        if (polygonCoords == null || polygonCoords.isEmpty()) {
            return new ArrayList<>();
        }

        // Convert coordinates to H3 LatLng
        List<LatLng> points = polygonCoords.stream()
                .map(pt -> new LatLng(pt.get(1), pt.get(0))) // index 1 is lat, index 0 is lon
                .collect(Collectors.toList());

        // H3 polyfill requires the loop to be closed
        if (!points.isEmpty()) {
            LatLng first = points.get(0);
            LatLng last = points.get(points.size() - 1);
            if (first.lat != last.lat || first.lng != last.lng) {
                points.add(first);
            }
        }

        List<Long> cells = h3.polygonToCells(points, null, resolution);
        return cells.stream()
                .map(Long::toHexString)
                .collect(Collectors.toList());
    }
}
