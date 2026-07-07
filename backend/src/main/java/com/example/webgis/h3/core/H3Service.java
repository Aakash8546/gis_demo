package com.example.webgis.h3.core;

import com.uber.h3core.H3Core;
import com.uber.h3core.util.LatLng;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;





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

    







    public String latLonToH3(double lat, double lon, int resolution) {
        long h3Address = h3.latLngToCell(lat, lon, resolution);
        return Long.toHexString(h3Address);
    }

    






    public List<String> kRing(String h3Index, int k) {
        long cell = Long.parseUnsignedLong(h3Index, 16);
        List<Long> cells = h3.gridDisk(cell, k);
        return cells.stream()
                .map(Long::toHexString)
                .collect(Collectors.toList());
    }

    





    public double[] h3ToLatLon(String h3Index) {
        long cell = Long.parseUnsignedLong(h3Index, 16);
        LatLng latLng = h3.cellToLatLng(cell);
        return new double[]{latLng.lat, latLng.lng};
    }

    





    public List<double[]> cellBoundary(String h3Index) {
        long cell = Long.parseUnsignedLong(h3Index, 16);
        List<LatLng> boundary = h3.cellToBoundary(cell);
        List<double[]> coords = new ArrayList<>();
        for (LatLng latLng : boundary) {
            coords.add(new double[]{latLng.lat, latLng.lng});
        }
        return coords;
    }

    






    public List<String> polyfill(List<List<Double>> polygonCoords, int resolution) {
        if (polygonCoords == null || polygonCoords.isEmpty()) {
            return new ArrayList<>();
        }

        
        List<LatLng> points = polygonCoords.stream()
                .map(pt -> new LatLng(pt.get(1), pt.get(0))) 
                .collect(Collectors.toList());

        
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
