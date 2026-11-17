/*% if (feature.MV_MapCustomization) { %*/
import { HTTP } from "@/common/http-common";
import Logger from "js-logger";
const logger = Logger.get("logger");
const RESOURCE_NAME = "/maps";

export default {
    async exportState(map) {
        try {
            return (await HTTP.post(`${RESOURCE_NAME}`, map)).data;
        } catch (err) {
            logger.error("Error exporting map", map);
            throw err;
        }
    },
    async importState(id) {
        try {
            return (await HTTP.get(`${RESOURCE_NAME}/${id}`)).data;
        } catch (err) {
            logger.error("Error importing map for id " + id);
            throw err;
        }
    },
    async getAll() {
        try {
            return (await HTTP.get(`${RESOURCE_NAME}`)).data;
        } catch (err) {
            logger.error("Error getting maps list " + id);
            throw err;
        }
    },
    async updateState(id, map) {
        try {
            return (await HTTP.put(`${RESOURCE_NAME}/${id}`, map)).data;
        } catch (err) {
            logger.error("Error updating map with id " + id, map);
            throw err;
        }
    },
    async deleteMap(id) {
        try {
            return await HTTP.delete(`${RESOURCE_NAME}/${id}`);
        } catch (err) {
            logger.error("Error deleting map with id " + id);
            throw err;
        }
    },
};
/*% } %*/
