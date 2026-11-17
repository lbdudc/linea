/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.service;

import es.udc.lbd.gema.lps.component.map_viewer.model.domain.*;
import es.udc.lbd.gema.lps.component.map_viewer.model.repository.*;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.*;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import jakarta.inject.Inject;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import es.udc.lbd.gema.lps.model.service.exceptions.NotFoundException;
import es.udc.lbd.gema.lps.model.service.exceptions.OperationNotAllowedException;
/*% if (feature.UserManagement) { %*/
import es.udc.lbd.gema.lps.model.service.UMUserService;
import es.udc.lbd.gema.lps.model.domain.user_management.UMUser;
/*% } %*/

@Service
@Transactional(readOnly = true, rollbackFor = Exception.class)
public class MapServiceImpl implements MapService {

  @Inject private MapRepository mapRepository;
  @Inject private GeoJSONLayerRepository geoJSONLayerRepository;
  @Inject private TileLayerRepository tileLayerRepository;
  @Inject private WMSLayerRepository wmsLayerRepository;
  @Inject private LayerRepository layerRepository;
  @Inject private LayerInMapRepository layerInMapRepository;
  @Inject private WMSLayerStyleRepository wmsLayerStyleRepository;
  @Inject private GeoJSONLayerStyleRepository geoJSONLayerStyleRepository;
  @Inject private StyleRepository styleRepository;
  /*% if (feature.UserManagement) { %*/
  @Inject private UMUserService userService;
  /*% } %*/

  @Transactional(readOnly = false, rollbackFor = Exception.class)
  public MapStateDTO importState(MapStateDTO stateDTO) throws  OperationNotAllowedException, ParseException {
    Map map = new Map();
    map.setLabel(stateDTO.getId());
    map.setMinZoom(stateDTO.getMinZoom());
    map.setMaxZoom(stateDTO.getMaxZoom());
    map.setView(stateDTO.getView().toString());
    /*% if (feature.UserManagement) { %*/
    map.setOwner(userService.getUserWithAuthorities());
    /*% } %*/
    List<LayerInMap> layerInMapList = new ArrayList<>();
    for (MapLayerDTO layerDTO : stateDTO.getLayers()) {
      LayerInMap layerInMap = getLayerInMap(layerDTO.getOptions(), stateDTO.getLayerOrder());
      layerInMap.setLayer(getLayer(layerDTO.getOptions()));
      if (layerDTO.getOptions().getStyle() != null) {
        importStyles(layerInMap, layerDTO.getOptions());
      }
      layerInMap.setMap(map);
      LayerInMap layerInMapUpdated = layerInMapRepository.save(layerInMap);
      layerInMapList.add(layerInMapUpdated);
    }
    if (!layerInMapList.isEmpty()) map.setLayersInMap(layerInMapList);
    Map mapUpdated = mapRepository.save(map);
    return new MapStateDTO(
      mapUpdated,
      toJSONObject(mapUpdated.getView()),
      getLayerOrder(mapUpdated.getLayersInMap()),
      getOptions(mapUpdated.getLayersInMap()));
  }

  @Transactional(readOnly = true)
  public MapStateDTO exportState(Long id) throws NotFoundException, ParseException {
    Map map =
      mapRepository
        .findById(id)
        .orElseThrow(() -> new NotFoundException("Cannot find Map with id " + id));
    return new MapStateDTO(
        map,
        toJSONObject(map.getView()),
        getLayerOrder(map.getLayersInMap()),
        getOptions(map.getLayersInMap()));

  }
  @Transactional(readOnly = true)
  public List<MapDTO> findAll() {
    List<Map> mapList = mapRepository.findAll();
    /*% if (feature.UserManagement) { %*/
    UMUser user = userService.getUserWithAuthorities();
    /*% } %*/
    return mapList.stream()/*% if (feature.UserManagement) { %*/.filter(map -> map.getOwner().getId() == user.getId())/*% } %*/.map(MapDTO::new).collect(Collectors.toList());

  }

