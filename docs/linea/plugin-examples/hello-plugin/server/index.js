// An in-process plugin: it lives in the server's process and reaches LINEA only through `ctx`.
// (in memory: it restarts at 0 with the server and counts only while the plugin is enabled)
let generated = 0;

export default {
  register(ctx) {
    const { requireAuth, asyncHandler, userRepository } = ctx.services;
    const router = ctx.router(); // mounted at /api/plugins/hello-plugin, reached only while the plugin is enabled

    const greeting = () => {
      const { greeting: word, shout } = ctx.settings();
      return shout ? String(word).toUpperCase() : String(word);
    };

    router.get('/greeting', requireAuth, asyncHandler(async (req, res) => {
      // requireAuth sets only `req.userId`: the account is looked up
      const user = await userRepository.findById(req.userId);
      res.json({ greeting: greeting(), user: user?.username ?? null, generated });
    }));

    // the listener is skipped by the host while the plugin is disabled
    ctx.events.on('product:generated', () => { generated += 1; });

    ctx.onSettingsChange((fresh) => console.info(`[hello-plugin] settings changed: greeting="${fresh.greeting}"`));
  },
};
