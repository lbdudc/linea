import express from "express";
import bodyParser from "body-parser";
import logger from "morgan";
import {
  userRouter,
  lineRouter,
  productRouter,
  logRouter,
  migrationRouter,
  dashboardRouter,
  pluginRouter,
  packageRouter,
  registryRouter,
  settingsRouter,
  healthRouter,
} from "./src/rest/routers/index.js";
import cors from "cors";
import compression from "compression";
import { Server as SocketIO } from "socket.io";
import http from "http";
import socketHandler from "./src/ws/socketManager.js";
import process from "process";
import { Container } from "typedi";
import DataSource from "./src/model/connectors/DataSource.js";
import { getClientOrigin, properties } from "./src/model/connectors/properties.js";
import { pruneWorkDirs } from "./src/model/services/workDirs.js";
import { onError } from "./src/rest/common/onError.js";
import { serverTiming } from "./src/rest/common/serverTiming.js";
import { wireDomainEventBridge } from "./src/model/events/domainEventBridge.js";
import schedulerRouter from "./src/rest/routers/schedulerRouter.js";
import cicdRouter from "./src/rest/routers/cicdRouter.js";
import repositoryRouter from "./src/rest/routers/repositoryRouter.js";
import mergeRequestRouter from "./src/rest/routers/mergeRequestRouter.js";
import notificationRouter from "./src/rest/routers/notificationRouter.js";
import { wireNotifications } from "./src/model/services/NotificationService.js";
import gitWebhookRouter from "./src/rest/routers/gitWebhookRouter.js";
import { startScheduler } from "./src/model/services/scheduler/index.js";
import { pluginHost, provisionList, deployConfig } from "./src/plugins/index.js";
import { configureInstance } from "./src/config/instanceSettings.js";
import { mongoInstanceStore } from "./src/model/entities/instanceSetting.js";
import { pruneAudit } from "./src/model/audit.js";
import { configureGitHosts, enabledHosts, getLocalProvider, onGitHostsChange } from "./src/model/git/index.js";
import { authenticateLocal } from "./src/model/git/localAccounts.js";
import { bootstrapLocalRegistry } from "./src/model/git/registryBootstrap.js";
import { createLocalGitHttp } from "@lbdudc/linea-git";
import UserService from "./src/model/services/UserService.js";
import { runMigrations } from "./src/model/migrations/index.js";
import { checkGitVersion, configProblems } from "./src/model/git/startupChecks.js";
import { clearGitTokenCache } from "./src/rest/common/auth.js";
import { forgetNamespaces } from "./src/model/services/LineService.js";
import { signInLimiter } from "./src/rest/common/rateLimit.js";
import domainEvents, { DOMAIN_EVENTS } from "./src/model/events/domainEvents.js";
import { unpinnedCount, usageOfHost } from "./src/model/git/usage.js";
import { mongoGitHostStore } from "./src/model/entities/gitHostSetting.js";
import dotenv from "dotenv";

dotenv.config();

// gitlab-commando's Command.execute() calls the bare global fetch with no
// signal at all (see node_modules/gitlab-commando/dist/commands/Command.js).
// Node's built-in fetch (undici) then falls back to its own default 300s
// headersTimeout — we confirmed a generation run sitting for exactly that
// long before failing with a generic 500, because one GitLab call silently
// never got a response. Default every unsignalled global fetch to a much
// shorter timeout so a stalled call fails fast, as the GitLabError/PermissionError
// etc. the callers already catch for, instead of hanging for 5 minutes.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  if (init.signal) return nativeFetch(input, init);
  return nativeFetch(input, { ...init, signal: AbortSignal.timeout(30000) });
};

process.on("SIGINT", () => process.exit(130));
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason);
});
// The timeout above stays armed after a request has finished: when it fires, a body that is still open errors with no listener left,
// which Node treats as fatal. That error alone is logged and survived; any other uncaught exception is a bug, so the process ends.
const isLateFetchTimeout = (error) => ["TimeoutError", "AbortError"].includes(error?.name);
process.on("uncaughtException", (error) => {
  console.error("[server] uncaughtException:", error);
  if (!isLateFetchTimeout(error)) process.exit(1);
});

