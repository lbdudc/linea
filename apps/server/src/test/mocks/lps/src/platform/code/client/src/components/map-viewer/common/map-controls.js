/**
 * Map Control Functions
 */
/*% if (feature.DM_A_C_RouteCalculation) { %*/
  import Vue from 'vue';
  import RepositoryFactory from "@/repositories/RepositoryFactory";
  const MVRouteCalculationRepository = RepositoryFactory.get("MVRouteCalculationRepository");
  import i18n from "@/plugins/i18n";
  /*% if (feature.DM_A_C_RC_GraphHopper) { %*/
    import querystring from "querystring";
  /*% } %*/
/*% } %*/

/*% if (feature.MV_CI_Scale) { %*/
/**
 * Builds Scale control
 **/
function buildMapScaleControl() {
    return new L.control.scale();
}
/*% } %*/
/*% if (feature.MV_CI_CenterCoordinates) { %*/
/**
 * Builds coordinates control
 * https://github.com/xguaita/Leaflet.MapCenterCoord
 */
function buildMapCoordinatesControl() {
    var mapCenterOptions = {
        icon: false,
        onMove: true,
        latlngFormat: "DMS",
        latlngDesignators: true
    };
    // Show map coordinates
    return new L.control.mapCenterCoord(mapCenterOptions);
}
/*% } %*/
/*% if (feature.MV_CI_Map) { %*/
/**
 * Builds MiniMap control
 * https://github.com/Norkart/Leaflet-MiniMap
 */
function buildMiniMapControl(isMobile, defaultBaseLayer) {
    var miniMapOptions = {
        position: "bottomright",
        width: isMobile ? 75 : 125,
        height: isMobile ? 75 : 125,
        toggleDisplay: true,
        zoomLevelOffset: -5,
        zoomLevelFixed: false,
        zoomAnimation: false,
        autoToggleDisplay: true,
        aimingRectOptions: {
            color: "#ff7800",
            weight: 1,
            clickable: false,
        },
        shadowRectOptions: {
            color: "#000000",
            weight: 1,
            clickable: false,
            opacity: 0,
            fillOpacity: 0,
        },
    };
    let miniMapLayer;
    if (defaultBaseLayer) {
        miniMapLayer = new L.TileLayer(defaultBaseLayer.url, {
            minZoom: 0,
            maxZoom: 13,
        });
    } else {
        miniMapLayer = new L.TileLayer(
            "http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                minZoom: 0,
                maxZoom: 13,
            }
        );
    }

    return new L.Control.MiniMap(miniMapLayer, miniMapOptions);
}
/*% } %*/
/*% if (feature.MV_T_MeasureControl) { %*/
/**
 * Builds the measure tool control
 */
function buildMeasureControl() {
    const measureOptions = {
        position: "topleft",
        primaryLengthUnit: "kilometers",
        secondaryLengthUnit: undefined,
        primaryAreaUnit: "sqkilometers",
        activeColor: "#CC3E33",
        completedColor: "#33CC3E",
        units: {
            sqkilometers: {
                factor: 0.000001,
                display: "km2",
                decimals: 2
            }
        },
        decPoint: ",",
        thousandsSep: "."
    };
    return L.control.measure(measureOptions);
}
/*% } %*/
/*% if (feature.MV_T_ZoomWindow) { %*/
/**
 * Builds the zoombox control
 * http://angular-ui.github.io/ui-leaflet/examples/0000-viewer.html#/controls/minimap-example
 * https://github.com/consbio/Leaflet.ZoomBox
 */
function buildZoomBoxControl() {
    return L.control.zoomBox({
        modal: false,
        position: "topleft",
        title: "Zoom Box Control"
    });
}
/*% } %*/
/*% if (feature.MV_T_UserGeolocation) { %*/
/** Builds the locate control
 * https://github.com/domoritz/leaflet-locatecontrol
 */
function buildLocateControl() {
    const locateControlOptions = {
        strings: {
            title: "User location"
        },
        iconElementTag: "a",
        icon: "user-location-icon"
    };
    return L.control.locate(locateControlOptions);
}
/*% } %*/

