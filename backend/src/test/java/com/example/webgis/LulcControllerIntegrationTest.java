package com.example.webgis;

import com.example.webgis.dto.LulcRequest;
import com.example.webgis.dto.LulcResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LulcControllerIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void testLulcAnalysisEndpoint() {
        // Setup coordinates matching the approved SQL query:
        // POLYGON((82.960 25.300, 83.000 25.300, 83.000 25.330, 82.960 25.330, 82.960 25.300))
        List<List<Double>> ring = List.of(
                List.of(82.960, 25.300),
                List.of(83.000, 25.300),
                List.of(83.000, 25.330),
                List.of(82.960, 25.330),
                List.of(82.960, 25.300)
        );
        List<List<List<Double>>> coordinates = List.of(ring);
        LulcRequest request = new LulcRequest(coordinates);

        ResponseEntity<LulcResponse> responseEntity = restTemplate.postForEntity(
                "/api/lulc/analyze",
                request,
                LulcResponse.class
        );

        assertEquals(HttpStatus.OK, responseEntity.getStatusCode());
        LulcResponse response = responseEntity.getBody();
        assertNotNull(response);
        assertTrue(response.getTotalArea() > 0, "Total area should be greater than 0");
        assertNotNull(response.getClasses());
        assertTrue(response.getClasses().size() > 0, "Should contain LULC classes statistics");

        // Sum of percentages should be ~100
        double percentageSum = response.getClasses().stream()
                .mapToDouble(c -> c.getPercentage())
                .sum();
        assertTrue(Math.abs(percentageSum - 100.0) < 1.0, "Sum of class percentages should be near 100%");
    }
}