pruneWorkDirs(properties.paths.output);

const port = process.env.port || 3000;
const mongoUrl = process.env.mongoUrl;

export const app = express();
// how many proxies stand in front (TRUST_PROXY: a number, true or false): the sign-in limits count real addresses, not the proxy's
app.set("trust proxy", ["true", "false"].includes(process.env.TRUST_PROXY) ? process.env.TRUST_PROXY === "true" : Number.isInteger(Number(process.env.TRUST_PROXY)) && process.env.TRUST_PROXY !== "" && process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1);

const httpSrv = http.createServer(app);
// a push over git can take longer than the five minutes node allows a request by default
httpSrv.requestTimeout = 30 * 60 * 1000;
const io = new SocketIO(httpSrv, {
  cors: {
    // (an origin is scheme, host and port: the old value had `/login` on it and matched nothing; without REDIRECT_URI, the same origin only)
    origin: getClientOrigin() ? [getClientOrigin()] : false,
  },
  // The generate pipeline briefly blocks the event loop during synchronous,
  // CPU-bound stages (e.g. spl-js-engine's template processing) that we don't
  // control the internals of. Socket.io's defaults (25s interval / 20s timeout,
  // ~45s total budget) are tight enough that those bursts were disconnecting
  // every connected client. Widening the timeout buys headroom without masking
  // a truly dead connection, which still gets caught, just later.
  pingInterval: 25000,
  pingTimeout: 60000,
});
export let server;

io.engine.on("connection_error", (err) => {
  console.error("[WS][socket.io][engine] connection_error", {
    code: err?.code,
    message: err?.message,
    context: err?.context,
    reqHeaders: err?.req?.headers
  });
});

io.use((socket, next) => {
  const h = socket.handshake || {};
  console.log("[WS][socket.io] handshake", {
    id: socket.id,
    address: socket.handshake?.address,
    origin: h.headers?.origin,
    referer: h.headers?.referer,
    ua: h.headers?.["user-agent"],
    transport: h.query?.transport,
    EIO: h.query?.EIO
  });
  next();
});

io.on("connection", (socket) => {
  console.log("[WS][socket.io] connected", { id: socket.id });
  socket.on("disconnect", (reason) => {
    console.warn("[WS][socket.io] disconnected", { id: socket.id, reason });
  });
});

app.use(cors({ exposedHeaders: ["Server-Timing"] }));
app.use(serverTiming);
app.use(compression());
app.use(logger("dev"));
// the repositories of the local git host, to `git clone` and `git push` (git does not speak JSON: before the body parser)
app.use("/git", (req, res, next) => {
  if (!enabledHosts().includes("local")) return next();
  createLocalGitHttp({
    provider: getLocalProvider(),
    authenticate: authenticateLocal,
    // (LINEA_MAX_PUSH_MB: the most one push may send; none by default)
    // a push that git accepted is an event of LINEA: whoever listens (a plugin) reacts to it
    onPush: (push) => domainEvents.emit(DOMAIN_EVENTS.GIT_PUSHED, { host: "local", ...push }),
    maxPushBytes: Number(process.env.LINEA_MAX_PUSH_MB) > 0 ? Number(process.env.LINEA_MAX_PUSH_MB) * 1024 * 1024 : undefined,
    // the same count as the sign-in with a password: git is another way to guess it
    throttle: ({ ip, username }) => signInLimiter.blocked({ ip, key: username.toLowerCase() }),
    onFailure: ({ ip, username }) => {
      signInLimiter.fail({ ip, key: username.toLowerCase() });
      console.warn(`[git] wrong credentials for ${username} from ${ip}`);
    },
  })(req, res).catch(next);
});
// the git hosts' push webhooks: signed over the raw bytes, so they read their own body
app.use("/api/webhooks", gitWebhookRouter);
const specJson = bodyParser.json({ limit: `${Number(process.env.LINEA_MAX_SPEC_MB) > 0 ? Number(process.env.LINEA_MAX_SPEC_MB) : 16}mb` });
app.patch("/api/products/:id", specJson);
app.post(["/api/lines/:id/derive-trial", "/api/lines/:id/trial-models/check"], specJson);
app.use("/api/plugins", (req, res, next) => (["POST", "PUT", "PATCH"].includes(req.method) ? specJson(req, res, next) : next()));
app.post(["/api/lines/:id/repo/commits", "/api/products/:id/repo/commits", "/api/packages/:kind/:id/repo/commits", "/api/repos/:id/commits"], specJson);
app.use(bodyParser.json({ limit: '512kb' }));
socketHandler(io);

