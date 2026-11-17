/*% if (feature.MV_MapCustomization) { %*/
<template>
  <v-container>
    <v-tooltip left open-delay="200" color="var(--appColor)">
      <template v-slot:activator="{ on: onMenu }">
        <v-menu
          v-model="isMenuOpen"
          offset-x
          left
          v-on="onMenu"
          :close-on-content-click="false"
        >
          <template v-slot:activator="{ on: onTooltip }">
            <v-btn
              color="white"
              max-width="20"
              v-on="{ ...onMenu, ...onTooltip }"
            >
              <div v-if="!showBtns">
                <v-icon>chevron_left</v-icon>
                <v-icon>mdi-map</v-icon>
              </div>
              <div v-else>
                <v-icon>chevron_right</v-icon>
                <v-icon>mdi-map</v-icon>
              </div>
            </v-btn>
          </template>

          <div class="btn-container">
            <div class="column">
              <v-menu offset-y left min-width="250px">
                <template v-slot:activator="{ on: menu, attrs }">
                  <v-tooltip left open-delay="200" color="var(--appColor)">
                    <template v-slot:activator="{ on: tooltip }">
                      <v-btn
                        v-bind="attrs"
                        v-on="{ ...menu, ...tooltip }"
                        @click="getMaps"
                        :loading="loading"
                        color="white"
                      >
                        <v-icon>mdi-import mdi-rotate-90</v-icon></v-btn
                      >
                    </template>
                    <span>{{ $t("map_customization.download.tooltip") }}</span>
                  </v-tooltip>
                </template>
                <v-list v-show="!loading">
                  <v-list-item-group v-model="selectedMap">
                    <v-list-item
                      v-for="(item, index) in maps"
                      :key="index"
                      :disabled="false"
                      @click="$emit('update-route', item.id)"
                    >
                      <v-list-item-title>
                        {{ "(" + item.id + ") " + item.label }}
                      </v-list-item-title>
                    </v-list-item>
                  </v-list-item-group>
                  <v-list-item v-if="!maps.length">
                    <v-list-item-title>
                      {{ $t("map_customization.map-list.no-items") }}
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>

            <div class="column">
              <v-tooltip left open-delay="200" color="var(--appColor)">
                <template v-slot:activator="{ on }">
                  <v-btn
                    @click="nameDialog = true"
                    v-on="on"
                    :loading="loading"
                    color="white"
                    size="xs"
                  >
                    <v-icon>save</v-icon>
                  </v-btn>
                </template>
                <span>{{ $t("map_customization.upload.tooltip") }}</span>
              </v-tooltip>
            </div>

            <div class="column">
              <v-tooltip left open-delay="200" color="var(--appColor)">
                <template v-slot:activator="{ on }">
                  <v-btn
                    @click="deleteDialog = true"
                    :disabled="selectedMap == null"
                    v-on="on"
                    :loading="loading"
                    color="white"
                    size="xs"
                  >
                    <v-icon>delete</v-icon>
                  </v-btn>
                </template>
                <span>{{ $t("map_customization.delete.tooltip") }}</span>
              </v-tooltip>
            </div>
          </div>
        </v-menu>
      </template>
      <span>{{ $t("map_customization.mapCustomizationTitle") }}</span>
    </v-tooltip>

    <!-- New map name dialog -->
    <v-dialog persistent width="500" :value="nameDialog">
      <v-card>
        <v-card-title primary-title class="headline primary white--text">
          {{ $t("map_customization.upload.dialog.title") }}
        </v-card-title>
        <v-card-text class="mt-4">
          <v-form ref="nameForm" v-on:submit.prevent>
            <v-text-field
              :label="$t('map_customization.upload.dialog.title')"
              :rules="[
                (v) => !!v || $t('map_customization.upload.dialog.rule'),
              ]"
              @keydown.enter="checkMapName"
              dense
              required
              type="text"
              v-model="mapName"
            ></v-text-field>
          </v-form>
        </v-card-text>
        <v-card-actions class="pb-4">
          <v-spacer></v-spacer>
          <v-btn @click="nameDialog = false">
            {{ $t("map_customization.cancel") }}
          </v-btn>
          <v-btn class="mx-4" @click="checkMapName">
            {{ $t("map_customization.accept") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Overwrite map dialog -->
    <modal-dialog
      @cancel="(overwriteDialog = false), (loading = false)"
      @submit="updateMap"
      :dialog="overwriteDialog"
      :title="$t('map_customization.upload.overwrite.title')"
      titleClass="warning white--text"
      titleIcon="warning"
      submitClass="warning"
      :submitText="$t('map_customization.accept')"
      :content="$t('map_customization.upload.overwrite.text')"
    ></modal-dialog>

    <!-- Confirm delete map dialog -->
    <delete-dialog
      @cancel="deleteDialog = false"
      @submit="deleteMap()"
      :dialog="deleteDialog"
      :title="$t('map_customization.delete.dialog.title')"
      :content="$t('map_customization.delete.dialog.text')"
    >
    </delete-dialog>
  </v-container>
</template>
<script>
import RepositoryFactory from "@/repositories/RepositoryFactory";
import ModalDialog from "@/components/modal_dialog/ModalDialog.vue";
import DeleteDialog from "@/components/modal_dialog/DeleteDialog.vue";
import { loadAddedGeoJSONLayers } from "./common/map-common";
const mapRepository = RepositoryFactory.get("MapRepository");
export default {
  name: "MapCustomization",
  components: { ModalDialog, DeleteDialog },
  props: {
    map: {
      type: Object,
      mandatory: true,
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
  },
  data() {
    return {
      maps: [],
      loading: false,
      nameDialog: false,
      deleteDialog: false,
      overwriteDialog: false,
      mapName: null,
      selectedMap: null,
      showBtns: false,
      isMenuOpen: false,
    };
  },
  watch: {
    isMenuOpen() {
      this.showBtns = !this.showBtns;
    },
    nameDialog(newVal) {
      if (newVal) {
        this.mapName = null;
        this.$refs.nameForm?.resetValidation();
      }
    },
    selectedCustom() {
      this.loadFromSelectedMap();
    },
  },
  mounted() {
    this.getMaps();
    this.loadFromSelectedMap();
  },
  /*% if (!feature.UserManagement) { %*/
  beforeDestroy() {
    if (this.selectedMap) {
      localStorage.setItem("selected", this.maps[this.selectedMap].label);
    }
  },
  /*% } %*/
  methods: {
    getMaps() {
      this.loading = true;
      mapRepository
        .getAll()
        .then((data) => (this.maps = data))
        .catch(() =>
          this.$notify({
            title: this.$t("map_customization.get-maps.error.title"),
            text: this.$t("map_customization.get-maps.error.text"),
            type: "error",
          })
        )
        .finally(() => {
          this.loading = false;
          /*% if (!feature.UserManagement) { %*/
          if (localStorage.getItem("selected")) {
            this.mapName = localStorage.getItem("selected");
            localStorage.removeItem("selected");
          }
          /*% } %*/
          this.updateSelectedMap();
        });
    },
    downloadMap(id) {
      mapRepository
        .importState(id)
        .then((data) => {
          this.map
            .getOverlays()
            .forEach((layer) => this.map.removeLayer(layer.getId()));
          data.id = this.map.getId();

          // Create added GeoJSON layers before importing the prior state to the current map
          loadAddedGeoJSONLayers(this.map, data/*% if (feature.MV_DetailOnClick) { %*/, this.popupFn/*% } %*/);

          this.map?.importState(data);
        })
        .catch(() =>
          this.$notify({
            title: this.$t("map_customization.download.error.title"),
            text: this.$t("map_customization.download.error.text"),
            type: "error",
          })
        )
        .finally(() => {
          this.loading = false;
        });
    },
    uploadMap() {
      this.loading = true;
      const mapState = this.map?.exportState();
      mapState.id = this.mapName;

      mapRepository
        .exportState(mapState)
        .then(() =>
          this.$notify({
            title: this.$t("map_customization.upload.success.title"),
            text: this.$t("map_customization.upload.success.text"),
            type: "success",
          })
        )
        .catch(() =>
          this.$notify({
            title: this.$t("map_customization.upload.error.title"),
            text: this.$t("map_customization.upload.error.text"),
            type: "error",
          })
        )
        .finally(() => {
          this.loading = false;
          this.getMaps();
        });
    },
    updateMap() {
      this.loading = true;
      this.overwriteDialog = false;

      const mapToUpdate = this.maps.find((map) => map.label == this.mapName);
      const mapState = this.map?.exportState();
      mapState.id = this.mapName;

      mapRepository
        .updateState(mapToUpdate.id, mapState)
        .then(() =>
          this.$notify({
            title: this.$t("map_customization.upload.success.title"),
            text: this.$t("map_customization.upload.success.text"),
            type: "success",
          })
        )
        .catch(() =>
          this.$notify({
            title: this.$t("map_customization.upload.error.title"),
            text: this.$t("map_customization.upload.error.text"),
            type: "error",
          })
        )
        .finally(() => {
          this.loading = false;
          this.getMaps();
        });
    },
    deleteMap() {
      this.deleteDialog = false;
      const mapToDelete = this.maps[this.selectedMap];

      mapRepository
        .deleteMap(mapToDelete.id)
        .then(() =>
          this.$notify({
            title: this.$t("map_customization.delete.success.title"),
            text: this.$t("map_customization.delete.success.text"),
            type: "success",
          })
        )
        .catch(() =>
          this.$notify({
            title: this.$t("map_customization.delete.error.title"),
            text: this.$t("map_customization.delete.error.text"),
            type: "error",
          })
        )
        .finally(() => {
          this.$emit("update-route");
          this.getMaps();
          this.selectedMap = null;
          this.mapName = null;
          this.loading = false;
        });
    },
    checkMapName() {
      if (this.$refs.nameForm.validate()) {
        this.loading = true;
        this.nameDialog = false;

        const overwrite = this.maps.find((map) => map.label == this.mapName);
        overwrite ? (this.overwriteDialog = true) : this.uploadMap();
      }
    },
    updateSelectedMap() {
      if (this.mapName) {
        const selected = this.maps.find((map) => map.label == this.mapName);

        // Update route only if not "update" action
        if (this.maps.indexOf(selected) != this.selectedMap)
          this.$emit("update-route", selected.id);

        this.selectedMap = selected ? this.maps.indexOf(selected) : null;
        this.mapName = null;
      } else if (this.selectedCustom) {
        this.selectedMap = this.maps.findIndex(
            (map) => map.id === this.selectedCustom.customId
        );
      }
    },
    loadFromSelectedMap() {
      if (this.selectedCustom) {
        this.downloadMap(this.selectedCustom.customId);
        this.selectedMap = this.maps.findIndex(
            (map) => map.id === this.selectedCustom.customId
        );
      } else {
        this.selectedMap = null;
      }
    },
  },
};
</script>
<style lang="css" scoped>
.container {
  padding: 0;
  margin: 0;
}

.btn-container {
  width: auto !important;
  margin-right: 0.6em;
  z-index: 2000;
}

.column {
  margin-bottom: 0.6em;
}

.v-menu__content {
  width: auto !important;
  box-shadow: none;
}
</style>
/*% } %*/
