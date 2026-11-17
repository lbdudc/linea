/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.service.dto;

import org.json.simple.JSONObject;
import es.udc.lbd.gema.lps.component.map_viewer.model.domain.LayerType;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapStyleDTO;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.Valid;
import java.util.List;

public class MapOptionsDTO {
  private String id;
  private String label;
  @NotNull
  private LayerType type;
  private Boolean baseLayer;
  private Long opacity;
  private Boolean selected;
  private Boolean editable;
  private String color;
  private Boolean added;
  private String url;
  private JSONObject params;
  private String list;
  private Boolean clustering;
  @Valid private MapStyleDTO style;
  @Valid private List<MapStyleDTO> availableStyles;

  public MapOptionsDTO() {
  }

  public MapOptionsDTO(String id, String label, LayerType type, Boolean baseLayer, Long opacity, Boolean selected, Boolean editable, String color, Boolean added, String url, JSONObject params, String list, Boolean clustering, MapStyleDTO style, List<MapStyleDTO> availableStyles) {
    this.id = id;
    this.label = label;
    this.type = type;
    this.baseLayer = baseLayer;
    this.opacity = opacity;
    this.selected = selected;
    this.editable = editable;
    this.color = color;
    this.added = added;
    this.url = url;
    this.params = params;
    this.list = list;
    this.clustering = clustering;
    this.style = style;
    this.availableStyles = availableStyles;
  }

  public String getId() {
    return id;
  }

  public void setId(String id) {
    this.id = id;
  }

  public String getLabel() {
    return label;
  }

  public void setLabel(String label) {
    this.label = label;
  }

  public LayerType getType() {
    return type;
  }

  public void setType(LayerType type) {
    this.type = type;
  }

  public Boolean getBaseLayer() {
    return baseLayer;
  }

  public void setBaseLayer(Boolean baseLayer) {
    this.baseLayer = baseLayer;
  }

  public Long getOpacity() {
    return opacity;
  }

  public void setOpacity(Long opacity) {
    this.opacity = opacity;
  }

  public Boolean getSelected() {
    return selected;
  }

  public void setSelected(Boolean selected) {
    this.selected = selected;
  }

  public Boolean getEditable() {
    return editable;
  }

  public void setEditable(Boolean editable) {
    this.editable = editable;
  }

  public String getColor() {
    return color;
  }

  public void setColor(String color) {
    this.color = color;
  }

  public Boolean getAdded() {
    return added;
  }

  public void setAdded(Boolean added) {
    this.added = added;
  }

  public String getUrl() {
    return url;
  }

  public void setUrl(String url) {
    this.url = url;
  }

  public JSONObject getParams() {
    return params;
  }

  public void setParams(JSONObject params) {
    this.params = params;
  }

  public String getList() {
    return list;
  }

  public void setList(String list) {
    this.list = list;
  }

  public Boolean getClustering() {
    return clustering;
  }

  public void setClustering(Boolean clustering) {
    this.clustering = clustering;
  }

  public MapStyleDTO getStyle() {
    return style;
  }

  public void setStyle(MapStyleDTO style) {
    this.style = style;
  }

  public List<MapStyleDTO> getAvailableStyles() {
    return availableStyles;
  }

  public void setAvailableStyles(List<MapStyleDTO> availableStyles) {
    this.availableStyles = availableStyles;
  }
}
/*% } %*/
