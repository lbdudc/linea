# LINEA in Chrome

Each scenario starts its own LINEA (its own MongoDB, the dev GitLab/GitHub it needs, the server and the client), with a configuration of
git hosts and plugins, and walks through it in Chrome as the people it has.

```bash
cd e2e && npm install
npm test                 # every scenario (about 2 minutes)
npm test -- "all hosts"  # the scenarios whose name has these words
HEADED=1 npm test        # with the browser window
SHOTS=/some/folder npm test   # also saves screenshots of the profile switch
KEEP=1 npm test          # keeps the data folder of a stack (logs of the server and the dev hosts) for a look
```

Needs Google Chrome (it is used as it is installed, no browser is downloaded), Node 22 (`~/.nvm/versions/node/v22.23.3`) and the
workspace next to this repository (`../metamodels`, `../modules`: the registry is published from them).

| Scenario | Configuration | What it checks |
|---|---|---|
| local host only | server's repositories, no plugin | only administrators see and use Configuration (Git hosts / Plugins / Users: navigation, address, API 403); an administrator makes accounts, installs a plugin, makes another administrator; the last one cannot be removed |
| gitlab only | GitLab, analytics plugin | GitLab button only; the user of `ADMIN_USERS` is an administrator; a line made on GitLab is listed |
| github only | GitHub, analytics plugin | GitHub button only; GitHub's words; the plugin enabled at start |
| all hosts | local + GitLab + GitHub, analytics plugin | connecting accounts; the profile switch; one remote at a time (lines, words, new lines); the choice is kept; a plain person has no configuration and cannot use a remote they have no account on; switching a host off |
| local host security | server's repositories alone | git over HTTP with the levels of the host (a reporter reads and cannot push), the default branch cannot be force-pushed or deleted, the Members dialog, a renewed git token closes the old one, wrong passwords are limited per person, a disabled account cannot sign in |
| changing hosts | GitLab, analytics plugin | switching the server's repositories on does not move the primary host or the lines; the host of the registry cannot go; a host with people needs a yes; another tab hears that a plugin was switched off |
| plugin needs GitLab | server's repositories alone, agents plugin | the agents plugin is off, hidden and says why; enabling it is refused |
| upgrade | GitLab alone | data from before records named their host: switching the server's repositories on keeps GitLab primary, the line stays, and the primary cannot be handed over while records name no host |
| declared | `linea.config.yml`: GitLab primary + local + GitHub, analytics plugin | what the file declares is locked in the pages and in the API; the config download has no secrets; modules from the primary host |

The dev GitLab and GitHub have one person, `dev`, so a second person in a scenario is an account of the server.
Each stack uses its own ports (Mongo 27030+, server 3300+, client 9300+, GitLab 8091+, GitHub 8092+, ten apart per scenario).