/*% if (feature.DM_A_C_RouteCalculation) { %*/
/**
 * Builds route calculation control
 */

/*% if (feature.DM_A_C_RC_pgRouting) { %*/
/**
 * Retrieves data using pgRouting queries
 */
function buildPgroutingControl() {
  let route = {
    routeToCalculate: null,
    overlays: [],
    calculating: false,
  };

  return new L.easyButton({
    tittle: "pgrbtn",
    id: "calcRouteButton",
    position: "bottomleft",
    states: [
      {
        stateName: "normal",
        icon:
          '<span>pgRouting</span>',
        onClick: function(btn, map) {
          route = settingOrigin(btn, map, route);
        }
      },
      {
        stateName: "origin",
        icon: "<span>Set origin</span>",
        onClick: function(btn, map) {
          route = cancelRouteCalculation(btn, map, route);
        }
      },
      {
        stateName: "destiny",
        icon: "<span>Set destiny</span>",
        onClick: function(btn, map) {
          route = cancelRouteCalculation(btn, map, route);
        }
      }
    ]
  });
}

const calculatePgrRoute = (btn, map, route) => {
  btn.state("normal");
  var from = route.routeToCalculate.origin.getLatLng()
  var to = route.routeToCalculate.destiny.getLatLng()

  MVRouteCalculationRepository.getPgrRoute({
    params: {
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng
    }
  })
    .then(data => {
      route.calculating = false;
      var routeLayer = new L.featureGroup();
      var opacity = 80;
      var color = {
        name: "blue",
        value: "#106CB6"
      };

      data.forEach(json => {
        new L.geoJson(json.geom_way, {
          style: function() {
            return getStyleForRoute(color, opacity);
          },
          pointToLayer: (geoJsonPoint, latlng) => {
            return getPointToLayer(latlng, color, opacity);
          }
        }).addTo(routeLayer);
      })
      addOverlay(route.overlays, color, opacity, routeLayer);
      routeLayer.addTo(map);
    })
    .catch(() => cancelRouteCalculation(btn, map, route));
};
/*% } %*/

/*% if (feature.DM_A_C_RC_GraphHopper) { %*/
/**
 * Retrieves data from GraphHopper server
 */
function buildGraphhopperControl() {
  let route = {
    routeToCalculate: null,
    overlays: [],
    calculating: false,
  };

  return new L.easyButton({
    tittle: "ghbtn",
    id: "calcRouteButton",
    position: "bottomleft",
    states: [
      {
        stateName: "normal",
        icon:
          '<span>GraphHopper</span>',
        onClick: function(btn, map) {
          route = settingOrigin(btn, map, route);
        }
      },
      {
        stateName: "origin",
        icon: "<span>Set origin</span>",
        onClick: function(btn, map) {
          route = cancelRouteCalculation(btn, map, route);
        }
      },
      {
        stateName: "destiny",
        icon: "<span>Set destiny</span>",
        onClick: function(btn, map) {
          route = cancelRouteCalculation(btn, map, route);
        }
      }
    ]
  });
}

const calculateGhRoute = (btn, map, route) => {
  btn.state("normal");
  var from = route.routeToCalculate.origin.getLatLng()
  var to = route.routeToCalculate.destiny.getLatLng()

  MVRouteCalculationRepository.getGhRoute(
    querystring.stringify({
      point: [from.lat + "," + from.lng, to.lat + "," + to.lng],
      vehicle: "car",
      points_encoded: false,
    })

  )
    .then(data => {
      route.calculating = false;
      var routeLayer = new L.featureGroup();
      var opacity = 80;
      var color = {
        name: "green",
        value: "#008F3F"
      };

      new L.geoJson(data.paths[0].points, {
        style: function() {
          return getStyleForRoute(color, opacity);
        },
        pointToLayer: (geoJsonPoint, latlng) => {
          return getPointToLayer(latlng, color, opacity);
        }
      }).addTo(routeLayer);

      addOverlay(route.overlays, color, opacity, routeLayer);

      routeLayer.addTo(map);
    })
    .catch(() => cancelRouteCalculation(btn, map, route));
};
/*% } %*/

