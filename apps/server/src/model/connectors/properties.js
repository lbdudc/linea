import yaml from "js-yaml";
import fs from "fs";
import os from "os";
import path from "path";
import process from "process";
import dotenv from "dotenv";
import { instance } from "../../config/instanceSettings.js";

// Base env file, then local overrides — mirrors how docker-compose merges
// server/.env + server/.env.local for the containerized server (see
// deploy/docker-compose.yml), so `npm run dev` outside Docker behaves the same way.
// Skipped under vitest: tests pin their own environment (src/test/support/env.setup.js)
// and must not be altered by a developer's local .env / .env.local.
if (!process.env.VITEST) {
  dotenv.config();
  dotenv.config({ path: ".env.local", override: true });
}

const __dirname = path.resolve();
export let properties;

try {
  properties = yaml.load(
    fs.readFileSync(
      path.join(__dirname, "src/resources/properties.yml"),
      "utf8"
    )
  );
  properties.paths.output = path.join(os.tmpdir(), "linea-generations");
} catch (e) {
  console.error(e);
}

const mongoUrl = process.env.mongoUrl;

export function getMongoUrl() {
  return mongoUrl || `mongodb://${properties.db.hostname}:${properties.db.port}/${properties.db.schema}`;
}

export function getGitLabRedirectUri() {
  return `${process.env.REDIRECT_URI}/login`;
}

/** The origin the client is served from (an origin has no path): where sockets may come from. */
export function getClientOrigin() {
  try {
    return new URL(process.env.REDIRECT_URI).origin;
  } catch {
    return undefined;
  }
}

export function getJwtSignKey() {
  return process.env.JWT_SIGN_KEY;
}

/** How long a session lasts: the administrator's choice (Configuration > Sign-in), else `jwt.expirationSeconds` of properties.yml. */
export function getJwtExpirationSeconds() {
  return Math.round(instance('sessionHours') * 3600);
}

/** The usernames in `ADMIN_USERS` (comma-separated) are administrators of this LINEA: they can install and switch plugins. */
export function getAdminUsernames() {
  return (process.env.ADMIN_USERS ?? '').split(',').map((name) => name.trim()).filter(Boolean);
}
