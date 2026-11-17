/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.service.dto;

import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import java.util.List;
import jakarta.validation.Valid;
import es.udc.lbd.gema.lps.component.map_viewer.model.domain.Map;


public class MapStateDTO {

  private String id;
  private JSONObject view;
  private Float minZoom;
  private Float maxZoom;
  private List<String> layerOrder;
  @Valid
  private List<MapLayerDTO> layers;

  public MapStateDTO() {
  }

  public MapStateDTO(Map map, JSONObject view, List<String> layerOrder, List<MapLayerDTO> layers) {
    this.id = map.getLabel();
    this.minZoom = map.getMinZoom();
    this.maxZoom = map.getMaxZoom();
    this.view = view;
    this.layerOrder = layerOrder;
    this.layers = layers;
  }

  public String getId() {
    return id;
  }

  public void setId(String id) {
    this.id = id;
  }

  public JSONObject getView() {
    return view;
  }

  public Float getMinZoom() { return minZoom; }

  public void setMinZoom(Float minZoom) { this.minZoom = minZoom; }

  public Float getMaxZoom() { return maxZoom; }

  public void setMaxZoom(Float maxZoom) { this.maxZoom = maxZoom; }

  public void setView(JSONObject view) {
    this.view = view;
  }

  public List<String> getLayerOrder() {
    return layerOrder;
  }

  public void setLayerOrder(List<String> layerOrder) {
    this.layerOrder = layerOrder;
  }

  public List<MapLayerDTO> getLayers() {
    return layers;
  }

  public void setLayers(List<MapLayerDTO> layers) {
    this.layers = layers;
  }
}
/*% } %*/
