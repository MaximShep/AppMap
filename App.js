import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TextInput, Button, FlatList, TouchableOpacity, Text, Alert } from 'react-native';
import MapView, { Marker, UrlTile, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';

export default function App() {
  const [location, setLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [markerLocation, setMarkerLocation] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [navigationMode, setNavigationMode] = useState(false);
  const [navigationInstructions, setNavigationInstructions] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission to access location was denied');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setLocation(location.coords);
    })();
  }, []);

  // Function to search location using Nominatim
  const handleSearch = async () => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`
      );
      const data = await response.json();

      if (data.length > 0) {
        const location = {
          latitude: parseFloat(data[0].lat),
          longitude: parseFloat(data[0].lon),
        };
        setMarkerLocation({
          latitude: location.latitude,
          longitude: location.longitude,
          title: searchQuery,
        });

        mapRef.current.animateToRegion({
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      } else {
        Alert.alert('Object not found');
      }
    } catch (error) {
      Alert.alert('Error while searching');
    }
  };

  // Function to fetch suggestions for autocomplete
  const fetchSuggestions = async (query) => {
    try {
      if (query.length > 2) {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`
        );
        const data = await response.json();
        setSuggestions(data);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      console.log('Error fetching suggestions', error);
    }
  };

  // Function to clear search input
  const handleClearSearch = () => {
    setSearchQuery('');
    setSuggestions([]);
    setMarkerLocation(null);
    setRouteCoordinates([]);
    setNavigationMode(false);
    setNavigationInstructions([]);
    setCurrentStepIndex(0);
  };

  // Function to build the route using OSRM
  const handleBuildRoute = async () => {
    if (location && markerLocation) {
      try {
        const response = await fetch(
          `http://router.project-osrm.org/route/v1/driving/${location.longitude},${location.latitude};${markerLocation.longitude},${markerLocation.latitude}?overview=full&geometries=geojson&steps=true`
        );
        const data = await response.json();
        if (data.routes.length > 0) {
          const route = data.routes[0].geometry.coordinates.map(coord => ({
            latitude: coord[1],
            longitude: coord[0],
          }));
          setRouteCoordinates(route);
          setNavigationInstructions(data.routes[0].legs[0].steps);
          console.log(navigationInstructions[0].maneuver.modifier)

        } else {
          Alert.alert('Route not found');
        }
      } catch (error) {
        Alert.alert('Error building route');
      }
    } else {
      Alert.alert('Location not found or destination not selected');
    }
  };

  // Function to start navigation mode
  const handleStartNavigation = () => {
    setNavigationMode(true);
    mapRef.current.fitToCoordinates(routeCoordinates, {
      edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
      animated: true,
    });
    updateNavigationInstructions();
  };

  // Function to dynamically update navigation instructions
  const updateNavigationInstructions = () => {
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 1 },
      (newLocation) => {
        setLocation(newLocation.coords);
        const currentStep = navigationInstructions[currentStepIndex];

        // Calculate distance to next turn
        const distanceToNextTurn = getDistanceFromLatLonInKm(
          newLocation.coords.latitude,
          newLocation.coords.longitude,
          currentStep.maneuver.location[1],
          currentStep.maneuver.location[0]
        ) * 1000; // Convert to meters

        if (distanceToNextTurn < 10 && currentStepIndex < navigationInstructions.length - 1) {
          setCurrentStepIndex(currentStepIndex + 1); // Move to the next instruction
        }
      }
    );
  };

  // Function to calculate distance between two coordinates
  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  };

  const deg2rad = (deg) => deg * (Math.PI / 180);

  // Function to stop navigation mode
  const handleStopNavigation = () => {
    setNavigationMode(false);
    setNavigationInstructions([]);
    setCurrentStepIndex(0);
  };

  // Function to select a suggestion from the list
  const handleSelectSuggestion = (suggestion) => {
    setSearchQuery(suggestion.display_name);
    setSuggestions([]);
    handleSearch();
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location ? location.latitude : 59.93863,
          longitude: location ? location.longitude : 30.31413,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={true}
        minZoomLevel={5}
        maxZoomLevel={19}
      >
        <UrlTile
          urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
        />

        {/* Marker for searched location */}
        {markerLocation && (
          <Marker
            coordinate={{
              latitude: markerLocation.latitude,
              longitude: markerLocation.longitude,
            }}
            title={markerLocation.title}
          />
        )}

        {/* Route polyline */}
        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#ff0000" // Red color for the route
            strokeWidth={5}
          />
        )}
      </MapView>

      {/* Search input and buttons */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Enter place name"
          value={searchQuery}
          onChangeText={text => {
            setSearchQuery(text);
            fetchSuggestions(text); // Autocomplete
          }}
        />
        <Button title="Search" onPress={handleSearch} />
        <Button title="Clear" onPress={handleClearSearch} />
      </View>

      {/* Build route and Start navigation buttons */}
      {markerLocation && (
        <View style={styles.routeButtonContainer}>
          <Button title="Build Route" onPress={handleBuildRoute} />
          {routeCoordinates.length > 0 && !navigationMode && (
            <Button title="Start Navigation" onPress={handleStartNavigation} />
          )}
        </View>
      )}

      {/* Stop navigation button */}
      {navigationMode && (
        <View style={styles.stopButtonContainer}>
          <Button title="Stop Navigation" onPress={handleStopNavigation} color="red" />
        </View>
      )}

      {/* Display navigation instructions */}
      {navigationMode && navigationInstructions.length > 0 && (
        <View style={styles.navigationInstructionsContainer}>
          <Text style={styles.navigationInstructions}>
            {`Next turn: ${navigationInstructions[currentStepIndex].maneuver.modifier}`}
          </Text>
        </View>
      )}

      {/* Suggestions list */}
      {suggestions.length > 0 && (
        <FlatList
          style={styles.suggestionsList}
          data={suggestions}
          keyExtractor={(item) => item.place_id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleSelectSuggestion(item)}>
              <View style={styles.suggestionItem}>
                <Text>{item.display_name}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  searchContainer: {
    position: 'absolute',
    top: 40,
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 5,
    padding: 10,
    elevation: 10,
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    zIndex: 1,
  },
  searchInput: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    marginRight: 10,
  },
  suggestionsList: {
    position: 'absolute',
    top: 80,
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 5,
    elevation: 10,
    maxHeight: 150,
    zIndex: 1,
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  routeButtonContainer: {
    position: 'absolute',
    bottom: 110,
    left: 10,
    right: 10,
  },
  stopButtonContainer: {
    position: 'absolute',
    bottom: 50,
    left: 10,
    right: 10,
  },
  navigationInstructionsContainer: {
    position: 'absolute',
    top: 150,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 5,
    padding: 10,
    elevation: 10,
  },
  navigationInstructions: {
    fontSize: 16,
    color: '#333',
  },
});
