/*% if (feature.MV_LayerManagement || feature.MV_LM_ExternalLayer || feature.MV_T_ViewMapAsList || feature.MV_T_InformationMode) { %*/
<template>
  <v-container fluid id="controls-container">
    <div v-if="map" class="map-controls">
      <div class="column">
        <v-btn
          v-if="$vuetify.breakpoint.smAndDown"
          color="white"
          max-height="25"
          max-width="20"
          @click.stop="showButtons"
        >
          <div v-if="!showBtns && $vuetify.breakpoint.smAndDown">
            <v-icon>mdi-wrench-outline</v-icon>
            <v-icon>mdi-chevron-down</v-icon>
          </div>
          <div v-else>
            <v-icon>mdi-wrench-outline</v-icon>
            <v-icon>mdi-chevron-up</v-icon>
          </div>
        </v-btn>
      </div>

      <div v-show="showBtns || !$vuetify.breakpoint.smAndDown">
        /*% if (feature.MV_LayerManagement) { %*/
        <div class="column">
          <layer-manager
            :loadingMap="loadingMap"
            :overlays="overlays"
            :map="map"
            /*% if (feature.MV_MapCustomization) { %*/:customization="customization"/*% } %*/
            /*% if (feature.MV_LM_StylePreview) { %*/
            @wms-legend-selected="(newVal) => (
              (dialogComponent = 'wms-legend'),
              (wmsLegendSelected = newVal),
              (showDialog = true)
            )"
            /*% } %*/
          ></layer-manager>
        </div>
        /*% } %*/

        /*% if (feature.MV_LM_ExternalLayer) { %*/
        <div class="column">
          <v-tooltip left open-delay="200" color="var(--appColor)">
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                v-bind="attrs"
                v-on="on"
                color="white"
                @click.stop="(dialogComponent = 'add-new-layer'), (showDialog = true)"
              >
                <v-icon>mdi-layers-plus</v-icon>
              </v-btn>
            </template>
            <span>{{ $t("addNewLayer.addNewLayerTitle") }}</span>
          </v-tooltip>
        </div>
        /*% } %*/

        /*% if (feature.MV_LM_BaseLayerSelector) { %*/
        <div class="column">
          <v-tooltip left open-delay="200" color="var(--appColor)">
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                v-bind="attrs"
                v-on="on"
                color="white"
                @click.stop="(dialogComponent = 'change-base-layer'), (showDialog = true)"
              >
                <v-icon>mdi-layers-edit</v-icon>
              </v-btn>
            </template>
            <span>{{ $t("changeBaseLayer.changeBaseLayerTitle") }}</span>
          </v-tooltip>
        </div>
        /*% } %*/

        /*% if (feature.MV_T_ViewMapAsList) { %*/
        <div class="column">
          <v-tooltip left open-delay="200" color="var(--appColor)">
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                v-bind="attrs"
                v-on="on"
                color="white"
                @click.stop="(dialogComponent = 'list-layer-management'), (showDialog = true)"
              >
                <v-icon>mdi-format-list-bulleted</v-icon>
              </v-btn>
            </template>
            <span>{{ $t("mapViewer.listLayerElements") }}</span>
          </v-tooltip>
        </div>
        /*% } %*/

        /*% if (feature.MV_T_InformationMode) { %*/
        <div class="column">
          <v-tooltip left open-delay="200" color="var(--appColor)">
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                v-bind="attrs"
                v-on="on"
                :class="WMSInfoControlBtn ? null : 'btn-selected'"
                @click.stop="buildWMSInfoControl"
              >
                <v-icon v-if="WMSInfoControlBtn" color="red"
                >mdi-alert-circle</v-icon
                >
                <v-icon v-else color="green">mdi-alert-circle</v-icon>
              </v-btn>
            </template>
            <span>{{ $t("mapViewer.wmsDetail.title") }}</span>
          </v-tooltip>
        </div>
        /*% } %*/

        /*% if (feature.MV_T_Export) { %*/
        <div class="column">
          <v-tooltip left open-delay="200" color="var(--appColor)">
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                v-bind="attrs"
                v-on="on"
                color="white"
                @click.stop="(dialogComponent = 'export-management'), (showDialog = true)"
              >
                <v-icon>mdi-export</v-icon>
              </v-btn>
            </template>
            <span>{{ $t("mapViewer.exportManager") }}</span>
          </v-tooltip>
        </div>
        /*% } %*/

        /*% if (feature.MV_MapCustomization) { %*/
        <div class="column" v-if="customization">
          <map-customization
            :map="map"
            :selectedCustom="selectedCustom"
            /*% if (feature.MV_DetailOnClick) { %*/:popupFn="popupFn"/*% } %*/
            @update-route="(val) => $emit('update-route', val)"
          ></map-customization>
        </div>
        /*% } %*/
      </div>
    </div>
    /*% if (feature.MV_T_Export || feature.MV_LM_ExternalLayer || feature.MV_T_ViewMapAsList || feature.MV_T_InformationMode || feature.MV_LM_BaseLayerSelector) { %*/
    <v-dialog
      v-model="showDialog"
      hide-overlay
      :fullscreen="$vuetify.breakpoint.mdAndDown"
      :width="/*% if (feature.MV_T_InformationMode) { %*/wmsFeatures != null ? 1200 :/*% } %*/500"
      @click:outside="closeDialog"
    >
      <component
        v-if="dialogComponent"
        v-bind:is="dialogComponent"
        :map="map"
      /*% if (feature.MV_T_InformationMode) { %*/:features="wmsFeatures"/*% } %*/
      /*% if (feature.MV_LM_StylePreview) { %*/:wmsLegend="wmsLegendSelected"/*% } %*/
      @layer-added="(val) => $emit('map-updated', val)"
      @close="closeDialog"
      ></component>
    </v-dialog>
    /*% } %*/
  </v-container>
