/*% if (feature.GUI_M_Top && !feature.GUI_M_Custom) { %*/
<template>
  <v-container>
        <v-menu offset-y transition="slide-y-transition" class="dropdown-content">
          <template v-slot:activator="{ on }">
            <v-btn text v-on="on" :class="{ 'button-on-collapse': collapsed }" tile>
              {{ $t('menu.language') }}
              <v-icon>arrow_drop_down</v-icon>
            </v-btn>
          </template>
          <v-list>
    /*%
      data.basicData.languages.forEach(function(lang) {
    %*/
            <v-list-item
              @click="changeLocale('/*%= lang.toLocaleUpperCase() %*/')"
            >
              <v-list-item-title>{{ $t('languages./*%= normalize(lang) %*/') }}</v-list-item-title>
            </v-list-item>
    /*%
      });
    %*/
          </v-list>
        </v-menu>
    /*% if (feature.UM_UserCRUD) { %*/
        <v-btn text v-if="isAdmin" :to="{ name: 'UserManagementList' }"
          >{{ $t('menu.userManagement') }}
        </v-btn>
    /*% } %*/
    /*% if (data.lists.length > 0) { %*/
        <v-menu offset-y transition="slide-y-transition" class="dropdown-content">
          <template v-slot:activator="{ on }">
            <v-btn text v-on="on" :class="{ 'button-on-collapse': collapsed }" tile>
              {{ $t('menu.lists') }}
              <v-icon>arrow_drop_down</v-icon>
            </v-btn>
          </template>
          <v-list>
      /*% data.lists.forEach(function(list) { %*/
            <v-list-item :to="{ name: '/*%= list.id %*/' }">
              <v-list-item-content>
                <v-list-item-title>{{ $t('t_/*%= normalize(list.entity) %*/.headers./*%= normalize(list.id) %*/') }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
      /*% }); %*/
          </v-list>
        </v-menu>
    /*% } %*/
    /*% if (feature.MWM_PersonnelManager) { %*/
    <v-menu offset-y transition="slide-y-transition" class="dropdown-content">
      <template v-slot:activator="{ on }">
        <v-btn text v-on="on" :class="{ 'button-on-collapse': collapsed }">
          {{ $t('menu.management') }}
          <v-icon>arrow_drop_down</v-icon>
        </v-btn>
      </template>
      <v-list>
        /*% if (feature.MWM_PM_Clients) { %*/
        <v-list-item :to="{ name: 'ClientList' }">
          <v-list-item-content>
            <v-list-item-title>{{ $t('menu.clientList') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        /*% } %*/
        /*% if (feature.MWM_PM_Employees) { %*/
        <v-list-item :to="{ name: 'EmployeeList' }">
          <v-list-item-content>
            <v-list-item-title>{{ $t('menu.employeeList') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        /*% } %*/
      </v-list>
    </v-menu>
    /*% } %*/
    /*% if (feature.MWM_VisitSchedule) { %*/
    <v-menu offset-y transition="slide-y-transition" class="dropdown-content">
      <template v-slot:activator="{ on }">
        <v-btn text v-on="on" :class="{ 'button-on-collapse': collapsed }">
          {{ $t('menu.planning') }}
          <v-icon>arrow_drop_down</v-icon>
        </v-btn>
      </template>
      <v-list>
        <v-list-item :to="{ name: 'EventList' }">
          <v-list-item-content>
            <v-list-item-title>{{ $t('menu.plannedVisits') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item :to="{ name: 'EventCalendar' }">
          <v-list-item-content>
            <v-list-item-title>{{ $t('menu.visitCalendar') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-menu>
    /*% } %*/
    /*% if (feature.MWM_TrajectoryExploitation) { %*/
    <v-menu offset-y transition="slide-y-transition" class="dropdown-content">
      <template v-slot:activator="{ on }">
        <v-btn text v-on="on" :class="{ 'button-on-collapse': collapsed }">
          {{ $t('menu.mobilityAnalysis') }}
          <v-icon>arrow_drop_down</v-icon>
        </v-btn>
      </template>
      <v-list>
        /*% if (feature.MWM_TE_Realtime) { %*/
        <v-list-item :to="{ name: 'Realtime' }">
          <v-list-item-title>
            {{ $t('menu.realtime') }}
          </v-list-item-title>
        </v-list-item>
        /*% } %*/
        /*% if (feature.MWM_TE_Planning) { %*/
        <v-list-item :to="{ name: 'Planning' }">
          <v-list-item-title>
            {{ $t('menu.planning') }}
          </v-list-item-title>
        </v-list-item>
        /*% } %*/
        /*% if (feature.MWM_TE_ActivitiesRecord) { %*/
        <v-list-item :to="{ name: 'Record' }">
          <v-list-item-title>
            {{ $t('menu.activityHistory') }}
          </v-list-item-title>
        </v-list-item>
        /*% } %*/
        /*% if (feature.MWM_TE_VisitsRecord) { %*/
        <v-list-item :to="{ name: 'VisitsRecord' }">
          <v-list-item-title>
            {{ $t('menu.visits_record') }}
          </v-list-item-title>
        </v-list-item>
        /*% } %*/
        /*% if (feature.MWM_TE_Statistics) { %*/
        <v-list-item :to="{ name: 'Activities Statistics' }">
          <v-list-item-title>
            {{ $t('menu.activitiesStatistics') }}
          </v-list-item-title>
        </v-list-item>
        /*% } %*/
        /*% if (feature.MWM_TE_QueryView) { %*/
        <v-list-item :to="{ name: 'MobilityQuery' }">
          <v-list-item-title>
            {{ $t("menu.mobilityQuery") }}
          </v-list-item-title>
        </v-list-item>
        /*% } %*/
      </v-list>
    </v-menu>
    /*% } %*/
    /*% if (feature.MV_MM_UniqueMapViewer || feature.MV_MM_MMV_MapSelectorInMapViewer || feature.MV_MM_MMV_MapSelectorInMenuElement || feature.GUI_StaticPages || feature.MWM_TA_SensorDataCollector || feature.DM_DI_DF_Shapefile || feature.DM_A_G_Batch) { %*/
        <v-menu offset-y transition="slide-y-transition" class="dropdown-content">
          <template v-slot:activator="{ on }">
            <v-btn text v-on="on" :class="{ 'button-on-collapse': collapsed }">
              {{ $t('menu.components') }}
              <v-icon>arrow_drop_down</v-icon>
            </v-btn>
          </template>
          <v-list>
      /*% if (feature.MV_MM_UniqueMapViewer || (feature.MV_MM_MMV_MapSelectorInMapViewer && !feature.MV_MM_MMV_MapSelectorInMenuElement)) { %*/
            <v-list-item :to="{ name: 'MapViewer'/*% if (feature.MV_MM_UniqueMapViewer) { %*/, params: { id: 'default' } /*% } %*/ }">
              <v-list-item-title>
                {{ $t('menu.mapViewer') }}
              </v-list-item-title>
            </v-list-item>
      /*% } %*/
      /*% if (feature.MV_MM_MMV_MapSelectorInMenuElement) { %*/
            <v-list-item v-if="maps.length > 0">
              <v-list-item-title>
                <v-menu offset-x left>
                  <template v-slot:activator="{ on }">
                    <v-btn
                      text
                      v-on="on"
                      :class="{ 'button-on-collapse': collapsed }"
                      @click="loadCustomMaps"
                    >
                      <v-icon>chevron_left</v-icon>
                      {{ $t("menu.maps") }}
                    </v-btn>
                  </template>
                  <v-list v-for="map in maps" :key="map.id">
                    <v-list-item :to="{ name: 'MapViewer', params: { id: map.name } }">
                      {{ map.label }}
                    </v-list-item>
                  </v-list>
                </v-menu>
              </v-list-item-title>
            </v-list-item>
      /*% } %*/
      /*% if (feature.GUI_StaticPages) { %*/
            <v-list-item :to="{ name: 'Static_PageList' }">
              <v-list-item-title>
                {{ $t('menu.staticPages') }}
              </v-list-item-title>
            </v-list-item>
      /*% } %*/
      /*% if (feature.MWM_TA_SensorDataCollector) { %*/
            <v-list-item :to="{ name: 'SensorData' }">
              <v-list-item-content>
                <v-list-item-title>{{ $t('menu.sensorData') }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
      /*% } %*/
      /*% if (feature.DM_DI_DF_Shapefile) { %*/
            <v-list-item :to="{ name: 'Shapefile' }">
              <v-list-item-content>
                <v-list-item-title>{{ $t('menu.shapefile') }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
      /*% } %*/
      /*% if (feature.DM_A_G_Batch) { %*/
            <v-list-item :to="{ name: 'AutoAssign' }">
              <v-list-item-content>
                <v-list-item-title>{{ $t('menu.autoassign') }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
      /*% } %*/
      /*% if (feature.T_Payments) { %*/
            <v-list-item :to="{ name: 'Payments' }">
              <v-list-item-content>
                <v-list-item-title>{{ $t('menu.payments') }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
      /*% } %*/
          </v-list>
        </v-menu>
    /*% } %*/
  /*% if (feature.UserManagement) { %*/
        <v-btn
          active-class="hide-active"
          text
          v-show="!isLogged"
          :to="{ name: 'Login' }"
        >
          <v-icon>mdi-login</v-icon>
        </v-btn>
        <v-menu v-show="isLogged" offset-y transition="slide-y-transition">
          <template v-slot:activator="{ on }">
            <v-btn text v-on="on" v-show="isLogged" :class="{ 'button-on-collapse': collapsed }">
              <v-icon large>account_circle</v-icon>
            </v-btn>
          </template>
          <v-list v-show="isLogged">
            <v-list-item two-line v-show="isLogged">
              <v-list-item-avatar>
                <v-icon size="50">account_circle</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ user.login }}</v-list-item-title>
                <v-list-item-subtitle>{{ loggedAs }}</v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
            <v-list>
    /*% if (feature.UM_UserProfile) { %*/
              <v-divider />
              <v-list-item v-show="isLogged" :to="{ name: 'Profile' }">
                <v-list-item-content>
                  <v-list-item-title>{{ $t('menu.myProfile') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
    /*% } %*/
              <v-divider />
              <v-list-item v-show="isLogged" @click="logout()">
                <v-list-item-content>
                  <v-list-item-title>{{ $t('menu.logout') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-list>
        </v-menu>
  /*% } %*/
  </v-container>
</template>

<script>
/*% if (feature.UserManagement) { %*/
import auth from "@/common/auth";
import { mapAuthGetter } from "@/common/mapAuthGetter";
/*% } %*/
/*% if (feature.MV_MM_MMV_MapSelectorInMenuElement) { %*/
import maps from "@/components/map-viewer/config-files/maps.json";
/*% } %*/
/*% if (feature.MV_MapCustomization) { %*/
import RepositoryFactory from "@/repositories/RepositoryFactory";
const mapRepository = RepositoryFactory.get("MapRepository");
/*% } %*/

export default {
  name: "MenuBarItems",
  props: {
    collapsed: {
      type: Boolean,
      required: false,
      default: true
    }
  },
  /*% if (feature.UserManagement || feature.MV_MM_MMV_MapSelectorInMenuElement) { %*/
  data() {
    return {
      /*% if (feature.UserManagement) { %*/
      user: auth.getUser(),
      /*% } %*/
      /*% if (feature.MV_MM_MMV_MapSelectorInMenuElement) { %*/
      maps: [],
      /*% } %*/
    };
  },
  /*% } %*/
  mounted() {
    window.addEventListener("load", () => this.$emit("bar-items-loaded"));
    /*% if (feature.MV_MM_MMV_MapSelectorInMenuElement) { %*/
    this.maps = maps.maps.map((map, index) => {
      return {
        id: index,
        name: map.name,
        label: this.$t("mapViewer.map-label." + map.name.replace(".", "-")),
      };
    });
    /*% } %*/
  },
  beforeDestroy() {
    window.removeEventListener("load", this.resizeHandler);
  },
  computed: {
  /*% if (feature.UserManagement) { %*/
    ...mapAuthGetter(["isAdmin", "isLogged"/*% if (feature.MWM_EmployeeAuthentication) { %*/, "isEmployee"/*% } %*/]),
    loggedAs() {
      return this.isLogged
        ? this.$t("menu.loggedAs") +
        (this.isAdmin
          ? this.$t("menu.admin")
          /*% if (feature.MWM_EmployeeAuthentication) { %*/
          : this.isEmployee
            ? this.$t("menu.employee")
            /*% } %*/
            : this.$t("menu.registeredUser"))
        : "";
    },
    /*% if (feature.UM_UserProfile) { %*/
    langKey() {
      return this.user ? this.user.langKey : "/*%= data.basicData.languages[0].toLocaleUpperCase() %*/" ;
    }
    /*% } %*/
  /*% } %*/
  },
  /*% if (feature.UM_UserProfile || feature.MV_MapCustomization) { %*/
  watch: {
    /*% if (feature.UM_UserProfile) { %*/
    langKey(newValue, oldValue) {
      if (newValue != "") {
        if (oldValue === "" || newValue != oldValue) {
          this.changeLocale(newValue);
        }
      }
    },
    /*% } %*/
    /*% if (feature.MV_MapCustomization) { %*/
    isLogged(newVal) {
      if (newVal) this.loadCustomMaps();
    },
    /*% } %*/
  },
  /*% } %*/
  methods: {
    changeLocale(locale) {
      this.$i18n.locale = locale;
      /*% if (feature.UserManagement) { %*/
      auth.changeUserLang(locale);
      /*% } %*/
    },
  /*% if (feature.UserManagement) { %*/
    logout() {
      auth.logout()
        .then(
          this.$router.push({ name: "Home" })
        .catch(err => {
          //Do nothing if navigating to current route, otherwise throw error
          if (!err.name === 'NavigationDuplicated') {
            throw err;
          }
        }));
    },
  /*% } %*/
  /*% if (feature.MV_MapCustomization) { %*/
    loadCustomMaps() {
      mapRepository
        .getAll()
        .then((maps) => {
          return maps.map((map, index) => {
            return {
              id: index + this.maps.length,
              customId: map.id,
              name: map.label,
              label: map.label,
            };
          });
        })
        .then((data) => {
          this.maps = this.maps.filter((map) => !map.customId);
          this.maps.push(...data);
        });
    },
  /*% } %*/
  }
};
</script>
<style scoped>
.container {
  padding: 0px;
  height: 100%;
}
.v-btn:not(.v-btn--round).v-size--default {
  height: 100%;
}
.button-on-collapse {
  display: list-item;
  padding: 5px;
  justify-content: left;
}
.v-list {
  text-align: center;
  max-height: 70vh;
  overflow-y: auto;
}
.dropdown-content {
  max-height: 70vh;
  overflow-y: auto;
}
</style>
/*% } %*/
