import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TextInput, Button, FlatList, TouchableOpacity, Text, Alert } from 'react-native';
import MapView, { Marker, UrlTile, Polyline, Geojson } from 'react-native-maps';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import {mapData} from './data'


export default function App() {
  const [location, setLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [markerLocation, setMarkerLocation] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [navigationMode, setNavigationMode] = useState(false);
  const [navigationInstructions, setNavigationInstructions] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [indoorMapData, setIndoorMapData] = useState(null); // Данные карты МГТУ
  const [showIndoorMap, setShowIndoorMap] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState(1);
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Доступ к геопозиции был запрещен');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setLocation(location.coords);
    })();
  }, []);

   // Загрузка карты МГТУ из файла geojson
   useEffect(() => {
    const loadIndoorMap = async () => {
      try {
        const fileUri = '/assets/Cube1.geojson'; // Путь к файлу GeoJSON
        setIndoorMapData(mapData); // Парсим и сохраняем данные
      } catch (error) {
        console.error('Ошибка при загрузке карты МГТУ:', error);
      }
    };
    loadIndoorMap();
  }, []);

  const handleRegionChange = (region) => {
    const distanceToTarget = getDistanceFromLatLonInKm(region.latitude, region.longitude, 53.422031, 58.981336);

    // Если расстояние меньше 0.5 км и уровень приближения достаточно высок (например, 18)
    if (distanceToTarget < 0.5 && region.latitudeDelta < 0.005) {
      setShowIndoorMap(true);
    } else {
      setShowIndoorMap(false);
    }
  };


  // Поиск местоположения через Nominatim
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
        Alert.alert('Объект не найден');
      }
    } catch (error) {
      Alert.alert('Ошибка при поиске');
    }
  };

  // Фильтрация данных GeoJSON по этажу
  const filterGeojsonByFloor = (geojsonData, floor) => {
    if (!geojsonData || !geojsonData.features) return null;
    return {
      type: 'FeatureCollection',
      features: geojsonData.features.filter(feature => {
        return feature && feature.properties && feature.properties.level === floor.toString();
      }),
    };
  };

  // Загрузка данных GeoJSON при изменении этажа
  useEffect(() => {
    // Подгрузите данные вашего GeoJSON файла
        setIndoorMapData(filterGeojsonByFloor(mapData, selectedFloor));    
  }, [selectedFloor]);

 // Функция для переключения этажей
 const changeLevel = (level) => {
  setSelectedFloor(level);
};

  // Получение подсказок для автозаполнения
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
      console.log('Ошибка при получении подсказок', error);
    }
  };

  // Очистка поля поиска и маршрута
  const handleClearSearch = () => {
    setSearchQuery('');
    setSuggestions([]);
    setMarkerLocation(null);
    setRouteCoordinates([]);
    setNavigationMode(false);
    setNavigationInstructions([]);
    setCurrentStepIndex(0);
  };

  // Построение маршрута через OSRM
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

        } else {
          Alert.alert('Маршрут не найден');
        }
      } catch (error) {
        Alert.alert('Ошибка при построении маршрута');
      }
    } else {
      Alert.alert('Текущая геопозиция или цель не найдены');
    }
  };

  // Начало режима навигации
  const handleStartNavigation = () => {
    setNavigationMode(true);
    mapRef.current.fitToCoordinates(routeCoordinates, {
      edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
      animated: true,
    });
    updateNavigationInstructions();
  };

  // Обновление маршрута и подсказок во время движения
  const updateNavigationInstructions = () => {
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 1 },
      (newLocation) => {
        setLocation(newLocation.coords);

        const currentStep = navigationInstructions[currentStepIndex];

        // Рассчитываем расстояние до следующего поворота
        const distanceToNextTurn = getDistanceFromLatLonInKm(
          newLocation.coords.latitude,
          newLocation.coords.longitude,
          currentStep.maneuver.location[1],
          currentStep.maneuver.location[0]
        ) * 1000; // Преобразуем в метры

        // Если расстояние меньше 10 метров и мы еще не на последнем шаге, переключаемся на следующий шаг
        if (distanceToNextTurn < 10 && currentStepIndex < navigationInstructions.length - 1) {
          setCurrentStepIndex(currentStepIndex + 1);
        }

        // Если пользователь сильно отклонился от маршрута, перестраиваем маршрут
        if (distanceToNextTurn > 5) {
          handleBuildRoute(); // Перестроение маршрута
        }
      }
    );
  };

  // Рассчитываем расстояние между двумя точками
  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Радиус земли в км
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Расстояние в км
  };

  const deg2rad = (deg) => deg * (Math.PI / 180);

  // Остановка режима навигации
  const handleStopNavigation = () => {
    setNavigationMode(false);
    setNavigationInstructions([]);
    setCurrentStepIndex(0);
  };

  // Выбор подсказки из списка
  const handleSelectSuggestion = (suggestion) => {
    setSearchQuery(suggestion.display_name);
    setSuggestions([]);
    handleSearch();
  };

  const handleMapPress = async (event) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
  
    // Пример запроса к Nominatim для получения информации о здании
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
      );
      const data = await response.json();
  
      const buildingName = data.address.building || 'Здание не найдено';
  
      setMarkerLocation({
        latitude,
        longitude,
        title: buildingName,  // Название здания
      });
  
      mapRef.current.animateToRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    } catch (error) {
      Alert.alert('Ошибка при получении информации о здании');
    }
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
        onRegionChangeComplete={handleRegionChange} // Обрабатываем изменение региона
        onPress={handleMapPress} // Добавляем обработчик нажатия
      >
        <UrlTile
          urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
        />

        {/* Маркер для найденного места */}
        {markerLocation && (
          <Marker
            coordinate={{
              latitude: markerLocation.latitude,
              longitude: markerLocation.longitude,
            }}
            title={markerLocation.title}
          />
        )}

        {/* Линия маршрута */}
        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#ff0000" // Красный цвет для маршрута
            strokeWidth={5}
          />
        )}

        {/* Внутренняя карта здания, если условие выполнено */}
        {showIndoorMap && indoorMapData && (
          <Geojson
            geojson={indoorMapData}
            strokeColor="blue"
            fillColor="rgba(0,0,255,0.1)"
            strokeWidth={2}
          />
          
        )}
      </MapView>
         {/* Кнопки для смены этажей */}
      {showIndoorMap && indoorMapData && (
      <View style={styles.floorSelector}>
        <Button title="Этаж 1" onPress={() => changeLevel(1)} />
        <Button title="Этаж 2" onPress={() => changeLevel(2)} />
        <Button title="Этаж 3" onPress={() => changeLevel(3)} />
      </View>
      )}
      {/*```javascript
      {/* Поле поиска и кнопки */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Введите название места"
          value={searchQuery}
          onChangeText={text => {
            setSearchQuery(text);
            fetchSuggestions(text); // Автозаполнение
          }}
        />
        <Button title="Поиск" onPress={handleSearch} />
        <Button title="Очистить" onPress={handleClearSearch} />
      </View>

      {/* Кнопки построения маршрута и начала навигации */}
      {markerLocation && (
        <View style={styles.routeButtonContainer}>
          <Button title="Построить маршрут" onPress={handleBuildRoute} />
          {routeCoordinates.length > 0 && !navigationMode && (
            <Button title="Начать навигацию" onPress={handleStartNavigation} />
          )}
        </View>
      )}

      {/* Кнопка остановки навигации */}
      {navigationMode && (
        <View style={styles.stopButtonContainer}>
          <Button title="Остановить навигацию" onPress={handleStopNavigation} color="red" />
        </View>
      )}

      {/* Отображение навигационных инструкций */}
      {navigationMode && navigationInstructions.length > 0 && (
        <View style={styles.navigationInstructionsContainer}>
          <Text style={styles.navigationInstructions}>
            {`Следующий поворот: ${navigationInstructions[currentStepIndex].maneuver.modifier}`}
          </Text>
        </View>
      )}

      {/* Список подсказок */}
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
  floorSelector: {
    position: 'absolute',
    bottom: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
  },
});