</template>

<script>
/*% if (feature.MV_LayerManagement) { %*/
import LayerManager from "./LayerManager.vue";
/*% } %*/
/*% if (feature.MV_MapCustomization) { %*/
import MapCustomization from "@/components/map-viewer/MapCustomization";
/*% } %*/
/*% if (feature.MV_T_Export) { %*/
import ExportManagement from "../export-management/ExportManagement";
/*% } %*/
/*% if (feature.MV_LM_BaseLayerSelector ) { %*/
import ChangeBaseLayer from "../change-base-layer/ChangeBaseLayer.vue";
/*% } %*/
/*% if (feature.MV_T_ViewMapAsList) { %*/
import ListLayerManagement from "../list-layer-management/ListLayerManagement.vue";
/*% } %*/
/*% if (feature.MV_T_InformationMode) { %*/
import WMSInformation from "../wms-information/WMSInformation.vue";
/*% } %*/
/*% if (feature.MV_LM_ExternalLayer) { %*/
import AddNewLayer from "../add-new-layer/AddNewLayer.vue";
/*% } %*/
/*% if (feature.MV_LM_StylePreview) { %*/
import WMSLegend from "../wms-legend/WMSLegend.vue";
/*% } %*/

export default {
  name: "RightMapControls",
  /*% if (feature.MV_T_InformationMode || feature.MV_MapCustomization) { %*/
  watch: {
    /*% if (feature.MV_T_InformationMode) { %*/
    $route() {
      // Deactivate info control if it is active
      if (!this.WMSInfoControlBtn) {
        this.buildWMSInfoControl();
      }
    },
    /*% } %*/
  },
  /*% } %*/
  components: {
    /*% if (feature.MV_LayerManagement) { %*/
    LayerManager,
    /*% } %*/
    /*% if (feature.MV_MapCustomization) { %*/MapCustomization,/*% } %*/
    /*% if (feature.MV_T_Export) { %*/"export-management": ExportManagement,/*% } %*/
    /*% if (feature.MV_LM_BaseLayerSelector) { %*/"change-base-layer": ChangeBaseLayer,/*% } %*/
    /*% if (feature.MV_T_ViewMapAsList) { %*/"list-layer-management": ListLayerManagement,/*% } %*/
    /*% if (feature.MV_T_InformationMode) { %*/"wms-information": WMSInformation,/*% } %*/
    /*% if (feature.MV_LM_ExternalLayer) { %*/"add-new-layer": AddNewLayer,/*% } %*/
    /*% if (feature.MV_LM_StylePreview) { %*/"wms-legend": WMSLegend,/*% } %*/
  },
  props: {
    overlays: {
      type: Array,
      default: () => [],
    },
    map: {
      type: Object,
      default: () => {},
    },
    /*% if (feature.MV_T_InformationMode) { %*/
    form: {
      type: Object,
      default: () => {},
    },
    /*% } %*/
    loadingMap: {
      type: Boolean,
      required: false,
    },
    /*% if (feature.MV_MapCustomization) { %*/
    customization: {
      type: Boolean,
      required: false,
    },
    selectedCustom: {
      type: Object,
      mandatory: true,
    },
    /*% if (feature.MV_DetailOnClick) { %*/
    popupFn: {
      type: Function,
      mandatory: true,
    },
    /*% } %*/
    /*% } %*/
  },
  data() {
    return {
      showBtns: false,
      /*% if (feature.MV_T_InformationMode) { %*/
      WMSInfoControlBtn: true,
      wmsFeatures: null,
      /*% } %*/
      /*% if (feature.MV_T_Export || feature.MV_LM_ExternalLayer || feature.MV_T_ViewMapAsList || feature.MV_T_InformationMode || feature.MV_LM_BaseLayerSelector) { %*/
      dialogComponent: null,
      showDialog: false,
      /*% } %*/
      /*% if (feature.MV_LM_StylePreview) { %*/
      wmsLegendSelected: null,
      /*% } %*/
    };
  },
  methods: {
    showButtons() {
      this.showBtns = !this.showBtns;
    },
    /*% if (feature.MV_T_Export || feature.MV_LM_ExternalLayer || feature.MV_T_ViewMapAsList || feature.MV_T_InformationMode || feature.MV_LM_StylePreview || feature.MV_LM_BaseLayerSelector) { %*/
    closeDialog() {
      this.dialogComponent = null;
      this.showDialog = false;
      /*% if (feature.MV_T_InformationMode) { %*/
      this.wmsFeatures = null;
      /*% } %*/
      /*% if (feature.MV_LM_StylePreview) { %*/
      this.wmsLegendSelected = null;
      /*% } %*/
    },
    /*% } %*/
    /*% if (feature.MV_T_InformationMode) { %*/
    buildWMSInfoControl() {
      if (this.WMSInfoControlBtn) {
        document.getElementById("map").style.setProperty("cursor", "pointer");
        this.map.activateLayerInfo(this.wmsCallback);
      } else {
        this.map.deactivateLayerInfo();
        document.getElementById("map").style.setProperty("cursor", "grab");
      }
      this.WMSInfoControlBtn = !this.WMSInfoControlBtn;
    },
    wmsCallback(features) {
      let filteredFeatures =
        /*% if (feature.MV_T_F_BasicSearch) { %*/
        (this.form.query != null && this.form.query !== "")
          ? features.filter(f => f.id.endsWith(this.form.query))
          : /*% } %*/ features;
      if (filteredFeatures.length > 0) {
        this.dialogComponent = "wms-information";
        this.wmsFeatures = filteredFeatures;
        this.showDialog = true;
      }
    },
    /*% } %*/
  },
};
</script>

<style scoped>
.map-controls {
  position: absolute;
  z-index: 1000;
  top: 4px;
  right: 0px;
  margin-right: 0px;
  padding: 0;
}
.column {
  margin-top: 0.6em;
  padding-right: 8px;
}

/* we will explain what these classes do next! */
.v-enter-active,
.v-leave-active {
  transition: opacity 0.4s ease;
}

.v-enter-from,
.v-leave-to {
  opacity: 0;
}

.btn-selected {
  border: 2px solid #1976d2;
}

.arrow-icon {
  font-size: 24px;
}
</style>
/*% } %*/
