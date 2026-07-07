package com.example.webgis.h3;

import com.example.webgis.h3.core.H3Service;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

public class H3ServiceTest {



    private H3Service h3Service;

    @BeforeEach
    public void setUp() {
        h3Service = new H3Service();
    }

    @Test
    public void testCoordinateToH3Conversion() {
        double lat = 25.2677; // BHU Varanasi
        double lon = 82.9913;
        int resolution = 9;

        String h3Index = h3Service.latLonToH3(lat, lon, resolution);
        assertNotNull(h3Index);
        assertFalse(h3Index.isEmpty());
        
        // Assert that converting back gives approx center coordinate
        double[] center = h3Service.h3ToLatLon(h3Index);
        assertEquals(lat, center[0], 0.005);
        assertEquals(lon, center[1], 0.005);
    }

    @Test
    public void testKRingNeighbors() {
        double lat = 25.2677;
        double lon = 82.9913;
        String h3Index = h3Service.latLonToH3(lat, lon, 9);

        // Ring size k=1 should have 7 cells
        List<String> ring1 = h3Service.kRing(h3Index, 1);
        assertEquals(7, ring1.size());
        assertTrue(ring1.contains(h3Index));

        // Ring size k=2 should have 19 cells
        List<String> ring2 = h3Service.kRing(h3Index, 2);
        assertEquals(19, ring2.size());
        assertTrue(ring2.contains(h3Index));
    }

    @Test
    public void testCellBoundaryVertices() {
        double lat = 25.2677;
        double lon = 82.9913;
        String h3Index = h3Service.latLonToH3(lat, lon, 9);

        List<double[]> boundary = h3Service.cellBoundary(h3Index);
        // H3 cell is a hexagon (6 vertices)
        assertEquals(6, boundary.size());
        for (double[] vertex : boundary) {
            assertEquals(2, vertex.length);
            assertTrue(vertex[0] >= -90 && vertex[0] <= 90);
            assertTrue(vertex[1] >= -180 && vertex[1] <= 180);
        }
    }

    @Test
    public void testPolyfill() {
        // Define a small square polygon around BHU (Varanasi)
        // Vertices: [[lon, lat], [lon, lat], ...]
        List<List<Double>> polygon = new ArrayList<>();
        polygon.add(List.of(82.980, 25.275));
        polygon.add(List.of(83.000, 25.275));
        polygon.add(List.of(83.000, 25.260));
        polygon.add(List.of(82.980, 25.260));
        polygon.add(List.of(82.980, 25.275)); // Close the loop

        List<String> cells = h3Service.polyfill(polygon, 9);
        assertNotNull(cells);
        assertFalse(cells.isEmpty());
        
        // Assert each generated cell is a valid hex string
        for (String cell : cells) {
            assertTrue(cell.matches("[0-9a-fA-F]+"));
        }
    }
}