  @Transactional(readOnly = false, rollbackFor = Exception.class)
  public MapStateDTO updateState(Long id, MapStateDTO stateDTO)
    throws OperationNotAllowedException, NotFoundException, ParseException {
    if (stateDTO.getId() == null) {
      throw new OperationNotAllowedException("map.error.id-not-exists");
    }
    Map map =
      mapRepository
          .findById(id)
          .orElseThrow(() -> new NotFoundException("Cannot find Map with id " + id));

    map.setMinZoom(stateDTO.getMinZoom());
    map.setMaxZoom(stateDTO.getMaxZoom());
    map.setView(stateDTO.getView().toString());

    // Layers in the map not updated
    List<LayerInMap> layerInOldMapList = map.getLayersInMap();

    List<LayerInMap> layerInMapList = new ArrayList<>();
    for (MapLayerDTO layerDTO : stateDTO.getLayers()) {
      LayerInMap layerInMap;
      // If the new layer is not in the old map version, create it and add it to the new map
      if (!layerExists(layerInOldMapList, layerDTO)) {
        layerInMap = getLayerInMap(layerDTO.getOptions(), stateDTO.getLayerOrder());
        layerInMap.setLayer(getLayer(layerDTO.getOptions()));
        if (layerDTO.getOptions().getStyle() != null) {
          importStyles(layerInMap, layerDTO.getOptions());
        }
        layerInMap.setMap(map);
        // If the new layer is already in the old map version, update it and add it to the new map
      } else {
        layerInMap = getLayerInList(layerInOldMapList, layerDTO);
        MapOptionsDTO layerOptions = layerDTO.getOptions();
        layerInMap.setLayer(layerInMap.getLayer().fromDtoToLayer(layerOptions));
        layerInMap.setIsBaseLayer(layerOptions.getBaseLayer());
        layerInMap.setOpacity(layerOptions.getOpacity());
        if (layerOptions.getStyle() != null) {
          layerInMap
            .getLayer()
            .getAvailableStyles()
            .forEach(style -> styleRepository.deleteById(style.getId()));
          importStyles(layerInMap, layerDTO.getOptions());
        }
        if (layerOptions.getSelected() != null) layerInMap.setSelected(layerOptions.getSelected());
        layerInOldMapList.remove(layerInMap);
      }
      LayerInMap layerInMapUpdated = layerInMapRepository.save(layerInMap);
      layerInMapList.add(layerInMapUpdated);
    }
    // If there is a layer in the old map version not present in the new map state, delete it
    for (LayerInMap layerInMap : layerInOldMapList) {
      layerInMapRepository.delete(layerInMap);
    }
    if (!layerInMapList.isEmpty()) map.setLayersInMap(layerInMapList);
    Map mapUpdated = mapRepository.save(map);
    return new MapStateDTO(
        mapUpdated,
        toJSONObject(mapUpdated.getView()),
        getLayerOrder(mapUpdated.getLayersInMap()),
        getOptions(mapUpdated.getLayersInMap()));
  }

  @Transactional(readOnly = false, rollbackFor = Exception.class)
  public void delete(Long id) throws NotFoundException {
    Map map =
      mapRepository
        .findById(id)
        .orElseThrow(() -> new NotFoundException("Cannot find Map with id " + id));
    mapRepository.deleteById(id);
  }

  /**************************** Private methods ***********************************/
  private List<String> getLayerOrder(List<LayerInMap> list) {
    return list.stream()
      .filter(layer -> layer.getOrder() != null)
      .sorted(Comparator.comparingInt(LayerInMap::getOrder))
      .map(LayerInMap::getLayer)
      .map(Layer::getLabel)
      .collect(Collectors.toList());
  }

  private List<MapLayerDTO> getOptions(List<LayerInMap> layerInMapList)  throws ParseException {
    List<MapLayerDTO> layersDTO = new ArrayList<>();
    for (LayerInMap layerInMap : layerInMapList) {
      MapOptionsDTO mapOptionsDTO = new MapOptionsDTO();
      mapOptionsDTO = layerInMap.getLayerParams(mapOptionsDTO);
      if (layerInMap.getLayer() != null) {
        mapOptionsDTO = layerInMap.getLayer().getLayerParams(mapOptionsDTO);
      }
      if (layerInMap.getLayer().getDefaultStyle() != null) {
        mapOptionsDTO.setStyle(layerInMap.getLayer().getDefaultStyle().getStyleParams());
      }
      if (layerInMap.getLayer().getAvailableStyles() != null) {
        List<MapStyleDTO> availableStylesDTO = new ArrayList<>();
        for (Style availableStyle : layerInMap.getLayer().getAvailableStyles()) {
          availableStylesDTO.add(availableStyle.getStyleParams());
        }
        mapOptionsDTO.setAvailableStyles(availableStylesDTO);
      }
      layersDTO.add(new MapLayerDTO(mapOptionsDTO));
    }
    return layersDTO;
  }