const settingOrigin = (btn, map, route) => {
  if (!route.calculating) {
    btn.state("origin");
    route.calculating = true;
    removeCurrentRoute(btn, map, route);
    route.routeToCalculate = {
      origin: null,
      destiny: null
    };

    map.on("click", e => {
      route.routeToCalculate.origin = L.marker(e.latlng);
      route.routeToCalculate.origin.addTo(map);
      map.off("click");
      settingDestiny(btn, map, route);
    });
  } else
    Vue.notify({
      text: i18n.t("mapViewer.routeCompletationError"),
      type: "error"
    });
  return route;
};

const settingDestiny = (btn, map, route) => {
  btn.state("destiny");
  map.on("click", e => {
    route.routeToCalculate.destiny = L.marker(e.latlng);
    route.routeToCalculate.destiny.addTo(map);
    map.off("click");

    /*% if (feature.DM_A_C_RC_GraphHopper && feature.DM_A_C_RC_pgRouting) { %*/
    if (btn.options.tittle === "ghbtn") {
      calculateGhRoute(btn, map, route);
    } else calculatePgrRoute(btn, map, route);
    /*% } else if (feature.DM_A_C_RC_pgRouting) { %*/
    calculatePgrRoute(btn, map, route);
    /*% } else if (feature.DM_A_C_RC_GraphHopper) { %*/
    calculateGhRoute(btn, map, route);
    /*% } %*/
  });
};

function getPointToLayer(latlng, color, opacity) {
  return new L.circleMarker(latlng, {
    radius: 8,
    fillColor: color.value,
    color: color.value,
    weight: 1,
    opacity: 1,
    fillOpacity: opacity / 100
  });
}

function getStyleForRoute(color, opacity) {
  return {
    opacity: opacity / 100,
    fillOpacity: opacity / 100,
    color: color.value,
    fillColor: color.value
  };
}

const addOverlay = (overlays, color, opacity, routeLayer) => {
  overlays.push({
    id: "calculated-route",
    name: "mapviewer.route",
    color: color,
    opacity: opacity,
    layer: routeLayer,
    order: overlays.length
  });

}

const removeCurrentRoute = (btn, map, route) => {
  if (route.routeToCalculate) {
    if (route.routeToCalculate.origin) {
      map.removeLayer(route.routeToCalculate.origin);
    }
    if (route.routeToCalculate.destiny) {
      map.removeLayer(route.routeToCalculate.destiny);
    }
  }

  var old = route.overlays.find(l => {
    return l.id === "calculated-route";
  });
  if (old) {
    route.overlays.splice(route.overlays.indexOf(old), 1);
    map.removeLayer(old.layer);
  }
};

const cancelRouteCalculation = (btn, map, route) => {
  btn.state("normal");
  map.off("click");
  route.calculating = false;
  removeCurrentRoute(btn, map, route);
  route.routeToCalculate = null;

  return route;
};
/*% } %*/

export { /*% if (feature.MV_CI_Scale) { %*/buildMapScaleControl,/*% } %*/
    /*% if (feature.MV_CI_CenterCoordinates) { %*/ buildMapCoordinatesControl,/*% } %*/
    /*% if (feature.MV_CI_Map) { %*/ buildMiniMapControl,/*% } %*/
    /*% if (feature.MV_T_MeasureControl) { %*/ buildMeasureControl,/*% } %*/
    /*% if (feature.MV_T_ZoomWindow) { %*/ buildZoomBoxControl,/*% } %*/
    /*% if (feature.MV_T_UserGeolocation) { %*/ buildLocateControl,/*% } %*/
    /*% if (feature.DM_A_C_RC_pgRouting) { %*/ buildPgroutingControl,/*% } %*/
    /*% if (feature.DM_A_C_RC_GraphHopper) { %*/ buildGraphhopperControl/*% } %*/
};
