/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.service.dto;

import es.udc.lbd.gema.lps.component.map_viewer.model.domain.Map;

public class MapDTO {

  private Long id;
  private String label;
  private String view;
  private Boolean contextMenu;
  private Long contextMenuWidth;
  private Float minZoom;
  private Float maxZoom;
  private Boolean sortable;

  public MapDTO() {}

  public MapDTO(Map map) {
    this.id = map.getId();
    this.label = map.getLabel();
    this.view = map.getView();
    this.contextMenu = map.getContextMenu();
    this.contextMenuWidth = map.getContextMenuWidth();
    this.minZoom = map.getMinZoom();
    this.maxZoom = map.getMaxZoom();
    this.sortable = map.getSortable();
  }

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getLabel() {
    return label;
  }

  public void setLabel(String label) {
    this.label = label;
  }

  public String getView() {
    return view;
  }

  public void setView(String view) {
    this.view = view;
  }

  public Boolean getContextMenu() {
    return contextMenu;
  }

  public void setContextMenu(Boolean contextMenu) {
    this.contextMenu = contextMenu;
  }

  public Long getContextMenuWidth() {
    return contextMenuWidth;
  }

  public void setContextMenuWidth(Long contextMenuWidth) {
    this.contextMenuWidth = contextMenuWidth;
  }

  public Float getMinZoom() {
    return minZoom;
  }

  public void setMinZoom(Float minZoom) {
    this.minZoom = minZoom;
  }

  public Float getMaxZoom() {
    return maxZoom;
  }

  public void setMaxZoom(Float maxZoom) {
    this.maxZoom = maxZoom;
  }

  public Boolean getSortable() {
    return sortable;
  }

  public void setSortable(Boolean sortable) {
    this.sortable = sortable;
  }

}
/*% } %*/