app.use("/api/health", healthRouter);
// what moved into plugins keeps answering at its old paths for the callers that cannot change (the MCP server, say)
app.use(pluginHost.aliases);
app.use("/api/users", userRouter);
app.use("/api/lines", lineRouter);
app.use("/api/products", productRouter);
app.use("/api/logs", logRouter);
app.use("/api/migration", migrationRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/packages", packageRouter);
app.use("/api/registry", registryRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/scheduler", schedulerRouter);
app.use("/api/cicd", cicdRouter);
app.use("/api/notifications", notificationRouter);
// the code of a repository by its own id on a host (`?host=`), for the services that know a project and not the line or product
app.use("/api/repos/:id", repositoryRouter("repo"));
app.use("/api/repos/:id/mrs", mergeRequestRouter("repo"));
app.use("/api/plugins", pluginRouter);
app.set("io", io);

app.use(onError);

const dataSource = Container.get(DataSource);

dataSource
  .connect({ url: mongoUrl })
  .then(async () => {
    // each step says which it is when it fails: a server that cannot start must not look like a database that cannot be reached
    const step = async (name, run) => {
      try {
        return await run();
      } catch (error) {
        console.error(`Could not start (${name}):`, error.message);
        process.exit(1);
      }
    };
    // what is kept in MongoDB, brought to the shape this version reads
    await step("migrations", () => runMigrations({ context: { declared: deployConfig.gitHosts } }));
    // how this LINEA behaves (sign-in, modules, audit): the file's, else what an administrator saved, else the defaults
    await step("instance settings", () => configureInstance({ file: deployConfig.instance, store: mongoInstanceStore }));
    // the audit log keeps what the administrators chose, no more
    const prune = () => pruneAudit().catch((error) => console.error("[audit] could not prune:", error.message));
    await prune();
    setInterval(prune, 24 * 3600_000).unref();
    // the git hosts this deployment has: the file's, else what an administrator saved, else the environment's
    await step("git hosts", () => configureGitHosts({ file: deployConfig.gitHosts, hostStore: mongoGitHostStore, usageOf: usageOfHost, unpinnedCount }));
    // what an administrator's change of hosts needs made again (a host switched on has no registry or first accounts yet)
    onGitHostsChange(async () => {
      clearGitTokenCache();
      forgetNamespaces();
      await bootstrapLocalRegistry().catch((error) => console.error("[registry] could not be published:", error.message));
      await Container.get(UserService).ensureLocalAdmins();
    });
    await step("git", async () => {
      checkGitVersion();
      for (const problem of configProblems({ declared: deployConfig.gitHosts })) console.warn(`[config] ${problem}`);
    });
    // the metamodels and modules of a LINEA that keeps its repositories itself
    await bootstrapLocalRegistry().catch((error) => console.error("[registry] could not be published:", error.message));
    // the first administrators of the local host: someone has to be able to sign in
    await Container.get(UserService).ensureLocalAdmins();
    // plugins this deployment cannot do without (LINEA_PLUGINS=a,b: nobody may be there to switch them on)
    await step("plugins", () => pluginHost.start({ provision: provisionList() }));
    wireDomainEventBridge({ pluginTargets: () => pluginHost.eventUrls() });
    wireNotifications();
    // the syncs of the products that are due (instance settings `scheduler`: pause, concurrency)
    startScheduler();
    server = httpSrv.listen(port, "0.0.0.0");
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Is another instance of the server running?`);
      } else {
        console.error("Server error:", error.message);
      }
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
  });
