package com.example.webgis.model;

public class RecommendationRequest {
    private int nearbyShops;
    private int nearbySchools;
    private int nearbyHospitals;
    private int nearbyRoads;
    private int radiusMeters;
    private int populationFactor;
    private int trafficFactor;
    private int competitionFactor;
    private int businessPotentialScore;

    public int getNearbyShops() {
        return nearbyShops;
    }

    public void setNearbyShops(int nearbyShops) {
        this.nearbyShops = nearbyShops;
    }

    public int getNearbySchools() {
        return nearbySchools;
    }

    public void setNearbySchools(int nearbySchools) {
        this.nearbySchools = nearbySchools;
    }

    public int getNearbyHospitals() {
        return nearbyHospitals;
    }

    public void setNearbyHospitals(int nearbyHospitals) {
        this.nearbyHospitals = nearbyHospitals;
    }

    public int getNearbyRoads() {
        return nearbyRoads;
    }

    public void setNearbyRoads(int nearbyRoads) {
        this.nearbyRoads = nearbyRoads;
    }

    public int getRadiusMeters() {
        return radiusMeters;
    }

    public void setRadiusMeters(int radiusMeters) {
        this.radiusMeters = radiusMeters;
    }

    public int getPopulationFactor() {
        return populationFactor;
    }

    public void setPopulationFactor(int populationFactor) {
        this.populationFactor = populationFactor;
    }

    public int getTrafficFactor() {
        return trafficFactor;
    }

    public void setTrafficFactor(int trafficFactor) {
        this.trafficFactor = trafficFactor;
    }

    public int getCompetitionFactor() {
        return competitionFactor;
    }

    public void setCompetitionFactor(int competitionFactor) {
        this.competitionFactor = competitionFactor;
    }

    public int getBusinessPotentialScore() {
        return businessPotentialScore;
    }

    public void setBusinessPotentialScore(int businessPotentialScore) {
        this.businessPotentialScore = businessPotentialScore;
    }
}

