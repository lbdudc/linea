package es.udc.lbd.gema.lps.component.map_viewer.model.service.dto;

public class MapStyleDTO {
    private String id;
    private String geometryType;
    private String fillColor;
    private String strokeColor;
    private Double fillOpacity;
    private Double strokeOpacity;
    private String icon;
    private Double radius;
    private Double weight;
    private Boolean dragend;
    private Boolean draggable;

    public MapStyleDTO() {}

    public MapStyleDTO(
            String id, String geometryType, String fillColor, String strokeColor, Double fillOpacity, Double strokeOpacity, String icon, Double radius, Double weight, Boolean dragend, Boolean draggable) {
        this.id = id;
        this.geometryType = geometryType;
        this.fillColor = fillColor;
        this.strokeColor = strokeColor;
        this.fillOpacity = fillOpacity;
        this.strokeOpacity = strokeOpacity;
        this.icon = icon;
        this.radius = radius;
        this.weight = weight;
        this.dragend = dragend;
        this.draggable = draggable;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getGeometryType() {
        return geometryType;
    }

    public void setGeometryType(String geometryType) {
        this.geometryType = geometryType;
    }

    public String getFillColor() {
        return fillColor;
    }

    public void setFillColor(String fillColor) {
        this.fillColor = fillColor;
    }

    public String getStrokeColor() {
        return strokeColor;
    }

    public void setStrokeColor(String strokeColor) {
        this.strokeColor = strokeColor;
    }

    public Double getFillOpacity() {
        return fillOpacity;
    }

    public void setFillOpacity(Double fillOpacity) {
        this.fillOpacity = fillOpacity;
    }

    public Double getStrokeOpacity() {
        return strokeOpacity;
    }

    public void setStrokeOpacity(Double strokeOpacity) {
        this.strokeOpacity = strokeOpacity;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }

    public Double getRadius() {
        return radius;
    }

    public void setRadius(Double radius) {
        this.radius = radius;
    }

    public Double getWeight() {
        return weight;
    }

    public void setWeight(Double weight) {
        this.weight = weight;
    }

    public Boolean getDragend() {
        return dragend;
    }

    public void setDragend(Boolean dragend) {
        this.dragend = dragend;
    }

    public Boolean getDraggable() {
        return draggable;
    }

    public void setDraggable(Boolean draggable) {
        this.draggable = draggable;
    }
}
