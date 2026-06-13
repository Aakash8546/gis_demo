package com.example.webgis.service;

import com.example.webgis.model.RecommendationRequest;
import com.example.webgis.model.RecommendationResponse;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class RecommendationService {

    public RecommendationResponse generate(RecommendationRequest request) {
        List<String> messages = new ArrayList<>();

        if (request.getNearbyShops() < 3 && request.getPopulationFactor() >= 70) {
            messages.add("Recommended for a fruit shop. Competition is low while population demand is strong.");
        }

        if (request.getNearbyShops() > 10) {
            messages.add("High competition detected. Consider a differentiated retail concept or another site.");
        }

        if (request.getTrafficFactor() >= 70) {
            messages.add("Traffic visibility is promising. This site may benefit from strong pass-by exposure.");
        } else {
            messages.add("Traffic exposure is moderate. Promotions or destination-based retail may work better here.");
        }

        if (request.getNearbyHospitals() >= 2) {
            messages.add("Healthcare activity nearby suggests steady footfall for convenience-led businesses.");
        }

        if (request.getBusinessPotentialScore() >= 75) {
            messages.add("Overall business potential is high based on the current mock scoring model.");
        } else if (request.getBusinessPotentialScore() >= 55) {
            messages.add("Overall business potential is moderate. This is a viable shortlist candidate.");
        } else {
            messages.add("Overall business potential is currently weak. A larger catchment or new concept may be needed.");
        }

        if (messages.isEmpty()) {
            messages.add("No strong recommendation was triggered. Review the radius and test another location.");
        }

        return new RecommendationResponse(messages);
    }
}