  private JSONObject toJSONObject(String obj) throws ParseException {
    JSONParser jsonParser = new JSONParser();
    return (JSONObject) jsonParser.parse(obj);
  }

  private LayerInMap getLayerInMap(MapOptionsDTO data, List<String> layerOrder) throws OperationNotAllowedException, ParseException {
    LayerInMap layerInMap = new LayerInMap();
    layerInMap.setIsBaseLayer(data.getBaseLayer());
    layerInMap.setOpacity(data.getOpacity());
    if (data.getSelected() != null)
      layerInMap.setSelected(data.getSelected());
    int index = layerOrder.indexOf(data.getId());
    if (index >= 0) layerInMap.setOrder(index + 1);
    return layerInMap;
  }

  private Layer getLayer(MapOptionsDTO data) throws OperationNotAllowedException {
    switch (data.getType()) {
      case TILE:
        TileLayer tileLayer = new TileLayer();
        return tileLayerRepository.save(tileLayer.fromDtoToLayer(data));
      case WMS:
        WMSLayer wmsLayer = new WMSLayer();
        return wmsLayerRepository.save(wmsLayer.fromDtoToLayer(data));
      case GEOJSON:
        GeoJSONLayer geoJSONLayer = new GeoJSONLayer();
        return geoJSONLayerRepository.save(geoJSONLayer.fromDtoToLayer(data));
      default:
        throw new OperationNotAllowedException("Layer type parameter not allowed");
    }
  }

  private void importStyles(LayerInMap layerInMap, MapOptionsDTO data) throws OperationNotAllowedException, ParseException {
    List<LayerInMap> layersInMapList = new ArrayList<>();
    layersInMapList.add(layerInMap);
    // Import available styles
    if (data.getAvailableStyles() != null) {
      List<Layer> layersList = new ArrayList<>();
      layersList.add(layerInMap.getLayer());

      List<Style> availableStyles = new ArrayList<>();
      for (MapStyleDTO styleDTO : data.getAvailableStyles()) {
        Style availableStyle =
                getStyle(data.getType(), styleDTO, layersInMapList, layersList);
        availableStyles.add(availableStyle);
      }
      // import default style
      Style defaultStyle =
              availableStyles.stream()
                      .filter(
                              availableStyle ->
                                      data.getStyle().getId().equals(availableStyle.getStyleParams().getId()))
                      .findAny()
                      .orElse(null);
      layerInMap.setDefaultStyleInMap(defaultStyle);
      layerInMap.getLayer().setDefaultStyle(defaultStyle);
      layerInMap.getLayer().setAvailableStyles(availableStyles);
    }
  }

  private Style getStyle(LayerType type, MapStyleDTO style, List<LayerInMap> layersInMapList, List<Layer> layers)
    throws OperationNotAllowedException, ParseException {
    switch (type) {
      case WMS:
        WMSLayerStyle wmsLayerStyle = new WMSLayerStyle();
        wmsLayerStyle = wmsLayerStyle.fromDtoToLayer(style);
        wmsLayerStyle.setDefaultStyleInMap(layersInMapList);
        wmsLayerStyle.setLayers(layers);
        return wmsLayerStyleRepository.save(wmsLayerStyle);
      case GEOJSON:
        GeoJSONLayerStyle geoJSONLayerStyle = new GeoJSONLayerStyle();
        geoJSONLayerStyle = geoJSONLayerStyle.fromDtoToLayer(style);
        geoJSONLayerStyle.setDefaultStyleInMap(layersInMapList);
        geoJSONLayerStyle.setLayers(layers);
        return geoJSONLayerStyleRepository.save(geoJSONLayerStyle);
      default:
        throw new OperationNotAllowedException("Layer type parameter not allowed");
    }
  }

  private Boolean layerExists(List<LayerInMap> LayerInMapList, MapLayerDTO layerDTO) {
    return LayerInMapList.stream()
      .anyMatch(
        layerInMapList ->
          layerDTO.getOptions().getId() == layerInMapList.getLayer().getLayerId());
  }

  private LayerInMap getLayerInList(List<LayerInMap> LayerInMapList, MapLayerDTO layerDTO) {
    return LayerInMapList.stream()
      .filter(
        layerInMapList ->
          layerDTO.getOptions().getId() == layerInMapList.getLayer().getLayerId())
      .findAny()
      .orElse(null);
  }
}
/*% } %*/
